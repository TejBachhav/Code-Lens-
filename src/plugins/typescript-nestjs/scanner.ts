/**
 * CodeLens — TypeScript/NestJS Tier 1 Scanner
 *
 * Uses ts-morph to scan NestJS controller files and extract endpoint records.
 * Handles: @Controller(), @Get/@Post/@Put/@Delete/@Patch decorators,
 *          @Param/@Query/@Body parameter decorators, @UseGuards auth detection,
 *          @HttpCode status codes, Promise<T>/Observable<T> return types.
 */

import * as path from 'path';
import * as fs from 'fs';
import { Project, Node, SyntaxKind, SourceFile, ClassDeclaration, MethodDeclaration } from 'ts-morph';
import {
  EndpointRecord,
  HttpMethod,
  ParamRecord,
  AuthRecord,
  RequestBodyRecord,
  DecoratorRecord,
} from '../../shared/types';
import {
  generateEndpointId,
  composePath,
  normalizePath,
  extractPathParams,
  toRelativePath,
  normalizeHttpMethod,
  pathParam,
  queryParam,
  unresolvedSchema,
} from '../../shared/utils';
import { Logger } from '../../shared/logger';
import { unwrapPromiseType, resolveTypeToJsonSchema } from '../shared/typescriptAstUtils';

const logger = Logger.create('nestjs-scanner');

const HTTP_METHOD_DECORATORS: Record<string, HttpMethod> = {
  Get: 'GET', Post: 'POST', Put: 'PUT', Delete: 'DELETE',
  Patch: 'PATCH', Options: 'OPTIONS', Head: 'HEAD',
};

const AUTH_GUARD_NAMES = new Set([
  'AuthGuard', 'JwtAuthGuard', 'LocalAuthGuard', 'RolesGuard',
  'ApiKeyGuard', 'BasicAuthGuard', 'OAuth2Guard',
]);

/**
 * Scan NestJS TypeScript files using ts-morph.
 */
export async function scanNestJsFiles(
  files: string[],
  workspaceRoot: string,
): Promise<EndpointRecord[]> {
  const endpoints: EndpointRecord[] = [];

  const tsConfigPath = path.join(workspaceRoot, 'tsconfig.json');
  const project = fs.existsSync(tsConfigPath)
    ? new Project({ tsConfigFilePath: tsConfigPath, skipAddingFilesFromTsConfig: true })
    : new Project({ compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true } });

  for (const f of files) {
    try { project.addSourceFileAtPath(f); } catch { /* ignore */ }
  }

  for (const sf of project.getSourceFiles()) {
    const relPath = toRelativePath(sf.getFilePath(), workspaceRoot);
    try {
      const fileEndpoints = extractControllersFromFile(sf, relPath);
      endpoints.push(...fileEndpoints);
    } catch (err) {
      logger.warn(`Failed to scan NestJS file: ${sf.getFilePath()}`, err);
    }
  }

  return endpoints;
}

// ─── Controller Extraction ────────────────────────────────────────────────────

function extractControllersFromFile(sf: SourceFile, relPath: string): EndpointRecord[] {
  const endpoints: EndpointRecord[] = [];

  for (const cls of sf.getClasses()) {
    const controllerDec = cls.getDecorator('Controller');
    if (!controllerDec) continue;

    const basePath = getDecoratorStringArg(controllerDec) ?? '';

    // Class-level guards
    const classGuards = extractGuards(cls);
    const classAuth = classGuards.length > 0 ? buildAuthRecord(classGuards) : undefined;

    // Class-level decorators
    const classDecorators: DecoratorRecord[] = cls.getDecorators().map(d => ({
      name: d.getName(),
      arguments: d.getArguments().map(a => a.getText()),
    }));

    for (const method of cls.getMethods()) {
      const methodEndpoints = extractMethodEndpoints(
        method, cls, basePath, relPath, classAuth, classDecorators,
      );
      endpoints.push(...methodEndpoints);
    }
  }

  return endpoints;
}

