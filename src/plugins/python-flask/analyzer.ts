/**
 * CodeLens — Python/Flask Tier 2 Analyzer
 *
 * Enriches Flask endpoint records with response shapes, side effects,
 * and constraints through inter-procedural data flow analysis.
 */

import * as fs from 'fs';
import * as path from 'path';
import Parser from 'web-tree-sitter';
import {
  EndpointRecord,
  ResponseSchemaRecord,
  SideEffectRecord,
  JsonSchema,
} from '../../shared/types';
import { UNRESOLVED, ORM_PATTERNS, PYTHON_TYPE_MAP } from '../../shared/constants';
import { unresolvedSchema } from '../../shared/utils';
import { Logger } from '../../shared/logger';
import {
  findNodesByType,
  findAllNodes,
} from '../shared/pythonAstUtils';

/** Inline helpers */
const findAllDescendantsOfType = (node: Parser.SyntaxNode, type: string) =>
  findAllNodes(node, n => n.type === type);

const logger = Logger.create('flask-analyzer');

/**
 * Analyze Flask endpoints to add response schemas and side effects.
 */
export async function analyzeFlaskEndpoints(
  endpoints: EndpointRecord[],
  workspaceRoot: string,
): Promise<EndpointRecord[]> {
  // Build a map of all Python files for cross-file resolution
  const pyFiles = getAllPythonFiles(workspaceRoot);
  const sourceCache = new Map<string, string>();
  const treeCache = new Map<string, Parser.Tree>();

  return endpoints.map(ep => {
    try {
      return analyzeEndpoint(ep, workspaceRoot, pyFiles, sourceCache);
    } catch (err) {
      logger.warn(`Failed to analyze endpoint ${ep.method} ${ep.path}`, err);
      return ep;
    }
  });
}

function analyzeEndpoint(
  endpoint: EndpointRecord,
  workspaceRoot: string,
  pyFiles: string[],
  sourceCache: Map<string, string>,
): EndpointRecord {
  const absPath = path.join(workspaceRoot, endpoint.sourceFile);
  const source = getCachedSource(absPath, sourceCache);
  if (!source) return endpoint;

  const responseSchemas: ResponseSchemaRecord[] = [];
  const sideEffects: SideEffectRecord[] = [];

  // Detect response patterns from return statements
  const returnSchemas = detectReturnSchemas(source, endpoint.handler.name);
  responseSchemas.push(...returnSchemas);

  // Default 200 OK if nothing detected
  if (responseSchemas.length === 0) {
    responseSchemas.push({
      statusCode: 200,
      contentType: 'application/json',
      schema: unresolvedSchema('No return type annotation or jsonify() call found'),
    });
  }

  // Detect side effects
  const effects = detectSideEffects(source, endpoint.handler.name);
  sideEffects.push(...effects);

  // Extract request body fields and query params from handler source body
  const handlerSource = extractHandlerSource(source, endpoint.handler.name, endpoint.handler.className);
  let requestBody = endpoint.requestBody;
  const params = [...endpoint.params];

  if (handlerSource) {
    // 1. JSON Body Fields
    const jsonFields = extractRequestBodyFields(handlerSource);
    if (jsonFields.length > 0 && !requestBody) {
      const properties: Record<string, JsonSchema> = {};
      for (const field of jsonFields) {
        properties[field] = { type: 'string', description: `Request body field: ${field}` };
      }
      requestBody = {
        contentType: 'application/json',
        required: true,
        schema: {
          type: 'object',
          properties,
          required: [],
        },
      };
    }

    // 2. Form Body Fields (only if no JSON body detected)
    if (jsonFields.length === 0 && !requestBody) {
      const formFields = extractFormFields(handlerSource);
      if (formFields.length > 0) {
        const properties: Record<string, JsonSchema> = {};
        for (const field of formFields) {
          properties[field] = { type: 'string', description: `Form field: ${field}` };
        }
        requestBody = {
          contentType: 'application/x-www-form-urlencoded',
          required: true,
          schema: {
            type: 'object',
            properties,
            required: [],
          },
        };
      }
    }

    // 3. Query Param Fields
    const queryFields = extractQueryParamFields(handlerSource);
    for (const field of queryFields) {
      if (!params.some(p => p.name === field)) {
        params.push({
          name: field,
          in: 'query',
          type: 'string',
          required: false,
          description: `Query parameter: ${field}`,
        });
      }
    }
  }

  return {
    ...endpoint,
    params,
    requestBody,
    responseSchemas,
    sideEffects,
    constraints: [],
  };
}

