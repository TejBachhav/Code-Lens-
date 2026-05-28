/**
 * CodeLens — Python/Flask Tier 2 Analyzer
 *
 * Enriches Flask endpoint records with response shapes, side effects,
 * and constraints through inter-procedural data flow analysis.
 */
import { EndpointRecord } from '../../shared/types';
/**
 * Analyze Flask endpoints to add response schemas and side effects.
 */
export declare function analyzeFlaskEndpoints(endpoints: EndpointRecord[], workspaceRoot: string): Promise<EndpointRecord[]>;
//# sourceMappingURL=analyzer.d.ts.map