/**
 * CodeLens — Python FastAPI Analyzer (Tier 2)
 *
 * Performs inter-procedural data flow analysis on FastAPI endpoints:
 * - Resolves Pydantic BaseModel subclasses to JSON Schema
 * - Traces return statements in handler functions
 * - Detects SQLAlchemy ORM call patterns for side effects
 * - Extracts HTTPException raises for error response schemas
 */

import * as fs from 'fs';
import * as path from 'path';
import Parser from 'web-tree-sitter';

import {
  EndpointRecord,
  JsonSchema,
  ResponseSchemaRecord,
  SideEffectRecord,
  ConstraintRecord,
} from '../../shared/types';
import { UNRESOLVED, PYTHON_TYPE_MAP, ORM_PATTERNS } from '../../shared/constants';
import { Logger } from '../../shared/logger';
import {
  findClassDefinitions,
  extractClassFields,
  findNodesByType,
  findAllNodes,
  ClassField,
  stripQuotes,
} from '../shared/pythonAstUtils';

const logger = Logger.create('FastAPIAnalyzer');

// ─── Parser ──────────────────────────────────────────────────────────────────

let parser: Parser | null = null;

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

// ─── Main Analysis Function ──────────────────────────────────────────────────

/**
 * Enrich FastAPI endpoint records with Tier 2 analysis data.
 *
 * @param endpoints - Tier 1 endpoint records
 * @param workspaceRoot - Workspace root path
 * @returns Enriched endpoint records
 */
export async function analyzeFastAPIEndpoints(
  endpoints: EndpointRecord[],
  workspaceRoot: string
): Promise<EndpointRecord[]> {
  const p = await getParser();

  // ─── Phase 1: Build model registry from all source files ─────────
  const modelRegistry = await buildModelRegistry(p, endpoints, workspaceRoot);
  logger.info(`Built model registry with ${Object.keys(modelRegistry).length} models`);

  // ─── Phase 2: Enrich each endpoint ───────────────────────────────
  for (const endpoint of endpoints) {
    try {
      await enrichEndpoint(p, endpoint, workspaceRoot, modelRegistry);
    } catch (error) {
      logger.warn(
        `Failed to analyze endpoint ${endpoint.method} ${endpoint.path}`,
        { error: String(error) }
      );
    }
  }

  return endpoints;
}

// ─── Model Registry ──────────────────────────────────────────────────────────

/** Map of model name → resolved JSON Schema */
type ModelRegistry = Record<string, JsonSchema>;

/**
 * Scan workspace files to find all Pydantic BaseModel subclasses
 * and convert them to JSON Schema definitions.
 */
async function buildModelRegistry(
  p: Parser,
  endpoints: EndpointRecord[],
  workspaceRoot: string
): Promise<ModelRegistry> {
  const registry: ModelRegistry = {};

  // Collect unique source files from endpoints
  const sourceFiles = new Set<string>();
  for (const ep of endpoints) {
    sourceFiles.add(path.resolve(workspaceRoot, ep.sourceFile));
  }

  for (const filePath of sourceFiles) {
    try {
      const source = fs.readFileSync(filePath, 'utf-8');
      const tree = p.parse(source);

      // Find all classes that extend BaseModel
      const modelClasses = findClassDefinitions(tree, 'BaseModel');

      for (const modelClass of modelClasses) {
        const fields = extractClassFields(modelClass.classNode);
        const schema = pydanticFieldsToJsonSchema(fields, modelClass.className);
        registry[modelClass.className] = schema;
      }
    } catch (error) {
      logger.debug(`Skipped model extraction from ${filePath}`, { error: String(error) });
    }
  }

  return registry;
}

/**
 * Convert Pydantic model fields to a JSON Schema.
 */
