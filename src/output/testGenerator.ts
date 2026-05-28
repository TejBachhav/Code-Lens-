/**
 * CodeLens — Test File Generator
 *
 * Generates framework-appropriate test files from enriched endpoint records.
 *
 * Strategy:
 *   - Python endpoints → pytest tests using httpx
 *   - TypeScript/JavaScript endpoints → Jest tests using supertest
 *   - If Tier 3 test cases are available, uses them; otherwise generates basic smoke tests
 *   - Groups tests by source file / controller class
 *   - Generates boilerplate: conftest.py for pytest, jest.config.js for Jest
 *
 * Uses Handlebars templates for customizability.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as Handlebars from 'handlebars';
import {
  EndpointRecord,
  SupportedLanguage,
  TestCaseRecord,
  HttpMethod,
} from '../shared/types';
import { endpointFilename, toSafeFilename } from '../shared/utils';
import { Logger } from '../shared/logger';

const logger = Logger.create('TestGenerator');

const TEMPLATE_DIR = path.resolve(__dirname, 'templates');

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Generate test files for all endpoints.
 *
 * @param endpoints - The enriched endpoint records.
 * @param outputDir - Absolute path to the test output directory.
 * @returns Paths to all generated test files.
 */
export async function generateTests(
  endpoints: EndpointRecord[],
  outputDir: string,
): Promise<string[]> {
  if (endpoints.length === 0) {
    logger.info('No endpoints to generate tests for');
    return [];
  }

  ensureDir(outputDir);

  // Register Handlebars helpers
  registerHelpers();

  const generatedFiles: string[] = [];

  // Split endpoints by language
  const pythonEndpoints = endpoints.filter((ep) => ep.language === 'python');
  const tsJsEndpoints = endpoints.filter(
    (ep) => ep.language === 'typescript' || ep.language === 'javascript',
  );

  // ── Generate Python (pytest) tests ────────────────────────────────────
  if (pythonEndpoints.length > 0) {
    const pytestDir = path.join(outputDir, 'pytest');
    ensureDir(pytestDir);

    const pytestFiles = generatePytestSuite(pythonEndpoints, pytestDir);
    generatedFiles.push(...pytestFiles);
    logger.info(`Generated ${pytestFiles.length} pytest files`);
  }

  // ── Generate TypeScript/JavaScript (Jest) tests ───────────────────────
  if (tsJsEndpoints.length > 0) {
    const jestDir = path.join(outputDir, 'jest');
    ensureDir(jestDir);

    const jestFiles = generateJestSuite(tsJsEndpoints, jestDir);
    generatedFiles.push(...jestFiles);
    logger.info(`Generated ${jestFiles.length} Jest test files`);
  }

  return generatedFiles;
}

// ─── Pytest Generation ───────────────────────────────────────────────────────

/**
 * Generate a complete pytest test suite.
 */
function generatePytestSuite(
  endpoints: EndpointRecord[],
  outputDir: string,
): string[] {
  const files: string[] = [];

  // Generate conftest.py
  const conftestPath = path.join(outputDir, 'conftest.py');
  fs.writeFileSync(conftestPath, CONFTEST_CONTENT, 'utf-8');
  files.push(conftestPath);

  // Group endpoints by source file / controller
  const groups = groupEndpoints(endpoints);

  const pytestTemplate = loadTemplate('pytest.hbs');

  for (const [groupName, groupEndpoints] of groups) {
    const safeName = toSafeFilename(groupName);
    const filename = `test_${safeName}.py`;
    const filePath = path.join(outputDir, filename);

    const testData = buildPytestData(groupName, groupEndpoints);
    const content = pytestTemplate(testData);
    fs.writeFileSync(filePath, content, 'utf-8');
    files.push(filePath);
  }

  return files;
}

/**
 * Build template data for a pytest test file.
 */
function buildPytestData(
  groupName: string,
  endpoints: EndpointRecord[],
): Record<string, unknown> {
  const testClasses = endpoints.map((ep) => {
    const testCases =
      ep.testCases && ep.testCases.length > 0
        ? ep.testCases.map((tc) => formatPytestCase(tc))
        : [generateSmokePytestCase(ep)];

    return {
      className: buildTestClassName(ep),
      docstring: `Tests for ${ep.method} ${ep.path}`,
      endpoint: {
        method: ep.method.toLowerCase(),
        path: ep.path,
        auth: ep.auth,
        hasRequestBody: !!ep.requestBody,
      },
      testCases,
    };
  });

  return {
    groupName,
    generatedAt: new Date().toISOString(),
    testClasses,
  };
}

/**
 * Format a Tier 3 test case for pytest.
 */
