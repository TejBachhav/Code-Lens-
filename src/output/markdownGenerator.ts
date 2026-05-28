/**
 * CodeLens — Markdown Documentation Generator
 *
 * Generates human-readable Markdown documentation from enriched endpoint records.
 *
 * Output structure:
 *   docs/
 *   ├── README.md              — Overview with endpoint index table
 *   ├── endpoints/
 *   │   └── METHOD_path.md     — Per-endpoint detail pages
 *   └── schemas/
 *       └── TypeName.md        — Schema documentation from resolvedTypes
 *
 * Uses Handlebars templates stored in src/output/templates/ for customizability.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as Handlebars from 'handlebars';
import { EndpointRecord, JsonSchema } from '../shared/types';
import { UNRESOLVED } from '../shared/constants';
import { endpointFilename } from '../shared/utils';
import { Logger } from '../shared/logger';

const logger = Logger.create('MarkdownGenerator');

// ─── Template Paths ──────────────────────────────────────────────────────────

const TEMPLATE_DIR = path.resolve(__dirname, 'templates');

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Generate complete Markdown documentation for all endpoints.
 *
 * @param endpoints - The enriched endpoint records.
 * @param outputDir - Absolute path to the output directory (e.g., workspace/.codelens/docs).
 * @returns Paths to all generated files.
 */
export async function generateMarkdownDocs(
  endpoints: EndpointRecord[],
  outputDir: string,
): Promise<string[]> {
  const generatedFiles: string[] = [];

  // Ensure output directories exist
  const endpointsDir = path.join(outputDir, 'endpoints');
  const schemasDir = path.join(outputDir, 'schemas');
  ensureDir(outputDir);
  ensureDir(endpointsDir);
  ensureDir(schemasDir);

  // Register Handlebars helpers
  registerHelpers();

  // ── 1. Generate overview README ──────────────────────────────────────────
  const readmePath = path.join(outputDir, 'README.md');
  const overviewTemplate = loadTemplate('overview.md.hbs');

  const overviewData = buildOverviewData(endpoints);
  const readmeContent = overviewTemplate(overviewData);
  fs.writeFileSync(readmePath, readmeContent, 'utf-8');
  generatedFiles.push(readmePath);
  logger.info(`Generated overview: ${readmePath}`);

  // ── 2. Generate per-endpoint pages ──────────────────────────────────────
  const endpointTemplate = loadTemplate('endpoint.md.hbs');

  for (const ep of endpoints) {
    const filename = endpointFilename(ep.method, ep.path) + '.md';
    const filePath = path.join(endpointsDir, filename);
    const epData = buildEndpointData(ep);
    const content = endpointTemplate(epData);
    fs.writeFileSync(filePath, content, 'utf-8');
    generatedFiles.push(filePath);
  }

  logger.info(`Generated ${endpoints.length} endpoint docs`);

  // ── 3. Generate schema pages ────────────────────────────────────────────
  const allSchemas = collectSchemas(endpoints);
  let schemaCount = 0;

  for (const [typeName, schema] of Object.entries(allSchemas)) {
    const filename = typeName.replace(/[^a-zA-Z0-9_-]/g, '_') + '.md';
    const filePath = path.join(schemasDir, filename);
    const content = generateSchemaPage(typeName, schema);
    fs.writeFileSync(filePath, content, 'utf-8');
    generatedFiles.push(filePath);
    schemaCount++;
  }

  if (schemaCount > 0) {
    logger.info(`Generated ${schemaCount} schema docs`);
  }

  return generatedFiles;
}

// ─── Template Loader ─────────────────────────────────────────────────────────

/**
 * Load and compile a Handlebars template from the templates directory.
 * Falls back to an inline default if the template file is missing.
 */
