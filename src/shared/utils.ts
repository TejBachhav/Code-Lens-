/**
 * CodeLens — Utility Functions
 *
 * Shared helpers: hashing, path normalization, type checking, and pipeline utilities.
 */

import * as crypto from 'crypto';
import * as path from 'path';
import * as fs from 'fs';
import { UNRESOLVED } from './constants';
import { HttpMethod, JsonSchema, EndpointRecord, ParamRecord } from './types';

// ─── Hashing ─────────────────────────────────────────────────────────────────

/**
 * Generate a deterministic ID for an endpoint based on method + path + handler.
 */
export function generateEndpointId(method: HttpMethod, routePath: string, handlerName: string): string {
  const input = `${method}:${routePath}:${handlerName}`;
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 16);
}

/**
 * Generate a short hash for any string.
 */
export function shortHash(input: string, length: number = 8): string {
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, length);
}

// ─── Path Normalization ──────────────────────────────────────────────────────

/**
 * Normalize a route path:
 * - Ensure leading slash
 * - Remove trailing slash (except root "/")
 * - Convert Express-style :param to OpenAPI-style {param}
 * - Convert Flask-style <type:param> to {param}
 * - Collapse multiple slashes
 */
export function normalizePath(routePath: string): string {
  let normalized = routePath
    // Collapse multiple slashes
    .replace(/\/+/g, '/')
    // Convert Express-style :param to {param}
    .replace(/:(\w+)/g, '{$1}')
    // Convert Flask-style <type:param> to {param}
    .replace(/<(?:\w+:)?(\w+)>/g, '{$1}');

  // Ensure leading slash
  if (!normalized.startsWith('/')) {
    normalized = '/' + normalized;
  }

  // Remove trailing slash (except root)
  if (normalized.length > 1 && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }

  return normalized;
}

/**
 * Compose a full route path from base prefix and sub-path.
 */
export function composePath(basePath: string, subPath: string): string {
  const base = basePath.replace(/\/+$/, '');
  const sub = subPath.replace(/^\/+/, '');
  const composed = sub ? `${base}/${sub}` : base;
  return normalizePath(composed);
}

/**
 * Extract path parameter names from a normalized route path.
 */
export function extractPathParams(routePath: string): string[] {
  const params: string[] = [];
  const regex = /\{(\w+)\}/g;
  let match;
  while ((match = regex.exec(routePath)) !== null) {
    params.push(match[1]);
  }
  return params;
}

/**
 * Make a path relative to the workspace root, using forward slashes.
 */
export function toRelativePath(absolutePath: string, workspaceRoot: string): string {
  return path.relative(workspaceRoot, absolutePath).replace(/\\/g, '/');
}

// ─── Type Checking & Sentinel Values ─────────────────────────────────────────

/**
 * Check whether a value is the UNRESOLVED sentinel.
 */
export function isUnresolved(value: unknown): value is typeof UNRESOLVED {
  return value === UNRESOLVED;
}

/**
 * Create an UNRESOLVED JSON Schema with a descriptive note.
 */
export function unresolvedSchema(reason?: string): JsonSchema {
  return {
    type: 'object',
    description: reason
      ? `__UNRESOLVED__: ${reason}`
      : '__UNRESOLVED__: Type could not be statically determined',
  };
}

/**
 * Count the number of UNRESOLVED values in an endpoint record.
 */
export function countUnresolved(endpoint: EndpointRecord): number {
  let count = 0;

  // Check params
  for (const param of endpoint.params) {
    if (param.type === UNRESOLVED) count++;
  }

  // Check request body
  if (endpoint.requestBody && endpoint.requestBody.schema === UNRESOLVED) count++;

  // Check response schemas
  if (endpoint.responseSchemas) {
    for (const rs of endpoint.responseSchemas) {
      if (rs.schema === UNRESOLVED) count++;
    }
  }

  return count;
}

