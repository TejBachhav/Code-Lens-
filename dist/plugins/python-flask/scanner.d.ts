/**
 * CodeLens — Python/Flask Tier 1 Scanner
 *
 * Scans Flask source files and extracts endpoint records using web-tree-sitter.
 * Handles: @app.route(), Blueprint routes, Flask-RESTful Resource classes,
 *          URL converters (<int:id>), stacked auth decorators.
 */
import { EndpointRecord } from '../../shared/types';
/**
 * Scan Python Flask files and extract all endpoint records.
 */
export declare function scanFlaskFiles(files: string[], workspaceRoot: string): Promise<EndpointRecord[]>;
//# sourceMappingURL=scanner.d.ts.map