function loadTemplate(templateName: string): Handlebars.TemplateDelegate {
  const templatePath = path.join(TEMPLATE_DIR, templateName);

  if (fs.existsSync(templatePath)) {
    const source = fs.readFileSync(templatePath, 'utf-8');
    return Handlebars.compile(source);
  }

  logger.warn(`Template file not found: ${templatePath}, using inline fallback`);

  // Inline fallbacks
  if (templateName === 'overview.md.hbs') {
    return Handlebars.compile(FALLBACK_OVERVIEW_TEMPLATE);
  }
  if (templateName === 'endpoint.md.hbs') {
    return Handlebars.compile(FALLBACK_ENDPOINT_TEMPLATE);
  }

  // Generic fallback
  return Handlebars.compile('# {{title}}\n\nNo template available.\n');
}

// ─── Handlebars Helpers ──────────────────────────────────────────────────────

/**
 * Register custom Handlebars helpers used in templates.
 */
function registerHelpers(): void {
  Handlebars.registerHelper('uppercase', (str: string) =>
    typeof str === 'string' ? str.toUpperCase() : str,
  );

  Handlebars.registerHelper('lowercase', (str: string) =>
    typeof str === 'string' ? str.toLowerCase() : str,
  );

  Handlebars.registerHelper('httpBadge', (method: string) => {
    const colors: Record<string, string> = {
      GET: '🟢',
      POST: '🟡',
      PUT: '🟠',
      PATCH: '🟠',
      DELETE: '🔴',
      OPTIONS: '⚪',
      HEAD: '⚪',
    };
    return colors[method] ?? '⚫';
  });

  Handlebars.registerHelper('authBadge', (auth: unknown) => {
    if (!auth) return '🔓 None';
    const a = auth as { type: string };
    return `🔐 ${a.type}`;
  });

  Handlebars.registerHelper('isUnresolved', (value: unknown) => {
    return value === UNRESOLVED || value === '__UNRESOLVED__';
  });

  Handlebars.registerHelper('jsonPretty', (value: unknown) => {
    if (value === undefined || value === null) return 'N/A';
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  });

  Handlebars.registerHelper('ifEquals', function (
    this: unknown,
    a: unknown,
    b: unknown,
    options: Handlebars.HelperOptions,
  ) {
    return a === b ? options.fn(this) : options.inverse(this);
  });
}

// ─── Data Builders ───────────────────────────────────────────────────────────

interface SchemaElementRow {
  name: string;
  type: string;
  required: string;
  description: string;
  sampleInput: string;
}

function getSampleValueForType(type: string): string {
  switch (type?.toLowerCase()) {
    case 'integer':
    case 'int':
    case 'number':
    case 'float':
      return '1';
    case 'boolean':
    case 'bool':
      return 'true';
    case 'array':
    case 'list':
      return '[]';
    case 'object':
    case 'dict':
      return '{}';
    case 'string':
    case 'str':
    default:
      return '"string"';
  }
}

function buildMockValue(schema: any): any {
  if (!schema || schema === UNRESOLVED || schema === '__UNRESOLVED__') return 'success';
  if (schema.type === 'object') {
    const obj: Record<string, any> = {};
    if (schema.properties) {
      for (const [key, val] of Object.entries(schema.properties)) {
        obj[key] = buildMockValue(val);
      }
    }
    return obj;
  }
  if (schema.type === 'array') {
    if (schema.items) {
      return [buildMockValue(schema.items)];
    }
    return [];
  }
  switch (schema.type) {
    case 'integer':
    case 'number':
      return 1;
    case 'boolean':
      return true;
    case 'null':
      return null;
    case 'string':
    default:
      if (schema.format === 'date-time') {
        return new Date().toISOString();
      }
      return 'string';
  }
}

function generateMockJson(schema: any): string {
  if (!schema || schema === UNRESOLVED || schema === '__UNRESOLVED__') {
    return '{\n  "message": "success"\n}';
  }
  try {
    const mock = buildMockValue(schema);
    return JSON.stringify(mock, null, 2);
  } catch {
    return '{\n  "message": "success"\n}';
  }
}