function formatPytestCase(tc: TestCaseRecord): Record<string, unknown> {
  const funcName = 'test_' + toSafeFilename(tc.name);
  return {
    name: funcName,
    docstring: tc.description,
    method: tc.method.toLowerCase(),
    path: tc.path,
    headers: tc.headers ? JSON.stringify(tc.headers) : null,
    body: tc.body ? JSON.stringify(tc.body, null, 8) : null,
    expectedStatus: tc.expectedStatus,
    assertions: tc.assertions,
  };
}

/**
 * Generate a basic smoke test case for an endpoint without Tier 3 data.
 */
function generateSmokePytestCase(ep: EndpointRecord): Record<string, unknown> {
  const method = ep.method.toLowerCase();
  // For GET/HEAD/OPTIONS, expect 200; for POST, 201; for DELETE, 204 or 200
  const expectedStatus =
    method === 'post' ? 201 : method === 'delete' ? 204 : 200;

  const path = ep.path.replace(/{(\w+)}/g, '1'); // substitute params with "1"

  return {
    name: `test_${method}_smoke`,
    docstring: `Smoke test: ${ep.method} ${ep.path} returns a successful status`,
    method,
    path,
    headers: null,
    body: ep.requestBody ? '{}' : null,
    expectedStatus,
    assertions: [`Response status is ${expectedStatus}`],
  };
}

// ─── Jest Generation ─────────────────────────────────────────────────────────

/**
 * Generate a complete Jest test suite.
 */
function generateJestSuite(
  endpoints: EndpointRecord[],
  outputDir: string,
): string[] {
  const files: string[] = [];

  // Generate jest.config.js
  const configPath = path.join(outputDir, 'jest.config.js');
  fs.writeFileSync(configPath, JEST_CONFIG_CONTENT, 'utf-8');
  files.push(configPath);

  // Group endpoints by source file / controller
  const groups = groupEndpoints(endpoints);

  const jestTemplate = loadTemplate('jest.hbs');

  for (const [groupName, groupEndpoints] of groups) {
    const safeName = toSafeFilename(groupName);
    const filename = `${safeName}.test.ts`;
    const filePath = path.join(outputDir, filename);

    const testData = buildJestData(groupName, groupEndpoints);
    const content = jestTemplate(testData);
    fs.writeFileSync(filePath, content, 'utf-8');
    files.push(filePath);
  }

  return files;
}

/**
 * Build template data for a Jest test file.
 */
function buildJestData(
  groupName: string,
  endpoints: EndpointRecord[],
): Record<string, unknown> {
  const describeBlocks = endpoints.map((ep) => {
    const testCases =
      ep.testCases && ep.testCases.length > 0
        ? ep.testCases.map((tc) => formatJestCase(tc))
        : [generateSmokeJestCase(ep)];

    return {
      description: `${ep.method} ${ep.path}`,
      endpoint: {
        method: ep.method.toLowerCase(),
        path: ep.path,
        auth: ep.auth,
        hasRequestBody: !!ep.requestBody,
      },
      testCases,
    };
  });

  return {
    groupName,
    generatedAt: new Date().toISOString(),
    describeBlocks,
  };
}

/**
 * Format a Tier 3 test case for Jest.
 */
function formatJestCase(tc: TestCaseRecord): Record<string, unknown> {
  return {
    name: tc.name,
    method: tc.method.toLowerCase(),
    path: tc.path,
    headers: tc.headers ? JSON.stringify(tc.headers, null, 6) : null,
    body: tc.body ? JSON.stringify(tc.body, null, 6) : null,
    expectedStatus: tc.expectedStatus,
    assertions: tc.assertions,
  };
}

/**
 * Generate a basic smoke test case for Jest.
 */
function generateSmokeJestCase(ep: EndpointRecord): Record<string, unknown> {
  const method = ep.method.toLowerCase();
  const expectedStatus =
    method === 'post' ? 201 : method === 'delete' ? 204 : 200;

  const testPath = ep.path.replace(/{(\w+)}/g, '1');

  return {
    name: `should return ${expectedStatus} for ${ep.method} ${ep.path}`,
    method,
    path: testPath,
    headers: null,
    body: ep.requestBody ? '{}' : null,
    expectedStatus,
    assertions: [`Response status should be ${expectedStatus}`],
  };
}

// ─── Shared Helpers ──────────────────────────────────────────────────────────

/**
 * Group endpoints by source file or controller class.
 */
function groupEndpoints(
  endpoints: EndpointRecord[],
): Map<string, EndpointRecord[]> {
  const groups = new Map<string, EndpointRecord[]>();

  for (const ep of endpoints) {
    // Prefer class name as group key, fall back to source file
    const key = ep.handler.className ?? path.basename(ep.sourceFile, path.extname(ep.sourceFile));

    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(ep);
  }

  return groups;
}

/**
 * Build a PascalCase test class name from an endpoint.
 */
function buildTestClassName(ep: EndpointRecord): string {
  const base = ep.handler.className ?? ep.handler.name;
  // Ensure it starts with "Test"
  const cleaned = base.replace(/[^a-zA-Z0-9]/g, '');
  return cleaned.startsWith('Test') ? cleaned : `Test${cleaned}`;
}

