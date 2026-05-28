/**
 * CodeLens — Python/Flask Tier 1 Scanner
 *
 * Scans Flask source files and extracts endpoint records using web-tree-sitter.
 * Handles: @app.route(), Blueprint routes, Flask-RESTful Resource classes,
 *          URL converters (<int:id>), stacked auth decorators.
 */

import * as path from 'path';
import * as fs from 'fs';
import Parser from 'web-tree-sitter';
import {
  EndpointRecord,
  HttpMethod,
  ParamRecord,
  AuthRecord,
  DecoratorRecord,
} from '../../shared/types';
import { FLASK_CONVERTER_MAP, PYTHON_TYPE_MAP } from '../../shared/constants';
import {
  generateEndpointId,
  normalizePath,
  composePath,
  extractPathParams,
  toRelativePath,
  normalizeHttpMethod,
  pathParam,
  queryParam,
} from '../../shared/utils';
import { Logger } from '../../shared/logger';
import { resolvePythonPrefixes } from '../shared/pythonPrefixResolver';
import {
  extractDecoratorArgs,
  findNodesByType,
  findAllNodes,
  stripQuotes,
} from '../shared/pythonAstUtils';

/** Inline helper — get text of any AST node */
const getNodeText = (node: Parser.SyntaxNode): string => node.text;

/** Inline helper — find first descendant of given type */
function findDescendantOfType(node: Parser.SyntaxNode, type: string): Parser.SyntaxNode | null {
  return findAllNodes(node, n => n.type === type)[0] ?? null;
}

/** Inline helper — find all descendants of given type */
function findAllDescendantsOfType(node: Parser.SyntaxNode, type: string): Parser.SyntaxNode[] {
  return findAllNodes(node, n => n.type === type);
}

const logger = Logger.create('flask-scanner');

let _parser: Parser | null = null;

async function getParser(workspaceRoot: string): Promise<Parser> {
  if (_parser) return _parser;
  await Parser.init();
  _parser = new Parser();
  
  const wasmPath = path.join(workspaceRoot, 'node_modules', 'web-tree-sitter', 'tree-sitter-python.wasm');
  const devPath = path.join(__dirname, '..', '..', '..', 'grammars', 'tree-sitter-python.wasm');
  const prodPath = path.join(__dirname, 'grammars', 'tree-sitter-python.wasm');
  const siblingPath = path.join(__dirname, '..', 'grammars', 'tree-sitter-python.wasm');
  
  let grammarPath = devPath;
  if (fs.existsSync(wasmPath)) {
    grammarPath = wasmPath;
  } else if (fs.existsSync(prodPath)) {
    grammarPath = prodPath;
  } else if (fs.existsSync(siblingPath)) {
    grammarPath = siblingPath;
  } else if (fs.existsSync(devPath)) {
    grammarPath = devPath;
  }
  
  const Python = await Parser.Language.load(grammarPath);
  _parser.setLanguage(Python);
  return _parser;
}

/** Known auth decorator names that indicate authentication is required */
const AUTH_DECORATORS = new Set([
  'login_required', 'requires_auth', 'jwt_required', 'token_required',
  'auth_required', 'require_auth', 'requires_login', 'authenticated',
]);

/**
 * Scan Python Flask files and extract all endpoint records.
 */
