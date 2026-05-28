/**
 * CodeLens — TypeScript/Express Tier 1 Scanner
 *
 * Uses ts-morph to scan Express.js TypeScript files and extract endpoint records.
 * Handles: app.get/post/put/delete/patch, express.Router(), app.use() mounting,
 *          middleware chains, typed request/response handlers.
 */

import * as path from 'path';
import * as fs from 'fs';
import { Project, SyntaxKind, Node, CallExpression, SourceFile } from 'ts-morph';
import {
  EndpointRecord,
  HttpMethod,
  ParamRecord,
} from '../../shared/types';
import {
  generateEndpointId,
  normalizePath,
  composePath,
  extractPathParams,
  toRelativePath,
  normalizeHttpMethod,
  pathParam,
} from '../../shared/utils';
import { Logger } from '../../shared/logger';
import { resolveExpressPrefixes } from '../shared/expressPrefixResolver';

const logger = Logger.create('express-scanner');

const HTTP_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch', 'options', 'head', 'all']);

/**
 * Scan TypeScript Express files using ts-morph.
 */
export async function scanExpressFiles(
  files: string[],
  workspaceRoot: string,
): Promise<EndpointRecord[]> {
  const endpoints: EndpointRecord[] = [];

  // Run Pass 1: Resolve Express mount prefixes globally
  const resolvedPrefixes = resolveExpressPrefixes(files, workspaceRoot);

  // Initialize ts-morph project
  const tsConfigPath = path.join(workspaceRoot, 'tsconfig.json');
  const project = fs.existsSync(tsConfigPath)
    ? new Project({ tsConfigFilePath: tsConfigPath, skipAddingFilesFromTsConfig: true })
    : new Project({ compilerOptions: { allowJs: true, checkJs: false } });

  // Add only the target files
  for (const f of files) {
    try {
      project.addSourceFileAtPath(f);
    } catch (err) {
      logger.warn(`Could not add file to ts-morph: ${f}`, err);
    }
  }

  // Second pass: extract routes
  for (const sf of project.getSourceFiles()) {
    const relPath = toRelativePath(sf.getFilePath(), workspaceRoot);
    const absPath = path.resolve(sf.getFilePath());
    const prefixes = resolvedPrefixes.get(absPath) || [''];

    try {
      const fileEndpoints = extractExpressRoutes(sf, relPath, prefixes);
      endpoints.push(...fileEndpoints);
    } catch (err) {
      logger.warn(`Failed to scan Express file: ${sf.getFilePath()}`, err);
    }
  }

  return endpoints;
}

// ─── Route Extraction ─────────────────────────────────────────────────────────

function extractExpressRoutes(
  sf: SourceFile,
  relPath: string,
  prefixes: string[],
): EndpointRecord[] {
  const endpoints: EndpointRecord[] = [];
  const callExprs = sf.getDescendantsOfKind(SyntaxKind.CallExpression);

  for (const call of callExprs) {
    try {
      const routeEndpoints = extractRouteFromCall(call, relPath, prefixes);
      if (routeEndpoints) endpoints.push(...routeEndpoints);
    } catch (err) {
      logger.warn('Failed to extract Express route from call expression', err);
    }
  }

  return endpoints;
}

function extractRouteFromCall(
  call: CallExpression,
  relPath: string,
  prefixes: string[],
): EndpointRecord[] | null {
  const expr = call.getExpression();
  if (!Node.isPropertyAccessExpression(expr)) return null;

  const methodName = expr.getName().toLowerCase();
  if (!HTTP_METHODS.has(methodName) || methodName === 'use' || methodName === 'all') return null;

  const httpMethod = normalizeHttpMethod(methodName);
  if (!httpMethod) return null;

  const args = call.getArguments();
  if (args.length < 2) return null;

  // First arg should be the path string
  const pathArg = args[0];
  if (!Node.isStringLiteral(pathArg) && !Node.isNoSubstitutionTemplateLiteral(pathArg)) return null;

  const rawPath = Node.isStringLiteral(pathArg)
    ? pathArg.getLiteralValue()
    : pathArg.getText().replace(/`/g, '');

  // Find middleware (arguments between path and handler)
  const middleware: string[] = [];
  const handlerArg = args[args.length - 1];
  for (let i = 1; i < args.length - 1; i++) {
    middleware.push(args[i].getText());
  }

  // Extract handler name
  let handlerName = 'anonymous';
  let isAsync = false;

  if (Node.isArrowFunction(handlerArg) || Node.isFunctionExpression(handlerArg)) {
    // We use a temporary dummy path to form the handler name if prefix is empty
    handlerName = `${methodName}${rawPath.replace(/[^a-zA-Z0-9]/g, '_')}`;
    isAsync = handlerArg.isAsync();
  } else if (Node.isIdentifier(handlerArg)) {
    handlerName = handlerArg.getText();
  } else if (Node.isPropertyAccessExpression(handlerArg)) {
    handlerName = handlerArg.getName();
  }

  // Get source position
  const startLine = call.getStartLineNumber();
  const endLine = call.getEndLineNumber();

  const records: EndpointRecord[] = [];

  for (const mountPrefix of prefixes) {
    const fullPath = mountPrefix ? composePath(mountPrefix, rawPath) : normalizePath(rawPath);
    const pathParamNames = extractPathParams(fullPath);
    const params: ParamRecord[] = pathParamNames.map(name => pathParam(name));
    const id = generateEndpointId(httpMethod, fullPath, handlerName);

    records.push({
      id,
      method: httpMethod,
      path: fullPath,
      handler: {
        name: handlerName,
        modulePath: relPath,
        isAsync,
      },
      params,
      middleware,
      decorators: [],
      framework: 'express',
      language: 'typescript',
      sourceFile: relPath,
      sourceLines: [startLine, endLine],
    });
  }

  return records;
}
