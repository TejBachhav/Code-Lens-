/**
 * CodeLens — Python FastAPI Scanner (Tier 1)
 *
 * Uses web-tree-sitter with the Python grammar to perform deterministic
 * AST-based extraction of FastAPI endpoint definitions.
 *
 * Detects:
 * - @app.get/post/put/delete/patch/options/head() decorators
 * - Route paths, response_model, status_code, tags, dependencies
 * - Function parameters with type annotations
 * - Depends() for dependency injection / auth
 * - Path params vs query params
 * - Pydantic model references in function params
 */

import * as fs from 'fs';
import * as path from 'path';
import Parser from 'web-tree-sitter';

import {
  EndpointRecord,
  HttpMethod,
  ParamRecord,
  HandlerInfo,
  DecoratorRecord,
  AuthRecord,
  RequestBodyRecord,
} from '../../shared/types';
import { UNRESOLVED, PYTHON_TYPE_MAP } from '../../shared/constants';
import { Logger } from '../../shared/logger';
import {
  generateEndpointId,
  normalizePath,
  composePath,
  toRelativePath,
  extractPathParams,
  normalizeHttpMethod,
} from '../../shared/utils';
import { resolvePythonPrefixes } from '../shared/pythonPrefixResolver';
import {
  findDecoratedFunctions,
  extractDecoratorArgs,
  extractFunctionParams,
  stripQuotes,
  DecoratedFunction,
  FunctionParam,
  extractListItems,
} from '../shared/pythonAstUtils';

const logger = Logger.create('FastAPIScanner');

// ─── HTTP method pattern for FastAPI decorators ──────────────────────────────