export async function scanFlaskFiles(
  files: string[],
  workspaceRoot: string,
): Promise<EndpointRecord[]> {
  const parser = await getParser(workspaceRoot);
  const endpoints: EndpointRecord[] = [];

  // Pass 1: Resolve prefixes across files
  const filePrefixMaps = await resolvePythonPrefixes(files, workspaceRoot, parser);

  for (const filePath of files) {
    try {
      const source = fs.readFileSync(filePath, 'utf-8');
      const tree = parser.parse(source);
      const relPath = toRelativePath(filePath, workspaceRoot);
      const prefixMap = filePrefixMaps.get(filePath) || new Map<string, string>();

      // First pass: detect Blueprint definitions and their url_prefix
      const blueprints = detectBlueprints(tree.rootNode);

      // Second pass: find Flask-RESTful Resource classes
      const resourceEndpoints = scanResourceClasses(tree.rootNode, filePath, relPath, workspaceRoot);
      endpoints.push(...resourceEndpoints);

      // Third pass: find @app.route / @bp.route decorated functions
      const routeEndpoints = scanDecoratedRoutes(tree.rootNode, filePath, relPath, workspaceRoot, blueprints, prefixMap);
      endpoints.push(...routeEndpoints);

    } catch (err) {
      logger.warn(`Failed to scan Flask file: ${filePath}`, err);
    }
  }

  return endpoints;
}

// ─── Blueprint Detection ─────────────────────────────────────────────────────

interface BlueprintInfo {
  varName: string;
  urlPrefix?: string;
}