/**
 * Build template data for the overview page.
 */
function buildOverviewData(endpoints: EndpointRecord[]): Record<string, unknown> {
  // Group by framework
  const frameworks = new Map<string, number>();
  const authTypes = new Set<string>();

  for (const ep of endpoints) {
    frameworks.set(ep.framework, (frameworks.get(ep.framework) ?? 0) + 1);
    if (ep.auth?.type) {
      authTypes.add(ep.auth.type);
    }
  }

  // Endpoint index rows
  const endpointRows = endpoints.map((ep) => ({
    method: ep.method,
    path: ep.path,
    summary: ep.summary ?? '—',
    auth: ep.auth ? ep.auth.type : 'none',
    framework: ep.framework,
    filename: endpointFilename(ep.method, ep.path) + '.md',
  }));

  // Sort by path then method
  endpointRows.sort((a, b) => {
    const pathCmp = a.path.localeCompare(b.path);
    return pathCmp !== 0 ? pathCmp : a.method.localeCompare(b.method);
  });

  return {
    title: 'API Documentation',
    generatedAt: new Date().toLocaleDateString(),
    totalEndpoints: endpoints.length,
    frameworkSummary: Array.from(frameworks.entries()).map(([name, count]) => ({
      name,
      count,
    })),
    endpoints: endpointRows,
    authTypes: Array.from(authTypes),
  };
}

/**
 * Build template data for a single endpoint page.
 */
function buildEndpointData(ep: EndpointRecord): Record<string, unknown> {
  const schemaElements: SchemaElementRow[] = [];

  // 1. Add path and query parameters
  for (const p of ep.params) {
    const name = p.in === 'path' ? `${p.name} (path)` : `${p.name} (query)`;
    schemaElements.push({
      name,
      type: p.type,
      required: p.required ? 'Yes' : 'No',
      description: p.description || `Parameter in ${p.in}`,
      sampleInput: p.default !== undefined ? String(p.default) : getSampleValueForType(p.type),
    });
  }

  // 2. Add request body fields if schema is available
  if (ep.requestBody) {
    const schema = ep.requestBody.schema;
    if (schema && (schema as any) !== UNRESOLVED && (schema as any) !== '__UNRESOLVED__') {
      const jsonSchema = schema as JsonSchema;
      if (jsonSchema.properties) {
        const requiredFields = new Set(jsonSchema.required || []);
        for (const [propName, propSchema] of Object.entries(jsonSchema.properties)) {
          const typeStr = (propSchema as any).type || 'string';
          schemaElements.push({
            name: `body.${propName}`,
            type: typeStr,
            required: requiredFields.has(propName) ? 'Yes' : 'No',
            description: (propSchema as any).description || 'Request body field',
            sampleInput: (propSchema as any).default !== undefined
              ? JSON.stringify((propSchema as any).default)
              : getSampleValueForType(typeStr),
          });
        }
      } else {
        schemaElements.push({
          name: 'body',
          type: jsonSchema.type || 'object',
          required: ep.requestBody.required ? 'Yes' : 'No',
          description: jsonSchema.description || 'Request body payload',
          sampleInput: generateMockJson(jsonSchema),
        });
      }
    } else {
      schemaElements.push({
        name: 'body',
        type: 'object',
        required: ep.requestBody.required ? 'Yes' : 'No',
        description: 'Request body payload',
        sampleInput: '{}',
      });
    }
  }

  // 3. Construct possible request (curl)
  let sampleRequest = ep.curlExample || '';
  if (!sampleRequest) {
    sampleRequest = `curl -X ${ep.method} "http://localhost:8000${ep.path}"`;
    const headers: string[] = [];
    if (ep.auth) {
      if (ep.auth.type === 'bearer') {
        headers.push('-H "Authorization: Bearer <TOKEN>"');
      } else if (ep.auth.type === 'api_key') {
        headers.push('-H "X-API-Key: <API_KEY>"');
      }
    }
    if (ep.requestBody) {
      headers.push(`-H "Content-Type: ${ep.requestBody.contentType}"`);
      const mockBody = generateMockJson(ep.requestBody.schema);
      const singleLineBody = mockBody.replace(/\s+/g, ' ');
      headers.push(`-d '${singleLineBody}'`);
    }
    if (headers.length > 0) {
      sampleRequest += ' \\\n  ' + headers.join(' \\\n  ');
    }
  }

  // 4. Construct response outputs
  const responseOutputs: Array<{
    statusCode: number;
    statusDescription: string;
    contentType: string;
    sampleOutput: string;
  }> = [];

  const descriptions: Record<number, string> = {
    200: 'OK',
    201: 'Created',
    204: 'No Content',
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    500: 'Internal Server Error',
  };

  if (ep.responseSchemas && ep.responseSchemas.length > 0) {
    for (const r of ep.responseSchemas) {
      responseOutputs.push({
        statusCode: r.statusCode,
        statusDescription: r.description || descriptions[r.statusCode] || 'Success',
        contentType: r.contentType,
        sampleOutput: generateMockJson(r.schema),
      });
    }
  } else {
    responseOutputs.push({
      statusCode: 200,
      statusDescription: 'Success',
      contentType: 'application/json',
      sampleOutput: '{\n  "message": "success"\n}',
    });
  }

  return {
    method: ep.method,
    path: ep.path,
    summary: ep.summary ?? `${ep.method} ${ep.path}`,
    description: ep.description ?? null,
    handler: ep.handler,
    framework: ep.framework,
    language: ep.language,
    sourceFile: ep.sourceFile,
    sourceLines: ep.sourceLines,
    schemaElements,
    sampleRequest,
    responseOutputs,
    testCases: ep.testCases,
    tags: ep.tags,
    sideEffects: ep.sideEffects,
    constraints: ep.constraints,
    generatedAt: new Date().toLocaleDateString(),
  };
}

