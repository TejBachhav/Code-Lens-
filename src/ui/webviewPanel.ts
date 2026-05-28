/**
 * CodeLens — Documentation Preview Webview Panel
 *
 * Renders a rich, dark-themed preview of a single endpoint's documentation
 * inside a VS Code webview panel. The panel follows the singleton pattern:
 * calling {@link DocPreviewPanel.createOrShow} reuses an existing panel when
 * one is already visible.
 *
 * Sections rendered:
 *  - Method badge (colour-coded)
 *  - Path with highlighted `{params}`
 *  - Parameters table
 *  - Request body schema (formatted JSON)
 *  - Response schemas table
 *  - Authentication requirements
 *  - Side effects list
 *  - curl example (Tier 3)
 *  - Generated test cases (Tier 3)
 *
 * @module ui/webviewPanel
 */

import * as vscode from 'vscode';
import {
  EndpointRecord,
  HttpMethod,
  ParamRecord,
  ResponseSchemaRecord,
  SideEffectRecord,
  TestCaseRecord,
  JsonSchema,
} from '../shared/types';
import { UNRESOLVED } from '../shared/constants';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Unique viewType identifier registered with VS Code. */
const VIEW_TYPE = 'codelens.docPreview';

/** Colour mapping for HTTP method badges (CSS colour values). */
const METHOD_COLORS: Record<HttpMethod, string> = {
  GET:     '#49cc90',
  POST:    '#fca130',
  PUT:     '#61affe',
  DELETE:  '#f93e3e',
  PATCH:   '#e8a317',
  OPTIONS: '#9b59b6',
  HEAD:    '#9b59b6',
};

// ─── DocPreviewPanel ─────────────────────────────────────────────────────────

/**
 * Manages a singleton webview panel that displays endpoint documentation.
 *
 * ```ts
 * // Open or update the preview
 * DocPreviewPanel.createOrShow(context.extensionUri, endpointRecord);
 * ```
 */
export class DocPreviewPanel {
  /** The singleton instance (if the panel is currently open). */
  private static currentPanel: DocPreviewPanel | undefined;

  /** The underlying VS Code webview panel. */
  private readonly panel: vscode.WebviewPanel;

  /** Extension URI (used for local resource paths if needed in future). */
  private readonly extensionUri: vscode.Uri;

  /** The endpoint currently being displayed. */
  private endpoint: EndpointRecord | undefined;

  /** Disposables owned by this panel. */
  private disposables: vscode.Disposable[] = [];

  // ── Static factory ───────────────────────────────────────────────────

  /**
   * Create or reveal the documentation preview panel for the given endpoint.
   *
   * If a panel already exists it is revealed and updated; otherwise a new
   * panel is created in the column beside the active editor.
   *
   * @param extensionUri URI of the extension installation directory.
   * @param endpoint     The endpoint record to preview.
   */
  static createOrShow(extensionUri: vscode.Uri, endpoint: EndpointRecord): void {
    const column = vscode.window.activeTextEditor
      ? vscode.ViewColumn.Beside
      : vscode.ViewColumn.One;

    if (DocPreviewPanel.currentPanel) {
      DocPreviewPanel.currentPanel.panel.reveal(column);
      DocPreviewPanel.currentPanel.update(endpoint);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      VIEW_TYPE,
      `Docs: ${endpoint.method} ${endpoint.path}`,
      column,
      {
        enableScripts: false,
        localResourceRoots: [extensionUri],
      },
    );

    DocPreviewPanel.currentPanel = new DocPreviewPanel(panel, extensionUri);
    DocPreviewPanel.currentPanel.update(endpoint);
  }

  /**
   * Revive a previously serialised webview panel (called by VS Code when
   * the user re-opens the workbench and the panel was open before).
   *
   * @param panel        The webview panel to revive.
   * @param extensionUri URI of the extension installation directory.
   */
  static revive(panel: vscode.WebviewPanel, extensionUri: vscode.Uri): void {
    DocPreviewPanel.currentPanel = new DocPreviewPanel(panel, extensionUri);
  }

  // ── Constructor (private — use static methods) ───────────────────────

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this.panel = panel;
    this.extensionUri = extensionUri;

    // Clean up when the user closes the panel
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  // ── Public API ───────────────────────────────────────────────────────

  /**
   * Update the webview with a new endpoint's documentation.
   *
   * @param endpoint The endpoint record to render.
   */
  update(endpoint: EndpointRecord): void {
    this.endpoint = endpoint;
    this.panel.title = `Docs: ${endpoint.method} ${endpoint.path}`;
    this.panel.webview.html = this.buildHtml(endpoint);
  }

