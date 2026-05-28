/**
 * CodeLens — TypeScript/NestJS Tier 2 Analyzer
 *
 * Resolves NestJS DTO classes to JSON Schema, extracts class-validator
 * constraints, and detects ORM side effects.
 */
import { EndpointRecord } from '../../shared/types';
export declare function analyzeNestJsEndpoints(endpoints: EndpointRecord[], workspaceRoot: string): Promise<EndpointRecord[]>;
//# sourceMappingURL=analyzer.d.ts.map