/**
 * Collect all unique resolved type schemas across endpoints.
 */
function collectSchemas(endpoints: EndpointRecord[]): Record<string, JsonSchema> {
  const schemas: Record<string, JsonSchema> = {};
  for (const ep of endpoints) {
    if (ep.resolvedTypes) {
      for (const [name, schema] of Object.entries(ep.resolvedTypes)) {
        if (!schemas[name]) {
          schemas[name] = schema;
        }
      }
    }
  }
  return schemas;
}

/**
 * Generate a Markdown page for a single schema/type definition.
 */
function generateSchemaPage(typeName: string, schema: JsonSchema): string {
  const lines: string[] = [
    `# ${typeName}`,
    '',
    `> Auto-generated schema documentation`,
    '',
  ];

  if (schema.description) {
    lines.push(schema.description, '');
  }

  lines.push('## Definition', '', '```json', JSON.stringify(schema, null, 2), '```', '');

  // Properties table
  if (schema.properties) {
    lines.push('## Properties', '');
    lines.push('| Property | Type | Required | Description |');
    lines.push('|----------|------|----------|-------------|');

    const required = new Set(schema.required ?? []);
    for (const [propName, propSchema] of Object.entries(schema.properties)) {
      const propType = propSchema.type ?? 'object';
      const isRequired = required.has(propName) ? '✅' : '—';
      const desc = propSchema.description ?? '—';
      lines.push(`| \`${propName}\` | \`${propType}\` | ${isRequired} | ${desc} |`);
    }

    lines.push('');
  }

  return lines.join('\n');
}

// ─── Utility ─────────────────────────────────────────────────────────────────

/**
 * Ensure a directory exists, creating it recursively if needed.
 */
function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

// ─── Fallback Templates ─────────────────────────────────────────────────────

