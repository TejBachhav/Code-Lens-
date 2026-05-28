/**
 * CodeLens — Endpoint Tree View Provider
 *
 * Renders a hierarchical VS Code TreeView for discovered API endpoints:
 *   Level 0: Framework groups (e.g., "FastAPI (12 endpoints)")
 *   Level 1: Individual endpoints ("GET /users/{id}")
 *   Level 2: Endpoint details (params, response schemas, auth, side effects)
 *
 * Tree items at Level 1 carry a command that opens the handler's source file
 * at the exact line where the route is declared.
 *
 * @module ui/treeView
 */

import * as vscode from 'vscode';
import * as path from 'path';
import {
  EndpointRecord,
  HttpMethod,
  PipelineResult,
  SupportedFramework,
  ParamRecord,
  ResponseSchemaRecord,
  AuthRecord,
  SideEffectRecord,
} from '../shared/types';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Method → ThemeColor id for tree item icons */
const METHOD_ICON_MAP: Record<HttpMethod, { color: vscode.ThemeColor; icon: string }> = {
  GET:     { color: new vscode.ThemeColor('charts.green'),  icon: 'symbol-method' },
  POST:    { color: new vscode.ThemeColor('charts.yellow'), icon: 'symbol-method' },
  PUT:     { color: new vscode.ThemeColor('charts.blue'),   icon: 'symbol-method' },
  DELETE:  { color: new vscode.ThemeColor('charts.red'),    icon: 'symbol-method' },
  PATCH:   { color: new vscode.ThemeColor('charts.orange'), icon: 'symbol-method' },
  OPTIONS: { color: new vscode.ThemeColor('charts.purple'), icon: 'symbol-method' },
  HEAD:    { color: new vscode.ThemeColor('charts.purple'), icon: 'symbol-method' },
};

/** Human-readable framework names */
const FRAMEWORK_LABELS: Record<SupportedFramework, string> = {
  fastapi:     'FastAPI',
  flask:       'Flask',
  express:     'Express',
  nestjs:      'NestJS',
  'spring-xml': 'Spring XML',
  servlet:     'Servlet',
  wsdl:        'WSDL',
  generic:     'Generic',
};

// ─── Detail-level item types ─────────────────────────────────────────────────

/** The kind of detail displayed at tree Level 2 */
type DetailKind = 'param' | 'response' | 'auth' | 'sideEffect' | 'info';

// ─── EndpointTreeItem ────────────────────────────────────────────────────────

/**
 * Represents a single node in the endpoint tree.
 *
 * There are three levels:
 *  - **framework** — collapsible group header
 *  - **endpoint**  — individual route, clickable → opens source
 *  - **detail**    — leaf node showing a single attribute of the endpoint
 */
export class EndpointTreeItem extends vscode.TreeItem {
  /** The level within the tree hierarchy (0, 1, or 2). */
  public readonly level: number;

  /** Framework key — only present on level-0 and level-1 items. */
  public readonly framework?: SupportedFramework;

  /** The underlying endpoint record — only present on level-1 and level-2 items. */
  public readonly endpoint?: EndpointRecord;

  /** Detail kind — only present on level-2 items. */
  public readonly detailKind?: DetailKind;

  /**
   * @param label      - Display label for the tree node
   * @param level      - Hierarchy depth (0 = framework, 1 = endpoint, 2 = detail)
   * @param collapsibleState - Whether the item is expandable
   * @param options    - Optional metadata attached to the node
   */
  constructor(
    label: string,
    level: number,
    collapsibleState: vscode.TreeItemCollapsibleState,
    options?: {
      framework?: SupportedFramework;
      endpoint?: EndpointRecord;
      detailKind?: DetailKind;
    },
  ) {
    super(label, collapsibleState);
    this.level = level;
    this.framework = options?.framework;
    this.endpoint = options?.endpoint;
    this.detailKind = options?.detailKind;
  }
}

// ─── EndpointTreeProvider ────────────────────────────────────────────────────

/**
 * VS Code TreeDataProvider that displays discovered API endpoints grouped by
 * framework. Call {@link refresh} with new pipeline results to update the view.
 *
 * Register in the extension activation with:
 * ```ts
 * const provider = new EndpointTreeProvider(workspaceRoot);
 * vscode.window.registerTreeDataProvider('codelensEndpoints', provider);
 * ```
 */
export class EndpointTreeProvider implements vscode.TreeDataProvider<EndpointTreeItem> {
  // ── Event emitter for tree-data changes ──────────────────────────────
  private _onDidChangeTreeData = new vscode.EventEmitter<EndpointTreeItem | undefined | null | void>();
  /** Fires when the tree data should be refreshed. */
  public readonly onDidChangeTreeData: vscode.Event<EndpointTreeItem | undefined | null | void> =
    this._onDidChangeTreeData.event;

  /** Endpoints grouped by framework key */
  private frameworkGroups: Map<SupportedFramework, EndpointRecord[]> = new Map();

