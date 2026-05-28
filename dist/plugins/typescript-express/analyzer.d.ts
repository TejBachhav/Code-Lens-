/**
 * CodeLens — TypeScript/Express Tier 2 Analyzer
 *
 * Enriches Express endpoint records with response shapes, side effects,
 * and constraints using ts-morph type resolution.
 */
import { EndpointRecord } from '../../shared/types';
export declare function analyzeExpressEndpoints(endpoints: EndpointRecord[], workspaceRoot: string): Promise<EndpointRecord[]>;
//# sourceMappingURL=analyzer.d.ts.map