/**
 * CodeLens — JavaScript/Express Tier 2 Analyzer
 *
 * Pattern-based analysis for plain JS Express files. Uses regex since
 * tree-sitter provides CST only and we cannot do type resolution in JS.
 * Aggressively uses __UNRESOLVED__ since JS lacks type annotations.
 */
import { EndpointRecord } from '../../shared/types';
export declare function analyzeJsExpressEndpoints(endpoints: EndpointRecord[], workspaceRoot: string): Promise<EndpointRecord[]>;
//# sourceMappingURL=analyzer.d.ts.map