// ─── Return Schema Detection ─────────────────────────────────────────────────

function detectReturnSchemas(source: string, handlerName: string): ResponseSchemaRecord[] {
  const schemas: ResponseSchemaRecord[] = [];

  // Look for jsonify() calls
  const jsonifyRegex = /return\s+jsonify\s*\(/g;
  if (jsonifyRegex.test(source)) {
    schemas.push({
      statusCode: 200,
      contentType: 'application/json',
      schema: unresolvedSchema('jsonify() return value — shape requires runtime analysis'),
    });
  }

  // Look for tuple returns with status codes: return {...}, 201
  const tupleReturnRegex = /return\s+.*,\s*(\d{3})/g;
  let match;
  while ((match = tupleReturnRegex.exec(source)) !== null) {
    const statusCode = parseInt(match[1], 10);
    if (!schemas.find(s => s.statusCode === statusCode)) {
      schemas.push({
        statusCode,
        contentType: 'application/json',
        schema: unresolvedSchema(`Tuple return with status ${statusCode}`),
      });
    }
  }

  // Look for make_response()
  if (/return\s+make_response\s*\(/.test(source)) {
    if (!schemas.find(s => s.statusCode === 200)) {
      schemas.push({
        statusCode: 200,
        contentType: 'application/json',
        schema: unresolvedSchema('make_response() return value'),
      });
    }
  }

  return schemas;
}

// ─── Side Effect Detection ────────────────────────────────────────────────────

function detectSideEffects(source: string, handlerName: string): SideEffectRecord[] {
  const effects: SideEffectRecord[] = [];

  // SQLAlchemy patterns
  const sqlAlchemy = ORM_PATTERNS.sqlalchemy;

  for (const method of sqlAlchemy.read) {
    if (new RegExp(`\\.${method}\\s*\\(`).test(source)) {
      effects.push({
        type: 'database',
        operation: 'READ',
        confidence: 'medium',
      });
      break;
    }
  }

  for (const method of sqlAlchemy.create) {
    if (new RegExp(`\\.${method}\\s*\\(`).test(source) || /db\.session\.add\s*\(/.test(source)) {
      effects.push({ type: 'database', operation: 'CREATE', confidence: 'medium' });
      break;
    }
  }

  if (/db\.session\.commit\s*\(/.test(source)) {
    // Commit suggests a write operation was done
    if (!effects.find(e => e.operation === 'CREATE' || e.operation === 'UPDATE')) {
      effects.push({ type: 'database', operation: 'UPDATE', confidence: 'low' });
    }
  }

  for (const method of sqlAlchemy.delete) {
    if (new RegExp(`\\.${method}\\s*\\(`).test(source)) {
      effects.push({ type: 'database', operation: 'DELETE', confidence: 'medium' });
      break;
    }
  }

  return effects;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getCachedSource(absPath: string, cache: Map<string, string>): string | null {
  if (cache.has(absPath)) return cache.get(absPath)!;
  try {
    const src = fs.readFileSync(absPath, 'utf-8');
    cache.set(absPath, src);
    return src;
  } catch {
    return null;
  }
}

function getAllPythonFiles(workspaceRoot: string): string[] {
  const results: string[] = [];
  function walk(dir: string) {
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory() && !['node_modules', '.venv', 'venv', '__pycache__'].includes(entry.name)) {
          walk(full);
        } else if (entry.isFile() && entry.name.endsWith('.py')) {
          results.push(full);
        }
      }
    } catch { /* ignore permission errors */ }
  }
  walk(workspaceRoot);
  return results;
}

// ─── Handler Extraction & Analysis Helpers ────────────────────────────────────

function extractHandlerSource(source: string, handlerName: string, className?: string): string {
  const lines = source.split(/\r?\n/);
  let startIdx = -1;
  let baseIndent = 0;

  if (className) {
    let classIdx = -1;
    const classRegex = new RegExp(`^(\\s*)class\\s+${className}\\b`);
    for (let i = 0; i < lines.length; i++) {
      if (classRegex.test(lines[i])) {
        classIdx = i;
        break;
      }
    }
    if (classIdx !== -1) {
      const methodRegex = new RegExp(`^(\\s*)def\\s+${handlerName}\\s*\\(`);
      for (let i = classIdx + 1; i < lines.length; i++) {
        if (lines[i].trim() !== '' && lines[i].match(/^(\s*)/)?.[1].length === 0 && !lines[i].startsWith('#')) {
          break;
        }
        const match = lines[i].match(methodRegex);
        if (match) {
          startIdx = i;
          baseIndent = match[1].length;
          break;
        }
      }
    }
  } else {
    const defRegex = new RegExp(`^(\\s*)def\\s+${handlerName}\\s*\\(`);
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(defRegex);
      if (match) {
        startIdx = i;
        baseIndent = match[1].length;
        break;
      }
    }
  }

  if (startIdx === -1) return '';

  const handlerLines: string[] = [lines[startIdx]];
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') {
      handlerLines.push(line);
      continue;
    }
    const indent = line.match(/^(\s*)/)?.[1].length ?? 0;
    if (indent <= baseIndent) {
      break;
    }
    handlerLines.push(line);
  }

  return handlerLines.join('\n');
}

