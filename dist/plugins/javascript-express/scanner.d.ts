/**
 * CodeLens — JavaScript/Express Tier 1 Scanner
 *
 * Uses web-tree-sitter with the JavaScript grammar to scan Express.js files.
 * Works on plain .js files without requiring a tsconfig.json.
 * Handles: app.get/post/put/delete, Router(), app.use() mounting,
 *          CommonJS require() patterns, module.exports = router.
 */
import { EndpointRecord } from '../../shared/types';
/**
 * Scan JavaScript Express files using web-tree-sitter.
 */
export declare function scanJsExpressFiles(files: string[], workspaceRoot: string): Promise<EndpointRecord[]>;
//# sourceMappingURL=scanner.d.ts.map