const FALLBACK_OVERVIEW_TEMPLATE = `# {{title}}

> Auto-generated by CodeLens on {{generatedAt}}

## Summary

- **Total Endpoints:** {{totalEndpoints}}
{{#each frameworkSummary}}
- **{{name}}:** {{count}} endpoints
{{/each}}

## Endpoints

| Method | Path | Summary | Auth |
|--------|------|---------|------|
{{#each endpoints}}
| {{httpBadge method}} **{{method}}** | [\`{{path}}\`](endpoints/{{filename}}) | {{summary}} | {{authBadge auth}} |
{{/each}}

---

*Generated by [CodeLens](https://github.com/codelens)*
`;

const FALLBACK_ENDPOINT_TEMPLATE = `# {{httpBadge method}} {{method}} \`{{path}}\`

{{#if summary}}> {{summary}}{{/if}}

{{#if description}}
## Description

{{description}}
{{/if}}

## Details

| Property | Value |
|----------|-------|
| **Framework** | {{framework}} |
| **Language** | {{language}} |
| **Handler** | \`{{handler.name}}\` |
{{#if handler.className}}| **Class** | \`{{handler.className}}\` |{{/if}}
| **Source** | \`{{sourceFile}}\` (L{{sourceLines.[0]}}–L{{sourceLines.[1]}}) |
| **Async** | {{handler.isAsync}} |

{{#if params}}
## Parameters

| Name | In | Type | Required | Default | Description |
|------|----|------|----------|---------|-------------|
{{#each params}}
| \`{{name}}\` | {{in}} | \`{{type}}\` | {{#if required}}✅{{else}}—{{/if}} | {{#if default}}\`{{default}}\`{{else}}—{{/if}} | {{#if description}}{{description}}{{else}}—{{/if}} |
{{/each}}
{{/if}}

{{#if requestBody}}
## Request Body

- **Content-Type:** \`{{requestBody.contentType}}\`
- **Required:** {{requestBody.required}}
{{#if requestBody.typeName}}- **Type:** \`{{requestBody.typeName}}\`{{/if}}

\`\`\`json
{{jsonPretty requestBody.schema}}
\`\`\`
{{/if}}

{{#if auth}}
## Authentication

- **Type:** {{auth.type}}
{{#if auth.scheme}}- **Scheme:** {{auth.scheme}}{{/if}}
{{#if auth.guardName}}- **Guard:** \`{{auth.guardName}}\`{{/if}}
{{/if}}

{{#if middleware}}
## Middleware

{{#each middleware}}
- \`{{this}}\`
{{/each}}
{{/if}}

{{#if responseSchemas}}
## Responses

| Status | Content-Type | Description |
|--------|-------------|-------------|
{{#each responseSchemas}}
| {{statusCode}} | \`{{contentType}}\` | {{#if description}}{{description}}{{else}}—{{/if}} |
{{/each}}
{{/if}}

{{#if sideEffects}}
## Side Effects

| Type | Operation | Target | Confidence |
|------|-----------|--------|------------|
{{#each sideEffects}}
| {{type}} | {{operation}} | {{#if target}}\`{{target}}\`{{else}}—{{/if}} | {{confidence}} |
{{/each}}
{{/if}}

{{#if constraints}}
## Constraints

{{#each constraints}}
- **{{type}}:** {{description}} *(source: {{source}})*
{{/each}}
{{/if}}

{{#if curlExample}}
## Example

\`\`\`bash
{{curlExample}}
\`\`\`
{{/if}}

{{#if testCases}}
## Test Cases

{{#each testCases}}
### {{name}}

{{description}}

- **Request:** \`{{method}} {{path}}\`
- **Expected Status:** {{expectedStatus}}
{{#if assertions}}
- **Assertions:**
{{#each assertions}}
  - {{this}}
{{/each}}
{{/if}}

{{/each}}
{{/if}}

{{#if tags}}
## Tags

{{#each tags}}\`{{this}}\` {{/each}}
{{/if}}

---

*Generated by CodeLens*
`;