function extractRequestBodyFields(handlerSource: string): string[] {
  const fields = new Set<string>();
  
  const directRegexes = [
    /request\.json\.get\(\s*['"]([^'"]+)['"]/g,
    /request\.json\[\s*['"]([^'"]+)['"]\s*\]/g,
    /request\.get_json\(\)\.get\(\s*['"]([^'"]+)['"]/g,
    /request\.get_json\(\)\[\s*['"]([^'"]+)['"]\s*\]/g,
  ];
  
  for (const regex of directRegexes) {
    let match;
    while ((match = regex.exec(handlerSource)) !== null) {
      fields.add(match[1]);
    }
  }
  
  const assignRegex = /(\w+)\s*=\s*request\.(?:get_json\([^)]*\)|json)/g;
  let match;
  while ((match = assignRegex.exec(handlerSource)) !== null) {
    const varName = match[1];
    const varRegexes = [
      new RegExp(`${varName}\\.get\\(\\s*['"]([^'"]+)['"]`, 'g'),
      new RegExp(`${varName}\\[\\s*['"]([^'"]+)['"]\\s*\\]`, 'g'),
    ];
    for (const vRegex of varRegexes) {
      let vMatch;
      while ((vMatch = vRegex.exec(handlerSource)) !== null) {
        fields.add(vMatch[1]);
      }
    }
  }
  
  return Array.from(fields);
}

function extractFormFields(handlerSource: string): string[] {
  const fields = new Set<string>();
  
  const directRegexes = [
    /request\.form\.get\(\s*['"]([^'"]+)['"]/g,
    /request\.form\[\s*['"]([^'"]+)['"]\s*\]/g,
  ];
  
  for (const regex of directRegexes) {
    let match;
    while ((match = regex.exec(handlerSource)) !== null) {
      fields.add(match[1]);
    }
  }
  
  const assignRegex = /(\w+)\s*=\s*request\.form/g;
  let match;
  while ((match = assignRegex.exec(handlerSource)) !== null) {
    const varName = match[1];
    const varRegexes = [
      new RegExp(`${varName}\\.get\\(\\s*['"]([^'"]+)['"]`, 'g'),
      new RegExp(`${varName}\\[\\s*['"]([^'"]+)['"]\\s*\\]`, 'g'),
    ];
    for (const vRegex of varRegexes) {
      let vMatch;
      while ((vMatch = vRegex.exec(handlerSource)) !== null) {
        fields.add(vMatch[1]);
      }
    }
  }
  
  return Array.from(fields);
}

function extractQueryParamFields(handlerSource: string): string[] {
  const fields = new Set<string>();
  
  const directRegexes = [
    /request\.args\.get\(\s*['"]([^'"]+)['"]/g,
    /request\.args\[\s*['"]([^'"]+)['"]\s*\]/g,
  ];
  
  for (const regex of directRegexes) {
    let match;
    while ((match = regex.exec(handlerSource)) !== null) {
      fields.add(match[1]);
    }
  }
  
  const assignRegex = /(\w+)\s*=\s*request\.args/g;
  let match;
  while ((match = assignRegex.exec(handlerSource)) !== null) {
    const varName = match[1];
    const varRegexes = [
      new RegExp(`${varName}\\.get\\(\\s*['"]([^'"]+)['"]`, 'g'),
      new RegExp(`${varName}\\[\\s*['"]([^'"]+)['"]\\s*\\]`, 'g'),
    ];
    for (const vRegex of varRegexes) {
      let vMatch;
      while ((vMatch = vRegex.exec(handlerSource)) !== null) {
        fields.add(vMatch[1]);
      }
    }
  }
  
  return Array.from(fields);
}
