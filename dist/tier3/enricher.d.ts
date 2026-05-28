/**
 * CodeLens — Tier 3 Enrichment Orchestrator
 *
 * Coordinates LLM enrichment of endpoint records via Ollama.
 *
 * Flow:
 *   1. Health-check the Ollama server
 *   2. For each endpoint (concurrency-limited):
 *      a. Build documentation prompt → generate → parse → merge
 *      b. Build test case prompt → generate → parse → merge
 *   3. Return enriched endpoints
 *
 * Design principles:
 *   - If Ollama is unavailable, return endpoints unchanged (graceful degradation)
 *   - If a single endpoint fails, log a warning and continue
 *   - Never crash the pipeline due to LLM errors
 */
import { EndpointRecord, OllamaConfig } from '../shared/types';
/**
 * Enrich an array of endpoint records with LLM-generated documentation,
 * test cases, and tags.
 *
 * @param endpoints  - The endpoint records from Tier 1 + Tier 2.
 * @param config     - Ollama connection and model configuration.
 * @param onProgress - Optional callback invoked after each endpoint completes.
 * @returns A new array of endpoints with Tier 3 fields populated where possible.
 *          Endpoints that fail enrichment are returned with their original data intact.
 */
export declare function enrichEndpoints(endpoints: EndpointRecord[], config: OllamaConfig, onProgress?: (completed: number, total: number) => void): Promise<EndpointRecord[]>;
//# sourceMappingURL=enricher.d.ts.map