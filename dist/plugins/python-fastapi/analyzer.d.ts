/**
 * CodeLens — Python FastAPI Analyzer (Tier 2)
 *
 * Performs inter-procedural data flow analysis on FastAPI endpoints:
 * - Resolves Pydantic BaseModel subclasses to JSON Schema
 * - Traces return statements in handler functions
 * - Detects SQLAlchemy ORM call patterns for side effects
 * - Extracts HTTPException raises for error response schemas
 */
import { EndpointRecord } from '../../shared/types';
/**
 * Enrich FastAPI endpoint records with Tier 2 analysis data.
 *
 * @param endpoints - Tier 1 endpoint records
 * @param workspaceRoot - Workspace root path
 * @returns Enriched endpoint records
 */
export declare function analyzeFastAPIEndpoints(endpoints: EndpointRecord[], workspaceRoot: string): Promise<EndpointRecord[]>;
//# sourceMappingURL=analyzer.d.ts.map