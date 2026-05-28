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
import { asyncPool } from '../shared/utils';
import { Logger } from '../shared/logger';
import { OllamaClient } from './ollamaClient';
import { buildDocumentationPrompt, buildTestCasePrompt } from './promptBuilder';
import { parseDocumentationResponse, parseTestCaseResponse } from './responseParser';
import { spawn, ChildProcess } from 'child_process';

const logger = Logger.create('Tier3Enricher');

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
export async function enrichEndpoints(
  endpoints: EndpointRecord[],
  config: OllamaConfig,
  onProgress?: (completed: number, total: number) => void,
): Promise<EndpointRecord[]> {
  if (endpoints.length === 0) {
    logger.info('No endpoints to enrich');
    return endpoints;
  }

  const client = new OllamaClient(config);
  let weStartedOllama = false;
  let ollamaProcess: ChildProcess | null = null;

  // ── Step 1: Health check & Auto-start ──────────────────────────────────
  let health = await client.healthCheck();

  if (!health.available) {
    logger.info('Ollama is not running. Attempting to start Ollama server automatically...');
    try {
      ollamaProcess = spawn('ollama', ['serve'], { stdio: 'ignore' });
      
      // Wait for Ollama to boot up (check health every 1s, up to 6 times)
      for (let i = 0; i < 6; i++) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        health = await client.healthCheck();
        if (health.available) {
          weStartedOllama = true;
          logger.info('Ollama server started successfully.');
          break;
        }
      }
    } catch (err) {
      logger.warn('Failed to launch Ollama server automatically', err);
    }
  }

  if (!health.available) {
    logger.warn(
      'Ollama is not available — skipping Tier 3 enrichment. ' +
        'Endpoints will be returned without LLM-generated documentation.',
    );
    return endpoints;
  }

  try {
    if (!health.models.includes(config.model)) {
      // Check with a normalized name (tag may differ)
      const modelBase = config.model.split(':')[0];
      const hasModel = health.models.some((m) => m.startsWith(modelBase));

      if (!hasModel) {
        logger.warn(
          `Model "${config.model}" is not available on the Ollama server. ` +
            `Available models: ${health.models.join(', ')}. ` +
            'Skipping Tier 3 enrichment.',
        );
        return endpoints;
      }
    }

    logger.info(
      `Starting Tier 3 enrichment for ${endpoints.length} endpoints ` +
        `(model: ${config.model}, concurrency: ${config.concurrency})`,
    );

    // ── Step 2: Process endpoints concurrently ──────────────────────────────
    let completed = 0;
    const total = endpoints.length;

    const enrichedEndpoints = await asyncPool(
      endpoints,
      config.concurrency,
      async (endpoint: EndpointRecord): Promise<EndpointRecord> => {
        try {
          const enriched = await enrichSingleEndpoint(client, endpoint);
          completed++;
          if (onProgress) {
            onProgress(completed, total);
          }
          return enriched;
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          logger.warn(
            `Failed to enrich endpoint ${endpoint.method} ${endpoint.path}: ${msg}`,
          );
          completed++;
          if (onProgress) {
            onProgress(completed, total);
          }
          return endpoint;
        }
      },
    );

    const enrichedCount = enrichedEndpoints.filter(
      (ep) => ep.summary || ep.description || (ep.testCases && ep.testCases.length > 0),
    ).length;

    logger.info(
      `Tier 3 enrichment complete: ${enrichedCount}/${total} endpoints enriched successfully`,
    );

    return enrichedEndpoints;
  } finally {
    if (weStartedOllama && ollamaProcess) {
      logger.info('Stopping automatically started Ollama server...');
      try {
        ollamaProcess.kill();
      } catch (err) {
        logger.warn('Failed to stop Ollama server process', err);
      }
    }
  }
}

// ─── Internal Helpers ────────────────────────────────────────────────────────

/**
 * Enrich a single endpoint with documentation and test cases.
 *
 * Each enrichment task (docs, tests) is independent — if one fails,
 * we still attempt the other.
 */
async function enrichSingleEndpoint(
  client: OllamaClient,
  endpoint: EndpointRecord,
): Promise<EndpointRecord> {
  // Clone to avoid mutating the input
  const enriched: EndpointRecord = { ...endpoint };

  // ── Documentation enrichment ────────────────────────────────────────────
  try {
    const docPrompt = buildDocumentationPrompt(endpoint);
    const docRaw = await client.generate(docPrompt.user, docPrompt.system);
    const docResult = parseDocumentationResponse(docRaw);

    if (docResult) {
      if (docResult.summary) enriched.summary = docResult.summary;
      if (docResult.description) enriched.description = docResult.description;
      if (docResult.curlExample) enriched.curlExample = docResult.curlExample;
      if (docResult.tags && docResult.tags.length > 0) {
        enriched.tags = docResult.tags;
      }

      logger.debug(
        `Documentation generated for ${endpoint.method} ${endpoint.path}`,
      );
    } else {
      logger.debug(
        `No documentation could be parsed for ${endpoint.method} ${endpoint.path}`,
      );
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.warn(
      `Documentation generation failed for ${endpoint.method} ${endpoint.path}: ${msg}`,
    );
  }

  // ── Test case enrichment ────────────────────────────────────────────────
  try {
    const testPrompt = buildTestCasePrompt(endpoint);
    const testRaw = await client.generate(testPrompt.user, testPrompt.system);
    const testResult = parseTestCaseResponse(testRaw);

    if (testResult && testResult.length > 0) {
      enriched.testCases = testResult;
      logger.debug(
        `${testResult.length} test cases generated for ${endpoint.method} ${endpoint.path}`,
      );
    } else {
      logger.debug(
        `No test cases could be parsed for ${endpoint.method} ${endpoint.path}`,
      );
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.warn(
      `Test case generation failed for ${endpoint.method} ${endpoint.path}: ${msg}`,
    );
  }

  return enriched;
}
