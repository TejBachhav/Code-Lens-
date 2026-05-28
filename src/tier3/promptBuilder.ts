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
import { UNRESOLVED } from '../shared/constants';

// ─── Exported Prompt Builders ────────────────────────────────────────────────

/**
 * Build a documentation-generation prompt for a single endpoint.
 *
 * The LLM is asked to produce a concise summary, detailed description,
 * a working curl example, and categorization tags.
 *
 * @param endpoint - The endpoint record (Tier 1 + Tier 2 enriched).
 * @returns System and user prompt strings ready to send to Ollama.
 */
export function buildDocumentationPrompt(endpoint: EndpointRecord): {
  system: string;
  user: string;
} {
  const system = [
    'You are an API documentation expert.',
    'Given a structured JSON description of an API endpoint, generate concise, accurate documentation.',
    'Respond with valid JSON only — no markdown, no explanations, no extra text.',
    'If information is unavailable or marked "__UNRESOLVED__", note it as "unknown" or omit it.',
  ].join(' ');

  const endpointData = buildEndpointPayload(endpoint);

  const user = JSON.stringify({
    task: 'generate_documentation',
    endpoint: endpointData,
    responseFormat: {
      summary: 'string — One-line summary of what this endpoint does',
      description:
        'string — Detailed multi-sentence description of behavior, side effects, and usage notes',
      curlExample:
        'string — A working curl command that demonstrates a typical request',
      tags: 'string[] — 2-5 categorization tags (e.g., "users", "auth", "CRUD")',
    },
  });

  return { system, user };
}

/**
 * Build a test-case-generation prompt for a single endpoint.
 *
 * The LLM is asked to produce an array of test case objects covering
 * happy paths, error paths, edge cases, and auth scenarios.
 *
 * @param endpoint - The endpoint record (Tier 1 + Tier 2 enriched).
 * @returns System and user prompt strings ready to send to Ollama.
 */
export function buildTestCasePrompt(endpoint: EndpointRecord): {
  system: string;
  user: string;
} {
  const system = [
    'You are an API test engineer.',
    'Given a structured JSON description of an API endpoint, generate comprehensive test cases.',
    'Cover: happy path, validation errors, missing auth, edge cases, and error responses.',
    'Respond with valid JSON only — no markdown, no explanations, no extra text.',
  ].join(' ');

  const endpointData = buildEndpointPayload(endpoint);

  const user = JSON.stringify({
    task: 'generate_test_cases',
    endpoint: endpointData,
    responseFormat: {
      testCases: [
        {
          name: 'string — Test name, e.g. "should return 200 for valid request"',
          description: 'string — What this test verifies',
          method: 'string — HTTP method',
          path: 'string — URL path with substituted parameters',
          headers: 'object? — Request headers as key-value pairs',
          body: 'object? — Request body (for POST/PUT/PATCH)',
          expectedStatus: 'number — Expected HTTP status code',
          assertions: 'string[] — Human-readable assertion descriptions',
        },
      ],
    },
  });

  return { system, user };
}

/**
 * Build a tagging / categorization prompt for a batch of endpoints.
 *
 * The LLM is asked to assign semantic tags and group related endpoints
 * into logical domains (e.g., "User Management", "Billing").
 *
 * @param endpoints - Multiple endpoint records for batch categorization.
 * @returns System and user prompt strings ready to send to Ollama.
 */
export function buildTaggingPrompt(endpoints: EndpointRecord[]): {
  system: string;
  user: string;
} {
  const system = [
    'You are an API architect.',
    'Given an array of structured endpoint descriptions, assign semantic tags',
    'and group related endpoints into logical domains.',
    'Respond with valid JSON only — no markdown, no explanations, no extra text.',
  ].join(' ');

  const endpointSummaries = endpoints.map((ep) => ({
    id: ep.id,
    method: ep.method,
    path: ep.path,
    handler: ep.handler.name,
    className: ep.handler.className,
    middleware: ep.middleware,
    auth: ep.auth ? ep.auth.type : null,
    hasRequestBody: !!ep.requestBody,
    paramCount: ep.params.length,
    sideEffects: (ep.sideEffects ?? []).map((se) => ({
      type: se.type,
      operation: se.operation,
    })),
  }));

  const user = JSON.stringify({
    task: 'categorize_endpoints',
    endpoints: endpointSummaries,
    responseFormat: {
      endpointTags: {
        '<endpoint_id>': 'string[] — Tags for this endpoint',
      },
      domains: [
        {
          name: 'string — Domain name, e.g. "User Management"',
          endpointIds: 'string[] — IDs of endpoints in this domain',
        },
      ],
    },
  });

  return { system, user };
}

// ─── Internal Helpers ────────────────────────────────────────────────────────

/**
 * Build a sanitized endpoint payload for inclusion in prompts.
 * Strips source code references and normalizes sentinel values.
 */
function buildEndpointPayload(endpoint: EndpointRecord): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    method: endpoint.method,
    path: endpoint.path,
    handler: endpoint.handler.name,
    className: endpoint.handler.className ?? null,
    isAsync: endpoint.handler.isAsync,
    framework: endpoint.framework,
    language: endpoint.language,
  };

  // Parameters
  if (endpoint.params.length > 0) {
    payload.params = endpoint.params.map((p) => ({
      name: p.name,
      in: p.in,
      type: p.type === UNRESOLVED ? 'unknown' : p.type,
      required: p.required,
      default: p.default,
      validationRules: p.validationRules,
    }));
  }

  // Request body
  if (endpoint.requestBody) {
    payload.requestBody = {
      contentType: endpoint.requestBody.contentType,
      required: endpoint.requestBody.required,
      typeName: endpoint.requestBody.typeName ?? null,
      schema:
        endpoint.requestBody.schema === UNRESOLVED
          ? 'unknown'
          : endpoint.requestBody.schema,
    };
  }

  // Auth
  if (endpoint.auth) {
    payload.auth = {
      type: endpoint.auth.type,
      scheme: endpoint.auth.scheme ?? null,
      guardName: endpoint.auth.guardName ?? null,
    };
  }

  // Middleware
  if (endpoint.middleware.length > 0) {
    payload.middleware = endpoint.middleware;
  }

  // Tier 2: Response schemas
  if (endpoint.responseSchemas && endpoint.responseSchemas.length > 0) {
    payload.responseSchemas = endpoint.responseSchemas.map((rs) => ({
      statusCode: rs.statusCode,
      contentType: rs.contentType,
      schema: rs.schema === UNRESOLVED ? 'unknown' : rs.schema,
    }));
  }

  // Tier 2: Side effects
  if (endpoint.sideEffects && endpoint.sideEffects.length > 0) {
    payload.sideEffects = endpoint.sideEffects.map((se) => ({
      type: se.type,
      operation: se.operation,
      target: se.target ?? null,
    }));
  }

  // Tier 2: Constraints
  if (endpoint.constraints && endpoint.constraints.length > 0) {
    payload.constraints = endpoint.constraints.map((c) => ({
      type: c.type,
      description: c.description,
    }));
  }

  return payload;
}
