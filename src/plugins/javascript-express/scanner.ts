/**
 * CodeLens — JavaScript/Express Tier 1 Scanner
 *
 * Uses web-tree-sitter with the JavaScript grammar to scan Express.js files.
 * Works on plain .js files without requiring a tsconfig.json.
 * Handles: app.get/post/put/delete, Router(), app.use() mounting,
 *          CommonJS require() patterns, module.exports = router.
 */

import * as path from 'path';
import * as fs from 'fs';
import Parser from 'web-tree-sitter';
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

const logger = Logger.create('js-express-scanner');

const HTTP_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch', 'options', 'head']);

let _parser: Parser | null = null;

async function getParser(workspaceRoot: string): Promise<Parser> {
  if (_parser) return _parser;
  await Parser.init();
  _parser = new Parser();

  const wasmPath = path.join(workspaceRoot, 'node_modules', 'web-tree-sitter', 'tree-sitter-javascript.wasm');
  const devPath = path.join(__dirname, '..', '..', '..', 'grammars', 'tree-sitter-javascript.wasm');
  const prodPath = path.join(__dirname, 'grammars', 'tree-sitter-javascript.wasm');
  const siblingPath = path.join(__dirname, '..', 'grammars', 'tree-sitter-javascript.wasm');

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

  const JavaScript = await Parser.Language.load(grammarPath);
  _parser.setLanguage(JavaScript);
  return _parser;
}

/**
 * Scan JavaScript Express files using web-tree-sitter.
 */
export async function scanJsExpressFiles(
  files: string[],
  workspaceRoot: string,
): Promise<EndpointRecord[]> {
  const parser = await getParser(workspaceRoot);
  const endpoints: EndpointRecord[] = [];

  // Run Pass 1: Resolve Express mount prefixes globally
  const resolvedPrefixes = resolveExpressPrefixes(files, workspaceRoot);

  // Second pass: extract routes
  for (const filePath of files) {
    try {
      const source = fs.readFileSync(filePath, 'utf-8');
      const tree = parser.parse(source);
      const relPath = toRelativePath(filePath, workspaceRoot);
      const absPath = path.resolve(filePath);
      const prefixes = resolvedPrefixes.get(absPath) || [''];

      const fileEndpoints = extractRoutes(tree.rootNode, source, relPath, prefixes);
      endpoints.push(...fileEndpoints);
    } catch (err) {
      logger.warn(`Failed to scan JS file: ${filePath}`, err);
    }
  }

  return endpoints;
}

// ─── Route Extraction ─────────────────────────────────────────────────────────

function extractRoutes(
  rootNode: Parser.SyntaxNode,
  source: string,
  relPath: string,
  prefixes: string[],
): EndpointRecord[] {
  const endpoints: EndpointRecord[] = [];
  const calls = findAllType(rootNode, 'call_expression');

  for (const call of calls) {
    try {
      const routeEndpoints = extractRouteFromCall(call, source, relPath, prefixes);
      if (routeEndpoints) endpoints.push(...routeEndpoints);
    } catch (err) {
      logger.warn('Failed to extract JS route', err);
    }
  }

  return endpoints;
}

function extractRouteFromCall(
  call: Parser.SyntaxNode,
  source: string,
  relPath: string,
  prefixes: string[],
): EndpointRecord[] | null {
  const fn = call.childForFieldName('function');
  if (!fn || fn.type !== 'member_expression') return null;

  const objNode = fn.childForFieldName('object');
  const propNode = fn.childForFieldName('property');
  if (!objNode || !propNode) return null;

  const methodName = getText(propNode, source).toLowerCase();
  if (!HTTP_METHODS.has(methodName)) return null;

  const httpMethod = normalizeHttpMethod(methodName);
  if (!httpMethod) return null;

  const args = call.childForFieldName('arguments');
  if (!args) return null;

  const argChildren = args.children.filter(c => c.isNamed);
  if (argChildren.length < 2) return null;

  // First arg: route path
  const pathArg = argChildren[0];
  if (pathArg.type !== 'string' && pathArg.type !== 'template_string') return null;
  const rawPath = getText(pathArg, source).replace(/^['"`]|['"`]$/g, '');

  // Middleware (all args between path and handler)
  const middleware: string[] = [];
  const handlerArg = argChildren[argChildren.length - 1];
  for (let i = 1; i < argChildren.length - 1; i++) {
    middleware.push(getText(argChildren[i], source));
  }

  // Handler name
  let handlerName = 'anonymous';
  let isAsync = false;

  if (handlerArg.type === 'arrow_function' || handlerArg.type === 'function_expression') {
    // We use a temporary dummy path to form the handler name if prefix is empty
    handlerName = `${methodName}${rawPath.replace(/[^a-zA-Z0-9]/g, '_')}`;
    isAsync = source.substring(handlerArg.startIndex - 6, handlerArg.startIndex).includes('async');
  } else if (handlerArg.type === 'identifier') {
    handlerName = getText(handlerArg, source);
  } else if (handlerArg.type === 'member_expression') {
    const prop = handlerArg.childForFieldName('property');
    handlerName = prop ? getText(prop, source) : 'unknown';
  }

  const startLine = call.startPosition.row + 1;
  const endLine = call.endPosition.row + 1;

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
      handler: { name: handlerName, modulePath: relPath, isAsync },
      params,
      middleware,
      decorators: [],
      framework: 'express',
      language: 'javascript',
      sourceFile: relPath,
      sourceLines: [startLine, endLine],
    });
  }

  return records;
}

// ─── Tree-sitter Helpers ─────────────────────────────────────────────────────

function getText(node: Parser.SyntaxNode, source: string): string {
  return source.slice(node.startIndex, node.endIndex);
}

function findAllType(node: Parser.SyntaxNode, type: string): Parser.SyntaxNode[] {
  const results: Parser.SyntaxNode[] = [];
  function walk(n: Parser.SyntaxNode) {
    if (n.type === type) results.push(n);
    for (const child of n.children) walk(child);
  }
  walk(node);
  return results;
}