function pydanticFieldsToJsonSchema(
  fields: ClassField[],
  className: string
): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];

  for (const field of fields) {
    const propSchema = mapFieldTypeToSchema(field.typeAnnotation);

    // Add description from Field() if present
    if (field.hasFieldDescriptor && field.fieldArgs) {
      const descKwarg = field.fieldArgs.keyword.find((k) => k.key === 'description');
      if (descKwarg) {
        propSchema.description = stripQuotes(descKwarg.value);
      }

      // Extract validation constraints from Field()
      for (const kw of field.fieldArgs.keyword) {
        switch (kw.key) {
          case 'min_length':
            propSchema.minLength = parseInt(kw.value, 10);
            break;
          case 'max_length':
            propSchema.maxLength = parseInt(kw.value, 10);
            break;
          case 'ge':
          case 'gt':
            propSchema.minimum = parseInt(kw.value, 10);
            break;
          case 'le':
          case 'lt':
            propSchema.maximum = parseInt(kw.value, 10);
            break;
          case 'regex':
          case 'pattern':
            propSchema.pattern = stripQuotes(kw.value);
            break;
          case 'example':
            propSchema.example = parsePythonLiteral(kw.value);
            break;
          case 'default':
            propSchema.default = parsePythonLiteral(kw.value);
            break;
        }
      }

      // Check if the first positional arg is ... (required with no default)
      if (field.fieldArgs.positional.length > 0 && field.fieldArgs.positional[0].value === '...') {
        required.push(field.name);
      } else if (!field.defaultValue || field.defaultValue === '...') {
        required.push(field.name);
      }
    } else if (!field.defaultValue) {
      // No default value → required
      required.push(field.name);
    }

    properties[field.name] = propSchema;
  }

  return {
    type: 'object',
    properties,
    required: required.length > 0 ? required : undefined,
    description: className,
  };
}

/**
 * Map a Python type annotation string to a JSON Schema.
 */
function mapFieldTypeToSchema(typeAnnotation?: string): JsonSchema {
  if (!typeAnnotation) {
    return { type: 'object', description: UNRESOLVED };
  }

  // Handle Optional[X]
  const optionalMatch = typeAnnotation.match(/^Optional\[(.+)\]$/);
  if (optionalMatch) {
    const inner = mapFieldTypeToSchema(optionalMatch[1]);
    inner.nullable = true;
    return inner;
  }

  // Handle List[X]
  const listMatch = typeAnnotation.match(/^(?:List|list)\[(.+)\]$/);
  if (listMatch) {
    return {
      type: 'array',
      items: mapFieldTypeToSchema(listMatch[1]),
    };
  }

  // Handle Dict[K, V]
  const dictMatch = typeAnnotation.match(/^(?:Dict|dict)\[(.+),\s*(.+)\]$/);
  if (dictMatch) {
    return {
      type: 'object',
      additionalProperties: mapFieldTypeToSchema(dictMatch[2].trim()),
    };
  }

  // Handle Union[X, Y]
  const unionMatch = typeAnnotation.match(/^Union\[(.+)\]$/);
  if (unionMatch) {
    const types = splitTopLevelComma(unionMatch[1]);
    // Filter out None for nullable
    const nonNone = types.filter((t) => t.trim() !== 'None');
    const hasNone = nonNone.length < types.length;

    if (nonNone.length === 1) {
      const schema = mapFieldTypeToSchema(nonNone[0].trim());
      if (hasNone) schema.nullable = true;
      return schema;
    }

    return {
      oneOf: nonNone.map((t) => mapFieldTypeToSchema(t.trim())),
      nullable: hasNone || undefined,
    };
  }

  // Primitive type map
  const mapped = PYTHON_TYPE_MAP[typeAnnotation];
  if (mapped) {
    const schema: JsonSchema = { type: mapped };

    // Add format hints
    if (typeAnnotation === 'datetime') schema.format = 'date-time';
    if (typeAnnotation === 'date') schema.format = 'date';
    if (typeAnnotation === 'time') schema.format = 'time';
    if (typeAnnotation === 'uuid' || typeAnnotation === 'UUID') schema.format = 'uuid';
    if (typeAnnotation === 'bytes') schema.format = 'byte';

    return schema;
  }

  // Class reference (likely a nested model) — leave as $ref
  if (/^[A-Z]\w*$/.test(typeAnnotation)) {
    return { $ref: `#/definitions/${typeAnnotation}` };
  }

  return { type: 'object', description: `${UNRESOLVED}: ${typeAnnotation}` };
}

// ─── Endpoint Enrichment ─────────────────────────────────────────────────────

/**
 * Enrich a single endpoint with response schemas, side effects, and constraints.
 */
