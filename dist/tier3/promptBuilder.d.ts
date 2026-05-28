/**
 * CodeLens — LLM Prompt Builder
 *
 * Constructs structured JSON prompts for Tier 3 enrichment tasks.
 *
 * CRITICAL DESIGN CONSTRAINT:
 *   Prompts must NEVER include raw source code. The LLM receives only the
 *   structured JSON fields already extracted by Tiers 1 and 2. This keeps
 *   prompts compact, deterministic, and privacy-safe.
 */
import { EndpointRecord } from '../shared/types';
/**
 * Build a documentation-generation prompt for a single endpoint.
 *
 * The LLM is asked to produce a concise summary, detailed description,
 * a working curl example, and categorization tags.
 *
 * @param endpoint - The endpoint record (Tier 1 + Tier 2 enriched).
 * @returns System and user prompt strings ready to send to Ollama.
 */
export declare function buildDocumentationPrompt(endpoint: EndpointRecord): {
    system: string;
    user: string;
};
/**
 * Build a test-case-generation prompt for a single endpoint.
 *
 * The LLM is asked to produce an array of test case objects covering
 * happy paths, error paths, edge cases, and auth scenarios.
 *
 * @param endpoint - The endpoint record (Tier 1 + Tier 2 enriched).
 * @returns System and user prompt strings ready to send to Ollama.
 */
export declare function buildTestCasePrompt(endpoint: EndpointRecord): {
    system: string;
    user: string;
};
/**
 * Build a tagging / categorization prompt for a batch of endpoints.
 *
 * The LLM is asked to assign semantic tags and group related endpoints
 * into logical domains (e.g., "User Management", "Billing").
 *
 * @param endpoints - Multiple endpoint records for batch categorization.
 * @returns System and user prompt strings ready to send to Ollama.
 */
export declare function buildTaggingPrompt(endpoints: EndpointRecord[]): {
    system: string;
    user: string;
};
//# sourceMappingURL=promptBuilder.d.ts.map