function detectBlueprints(rootNode: Parser.SyntaxNode): Map<string, BlueprintInfo> {
  const blueprints = new Map<string, BlueprintInfo>();

  const assignments = findAllDescendantsOfType(rootNode, 'assignment');
  for (const node of assignments) {
    const right = node.childForFieldName('right');
    if (!right || right.type !== 'call') continue;
    const fn = right.childForFieldName('function');
    if (!fn) continue;

    const fnText = getNodeText(fn);
    if (fnText !== 'Blueprint') continue;

    const left = node.childForFieldName('left');
    if (!left) continue;
    const varName = getNodeText(left);

    const { positional, keyword } = extractDecoratorArgs(node);
    const urlPrefixKw = keyword.find(k => k.key === 'url_prefix');
    const urlPrefix = urlPrefixKw ? stripQuotes(urlPrefixKw.value) : undefined;

    blueprints.set(varName, { varName, urlPrefix: urlPrefix?.replace(/['"]/g, '') });
  }

  return blueprints;
}

// ─── @app.route / @bp.route Scanning ─────────────────────────────────────────

function scanDecoratedRoutes(
  rootNode: Parser.SyntaxNode,
  filePath: string,
  relPath: string,
  workspaceRoot: string,
  blueprints: Map<string, BlueprintInfo>,
  prefixMap: Map<string, string>,
): EndpointRecord[] {
  const endpoints: EndpointRecord[] = [];
  const decorated = findAllDescendantsOfType(rootNode, 'decorated_definition');

  for (const node of decorated) {
    try {
      const endpoint = extractRouteFromDecorated(node, filePath, relPath, blueprints, prefixMap);
      if (endpoint) endpoints.push(endpoint);
    } catch (err) {
      logger.warn(`Failed to extract Flask route`, err);
    }
  }

  return endpoints;
}

function extractRouteFromDecorated(
  node: Parser.SyntaxNode,
  filePath: string,
  relPath: string,
  blueprints: Map<string, BlueprintInfo>,
  prefixMap: Map<string, string>,
): EndpointRecord | null {
  // Collect all decorator nodes
  const decorators: Parser.SyntaxNode[] = [];
  const funcDef = node.childForFieldName('definition');
  if (!funcDef || funcDef.type !== 'function_definition') return null;

  for (const child of node.children) {
    if (child.type === 'decorator') decorators.push(child);
  }

  if (decorators.length === 0) return null;

  let routePath: string | null = null;
  let methods: HttpMethod[] = ['GET'];
  let instanceName: string | null = null;
  let urlPrefix: string | undefined;
  const authRecord: Partial<AuthRecord> = {};
  const decoratorRecords: DecoratorRecord[] = [];

  for (const dec of decorators) {
    const decName = getDecoratorName(dec);
    if (!decName) continue;

    // Check for auth decorators
    const lastPart = decName.split('.').pop() || '';
    if (AUTH_DECORATORS.has(lastPart)) {
      authRecord.type = 'custom';
      authRecord.decoratorName = lastPart;
    }

    // Check for .route() decorator
    if (lastPart === 'route') {
      const parts = decName.split('.');
      instanceName = parts.slice(0, -1).join('.');

      // Get url_prefix from blueprints or our prefix map
      const crossFilePrefix = prefixMap.get(instanceName);
      if (crossFilePrefix !== undefined) {
        urlPrefix = crossFilePrefix;
      } else {
        const bp = blueprints.get(instanceName);
        if (bp) urlPrefix = bp.urlPrefix;
      }

      const callNode = findDescendantOfType(dec, 'call');
      if (!callNode) continue;
      const { positional: decPositional, keyword: decKeyword } = extractDecoratorArgs(dec);
      if (decPositional.length > 0) {
        routePath = stripQuotes(decPositional[0].value);
      }

      const methodsKw = decKeyword.find(k => k.key === 'methods');
      if (methodsKw) {
        // methods kwarg value is like "['GET', 'POST']" — parse it
        const rawMethods = methodsKw.value.replace(/[\[\]'"\s]/g, '').split(',');
        const parsed = rawMethods
          .map(m => normalizeHttpMethod(m))
          .filter((m): m is HttpMethod => m !== undefined);
        if (parsed.length > 0) methods = parsed;
      }

      decoratorRecords.push({ name: 'route', arguments: decPositional.map(p => p.value) });
    }
  }

  if (!routePath) return null;

  const handlerName = getNodeText(funcDef.childForFieldName('name')!);
  const params = funcDef.childForFieldName('parameters');
  const isAsync = funcDef.children[0]?.type === 'async';

  const fullPath = urlPrefix ? composePath(urlPrefix, routePath) : normalizePath(routePath);
  const pathParams = extractPathParams(fullPath);

  const paramRecords: ParamRecord[] = [];

  // Extract path params from URL converter patterns
  extractFlaskPathParams(routePath, paramRecords);

  // Fill in params from function signature that aren't already accounted for
  if (params) {
    const sigParams = extractFunctionSignatureParams(params, pathParams);
    for (const p of sigParams) {
      if (!paramRecords.find(ep => ep.name === p.name)) {
        paramRecords.push(p);
      }
    }
  }

  // Generate one endpoint per method (Flask allows multiple methods on one route)
  const primaryMethod = methods[0] || 'GET';
  const id = generateEndpointId(primaryMethod, fullPath, handlerName);

  return {
    id,
    method: primaryMethod,
    path: fullPath,
    handler: {
      name: handlerName,
      modulePath: relPath,
      isAsync,
    },
    params: paramRecords,
    auth: authRecord.type ? (authRecord as AuthRecord) : undefined,
    middleware: [],
    decorators: decoratorRecords,
    framework: 'flask',
    language: 'python',
    sourceFile: relPath,
    sourceLines: [node.startPosition.row + 1, node.endPosition.row + 1],
  };
}

// ─── Flask-RESTful Resource Classes ──────────────────────────────────────────

function scanResourceClasses(
  rootNode: Parser.SyntaxNode,
  filePath: string,
  relPath: string,
  workspaceRoot: string,
): EndpointRecord[] {
  const endpoints: EndpointRecord[] = [];
  const classDefs = findAllDescendantsOfType(rootNode, 'class_definition');

  for (const cls of classDefs) {
    const superclasses = cls.childForFieldName('superclasses');
    if (!superclasses) continue;

    const superText = getNodeText(superclasses);
    if (!superText.includes('Resource')) continue;

    const className = getNodeText(cls.childForFieldName('name')!);
    const body = cls.childForFieldName('body');
    if (!body) continue;

    const methods = findAllDescendantsOfType(body, 'function_definition');
    for (const method of methods) {
      const methodName = getNodeText(method.childForFieldName('name')!);
      const httpMethod = normalizeHttpMethod(methodName);
      if (!httpMethod) continue;

      // We can't know the path without add_resource() call — mark as placeholder
      const placeholderPath = `/__UNRESOLVED__/${className.toLowerCase()}`;
      const id = generateEndpointId(httpMethod, placeholderPath, `${className}.${methodName}`);
      const isAsync = method.children[0]?.type === 'async';

      endpoints.push({
        id,
        method: httpMethod,
        path: placeholderPath,
        handler: {
          name: methodName,
          className,
          modulePath: relPath,
          isAsync,
        },
        params: [],
        middleware: [],
        decorators: [],
        framework: 'flask',
        language: 'python',
        sourceFile: relPath,
        sourceLines: [method.startPosition.row + 1, method.endPosition.row + 1],
      });
    }
  }

  // Try to resolve paths from api.add_resource() calls
  resolveResourcePaths(rootNode, endpoints);

  return endpoints;
}

function resolveResourcePaths(
  rootNode: Parser.SyntaxNode,
  endpoints: EndpointRecord[],
): void {
  const calls = findAllDescendantsOfType(rootNode, 'call');
  for (const call of calls) {
    const fn = call.childForFieldName('function');
    if (!fn) continue;
    const fnText = getNodeText(fn);
    if (!fnText.endsWith('.add_resource')) continue;

    const args = call.childForFieldName('arguments');
    if (!args) continue;
    // Call nodes have arguments child, not decorator nodes — parse directly
    const argNodes = args.namedChildren;
    if (argNodes.length < 2) continue;

    const className = stripQuotes(argNodes[0].text);
    const routePath = normalizePath(stripQuotes(argNodes[1].text));

    // Update placeholder paths for matching Resource class
    for (const ep of endpoints) {
      if (ep.handler.className === className && ep.path.includes('__UNRESOLVED__')) {
        ep.path = routePath;
        ep.id = generateEndpointId(ep.method, routePath, ep.handler.name);

        // Update path params
        const pathParams = extractPathParams(routePath);
        for (const pName of pathParams) {
          if (!ep.params.find(p => p.name === pName)) {
            ep.params.push(pathParam(pName));
          }
        }
      }
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getDecoratorName(decNode: Parser.SyntaxNode): string | null {
  for (const child of decNode.children) {
    if (child.type === 'call') {
      const fn = child.childForFieldName('function');
      return fn ? getNodeText(fn) : null;
    }
    if (child.type === 'attribute' || child.type === 'identifier') {
      return getNodeText(child);
    }
  }
  return null;
}

function extractFlaskPathParams(routePath: string, params: ParamRecord[]): void {
  // Match Flask <type:name> or <name> patterns
  const regex = /<(?:(\w+):)?(\w+)>/g;
  let match;
  while ((match = regex.exec(routePath)) !== null) {
    const converterType = match[1] || 'string';
    const paramName = match[2];
    const jsonType = FLASK_CONVERTER_MAP[converterType] || 'string';
    params.push({
      name: paramName,
      in: 'path',
      type: jsonType,
      required: true,
    });
  }
}

function extractFunctionSignatureParams(
  paramsNode: Parser.SyntaxNode,
  pathParamNames: string[],
): ParamRecord[] {
  const params: ParamRecord[] = [];

  for (const child of paramsNode.children) {
    if (child.type === 'identifier') {
      const name = getNodeText(child);
      if (name === 'self' || name === 'cls') continue;
      if (!pathParamNames.includes(name)) {
        params.push(queryParam(name, 'string', false));
      }
    } else if (child.type === 'typed_parameter') {
      const nameNode = child.childForFieldName('name');
      if (!nameNode) continue;
      const name = getNodeText(nameNode);
      if (name === 'self' || name === 'cls') continue;
      const typeNode = child.childForFieldName('type');
      const typeStr = typeNode ? PYTHON_TYPE_MAP[getNodeText(typeNode)] || 'string' : 'string';
      if (!pathParamNames.includes(name)) {
        params.push(queryParam(name, typeStr, false));
      }
    }
  }

  return params;
}