  /** Absolute workspace root (used to resolve relative source-file paths). */
  private workspaceRoot: string;

  /**
   * @param workspaceRoot Absolute path to the VS Code workspace root folder.
   */
  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  // ── TreeDataProvider implementation ──────────────────────────────────

  /**
   * Return the VS Code tree item representation for a given element.
   */
  getTreeItem(element: EndpointTreeItem): vscode.TreeItem {
    return element;
  }

  /**
   * Return children for the given element, or top-level items when
   * `element` is `undefined`.
   *
   * - **No element** → framework group nodes (Level 0)
   * - **Level 0** → endpoint nodes for that framework (Level 1)
   * - **Level 1** → detail nodes for that endpoint (Level 2)
   * - **Level 2** → no children (leaf)
   */
  getChildren(element?: EndpointTreeItem): EndpointTreeItem[] {
    if (!element) {
      return this.buildFrameworkNodes();
    }

    if (element.level === 0 && element.framework) {
      return this.buildEndpointNodes(element.framework);
    }

    if (element.level === 1 && element.endpoint) {
      return this.buildDetailNodes(element.endpoint);
    }

    return [];
  }

  // ── Public API ───────────────────────────────────────────────────────

  /**
   * Replace the tree contents with the results of a new pipeline run.
   *
   * @param result The completed pipeline result containing all endpoints.
   */
  refresh(result: PipelineResult): void {
    this.frameworkGroups.clear();

    for (const ep of result.endpoints) {
      const group = this.frameworkGroups.get(ep.framework) ?? [];
      group.push(ep);
      this.frameworkGroups.set(ep.framework, group);
    }

    this._onDidChangeTreeData.fire();
  }

  /**
   * Clear the tree completely.
   */
  clear(): void {
    this.frameworkGroups.clear();
    this._onDidChangeTreeData.fire();
  }