// ─── HTTP Method Helpers ─────────────────────────────────────────────────────

const VALID_METHODS = new Set<HttpMethod>([
  'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD',
]);

/**
 * Normalize an HTTP method string to uppercase HttpMethod type.
 * Returns undefined if invalid.
 */
export function normalizeHttpMethod(method: string): HttpMethod | undefined {
  const upper = method.toUpperCase() as HttpMethod;
  return VALID_METHODS.has(upper) ? upper : undefined;
}

// ─── JSON Schema Helpers ─────────────────────────────────────────────────────

/**
 * Create a simple JSON Schema from a type string.
 */
export function simpleSchema(type: string, format?: string): JsonSchema {
  const schema: JsonSchema = { type };
  if (format) schema.format = format;
  return schema;
}

/**
 * Merge multiple JSON Schemas using allOf.
 */
export function mergeSchemas(...schemas: JsonSchema[]): JsonSchema {
  if (schemas.length === 1) return schemas[0];
  return { allOf: schemas };
}

// ─── Param Helpers ───────────────────────────────────────────────────────────

/**
 * Create a path parameter record.
 */
export function pathParam(name: string, type: string = 'string'): ParamRecord {
  return {
    name,
    in: 'path',
    type,
    required: true,
  };
}

/**
 * Create a query parameter record.
 */
export function queryParam(name: string, type: string = 'string', required: boolean = false): ParamRecord {
  return {
    name,
    in: 'query',
    type,
    required,
  };
}

// ─── Async & Concurrency Helpers ─────────────────────────────────────────────

/**
 * Process items with concurrency limit.
 */
export async function asyncPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  const executing = new Set<Promise<void>>();

  for (const item of items) {
    const promise = fn(item).then((result) => {
      results.push(result);
    });

    const wrapped = promise.then(() => {
      executing.delete(wrapped);
    });

    executing.add(wrapped);

    if (executing.size >= concurrency) {
      await Promise.race(executing);
    }
  }

  await Promise.all(executing);
  return results;
}

/**
 * Retry a function with exponential backoff.
 */
export async function retry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelayMs: number = 1000,
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}

// ─── String Helpers ──────────────────────────────────────────────────────────

/**
 * Convert a string to a safe filename (kebab-case).
 */
export function toSafeFilename(input: string): string {
  return input
    .replace(/[{}]/g, '')
    .replace(/[^a-zA-Z0-9-_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .toLowerCase();
}

/**
 * Create a human-readable endpoint label from method + path.
 */
export function endpointLabel(method: HttpMethod, routePath: string): string {
  return `${method} ${routePath}`;
}

/**
 * Create a safe file name for an endpoint doc page.
 */
export function endpointFilename(method: HttpMethod, routePath: string): string {
  const safePath = toSafeFilename(routePath);
  return `${method}_${safePath}`;
}

/**
 * Recursively find files matching a name or custom filter function up to a max depth.
 * Skips common dependency/build directories for efficiency.
 */
export function findFilesRecursively(
  dir: string,
  matcher: (filename: string) => boolean,
  maxDepth: number = 8,
  currentDepth: number = 0
): string[] {
  if (currentDepth > maxDepth) return [];
  const results: string[] = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const nameLower = entry.name.toLowerCase();
        if (
          nameLower === 'node_modules' ||
          nameLower === '.venv' ||
          nameLower === 'venv' ||
          nameLower === '__pycache__' ||
          nameLower === 'dist' ||
          nameLower === 'build' ||
          nameLower === '.git' ||
          nameLower === 'target' ||
          nameLower === '.codelens'
        ) {
          continue;
        }
        results.push(...findFilesRecursively(fullPath, matcher, maxDepth, currentDepth + 1));
      } else if (entry.isFile() && matcher(entry.name)) {
        results.push(fullPath);
      }
    }
  } catch {
    // Ignore read errors (e.g. permission issues)
  }
  return results;
}
