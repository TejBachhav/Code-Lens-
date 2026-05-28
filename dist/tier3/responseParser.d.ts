/**
 * CodeLens — LLM Response Parser
 *
 * Defensively parses and validates JSON responses from the LLM.
 *
 * LLMs frequently produce slightly-broken output:
 *   - JSON wrapped in markdown code fences (```json … ```)
 *   - Extra commentary before or after the JSON object
 *   - Trailing commas in arrays/objects
 *   - Single-quoted strings instead of double-quoted
 *
 * This module handles all those cases so the rest of the pipeline
 * can assume clean, validated structures.
 */
import { TestCaseRecord } from '../shared/types';
/**
 * Parsed result from a documentation generation prompt.
 */
export interface DocumentationResult {
    summary?: string;
    description?: string;
    curlExample?: string;
    tags?: string[];
}
/**
 * Parse a documentation response from the LLM.
 *
 * @param raw - The raw string returned by Ollama's generate API.
 * @returns A validated DocumentationResult, or null if parsing fails entirely.
 */
export declare function parseDocumentationResponse(raw: string): DocumentationResult | null;
/**
 * Parse a test-case generation response from the LLM.
 *
 * @param raw - The raw string returned by Ollama's generate API.
 * @returns An array of validated TestCaseRecords, or null if parsing fails.
 */
export declare function parseTestCaseResponse(raw: string): TestCaseRecord[] | null;
/**
 * Extract a JSON object or array from a raw LLM response string.
 *
 * Handles common LLM output quirks:
 * 1. Clean JSON string
 * 2. JSON inside markdown code fences (```json … ```)
 * 3. Extra text before / after the JSON
 * 4. Trailing commas
 * 5. Single-quoted strings
 *
 * @param raw - The raw string from the LLM.
 * @returns A parsed object/array, or null if no valid JSON could be found.
 */
export declare function extractJson(raw: string): object | null;
//# sourceMappingURL=responseParser.d.ts.map