  /**
   * Dispose of internal resources.
   */
  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }

  // ── Level 0 — Framework group nodes ──────────────────────────────────

  /**
   * Build the top-level nodes, one per detected framework.
   */
  private buildFrameworkNodes(): EndpointTreeItem[] {
    const nodes: EndpointTreeItem[] = [];

    for (const [framework, endpoints] of this.frameworkGroups) {
      const displayName = FRAMEWORK_LABELS[framework] ?? framework;
      const label = `${displayName} (${endpoints.length} endpoint${endpoints.length !== 1 ? 's' : ''})`;

      const item = new EndpointTreeItem(
        label,
        0,
        vscode.TreeItemCollapsibleState.Expanded,
        { framework },
      );
      item.iconPath = new vscode.ThemeIcon('symbol-interface');
      item.contextValue = 'frameworkGroup';
      nodes.push(item);
    }

    // Sort alphabetically by framework label
    nodes.sort((a, b) => (a.label as string).localeCompare(b.label as string));
    return nodes;
  }

  // ── Level 1 — Endpoint nodes ─────────────────────────────────────────

  /**
   * Build endpoint nodes for a given framework.
   */
  private buildEndpointNodes(framework: SupportedFramework): EndpointTreeItem[] {
    const endpoints = this.frameworkGroups.get(framework) ?? [];

    return endpoints.map((ep) => {
      const label = `${ep.method} ${ep.path}`;
      const item = new EndpointTreeItem(
        label,
        1,
        vscode.TreeItemCollapsibleState.Collapsed,
        { framework, endpoint: ep },
      );

      // Icon & color based on HTTP method
      const iconInfo = METHOD_ICON_MAP[ep.method] ?? METHOD_ICON_MAP.GET;
      item.iconPath = new vscode.ThemeIcon(iconInfo.icon, iconInfo.color);

      // Tooltip with handler info
      item.tooltip = this.buildEndpointTooltip(ep);
      item.description = ep.handler.name;
      item.contextValue = 'endpoint';

      // Command — open source file at handler line
      const fileUri = vscode.Uri.file(path.resolve(this.workspaceRoot, ep.sourceFile));
      item.command = {
        command: 'vscode.open',
        title: 'Go to Handler',
        arguments: [
          fileUri,
          {
            selection: new vscode.Range(
              new vscode.Position(ep.sourceLines[0] - 1, 0),
              new vscode.Position(ep.sourceLines[0] - 1, 0),
            ),
          } as vscode.TextDocumentShowOptions,
        ],
      };

      return item;
    });
  }

  // ── Level 2 — Detail nodes ───────────────────────────────────────────

  /**
   * Build detail nodes for an individual endpoint (params, responses, auth,
   * side effects).
   */
  private buildDetailNodes(ep: EndpointRecord): EndpointTreeItem[] {
    const nodes: EndpointTreeItem[] = [];

    // Parameters
    if (ep.params.length > 0) {
      for (const param of ep.params) {
        nodes.push(this.paramDetailItem(param, ep));
      }
    }

    // Response schemas
    if (ep.responseSchemas && ep.responseSchemas.length > 0) {
      for (const rs of ep.responseSchemas) {
        nodes.push(this.responseDetailItem(rs, ep));
      }
    }

    // Auth
    if (ep.auth) {
      nodes.push(this.authDetailItem(ep.auth, ep));
    }

    // Side effects
    if (ep.sideEffects && ep.sideEffects.length > 0) {
      for (const se of ep.sideEffects) {
        nodes.push(this.sideEffectDetailItem(se, ep));
      }
    }

    // Summary (Tier 3)
    if (ep.summary) {
      const item = new EndpointTreeItem(
        `📝 ${ep.summary}`,
        2,
        vscode.TreeItemCollapsibleState.None,
        { endpoint: ep, detailKind: 'info' },
      );
      item.iconPath = new vscode.ThemeIcon('note');
      item.contextValue = 'detail';
      nodes.push(item);
    }

    return nodes;
  }

  /**
   * Create a detail node for a single parameter.
   */
  private paramDetailItem(param: ParamRecord, ep: EndpointRecord): EndpointTreeItem {
    const required = param.required ? '' : '?';
    const label = `${param.in}: ${param.name}${required} (${param.type})`;
    const item = new EndpointTreeItem(
      label,
      2,
      vscode.TreeItemCollapsibleState.None,
      { endpoint: ep, detailKind: 'param' },
    );
    item.iconPath = new vscode.ThemeIcon('symbol-parameter');
    item.tooltip = param.description ?? `${param.in} parameter "${param.name}" of type ${param.type}`;
    item.contextValue = 'detail';
    return item;
  }

  /**
   * Create a detail node for a single response schema.
   */
  private responseDetailItem(rs: ResponseSchemaRecord, ep: EndpointRecord): EndpointTreeItem {
    const schemaType =
      rs.schema === '__UNRESOLVED__' ? '__UNRESOLVED__' : (rs.schema.type ?? 'object');
    const label = `${rs.statusCode} ${rs.contentType} → ${schemaType}`;
    const item = new EndpointTreeItem(
      label,
      2,
      vscode.TreeItemCollapsibleState.None,
      { endpoint: ep, detailKind: 'response' },
    );
    item.iconPath = new vscode.ThemeIcon('symbol-enum');
    item.tooltip = rs.description ?? `Response ${rs.statusCode} (${rs.contentType})`;
    item.contextValue = 'detail';
    return item;
  }

  /**
   * Create a detail node for authentication info.
   */
  private authDetailItem(auth: AuthRecord, ep: EndpointRecord): EndpointTreeItem {
    const scheme = auth.scheme ?? auth.guardName ?? auth.dependencyName ?? auth.decoratorName ?? '';
    const label = `🔒 Auth: ${auth.type}${scheme ? ` (${scheme})` : ''}`;
    const item = new EndpointTreeItem(
      label,
      2,
      vscode.TreeItemCollapsibleState.None,
      { endpoint: ep, detailKind: 'auth' },
    );
    item.iconPath = new vscode.ThemeIcon('lock');
    item.contextValue = 'detail';
    return item;
  }

  /**
   * Create a detail node for a single side effect.
   */
  private sideEffectDetailItem(se: SideEffectRecord, ep: EndpointRecord): EndpointTreeItem {
    const target = se.target ? ` → ${se.target}` : '';
    const label = `⚡ ${se.type} ${se.operation}${target} [${se.confidence}]`;
    const item = new EndpointTreeItem(
      label,
      2,
      vscode.TreeItemCollapsibleState.None,
      { endpoint: ep, detailKind: 'sideEffect' },
    );
    item.iconPath = new vscode.ThemeIcon('zap');
    item.contextValue = 'detail';
    return item;
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  /**
   * Build a rich Markdown tooltip for an endpoint tree item.
   */
  private buildEndpointTooltip(ep: EndpointRecord): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.isTrusted = true;

    md.appendMarkdown(`### ${ep.method} \`${ep.path}\`\n\n`);
    md.appendMarkdown(`**Handler:** \`${ep.handler.className ? ep.handler.className + '.' : ''}${ep.handler.name}\`\n\n`);
    md.appendMarkdown(`**File:** \`${ep.sourceFile}:${ep.sourceLines[0]}\`\n\n`);
    md.appendMarkdown(`**Framework:** ${FRAMEWORK_LABELS[ep.framework] ?? ep.framework}\n\n`);

    if (ep.summary) {
      md.appendMarkdown(`---\n\n${ep.summary}\n\n`);
    }

    if (ep.params.length > 0) {
      md.appendMarkdown(`**Parameters:** ${ep.params.map((p) => `\`${p.name}\``).join(', ')}\n\n`);
    }

    if (ep.auth) {
      md.appendMarkdown(`**Auth:** ${ep.auth.type}\n\n`);
    }

    return md;
  }
}
