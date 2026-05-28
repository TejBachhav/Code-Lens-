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

import * as http from 'http';
import { URL } from 'url';
import { OllamaConfig } from '../shared/types';
import {
  OLLAMA_API,
  DEFAULT_OLLAMA_MAX_TOKENS,
} from '../shared/constants';
import { Logger } from '../shared/logger';

const logger = Logger.create('OllamaClient');

/** Timeout for all Ollama HTTP requests (120 seconds to allow model loading). */
const REQUEST_TIMEOUT_MS = 120_000;

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
export class OllamaClient {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly temperature: number;

  constructor(config: OllamaConfig) {
    // Strip trailing slash from URL
    this.baseUrl = config.url.replace(/\/+$/, '');
    this.model = config.model;
    this.temperature = config.temperature;
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  /**
   * Check whether the Ollama server is reachable and which models are loaded.
   *
   * @returns An object indicating availability and the list of model names.
   */
  async healthCheck(): Promise<{ available: boolean; models: string[] }> {
    try {
      const models = await this.listModels();
      return { available: true, models };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn('Ollama health check failed', { error: msg });
      return { available: false, models: [] };
    }
  }

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
  async generate(prompt: string, systemPrompt?: string): Promise<string> {
    const body: Record<string, unknown> = {
      model: this.model,
      prompt,
      format: 'json',
      stream: false,
      options: {
        temperature: this.temperature,
        num_predict: DEFAULT_OLLAMA_MAX_TOKENS,
      },
    };

    if (systemPrompt) {
      body.system = systemPrompt;
    }

    logger.debug('Sending generate request', {
      model: this.model,
      promptLength: prompt.length,
    });

    const result = await this.post<{ response: string }>(
      OLLAMA_API.GENERATE,
      body,
    );

    if (!result.response) {
      throw new Error('Ollama response missing "response" field');
    }

    return result.response;
  }

  /**
   * List all models currently available on the Ollama server.
   *
   * @returns An array of model name strings.
   */
  async listModels(): Promise<string[]> {
    const result = await this.get<{ models: Array<{ name: string }> }>(
      OLLAMA_API.TAGS,
    );

    if (!result.models || !Array.isArray(result.models)) {
      return [];
    }

    return result.models.map((m) => m.name);
  }

  // ─── Internal HTTP Helpers ───────────────────────────────────────────────

  /**
   * Perform an HTTP GET request and parse the JSON response.
   */
  private get<T>(endpoint: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const url = new URL(endpoint, this.baseUrl);

      const options: http.RequestOptions = {
        method: 'GET',
        hostname: url.hostname,
        port: url.port || undefined,
        path: url.pathname,
        timeout: REQUEST_TIMEOUT_MS,
        headers: { Accept: 'application/json' },
      };

      const req = http.request(options, (res) => {
        this.handleResponse<T>(res, resolve, reject);
      });

      this.attachErrorHandlers(req, reject);
      req.end();
    });
  }

  /**
   * Perform an HTTP POST request with a JSON body and parse the JSON response.
   */
  private post<T>(endpoint: string, body: unknown): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const url = new URL(endpoint, this.baseUrl);
      const payload = JSON.stringify(body);

      const options: http.RequestOptions = {
        method: 'POST',
        hostname: url.hostname,
        port: url.port || undefined,
        path: url.pathname,
        timeout: REQUEST_TIMEOUT_MS,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          Accept: 'application/json',
        },
      };

      const req = http.request(options, (res) => {
        this.handleResponse<T>(res, resolve, reject);
      });

      this.attachErrorHandlers(req, reject);
      req.write(payload);
      req.end();
    });
  }

  /**
   * Collect response chunks and parse the resulting JSON body.
   */
  private handleResponse<T>(
    res: http.IncomingMessage,
    resolve: (value: T) => void,
    reject: (reason: Error) => void,
  ): void {
    const chunks: Buffer[] = [];

    res.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    res.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8');

      if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
        reject(
          new Error(
            `Ollama returned HTTP ${res.statusCode ?? 'unknown'}: ${raw.slice(0, 500)}`,
          ),
        );
        return;
      }

      try {
        const parsed = JSON.parse(raw) as T;
        resolve(parsed);
      } catch {
        reject(new Error(`Failed to parse Ollama response as JSON: ${raw.slice(0, 200)}`));
      }
    });

    res.on('error', (err) => {
      reject(new Error(`Ollama response stream error: ${err.message}`));
    });
  }

  /**
   * Attach timeout & connection-error handlers that produce user-friendly messages.
   */
  private attachErrorHandlers(
    req: http.ClientRequest,
    reject: (reason: Error) => void,
  ): void {
    req.on('timeout', () => {
      req.destroy();
      reject(
        new Error(
          `Ollama request timed out after ${REQUEST_TIMEOUT_MS / 1000}s. ` +
            'The model may be loading or the server is under heavy load.',
        ),
      );
    });

    req.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ECONNREFUSED') {
        reject(
          new Error(
            `Cannot connect to Ollama at ${this.baseUrl}. ` +
              'Is the Ollama server running? Start it with: ollama serve',
          ),
        );
      } else if (err.code === 'ECONNRESET') {
        reject(
          new Error(
            'Connection to Ollama was reset. The server may have restarted.',
          ),
        );
      } else {
        reject(new Error(`Ollama request error: ${err.message}`));
      }
    });
  }
}