function extractMethodEndpoints(
  method: MethodDeclaration,
  cls: ClassDeclaration,
  basePath: string,
  relPath: string,
  classAuth: AuthRecord | undefined,
  classDecorators: DecoratorRecord[],
): EndpointRecord[] {
  const endpoints: EndpointRecord[] = [];

  for (const [decoratorName, httpMethod] of Object.entries(HTTP_METHOD_DECORATORS)) {
    const routeDec = method.getDecorator(decoratorName);
    if (!routeDec) continue;

    const subPath = getDecoratorStringArg(routeDec) ?? '';
    const fullPath = composePath(basePath, subPath);

    // Status code from @HttpCode()
    const httpCodeDec = method.getDecorator('HttpCode');
    const statusCode = httpCodeDec
      ? parseInt(httpCodeDec.getArguments()[0]?.getText() ?? '200', 10)
      : 200;

    // Method-level guards
    const methodGuards = extractGuards(method as any);
    const methodAuth = methodGuards.length > 0 ? buildAuthRecord(methodGuards) : classAuth;

    // Parameters
    const { params, requestBody } = extractParameters(method, fullPath);

    // Return type for response schema hint
    let returnTypeName: string | undefined;
    try {
      const returnType = method.getReturnType();
      returnTypeName = unwrapPromiseType(returnType)?.getText();
    } catch { /* ignore */ }

    // All decorators for record-keeping
    const decorators: DecoratorRecord[] = method.getDecorators().map(d => ({
      name: d.getName(),
      arguments: d.getArguments().map(a => a.getText()),
    }));

    const handlerName = method.getName();
    const className = cls.getName() ?? 'UnknownController';

    const id = generateEndpointId(httpMethod, fullPath, `${className}.${handlerName}`);

    const endpoint: EndpointRecord = {
      id,
      method: httpMethod,
      path: fullPath,
      handler: {
        name: handlerName,
        className,
        modulePath: relPath,
        isAsync: method.isAsync(),
      },
      params,
      requestBody,
      auth: methodAuth,
      middleware: extractInterceptors(method as any),
      decorators,
      framework: 'nestjs',
      language: 'typescript',
      sourceFile: relPath,
      sourceLines: [method.getStartLineNumber(), method.getEndLineNumber()],
    };

    // Pre-fill response schema from return type if available
    if (returnTypeName && returnTypeName !== 'void' && returnTypeName !== 'undefined') {
      endpoint.responseSchemas = [{
        statusCode,
        contentType: 'application/json',
        schema: unresolvedSchema(`Return type: ${returnTypeName} — resolve DTO in Tier 2`),
      }];
    }

    endpoints.push(endpoint);
  }

  return endpoints;
}

// ─── Parameter Extraction ─────────────────────────────────────────────────────

function extractParameters(
  method: MethodDeclaration,
  fullPath: string,
): { params: ParamRecord[]; requestBody: RequestBodyRecord | undefined } {
  const params: ParamRecord[] = [];
  let requestBody: RequestBodyRecord | undefined;

  const pathParamNames = extractPathParams(fullPath);

  for (const param of method.getParameters()) {
    const paramDec = param.getDecorator('Param');
    const queryDec = param.getDecorator('Query');
    const bodyDec = param.getDecorator('Body');

    let typeStr = 'string';
    try {
      typeStr = param.getType().getText();
      // Simplify common types
      if (typeStr === 'number') typeStr = 'integer';
      else if (!['string', 'integer', 'boolean', 'number'].includes(typeStr)) typeStr = '__UNRESOLVED__';
    } catch { /* ignore */ }

    if (paramDec) {
      const paramName = getDecoratorStringArg(paramDec) ?? param.getName();
      params.push({
        name: paramName,
        in: 'path',
        type: typeStr,
        required: true,
      });
    } else if (queryDec) {
      const queryName = getDecoratorStringArg(queryDec) ?? param.getName();
      const isOptional = param.isOptional() || param.hasInitializer();
      params.push({
        name: queryName,
        in: 'query',
        type: typeStr,
        required: !isOptional,
      });
    } else if (bodyDec) {
      let bodyTypeName: string | undefined;
      try {
        bodyTypeName = param.getType().getText();
      } catch { /* ignore */ }

      requestBody = {
        contentType: 'application/json',
        schema: bodyTypeName
          ? unresolvedSchema(`DTO: ${bodyTypeName} — resolve in Tier 2`)
          : unresolvedSchema('Body type not resolvable'),
        required: !param.isOptional(),
        typeName: bodyTypeName,
      };
    }
  }

  // Ensure all path params in the route are covered
  for (const pName of pathParamNames) {
    if (!params.find(p => p.name === pName)) {
      params.push(pathParam(pName));
    }
  }

  return { params, requestBody };
}

// ─── Guards & Interceptors ────────────────────────────────────────────────────

function extractGuards(node: ClassDeclaration | MethodDeclaration): string[] {
  const guardDec = (node as any).getDecorator?.('UseGuards');
  if (!guardDec) return [];
  return guardDec.getArguments().map((a: any) => a.getText());
}

function extractInterceptors(node: ClassDeclaration | MethodDeclaration): string[] {
  const dec = (node as any).getDecorator?.('UseInterceptors');
  if (!dec) return [];
  return dec.getArguments().map((a: any) => a.getText());
}

function buildAuthRecord(guards: string[]): AuthRecord {
  const known = guards.find(g => AUTH_GUARD_NAMES.has(g));
  return {
    type: known?.toLowerCase().includes('jwt') ? 'bearer' : 'custom',
    guardName: guards[0],
  };
}

// ─── Decorator Helpers ────────────────────────────────────────────────────────

function getDecoratorStringArg(dec: any): string | undefined {
  const args = dec.getArguments?.() ?? [];
  if (args.length === 0) return undefined;
  const arg = args[0];
  if (Node.isStringLiteral(arg)) return arg.getLiteralValue();
  return arg.getText().replace(/['"]/g, '');
}