/**
 * Load and compile a Handlebars template.
 */
function loadTemplate(templateName: string): Handlebars.TemplateDelegate {
  const templatePath = path.join(TEMPLATE_DIR, templateName);

  if (fs.existsSync(templatePath)) {
    const source = fs.readFileSync(templatePath, 'utf-8');
    return Handlebars.compile(source);
  }

  logger.warn(`Template file not found: ${templatePath}, using inline fallback`);

  if (templateName === 'pytest.hbs') {
    return Handlebars.compile(FALLBACK_PYTEST_TEMPLATE);
  }
  if (templateName === 'jest.hbs') {
    return Handlebars.compile(FALLBACK_JEST_TEMPLATE);
  }

  return Handlebars.compile('# No template available\n');
}

/**
 * Register Handlebars helpers for test generation.
 */
function registerHelpers(): void {
  Handlebars.registerHelper('indent', (text: string, spaces: number) => {
    if (typeof text !== 'string') return text;
    const pad = ' '.repeat(spaces);
    return text
      .split('\n')
      .map((line) => pad + line)
      .join('\n');
  });

  Handlebars.registerHelper('snakeCase', (str: string) => {
    if (typeof str !== 'string') return str;
    return str
      .replace(/[^a-zA-Z0-9]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      .toLowerCase();
  });
}

/**
 * Ensure a directory exists.
 */
function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

// ─── Boilerplate Content ─────────────────────────────────────────────────────

const CONFTEST_CONTENT = `"""
CodeLens — pytest Configuration & Fixtures
Auto-generated. Customize as needed.
"""

import pytest
import httpx


@pytest.fixture(scope="session")
def base_url() -> str:
    """Base URL for the API under test. Override via environment variable."""
    import os
    return os.environ.get("API_BASE_URL", "http://localhost:8000")


@pytest.fixture(scope="session")
def client(base_url: str) -> httpx.Client:
    """Reusable httpx client for the test session."""
    with httpx.Client(base_url=base_url, timeout=30.0) as client:
        yield client


@pytest.fixture(scope="session")
def async_client(base_url: str):
    """Reusable async httpx client for the test session."""
    import asyncio

    async def _make_client():
        async with httpx.AsyncClient(base_url=base_url, timeout=30.0) as client:
            yield client

    return _make_client


@pytest.fixture
def auth_headers() -> dict:
    """Default auth headers. Override in tests that need specific auth."""
    import os
    token = os.environ.get("API_AUTH_TOKEN", "test-token")
    return {"Authorization": f"Bearer {token}"}
`;

const JEST_CONFIG_CONTENT = `/**
 * CodeLens — Jest Configuration
 * Auto-generated. Customize as needed.
 */

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\\\.ts$': 'ts-jest',
  },
  globals: {
    'ts-jest': {
      tsconfig: 'tsconfig.json',
    },
  },
  // Set API base URL via environment variable
  // API_BASE_URL=http://localhost:3000 npx jest
  setupFiles: [],
  testTimeout: 30000,
};
`;

// ─── Fallback Templates ─────────────────────────────────────────────────────

const FALLBACK_PYTEST_TEMPLATE = `"""
CodeLens — Auto-generated pytest tests for {{groupName}}
Generated at: {{generatedAt}}

Run with: pytest {{groupName}}_test.py -v
"""

import pytest
import httpx


{{#each testClasses}}
class {{className}}:
    """{{docstring}}"""

{{#each testCases}}
    def {{name}}(self, client: httpx.Client{{#if ../endpoint.auth}}, auth_headers: dict{{/if}}):
        """{{docstring}}"""
        response = client.{{method}}(
            "{{path}}"{{#if headers}},
            headers={{headers}}{{else}}{{#if ../endpoint.auth}},
            headers=auth_headers{{/if}}{{/if}}{{#if body}},
            json={{body}}{{/if}},
        )
        assert response.status_code == {{expectedStatus}}
{{#each assertions}}
        # {{this}}
{{/each}}

{{/each}}

{{/each}}
`;

const FALLBACK_JEST_TEMPLATE = `/**
 * CodeLens — Auto-generated Jest tests for {{groupName}}
 * Generated at: {{generatedAt}}
 *
 * Run with: npx jest {{groupName}}.test.ts
 */

import request from 'supertest';

const BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';

{{#each describeBlocks}}
describe('{{description}}', () => {
{{#each testCases}}
  it('{{name}}', async () => {
    const response = await request(BASE_URL)
      .{{method}}('{{path}}'){{#if headers}}
      .set({{headers}}){{/if}}{{#if body}}
      .send({{body}}){{/if}};

    expect(response.status).toBe({{expectedStatus}});
{{#each assertions}}
    // {{this}}
{{/each}}
  });

{{/each}}
});

{{/each}}
`;