/** Matches decorators like @app.get(...), @router.post(...), etc. */
const FASTAPI_DECORATOR_PATTERN =
  /\.(get|post|put|delete|patch|options|head)\s*\(/i;

/** Known non-model param types (primitives and framework types) */
const PRIMITIVE_TYPES = new Set([
  'str', 'int', 'float', 'bool', 'bytes', 'None',
  'list', 'dict', 'set', 'tuple', 'frozenset',
  'Optional', 'List', 'Dict', 'Set', 'Tuple',
  'Any', 'Union',
  'Request', 'Response', 'WebSocket',
  'BackgroundTasks', 'HTTPConnection',
]);

// ─── Parser Initialization ───────────────────────────────────────────────────

let parser: Parser | null = null;

/**
 * Initialize and cache the tree-sitter Python parser.
 */
async function getParser(): Promise<Parser> {
  if (parser) return parser;
  await Parser.init();
  parser = new Parser();
  
  const devPath = path.join(__dirname, '..', '..', 'grammars', 'tree-sitter-python.wasm');
  const prodPath = path.join(__dirname, 'grammars', 'tree-sitter-python.wasm');
  const siblingPath = path.join(__dirname, '..', 'grammars', 'tree-sitter-python.wasm');
  
  let langPath = devPath;
  if (fs.existsSync(prodPath)) {
    langPath = prodPath;
  } else if (fs.existsSync(siblingPath)) {
    langPath = siblingPath;
  } else if (fs.existsSync(devPath)) {
    langPath = devPath;
  }
  
  const Python = await Parser.Language.load(langPath);
  parser.setLanguage(Python);
  return parser;
}

// ─── Main Scan Function ──────────────────────────────────────────────────────

/**
 * Scan a list of Python files for FastAPI endpoint definitions.
 *
 * @param files - Absolute paths to .py files
 * @param workspaceRoot - Workspace root for relative path computation
 * @returns Array of Tier 1 EndpointRecords
 */
export async function scanFastAPIEndpoints(
  files: string[],
  workspaceRoot: string
): Promise<EndpointRecord[]> {
  const p = await getParser();
  const endpoints: EndpointRecord[] = [];

  // Run Pass 1: Resolve prefixes across files
  const filePrefixMaps = await resolvePythonPrefixes(files, workspaceRoot, p);

  for (const filePath of files) {
    try {
      const source = fs.readFileSync(filePath, 'utf-8');
      const tree = p.parse(source);
      const prefixMap = filePrefixMaps.get(filePath) || new Map<string, string>();
      const fileEndpoints = extractEndpointsFromTree(tree, filePath, workspaceRoot, prefixMap);
      endpoints.push(...fileEndpoints);
      logger.debug(`Scanned ${filePath}: found ${fileEndpoints.length} endpoints`);
    } catch (error) {
      logger.error(`Failed to scan file: ${filePath}`, { error: String(error) });
    }
  }

  return endpoints;
}

// ─── Endpoint Extraction ─────────────────────────────────────────────────────

/**
 * Extract endpoint records from a parsed Python AST tree.
 */
function extractEndpointsFromTree(
  tree: Parser.Tree,
  filePath: string,
  workspaceRoot: string,
  prefixMap: Map<string, string>
): EndpointRecord[] {
  const endpoints: EndpointRecord[] = [];
  const decoratedFunctions = findDecoratedFunctions(tree, FASTAPI_DECORATOR_PATTERN);

  for (const decorated of decoratedFunctions) {
    try {
      const endpoint = processDecoratedFunction(decorated, filePath, workspaceRoot, prefixMap);
      if (endpoint) {
        endpoints.push(endpoint);
      }
    } catch (error) {
      logger.warn(
        `Failed to process decorated function '${decorated.functionName}' in ${filePath}`,
        { error: String(error) }
      );
    }
  }

  return endpoints;
}

/**
 * Process a single decorated function definition into an EndpointRecord.
 */
function processDecoratedFunction(
  decorated: DecoratedFunction,
  filePath: string,
  workspaceRoot: string,
  prefixMap: Map<string, string>
): EndpointRecord | null {
  const { decoratorNode, functionNode, functionName, startLine, endLine } = decorated;

  // ─── Extract HTTP method from decorator ────────────────────────────
  const httpMethod = extractHttpMethod(decoratorNode);
  if (!httpMethod) return null;

  // ─── Extract decorator arguments ───────────────────────────────────
  const args = extractDecoratorArgs(decoratorNode);

  // ─── Extract route path (first positional argument) ────────────────
  let routePath = '/';
  if (args.positional.length > 0) {
    routePath = stripQuotes(args.positional[0].value);
  }
  
  // Extract decorator object variable (e.g. @router.get -> router)
  const decoratorText = decoratorNode.text.replace(/^@/, '');
  const decoratorVar = decoratorText.split('.')[0] || 'router';

  // Resolve cross-file prefix if available
  const routerPrefix = prefixMap.get(decoratorVar) || '';
  const fullPath = routerPrefix ? composePath(routerPrefix, routePath) : normalizePath(routePath);
  const pathParamNames = extractPathParams(fullPath);

  // ─── Extract keyword arguments ─────────────────────────────────────
  const responseModel = findKwarg(args.keyword, 'response_model');
  const statusCode = findKwarg(args.keyword, 'status_code');
  const tags = findKwarg(args.keyword, 'tags');
  const dependencies = findKwarg(args.keyword, 'dependencies');

  // ─── Extract function parameters ───────────────────────────────────
  const funcParams = extractFunctionParams(functionNode);

  // ─── Classify parameters ───────────────────────────────────────────
  const params: ParamRecord[] = [];
  let requestBody: RequestBodyRecord | undefined;
  const authRecords: AuthRecord[] = [];

  for (const fp of funcParams) {
    // Skip 'self' parameter
    if (fp.name === 'self' || fp.name === 'cls') continue;

    // Skip Request/Response/WebSocket framework types
    if (fp.typeAnnotation && isFrameworkType(fp.typeAnnotation)) continue;

    // Check for Depends() — dependency injection
    if (fp.defaultValue && isDepends(fp.defaultValue)) {
      const depName = extractDependsName(fp.defaultValue);
      // Check if it's an auth dependency
      if (isAuthDependency(depName)) {
        authRecords.push({
          type: 'custom',
          dependencyName: depName,
        });
      }
      continue;
    }

    // Path parameter: appears in the route path pattern
    if (pathParamNames.includes(fp.name)) {
      params.push({
        name: fp.name,
        in: 'path',
        type: mapPythonType(fp.typeAnnotation),
        required: true,
        default: fp.defaultValue ? parseLiteralValue(fp.defaultValue) : undefined,
      });
      continue;
    }

    // Body parameter: non-primitive type annotation (likely a Pydantic model)
    if (fp.typeAnnotation && isPydanticModel(fp.typeAnnotation)) {
      requestBody = {
        contentType: 'application/json',
        schema: UNRESOLVED,
        required: !fp.defaultValue,
        typeName: fp.typeAnnotation,
      };
      continue;
    }

    // Query parameter: everything else
    params.push({
      name: fp.name,
      in: 'query',
      type: mapPythonType(fp.typeAnnotation),
      required: !fp.defaultValue && fp.defaultValue !== 'None',
      default: fp.defaultValue ? parseLiteralValue(fp.defaultValue) : undefined,
    });
  }

  // ─── Build auth record from dependencies kwarg ─────────────────────
  let auth: AuthRecord | undefined;
  if (authRecords.length > 0) {
    auth = authRecords[0];
  }

  // Check for auth in the dependencies list kwarg
  if (dependencies) {
    const depAuth = extractAuthFromDependencies(dependencies);
    if (depAuth) {
      auth = auth || depAuth;
    }
  }

  // ─── Determine if handler is async ─────────────────────────────────
  const isAsync = functionNode.text.trimStart().startsWith('async');

  // ─── Build decorator records ───────────────────────────────────────
  const decorators: DecoratorRecord[] = [{
    name: decoratorNode.text.replace(/^@/, '').split('(')[0],
    arguments: args.positional.map((a) => a.value),
  }];

  // ─── Build tags ────────────────────────────────────────────────────
  const endpointTags: string[] = [];
  if (tags) {
    // Parse tags list: tags=["users", "admin"]
    const tagNode = args.keyword.find((k) => k.key === 'tags')?.node;
    if (tagNode) {
      const tagItems = extractListItems(tagNode);
      endpointTags.push(...tagItems);
    }
  }

  // ─── Build the handler info ────────────────────────────────────────
  const handler: HandlerInfo = {
    name: functionName,
    modulePath: toRelativePath(filePath, workspaceRoot),
    isAsync,
  };

  // ─── Build the EndpointRecord ──────────────────────────────────────
  const endpoint: EndpointRecord = {
    id: generateEndpointId(httpMethod, fullPath, functionName),
    method: httpMethod,
    path: fullPath,
    handler,
    params,
    requestBody,
    auth,
    middleware: [],
    decorators,
    framework: 'fastapi',
    language: 'python',
    sourceFile: toRelativePath(filePath, workspaceRoot),
    sourceLines: [startLine + 1, endLine + 1], // Convert to 1-indexed
    tags: endpointTags.length > 0 ? endpointTags : undefined,
  };

  // Add status code info to decorators
  if (statusCode) {
    const code = parseInt(statusCode, 10);
    if (!isNaN(code)) {
      endpoint.decorators.push({
        name: 'status_code',
        arguments: [code],
      });
    }
  }

  // Add response_model reference
  if (responseModel) {
    endpoint.decorators.push({
      name: 'response_model',
      arguments: [responseModel],
    });
  }

  return endpoint;
}

// ─── Helper Functions ────────────────────────────────────────────────────────

/**
 * Extract the HTTP method from a FastAPI decorator node text.
 */
function extractHttpMethod(decoratorNode: Parser.SyntaxNode): HttpMethod | null {
  const text = decoratorNode.text;
  const match = FASTAPI_DECORATOR_PATTERN.exec(text);
  if (!match) return null;
  return normalizeHttpMethod(match[1]) || null;
}

/**
 * Find a keyword argument value by key name.
 */
function findKwarg(
  kwargs: Array<{ key: string; value: string }>,
  key: string
): string | undefined {
  const kwarg = kwargs.find((k) => k.key === key);
  return kwarg?.value;
}

/**
 * Map a Python type annotation to a JSON Schema type string.
 */
function mapPythonType(typeAnnotation?: string): string {
  if (!typeAnnotation) return UNRESOLVED;

  // Handle Optional[X] → unwrap to X
  const optionalMatch = typeAnnotation.match(/^Optional\[(.+)\]$/);
  if (optionalMatch) {
    return mapPythonType(optionalMatch[1]);
  }

  // Handle List[X] → array
  if (typeAnnotation.startsWith('List[') || typeAnnotation.startsWith('list[')) {
    return 'array';
  }

  // Handle Dict → object
  if (typeAnnotation.startsWith('Dict[') || typeAnnotation.startsWith('dict[')) {
    return 'object';
  }

  // Direct mapping
  const mapped = PYTHON_TYPE_MAP[typeAnnotation];
  if (mapped) return mapped;

  // If it's a simple identifier not in our type map, it's likely a model reference
  if (/^[A-Z]\w*$/.test(typeAnnotation)) {
    return 'object';
  }

  return UNRESOLVED;
}

/**
 * Check if a default value indicates a Depends() call.
 */
function isDepends(defaultValue: string): boolean {
  return defaultValue.startsWith('Depends(');
}

/**
 * Extract the dependency function name from a Depends() call.
 */
function extractDependsName(defaultValue: string): string {
  const match = defaultValue.match(/Depends\(\s*(\w+)/);
  return match ? match[1] : UNRESOLVED;
}

/**
 * Check if a dependency name looks like an auth dependency.
 */
function isAuthDependency(depName: string): boolean {
  const authPatterns = [
    'get_current_user',
    'get_current_active_user',
    'oauth2_scheme',
    'api_key',
    'verify_token',
    'authenticate',
    'auth',
    'login_required',
    'require_auth',
    'jwt_required',
  ];
  const lower = depName.toLowerCase();
  return authPatterns.some((pattern) => lower.includes(pattern));
}

/**
 * Check if a type annotation refers to a Pydantic model (non-primitive).
 */
function isPydanticModel(typeAnnotation: string): boolean {
  // Strip Optional wrapper
  const inner = typeAnnotation.replace(/^Optional\[(.+)\]$/, '$1');

  // If it's a known primitive type, it's not a model
  if (PRIMITIVE_TYPES.has(inner)) return false;

  // Check type map — known primitives
  if (PYTHON_TYPE_MAP[inner]) return false;

  // Class-like name starting with uppercase → likely a model
  return /^[A-Z]\w*$/.test(inner);
}

/**
 * Check if a type annotation is a FastAPI framework type.
 */
function isFrameworkType(typeAnnotation: string): boolean {
  const frameworkTypes = new Set([
    'Request', 'Response', 'WebSocket', 'BackgroundTasks',
    'HTTPConnection', 'Starlette',
  ]);
  return frameworkTypes.has(typeAnnotation);
}

/**
 * Parse a Python literal value to its JS representation.
 */
function parseLiteralValue(value: string): unknown {
  if (value === 'None') return null;
  if (value === 'True') return true;
  if (value === 'False') return false;
  const num = Number(value);
  if (!isNaN(num)) return num;
  // String literal
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return stripQuotes(value);
  }
  return value;
}

/**
 * Extract auth information from a dependencies=[...] keyword argument value.
 */
function extractAuthFromDependencies(depsValue: string): AuthRecord | null {
  if (depsValue.includes('Depends(')) {
    const match = depsValue.match(/Depends\(\s*(\w+)/);
    if (match && isAuthDependency(match[1])) {
      return {
        type: 'custom',
        dependencyName: match[1],
      };
    }
  }
  return null;
}