async function enrichEndpoint(
  p: Parser,
  endpoint: EndpointRecord,
  workspaceRoot: string,
  modelRegistry: ModelRegistry
): Promise<void> {
  const filePath = path.resolve(workspaceRoot, endpoint.sourceFile);
  const source = fs.readFileSync(filePath, 'utf-8');
  const tree = p.parse(source);

  // ─── Resolve request body type ─────────────────────────────────────
  if (endpoint.requestBody && endpoint.requestBody.typeName) {
    const schema = modelRegistry[endpoint.requestBody.typeName];
    if (schema) {
      endpoint.requestBody.schema = schema;
    }
  }

  // ─── Resolve response_model ────────────────────────────────────────
  const responseModelDecorator = endpoint.decorators.find(
    (d) => d.name === 'response_model'
  );
  const statusCodeDecorator = endpoint.decorators.find(
    (d) => d.name === 'status_code'
  );

  const responseSchemas: ResponseSchemaRecord[] = [];

  if (responseModelDecorator && responseModelDecorator.arguments[0]) {
    const modelName = String(responseModelDecorator.arguments[0]);

    // Handle List[Model] response_model
    const listMatch = modelName.match(/^(?:List|list)\[(\w+)\]$/);
    const actualModelName = listMatch ? listMatch[1] : modelName;
    const resolvedSchema = modelRegistry[actualModelName];

    const statusCode = statusCodeDecorator
      ? Number(statusCodeDecorator.arguments[0])
      : 200;

    if (resolvedSchema) {
      const schema = listMatch
        ? { type: 'array', items: resolvedSchema } as JsonSchema
        : resolvedSchema;

      responseSchemas.push({
        statusCode,
        contentType: 'application/json',
        schema,
      });
    } else {
      responseSchemas.push({
        statusCode,
        contentType: 'application/json',
        schema: { $ref: `#/definitions/${actualModelName}` },
      });
    }
  }

  // ─── Find HTTPException raises for error responses ─────────────────
  const handlerNode = findHandlerNode(tree, endpoint.sourceLines);
  if (handlerNode) {
    const httpExceptions = extractHTTPExceptions(handlerNode);
    responseSchemas.push(...httpExceptions);

    // ─── Detect side effects ───────────────────────────────────────
    const sideEffects = detectSideEffects(handlerNode);
    if (sideEffects.length > 0) {
      endpoint.sideEffects = sideEffects;
    }
  }

  if (responseSchemas.length > 0) {
    endpoint.responseSchemas = responseSchemas;
  }

  // ─── Store resolved types ──────────────────────────────────────────
  const resolvedTypes: Record<string, JsonSchema> = {};
  if (endpoint.requestBody?.typeName && modelRegistry[endpoint.requestBody.typeName]) {
    resolvedTypes[endpoint.requestBody.typeName] = modelRegistry[endpoint.requestBody.typeName];
  }
  if (responseModelDecorator?.arguments[0]) {
    const modelName = String(responseModelDecorator.arguments[0]).replace(/^(?:List|list)\[(\w+)\]$/, '$1');
    if (modelRegistry[modelName]) {
      resolvedTypes[modelName] = modelRegistry[modelName];
    }
  }
  if (Object.keys(resolvedTypes).length > 0) {
    endpoint.resolvedTypes = resolvedTypes;
  }
}

// ─── Handler Node Finder ─────────────────────────────────────────────────────

/**
 * Find the function_definition node corresponding to an endpoint handler.
 */
function findHandlerNode(
  tree: Parser.Tree,
  sourceLines: [number, number]
): Parser.SyntaxNode | null {
  const [startLine, endLine] = sourceLines;
  // sourceLines are 1-indexed, tree-sitter is 0-indexed
  const targetStart = startLine - 1;
  const targetEnd = endLine - 1;

  const funcDefs = findNodesByType(tree.rootNode, 'function_definition');
  for (const funcDef of funcDefs) {
    if (
      funcDef.startPosition.row >= targetStart &&
      funcDef.endPosition.row <= targetEnd
    ) {
      return funcDef;
    }
  }

  return null;
}

// ─── HTTPException Detection ─────────────────────────────────────────────────

/**
 * Extract HTTPException raises from a handler function body.
 *
 * Pattern: raise HTTPException(status_code=404, detail="Not found")
 */
