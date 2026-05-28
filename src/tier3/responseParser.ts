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

import { TestCaseRecord, HttpMethod } from '../shared/types';
import { Logger } from '../shared/logger';

const logger = Logger.create('ResponseParser');

// ─── Public Parsers ──────────────────────────────────────────────────────────

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
export function parseDocumentationResponse(raw: string): DocumentationResult | null {
  const obj = extractJson(raw);
  if (!obj || typeof obj !== 'object') {
    logger.warn('Failed to extract JSON from documentation response', {
      rawLength: raw.length,
      preview: raw.slice(0, 200),
    });
    return null;
  }

  const record = obj as Record<string, unknown>;
  const result: DocumentationResult = {};

  // Extract summary
  if (typeof record.summary === 'string' && record.summary.trim().length > 0) {
    result.summary = record.summary.trim();
  }

  // Extract description
  if (typeof record.description === 'string' && record.description.trim().length > 0) {
    result.description = record.description.trim();
  }

  // Extract curl example
  const curl = record.curlExample ?? record.curl_example ?? record.curl;
  if (typeof curl === 'string' && curl.trim().length > 0) {
    result.curlExample = curl.trim();
  }

  // Extract tags
  const tags = record.tags;
  if (Array.isArray(tags)) {
    result.tags = tags
      .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
      .map((t) => t.trim());
  }

  // Return null if we got nothing useful at all
  if (!result.summary && !result.description && !result.curlExample && (!result.tags || result.tags.length === 0)) {
    logger.warn('Documentation response contained no useful fields');
    return null;
  }

  return result;
}

/**
 * Parse a test-case generation response from the LLM.
 *
 * @param raw - The raw string returned by Ollama's generate API.
 * @returns An array of validated TestCaseRecords, or null if parsing fails.
 */
