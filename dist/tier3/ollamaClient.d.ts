/**
 * CodeLens — Ollama HTTP Client
 *
 * Communicates with a local Ollama instance for Tier 3 LLM enrichment.
 * Uses Node.js built-in `http` module (no external HTTP libraries) to satisfy
 * the offline-first constraint.
 *
 * API Reference:
 *   POST /api/generate  — Text completion (JSON mode, non-streaming)
 *   GET  /api/tags      — List available models
 */
import { OllamaConfig } from '../shared/types';
/**
 * Lightweight HTTP client for the Ollama REST API.
 *
 * @example
 * ```ts
 * const client = new OllamaClient({ url: 'http://localhost:11434', model: 'deepseek-coder-v2:16b', temperature: 0.1, concurrency: 2 });
 * const health = await client.healthCheck();
 * if (health.available) {
 *   const response = await client.generate('Describe this endpoint …');
 * }
 * ```
 */
export declare class OllamaClient {
    private readonly baseUrl;
    private readonly model;
    private readonly temperature;
    constructor(config: OllamaConfig);
    /**
     * Check whether the Ollama server is reachable and which models are loaded.
     *
     * @returns An object indicating availability and the list of model names.
     */
    healthCheck(): Promise<{
        available: boolean;
        models: string[];
    }>;
    /**
     * Generate a completion using the configured model.
     *
     * Sends a non-streaming request with JSON response format so the model
     * is constrained to produce valid JSON.
     *
     * @param prompt  - The user prompt (typically a JSON task description).
     * @param systemPrompt - Optional system-level instruction.
     * @returns The raw `response` string from Ollama's generate API.
     * @throws On network errors, timeouts, or non-2xx status codes.
     */
    generate(prompt: string, systemPrompt?: string): Promise<string>;
    /**
     * List all models currently available on the Ollama server.
     *
     * @returns An array of model name strings.
     */
    listModels(): Promise<string[]>;
    /**
     * Perform an HTTP GET request and parse the JSON response.
     */
    private get;
    /**
     * Perform an HTTP POST request with a JSON body and parse the JSON response.
     */
    private post;
    /**
     * Collect response chunks and parse the resulting JSON body.
     */
    private handleResponse;
    /**
     * Attach timeout & connection-error handlers that produce user-friendly messages.
     */
    private attachErrorHandlers;
}
//# sourceMappingURL=ollamaClient.d.ts.map