function extractHTTPExceptions(handlerNode: Parser.SyntaxNode): ResponseSchemaRecord[] {
  const results: ResponseSchemaRecord[] = [];

  const raiseStatements = findNodesByType(handlerNode, 'raise_statement');

  for (const raiseStmt of raiseStatements) {
    const callNode = raiseStmt.namedChildren.find((c) => c.type === 'call');
    if (!callNode) continue;

    const funcName = callNode.childForFieldName('function')?.text || '';
    if (funcName !== 'HTTPException' && !funcName.endsWith('.HTTPException')) continue;

    const argList = callNode.children.find((c) => c.type === 'argument_list');
    if (!argList) continue;

    let statusCode = 500;
    let detail = '';

    for (const arg of argList.namedChildren) {
      if (arg.type === 'keyword_argument') {
        const key = arg.childForFieldName('name')?.text;
        const value = arg.childForFieldName('value')?.text || '';

        if (key === 'status_code') {
          statusCode = parseInt(value, 10) || 500;
        } else if (key === 'detail') {
          detail = stripQuotes(value);
        }
      }
    }

    results.push({
      statusCode,
      contentType: 'application/json',
      schema: {
        type: 'object',
        properties: {
          detail: { type: 'string' },
        },
        required: ['detail'],
      },
      description: detail || undefined,
    });
  }

  return results;
}

// ─── Side Effect Detection ───────────────────────────────────────────────────

/**
 * Detect SQLAlchemy and other ORM call patterns in the handler body.
 */
function detectSideEffects(handlerNode: Parser.SyntaxNode): SideEffectRecord[] {
  const effects: SideEffectRecord[] = [];
  const handlerText = handlerNode.text;
  const sqla = ORM_PATTERNS.sqlalchemy;

  // Detect SQLAlchemy session operations
  const callNodes = findNodesByType(handlerNode, 'call');

  for (const callNode of callNodes) {
    const funcExpr = callNode.childForFieldName('function');
    if (!funcExpr) continue;

    const funcText = funcExpr.text;

    // Check for attribute access patterns: db.add(), session.commit(), etc.
    const attrMatch = funcText.match(/(\w+)\.(\w+)$/);
    if (!attrMatch) continue;

    const methodName = attrMatch[2];

    // SQLAlchemy patterns
    if (sqla.create.includes(methodName as any)) {
      effects.push({
        type: 'database',
        operation: 'CREATE',
        target: extractTargetEntity(callNode),
        confidence: 'medium',
      });
    } else if (sqla.delete.includes(methodName as any)) {
      effects.push({
        type: 'database',
        operation: 'DELETE',
        target: extractTargetEntity(callNode),
        confidence: 'medium',
      });
    } else if (sqla.update.includes(methodName as any) || sqla.commit.includes(methodName as any)) {
      effects.push({
        type: 'database',
        operation: 'UPDATE',
        target: extractTargetEntity(callNode),
        confidence: 'medium',
      });
    } else if (sqla.read.includes(methodName as any)) {
      effects.push({
        type: 'database',
        operation: 'READ',
        target: extractTargetEntity(callNode),
        confidence: 'medium',
      });
    }
  }

  // Check for external HTTP calls
  if (
    handlerText.includes('httpx.') ||
    handlerText.includes('requests.') ||
    handlerText.includes('aiohttp.')
  ) {
    effects.push({
      type: 'external_call',
      operation: 'SEND',
      confidence: 'high',
    });
  }

  return effects;
}

/**
 * Try to extract the target entity name from a db operation call.
 */
function extractTargetEntity(callNode: Parser.SyntaxNode): string | undefined {
  const argList = callNode.children.find((c) => c.type === 'argument_list');
  if (!argList || argList.namedChildren.length === 0) return undefined;

  const firstArg = argList.namedChildren[0];
  // If it's a variable, return its name
  if (firstArg.type === 'identifier') return firstArg.text;
  // If it's a call (e.g., Model()), return the function name
  if (firstArg.type === 'call') {
    const func = firstArg.childForFieldName('function');
    return func?.text;
  }
  return undefined;
}

// ─── Utility ─────────────────────────────────────────────────────────────────

/**
 * Parse a Python literal value.
 */
function parsePythonLiteral(value: string): unknown {
  if (value === 'None') return null;
  if (value === 'True') return true;
  if (value === 'False') return false;
  const num = Number(value);
  if (!isNaN(num)) return num;
  if (value.startsWith('"') || value.startsWith("'")) {
    return stripQuotes(value);
  }
  return value;
}

/**
 * Split a string by commas, respecting nested brackets.
 */
function splitTopLevelComma(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';

  for (const ch of text) {
    if (ch === '[' || ch === '(' || ch === '{') {
      depth++;
      current += ch;
    } else if (ch === ']' || ch === ')' || ch === '}') {
      depth--;
      current += ch;
    } else if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }

  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts;
}