export function parseTestCaseResponse(raw: string): TestCaseRecord[] | null {
  const obj = extractJson(raw);
  if (!obj || typeof obj !== 'object') {
    logger.warn('Failed to extract JSON from test case response', {
      rawLength: raw.length,
      preview: raw.slice(0, 200),
    });
    return null;
  }

  const record = obj as Record<string, unknown>;

  // The LLM might return { testCases: [...] } or a bare array
  let rawCases: unknown[];
  if (Array.isArray(record.testCases)) {
    rawCases = record.testCases;
  } else if (Array.isArray(record.test_cases)) {
    rawCases = record.test_cases;
  } else if (Array.isArray(record.tests)) {
    rawCases = record.tests;
  } else if (Array.isArray(obj)) {
    rawCases = obj as unknown[];
  } else {
    logger.warn('Test case response has no recognizable array field');
    return null;
  }

  const validCases: TestCaseRecord[] = [];
  const validMethods = new Set<string>(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']);

  for (const item of rawCases) {
    if (!item || typeof item !== 'object') continue;

    const c = item as Record<string, unknown>;

    // Name is required
    if (typeof c.name !== 'string' || c.name.trim().length === 0) continue;

    // Method — required, with validation
    const methodRaw = typeof c.method === 'string' ? c.method.toUpperCase() : '';
    if (!validMethods.has(methodRaw)) continue;

    // Path — required
    if (typeof c.path !== 'string' || c.path.trim().length === 0) continue;

    // Expected status — required, must be a number
    const status = typeof c.expectedStatus === 'number'
      ? c.expectedStatus
      : typeof c.expected_status === 'number'
        ? c.expected_status
        : typeof c.status === 'number'
          ? c.status
          : null;

    if (status === null || status < 100 || status > 599) continue;

    const testCase: TestCaseRecord = {
      name: c.name.trim(),
      description: typeof c.description === 'string' ? c.description.trim() : c.name.trim(),
      method: methodRaw as HttpMethod,
      path: c.path.trim(),
      expectedStatus: status,
      assertions: [],
    };

    // Optional headers
    if (c.headers && typeof c.headers === 'object' && !Array.isArray(c.headers)) {
      testCase.headers = c.headers as Record<string, string>;
    }

    // Optional body
    if (c.body !== undefined && c.body !== null) {
      testCase.body = c.body;
    }

    // Assertions
    if (Array.isArray(c.assertions)) {
      testCase.assertions = c.assertions
        .filter((a): a is string => typeof a === 'string' && a.trim().length > 0)
        .map((a) => a.trim());
    }

    validCases.push(testCase);
  }

  if (validCases.length === 0) {
    logger.warn('No valid test cases could be extracted from LLM response');
    return null;
  }

  return validCases;
}

// ─── JSON Extraction ─────────────────────────────────────────────────────────

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
export function extractJson(raw: string): object | null {
  if (!raw || raw.trim().length === 0) {
    return null;
  }

  // Strategy 1: Try parsing as-is (fastest path for well-behaved models)
  const directParse = tryParse(raw.trim());
  if (directParse !== null) return directParse;

  // Strategy 2: Strip markdown code fences
  const fenceStripped = stripCodeFences(raw);
  if (fenceStripped !== raw) {
    const fenceParsed = tryParse(fenceStripped);
    if (fenceParsed !== null) return fenceParsed;
  }

  // Strategy 3: Find the first { or [ and the matching closer
  const bracketExtracted = extractBracketedJson(raw);
  if (bracketExtracted !== null) {
    const bracketParsed = tryParse(bracketExtracted);
    if (bracketParsed !== null) return bracketParsed;
  }

  // Strategy 4: Attempt cleanup (trailing commas, single quotes) then retry
  const cleaned = cleanJsonString(raw);
  const cleanedParsed = tryParse(cleaned);
  if (cleanedParsed !== null) return cleanedParsed;

  // Strategy 5: Cleanup the bracket-extracted version
  if (bracketExtracted !== null) {
    const cleanedBracket = cleanJsonString(bracketExtracted);
    const cleanedBracketParsed = tryParse(cleanedBracket);
    if (cleanedBracketParsed !== null) return cleanedBracketParsed;
  }

  logger.debug('All JSON extraction strategies failed', {
    rawLength: raw.length,
    preview: raw.slice(0, 300),
  });

  return null;
}

// ─── Internal Helpers ────────────────────────────────────────────────────────

/**
 * Attempt to JSON.parse a string. Returns null on failure.
 */
function tryParse(input: string): object | null {
  try {
    const parsed = JSON.parse(input);
    if (parsed !== null && typeof parsed === 'object') {
      return parsed as object;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Remove markdown code fences (```json … ``` or ``` … ```).
 */
function stripCodeFences(input: string): string {
  // Match fenced code blocks with optional language tag
  const fenceRegex = /```(?:json|JSON|js|javascript)?\s*\n?([\s\S]*?)\n?\s*```/;
  const match = fenceRegex.exec(input);
  if (match && match[1]) {
    return match[1].trim();
  }
  return input;
}

/**
 * Extract the outermost JSON object or array from a string by
 * finding balanced braces/brackets.
 */
function extractBracketedJson(input: string): string | null {
  // Find the first { or [
  const objectStart = input.indexOf('{');
  const arrayStart = input.indexOf('[');

  let startIdx: number;
  let openChar: string;
  let closeChar: string;

  if (objectStart === -1 && arrayStart === -1) return null;

  if (objectStart === -1) {
    startIdx = arrayStart;
    openChar = '[';
    closeChar = ']';
  } else if (arrayStart === -1) {
    startIdx = objectStart;
    openChar = '{';
    closeChar = '}';
  } else {
    // Take whichever comes first
    if (objectStart <= arrayStart) {
      startIdx = objectStart;
      openChar = '{';
      closeChar = '}';
    } else {
      startIdx = arrayStart;
      openChar = '[';
      closeChar = ']';
    }
  }

  // Walk forward counting balanced brackets
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = startIdx; i < input.length; i++) {
    const ch = input[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === '\\') {
      escaped = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === openChar) {
      depth++;
    } else if (ch === closeChar) {
      depth--;
      if (depth === 0) {
        return input.slice(startIdx, i + 1);
      }
    }
  }

  // Unbalanced — try anyway with what we have
  return null;
}

/**
 * Clean up common JSON syntax issues:
 * - Trailing commas before } or ]
 * - Single-quoted strings → double-quoted (simple heuristic)
 */
function cleanJsonString(input: string): string {
  let cleaned = input;

  // Remove trailing commas before } or ]
  cleaned = cleaned.replace(/,\s*([\]}])/g, '$1');

  // Replace single-quoted strings with double-quoted (naive but helpful)
  // Only apply if there are no double quotes (i.e., the model used all single quotes)
  if (!cleaned.includes('"') && cleaned.includes("'")) {
    cleaned = cleaned.replace(/'/g, '"');
  }

  return cleaned.trim();
}
