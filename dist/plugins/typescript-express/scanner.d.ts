/**
 * CodeLens — TypeScript/Express Tier 1 Scanner
 *
 * Uses ts-morph to scan Express.js TypeScript files and extract endpoint records.
 * Handles: app.get/post/put/delete/patch, express.Router(), app.use() mounting,
 *          middleware chains, typed request/response handlers.
 */
import { EndpointRecord } from '../../shared/types';
/**
 * Scan TypeScript Express files using ts-morph.
 */
export declare function scanExpressFiles(files: string[], workspaceRoot: string): Promise<EndpointRecord[]>;
//# sourceMappingURL=scanner.d.ts.map