  /**
   * Dispose of the panel and all owned resources.
   */
  dispose(): void {
    DocPreviewPanel.currentPanel = undefined;

    this.panel.dispose();
    while (this.disposables.length) {
      const d = this.disposables.pop();
      d?.dispose();
    }
  }

  // ── HTML generation ──────────────────────────────────────────────────

  /**
   * Build the full HTML document for the webview.
   */
  private buildHtml(ep: EndpointRecord): string {
    const methodColor = METHOD_COLORS[ep.method] ?? '#aaa';
    const highlightedPath = this.highlightPathParams(ep.path);

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src 'unsafe-inline';" />
  <title>Docs: ${this.escapeHtml(ep.method)} ${this.escapeHtml(ep.path)}</title>
  <style>${this.getStyles()}</style>
</head>
<body>
  <div class="container">
    ${this.renderHeader(ep, methodColor, highlightedPath)}
    ${this.renderSummary(ep)}
    ${this.renderHandlerInfo(ep)}
    ${this.renderParams(ep)}
    ${this.renderRequestBody(ep)}
    ${this.renderResponses(ep)}
    ${this.renderAuth(ep)}
    ${this.renderSideEffects(ep)}
    ${this.renderCurlExample(ep)}
    ${this.renderTestCases(ep)}
  </div>
</body>
</html>`;
  }

  // ── Section renderers ────────────────────────────────────────────────

  /**
   * Render the hero header with method badge and path.
   */
  private renderHeader(ep: EndpointRecord, color: string, highlightedPath: string): string {
    return /* html */ `
    <div class="header">
      <span class="method-badge" style="background:${color};">${this.escapeHtml(ep.method)}</span>
      <span class="path">${highlightedPath}</span>
    </div>`;
  }

  /**
   * Render summary and description (Tier 3).
   */
  private renderSummary(ep: EndpointRecord): string {
    if (!ep.summary && !ep.description) {
      return '';
    }
    return /* html */ `
    <section class="section">
      ${ep.summary ? `<p class="summary">${this.escapeHtml(ep.summary)}</p>` : ''}
      ${ep.description ? `<p class="description">${this.escapeHtml(ep.description)}</p>` : ''}
    </section>`;
  }

  /**
   * Render handler metadata (file, line, framework).
   */
  private renderHandlerInfo(ep: EndpointRecord): string {
    const handlerName = ep.handler.className
      ? `${ep.handler.className}.${ep.handler.name}`
      : ep.handler.name;

    return /* html */ `
    <section class="section">
      <h2>Handler</h2>
      <table class="info-table">
        <tr><td class="label">Function</td><td><code>${this.escapeHtml(handlerName)}</code>${ep.handler.isAsync ? ' <span class="tag tag-async">async</span>' : ''}</td></tr>
        <tr><td class="label">File</td><td><code>${this.escapeHtml(ep.sourceFile)}:${ep.sourceLines[0]}</code></td></tr>
        <tr><td class="label">Framework</td><td>${this.escapeHtml(ep.framework)}</td></tr>
        <tr><td class="label">Language</td><td>${this.escapeHtml(ep.language)}</td></tr>
      </table>
    </section>`;
  }

  /**
   * Render the parameters table.
   */
  private renderParams(ep: EndpointRecord): string {
    if (ep.params.length === 0) {
      return '';
    }

    const rows = ep.params
      .map((p) => this.renderParamRow(p))
      .join('\n');

    return /* html */ `
    <section class="section">
      <h2>Parameters</h2>
      <table class="data-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>In</th>
            <th>Type</th>
            <th>Required</th>
            <th>Default</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </section>`;
  }

  /**
   * Render a single parameter table row.
   */
  private renderParamRow(p: ParamRecord): string {
    const required = p.required
      ? '<span class="tag tag-required">required</span>'
      : '<span class="tag tag-optional">optional</span>';
    const defaultVal = p.default !== undefined
      ? `<code>${this.escapeHtml(JSON.stringify(p.default))}</code>`
      : '—';
    const description = p.description ? this.escapeHtml(p.description) : '—';

    return /* html */ `
        <tr>
          <td><code>${this.escapeHtml(p.name)}</code></td>
          <td><span class="tag tag-in">${this.escapeHtml(p.in)}</span></td>
          <td><code>${this.escapeHtml(p.type)}</code></td>
          <td>${required}</td>
          <td>${defaultVal}</td>
          <td>${description}</td>
        </tr>`;
  }

  /**
   * Render the request body schema.
   */
  private renderRequestBody(ep: EndpointRecord): string {
    if (!ep.requestBody) {
      return '';
    }

    const rb = ep.requestBody;
    const schemaHtml =
      rb.schema === UNRESOLVED
        ? '<em>Could not be statically resolved</em>'
        : `<pre><code>${this.escapeHtml(JSON.stringify(rb.schema, null, 2))}</code></pre>`;

    return /* html */ `
    <section class="section">
      <h2>Request Body</h2>
      <table class="info-table">
        <tr><td class="label">Content Type</td><td><code>${this.escapeHtml(rb.contentType)}</code></td></tr>
        <tr><td class="label">Required</td><td>${rb.required ? 'Yes' : 'No'}</td></tr>
        ${rb.typeName ? `<tr><td class="label">Type Name</td><td><code>${this.escapeHtml(rb.typeName)}</code></td></tr>` : ''}
      </table>
      <h3>Schema</h3>
      ${schemaHtml}
    </section>`;
  }

  /**
   * Render response schemas table.
   */
  private renderResponses(ep: EndpointRecord): string {
    if (!ep.responseSchemas || ep.responseSchemas.length === 0) {
      return '';
    }

    const rows = ep.responseSchemas
      .map((rs) => this.renderResponseRow(rs))
      .join('\n');

    return /* html */ `
    <section class="section">
      <h2>Responses</h2>
      <table class="data-table">
        <thead>
          <tr>
            <th>Status</th>
            <th>Content Type</th>
            <th>Description</th>
            <th>Schema</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </section>`;
  }

  /**
   * Render a single response schema row.
   */
  private renderResponseRow(rs: ResponseSchemaRecord): string {
    const statusClass = rs.statusCode < 300 ? 'status-ok' : rs.statusCode < 400 ? 'status-redirect' : 'status-error';
    const schema =
      rs.schema === UNRESOLVED
        ? '<em>Unresolved</em>'
        : `<code>${this.escapeHtml(this.compactSchema(rs.schema))}</code>`;
    const description = rs.description ? this.escapeHtml(rs.description) : '—';

    return /* html */ `
        <tr>
          <td><span class="status-code ${statusClass}">${rs.statusCode}</span></td>
          <td><code>${this.escapeHtml(rs.contentType)}</code></td>
          <td>${description}</td>
          <td>${schema}</td>
        </tr>`;
  }

  /**
   * Render authentication requirements.
   */
  private renderAuth(ep: EndpointRecord): string {
    if (!ep.auth) {
      return '';
    }

    const a = ep.auth;
    const details: string[] = [];
    if (a.scheme) details.push(`Scheme: <code>${this.escapeHtml(a.scheme)}</code>`);
    if (a.guardName) details.push(`Guard: <code>${this.escapeHtml(a.guardName)}</code>`);
    if (a.dependencyName) details.push(`Dependency: <code>${this.escapeHtml(a.dependencyName)}</code>`);
    if (a.decoratorName) details.push(`Decorator: <code>${this.escapeHtml(a.decoratorName)}</code>`);

    return /* html */ `
    <section class="section">
      <h2>🔒 Authentication</h2>
      <p><strong>Type:</strong> <span class="tag tag-auth">${this.escapeHtml(a.type)}</span></p>
      ${details.length > 0 ? `<ul>${details.map((d) => `<li>${d}</li>`).join('\n')}</ul>` : ''}
    </section>`;
  }

  /**
   * Render side effects list.
   */
  private renderSideEffects(ep: EndpointRecord): string {
    if (!ep.sideEffects || ep.sideEffects.length === 0) {
      return '';
    }

    const items = ep.sideEffects
      .map((se) => this.renderSideEffectItem(se))
      .join('\n');

    return /* html */ `
    <section class="section">
      <h2>⚡ Side Effects</h2>
      <ul class="side-effects-list">
        ${items}
      </ul>
    </section>`;
  }

  /**
   * Render a single side effect item.
   */
  private renderSideEffectItem(se: SideEffectRecord): string {
    const target = se.target ? ` → <code>${this.escapeHtml(se.target)}</code>` : '';
    const confidence = `<span class="tag tag-confidence-${se.confidence}">${se.confidence}</span>`;

    return /* html */ `
        <li>
          <strong>${this.escapeHtml(se.type)}</strong>
          <span class="tag tag-operation">${this.escapeHtml(se.operation)}</span>
          ${target}
          ${confidence}
        </li>`;
  }

  /**
   * Render a curl example block (Tier 3).
   */
  private renderCurlExample(ep: EndpointRecord): string {
    if (!ep.curlExample) {
      return '';
    }

    return /* html */ `
    <section class="section">
      <h2>🔗 curl Example</h2>
      <pre class="curl-block"><code>${this.escapeHtml(ep.curlExample)}</code></pre>
    </section>`;
  }

  /**
   * Render generated test cases (Tier 3).
   */
  private renderTestCases(ep: EndpointRecord): string {
    if (!ep.testCases || ep.testCases.length === 0) {
      return '';
    }

    const cards = ep.testCases
      .map((tc, i) => this.renderTestCaseCard(tc, i + 1))
      .join('\n');

    return /* html */ `
    <section class="section">
      <h2>🧪 Test Cases</h2>
      ${cards}
    </section>`;
  }

  /**
   * Render a single test case card.
   */
  private renderTestCaseCard(tc: TestCaseRecord, index: number): string {
    const bodyHtml = tc.body
      ? `<h4>Request Body</h4><pre><code>${this.escapeHtml(JSON.stringify(tc.body, null, 2))}</code></pre>`
      : '';

    const headersHtml = tc.headers && Object.keys(tc.headers).length > 0
      ? `<h4>Headers</h4><pre><code>${this.escapeHtml(JSON.stringify(tc.headers, null, 2))}</code></pre>`
      : '';

    const assertionsHtml = tc.assertions.length > 0
      ? `<h4>Assertions</h4><ul>${tc.assertions.map((a) => `<li><code>${this.escapeHtml(a)}</code></li>`).join('\n')}</ul>`
      : '';

    return /* html */ `
      <div class="test-card">
        <h3>Test ${index}: ${this.escapeHtml(tc.name)}</h3>
        <p class="description">${this.escapeHtml(tc.description)}</p>
        <table class="info-table">
          <tr><td class="label">Method</td><td><code>${this.escapeHtml(tc.method)}</code></td></tr>
          <tr><td class="label">Path</td><td><code>${this.escapeHtml(tc.path)}</code></td></tr>
          <tr><td class="label">Expected Status</td><td><span class="status-code ${tc.expectedStatus < 300 ? 'status-ok' : 'status-error'}">${tc.expectedStatus}</span></td></tr>
        </table>
        ${headersHtml}
        ${bodyHtml}
        ${assertionsHtml}
      </div>`;
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  /**
   * Highlight `{param}` segments in the path with accent colour.
   */
  private highlightPathParams(routePath: string): string {
    return this.escapeHtml(routePath).replace(
      /\{(\w+)\}/g,
      '<span class="path-param">{$1}</span>',
    );
  }

  /**
   * Produce a compact one-line summary of a JSON Schema.
   */
  private compactSchema(schema: JsonSchema): string {
    if (schema.type === 'array' && schema.items) {
      return `array<${schema.items.type ?? 'object'}>`;
    }
    if (schema.type === 'object' && schema.properties) {
      const keys = Object.keys(schema.properties).slice(0, 5);
      const suffix = Object.keys(schema.properties).length > 5 ? ', …' : '';
      return `{ ${keys.join(', ')}${suffix} }`;
    }
    return schema.type ?? 'unknown';
  }

  /**
   * Escape a string for safe inclusion in HTML.
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // ── Inline CSS ─────────────────────────────────────────────────────

  /**
   * Return the full CSS stylesheet inlined into the webview HTML.
   * Uses VS Code CSS custom properties so the panel respects the user's
   * current colour theme.
   */
  private getStyles(): string {
    return /* css */ `
      :root {
        --bg:              var(--vscode-editor-background, #1e1e1e);
        --fg:              var(--vscode-editor-foreground, #d4d4d4);
        --border:          var(--vscode-panel-border, #2d2d2d);
        --card-bg:         var(--vscode-editorWidget-background, #252526);
        --link:            var(--vscode-textLink-foreground, #3794ff);
        --heading:         var(--vscode-foreground, #e0e0e0);
        --muted:           var(--vscode-descriptionForeground, #858585);
        --code-bg:         var(--vscode-textCodeBlock-background, #1a1a1a);
        --table-header-bg: var(--vscode-editorGroupHeader-tabsBackground, #2d2d2d);
      }

      * { box-sizing: border-box; margin: 0; padding: 0; }

      body {
        font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
        font-size: var(--vscode-font-size, 13px);
        line-height: 1.6;
        color: var(--fg);
        background: var(--bg);
        padding: 0;
      }

      .container {
        max-width: 860px;
        margin: 0 auto;
        padding: 24px 32px 48px;
      }

      /* ── Header ─────────────────────────────────────── */
      .header {
        display: flex;
        align-items: center;
        gap: 14px;
        margin-bottom: 20px;
        padding-bottom: 16px;
        border-bottom: 1px solid var(--border);
      }

      .method-badge {
        display: inline-block;
        padding: 4px 14px;
        border-radius: 4px;
        font-weight: 700;
        font-size: 14px;
        color: #fff;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        flex-shrink: 0;
      }

      .path {
        font-size: 18px;
        font-weight: 600;
        font-family: var(--vscode-editor-font-family, 'Cascadia Code', 'Fira Code', monospace);
        word-break: break-all;
      }

      .path-param {
        color: #e8a317;
        font-weight: 700;
      }

      /* ── Sections ───────────────────────────────────── */
      .section {
        margin-top: 24px;
      }

      .section h2 {
        font-size: 15px;
        font-weight: 600;
        color: var(--heading);
        margin-bottom: 10px;
        padding-bottom: 4px;
        border-bottom: 1px solid var(--border);
      }

      .section h3 {
        font-size: 13px;
        font-weight: 600;
        color: var(--heading);
        margin-top: 12px;
        margin-bottom: 6px;
      }

      .section h4 {
        font-size: 12px;
        font-weight: 600;
        color: var(--muted);
        margin-top: 10px;
        margin-bottom: 4px;
      }

      .summary {
        font-size: 14px;
        font-weight: 500;
        color: var(--heading);
      }

      .description {
        color: var(--muted);
        margin-top: 6px;
      }

      /* ── Tables ─────────────────────────────────────── */
      .data-table,
      .info-table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 6px;
      }

      .data-table th {
        text-align: left;
        padding: 6px 10px;
        background: var(--table-header-bg);
        font-weight: 600;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: var(--muted);
        border-bottom: 1px solid var(--border);
      }

      .data-table td,
      .info-table td {
        padding: 6px 10px;
        border-bottom: 1px solid var(--border);
        vertical-align: top;
      }

      .info-table .label {
        font-weight: 600;
        width: 140px;
        color: var(--muted);
        white-space: nowrap;
      }

      /* ── Tags / Badges ──────────────────────────────── */
      .tag {
        display: inline-block;
        padding: 1px 8px;
        border-radius: 3px;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.3px;
      }

      .tag-required  { background: rgba(249,62,62,0.15); color: #f93e3e; }
      .tag-optional  { background: rgba(133,133,133,0.15); color: #858585; }
      .tag-in        { background: rgba(97,175,254,0.15); color: #61affe; }
      .tag-auth      { background: rgba(252,161,48,0.15); color: #fca130; }
      .tag-async     { background: rgba(73,204,144,0.15); color: #49cc90; }
      .tag-operation { background: rgba(155,89,182,0.15); color: #bb86fc; }

      .tag-confidence-high   { background: rgba(73,204,144,0.15);  color: #49cc90; }
      .tag-confidence-medium { background: rgba(252,161,48,0.15);  color: #fca130; }
      .tag-confidence-low    { background: rgba(249,62,62,0.15);   color: #f93e3e; }

      /* ── Status codes ───────────────────────────────── */
      .status-code {
        display: inline-block;
        padding: 1px 8px;
        border-radius: 3px;
        font-weight: 700;
        font-size: 12px;
        font-family: var(--vscode-editor-font-family, monospace);
      }

      .status-ok       { background: rgba(73,204,144,0.15);  color: #49cc90; }
      .status-redirect { background: rgba(97,175,254,0.15);  color: #61affe; }
      .status-error    { background: rgba(249,62,62,0.15);   color: #f93e3e; }

      /* ── Code blocks ────────────────────────────────── */
      code {
        font-family: var(--vscode-editor-font-family, 'Cascadia Code', 'Fira Code', monospace);
        font-size: 12px;
        background: var(--code-bg);
        padding: 1px 5px;
        border-radius: 3px;
      }

      pre {
        background: var(--code-bg);
        border: 1px solid var(--border);
        border-radius: 6px;
        padding: 14px 16px;
        overflow-x: auto;
        margin-top: 6px;
      }

      pre code {
        background: none;
        padding: 0;
        white-space: pre;
      }

      .curl-block {
        background: var(--code-bg);
      }

      /* ── Test cards ─────────────────────────────────── */
      .test-card {
        background: var(--card-bg);
        border: 1px solid var(--border);
        border-radius: 6px;
        padding: 14px 18px;
        margin-top: 12px;
      }

      .test-card h3 {
        margin-top: 0;
      }

      /* ── Lists ──────────────────────────────────────── */
      ul {
        padding-left: 20px;
        margin-top: 6px;
      }

      li {
        margin-bottom: 6px;
      }

      .side-effects-list li {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }
    `;
  }
}
