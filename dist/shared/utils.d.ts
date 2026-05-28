/**
 * CodeLens — Utility Functions
 *
 * Shared helpers: hashing, path normalization, type checking, and pipeline utilities.
 */
import { UNRESOLVED } from './constants';
import { HttpMethod, JsonSchema, EndpointRecord, ParamRecord } from './types';
/**
 * Generate a deterministic ID for an endpoint based on method + path + handler.
 */
export declare function generateEndpointId(method: HttpMethod, routePath: string, handlerName: string): string;
/**
 * Generate a short hash for any string.
 */
export declare function shortHash(input: string, length?: number): string;
/**
 * Normalize a route path:
 * - Ensure leading slash
 * - Remove trailing slash (except root "/")
 * - Convert Express-style :param to OpenAPI-style {param}
 * - Convert Flask-style <type:param> to {param}
 * - Collapse multiple slashes
 */
export declare function normalizePath(routePath: string): string;
/**
 * Compose a full route path from base prefix and sub-path.
 */
export declare function composePath(basePath: string, subPath: string): string;
/**
 * Extract path parameter names from a normalized route path.
 */
export declare function extractPathParams(routePath: string): string[];
/**
 * Make a path relative to the workspace root, using forward slashes.
 */
export declare function toRelativePath(absolutePath: string, workspaceRoot: string): string;
/**
 * Check whether a value is the UNRESOLVED sentinel.
 */
export declare function isUnresolved(value: unknown): value is typeof UNRESOLVED;
/**
 * Create an UNRESOLVED JSON Schema with a descriptive note.
 */
export declare function unresolvedSchema(reason?: string): JsonSchema;
/**
 * Count the number of UNRESOLVED values in an endpoint record.
 */
export declare function countUnresolved(endpoint: EndpointRecord): number;
/**
 * Normalize an HTTP method string to uppercase HttpMethod type.
 * Returns undefined if invalid.
 */
export declare function normalizeHttpMethod(method: string): HttpMethod | undefined;
/**
 * Create a simple JSON Schema from a type string.
 */
export declare function simpleSchema(type: string, format?: string): JsonSchema;
/**
 * Merge multiple JSON Schemas using allOf.
 */
export declare function mergeSchemas(...schemas: JsonSchema[]): JsonSchema;
/**
 * Create a path parameter record.
 */
export declare function pathParam(name: string, type?: string): ParamRecord;
/**
 * Create a query parameter record.
 */
export declare function queryParam(name: string, type?: string, required?: boolean): ParamRecord;
/**
 * Process items with concurrency limit.
 */
export declare function asyncPool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]>;
/**
 * Retry a function with exponential backoff.
 */
export declare function retry<T>(fn: () => Promise<T>, maxRetries?: number, baseDelayMs?: number): Promise<T>;
/**
 * Convert a string to a safe filename (kebab-case).
 */
export declare function toSafeFilename(input: string): string;
/**
 * Create a human-readable endpoint label from method + path.
 */
export declare function endpointLabel(method: HttpMethod, routePath: string): string;
/**
 * Create a safe file name for an endpoint doc page.
 */
export declare function endpointFilename(method: HttpMethod, routePath: string): string;
/**
 * Recursively find files matching a name or custom filter function up to a max depth.
 * Skips common dependency/build directories for efficiency.
 */
export declare function findFilesRecursively(dir: string, matcher: (filename: string) => boolean, maxDepth?: number, currentDepth?: number): string[];
//# sourceMappingURL=utils.d.ts.map