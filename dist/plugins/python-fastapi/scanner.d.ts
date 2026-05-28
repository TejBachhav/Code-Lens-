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
import { EndpointRecord } from '../../shared/types';
/**
 * Scan a list of Python files for FastAPI endpoint definitions.
 *
 * @param files - Absolute paths to .py files
 * @param workspaceRoot - Workspace root for relative path computation
 * @returns Array of Tier 1 EndpointRecords
 */
export declare function scanFastAPIEndpoints(files: string[], workspaceRoot: string): Promise<EndpointRecord[]>;
//# sourceMappingURL=scanner.d.ts.map