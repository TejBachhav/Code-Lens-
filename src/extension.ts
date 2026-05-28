/**
 * CodeLens — VS Code Extension Entry Point
 *
 * Registers all commands, creates the endpoint TreeView provider, sets up the
 * status bar item, and creates the OutputChannel. The heavy pipeline work is
 * delegated to a child process via {@link executeScan}.
 *
 * @module extension
 */

import * as vscode from 'vscode';
import { executeScan, getLatestResult } from './commands/scanWorkspace';
import { executeGenerateDocs } from './commands/generateDocs';
import { executeGenerateTests } from './commands/generateTests';
import { PipelineResult, EndpointRecord } from './shared/types';
import { spawn, ChildProcess } from 'child_process';
import { OllamaClient } from './tier3/ollamaClient';
import { PipelineStatusWebviewProvider } from './ui/pipelineStatusWebview';

// ─── Tree Data Provider ───────────────────────────────────────────────────────

/**
 * Tree item representing an endpoint group (by path prefix) or a single
 * endpoint in the sidebar TreeView.
 */
class EndpointTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly endpoint?: EndpointRecord,
  ) {
    super(label, collapsibleState);

    if (endpoint) {
      this.description = endpoint.handler.className
        ? `${endpoint.handler.className}.${endpoint.handler.name}`
        : endpoint.handler.name;
      this.tooltip = `${endpoint.method} ${endpoint.path}\n${endpoint.sourceFile}:${endpoint.sourceLines[0]}`;
      this.iconPath = new vscode.ThemeIcon(getMethodIcon(endpoint.method));

      // Navigate to the source on click
      this.command = {
        command: 'vscode.open',
        title: 'Go to Endpoint',
        arguments: [
          vscode.Uri.file(endpoint.sourceFile),
          {
            selection: new vscode.Range(
              new vscode.Position(endpoint.sourceLines[0] - 1, 0),
              new vscode.Position(endpoint.sourceLines[1] - 1, 0),
            ),
          },
        ],
      };
    }
  }
}

/**
 * Map HTTP methods to VS Code ThemeIcon identifiers for visual distinction.
 */
function getMethodIcon(method: string): string {
  switch (method) {
    case 'GET':
      return 'arrow-down';
    case 'POST':
      return 'arrow-up';
    case 'PUT':
      return 'pencil';
    case 'PATCH':
      return 'edit';
    case 'DELETE':
      return 'trash';
    default:
      return 'circle-outline';
  }
}

/**
 * TreeDataProvider that displays discovered API endpoints grouped by their
 * first path segment (e.g. `/users`, `/orders`).
 */
class EndpointTreeProvider implements vscode.TreeDataProvider<EndpointTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<EndpointTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private endpoints: EndpointRecord[] = [];

  /**
   * Replace the displayed endpoints and refresh the tree.
   */
  setEndpoints(endpoints: EndpointRecord[]): void {
    this.endpoints = endpoints;
    this._onDidChangeTreeData.fire();
  }

  /**
   * Force a refresh of the tree view.
   */
  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: EndpointTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: EndpointTreeItem): EndpointTreeItem[] {
    if (!element) {
      // Root level — group by first path segment
      return this.getRootGroups();
    }

    // Children of a group — individual endpoints
    const groupPrefix = element.label as string;
    return this.endpoints
      .filter((ep) => this.getGroupKey(ep.path) === groupPrefix)
      .map(
        (ep) =>
          new EndpointTreeItem(
            `${ep.method} ${ep.path}`,
            vscode.TreeItemCollapsibleState.None,
            ep,
          ),
      );
  }

  /**
   * Build root-level group nodes from the first path segment.
   */
  private getRootGroups(): EndpointTreeItem[] {
    if (this.endpoints.length === 0) {
      return [
        new EndpointTreeItem(
          'No endpoints found — run a scan',
          vscode.TreeItemCollapsibleState.None,
        ),
      ];
    }

    const groups = new Map<string, number>();
    for (const ep of this.endpoints) {
      const key = this.getGroupKey(ep.path);
      groups.set(key, (groups.get(key) ?? 0) + 1);
    }

    return Array.from(groups.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(
        ([group, count]) =>
          new EndpointTreeItem(
            group,
            vscode.TreeItemCollapsibleState.Collapsed,
          ),
      );
  }

  /**
   * Extract the first meaningful path segment for grouping.
   */
  private getGroupKey(routePath: string): string {
    const segments = routePath.split('/').filter(Boolean);
    return segments.length > 0 ? `/${segments[0]}` : '/';
  }
}

// ─── Status Bar ───────────────────────────────────────────────────────────────

/**
 * Create and configure the CodeLens status bar item.
 */
function createStatusBarItem(): vscode.StatusBarItem {
  const item = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100,
  );
  item.text = '$(symbol-interface) CodeLens';
  item.tooltip = 'Click to scan workspace';
  item.command = 'codelens.scanWorkspace';
  item.show();
  return item;
}

/**
 * Update the status bar to reflect the current state.
 */
function updateStatusBar(
  item: vscode.StatusBarItem,
  result: PipelineResult | undefined,
): void {
  if (result) {
    item.text = `$(symbol-interface) CodeLens: ${result.endpoints.length} endpoint(s)`;
    item.tooltip = `Last scan: ${result.endpoints.length} endpoints, ${result.detectedFrameworks.length} framework(s)\nClick to re-scan`;
  } else {
    item.text = '$(symbol-interface) CodeLens';
    item.tooltip = 'Click to scan workspace';
  }
}

// ─── Extension Lifecycle ──────────────────────────────────────────────────────

let extensionOllamaProcess: ChildProcess | undefined;

/**
 * Start the Ollama server in the background if it is enabled and not already running.
 */
async function startOllamaServer(outputChannel: vscode.OutputChannel): Promise<void> {
  const config = vscode.workspace.getConfiguration('codelens');
  const enableTier3 = config.get<boolean>('tier3.enabled', true);

  if (!enableTier3) {
    outputChannel.appendLine('[CodeLens] Tier 3 enrichment is disabled in settings. Skipping Ollama auto-start.');
    return;
  }

  const url = config.get<string>('ollama.url', 'http://localhost:11434');
  const model = config.get<string>('ollama.model', 'qwen2.5-coder:7b');

  const client = new OllamaClient({
    url,
    model,
    temperature: 0.1,
    concurrency: 2,
  });

  outputChannel.appendLine('[CodeLens] Checking if Ollama server is already running...');
  try {
    const health = await client.healthCheck();
    if (health.available) {
      outputChannel.appendLine('[CodeLens] Ollama server is already running and accessible.');
      return;
    }
  } catch (err) {
    // Ignore error, we will try to start it
  }

  outputChannel.appendLine('[CodeLens] Ollama server is not running. Launching automatically in the background...');
  try {
    extensionOllamaProcess = spawn('ollama', ['serve'], { stdio: 'ignore' });
    
    // Wait for Ollama to boot up (check health every 1s, up to 6 times)
    for (let i = 0; i < 6; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      try {
        const health = await client.healthCheck();
        if (health.available) {
          outputChannel.appendLine('[CodeLens] Ollama server started successfully in the background.');
          return;
        }
      } catch (err) {
        // Keep retrying
      }
    }
    outputChannel.appendLine('[CodeLens] Warning: Ollama server started but did not respond to health checks in time.');
  } catch (err) {
    outputChannel.appendLine(`[CodeLens] Failed to launch Ollama server automatically: ${err}`);
  }
}

/**
 * Extension activation — called when VS Code loads the extension.
 *
 * Registers all commands, creates the TreeView and status bar, and sets up the
 * OutputChannel.
 *
 * @param context - VS Code extension context
 */
export function activate(context: vscode.ExtensionContext): void {
  // ── Output Channel ─────────────────────────────────────────────────
  const outputChannel = vscode.window.createOutputChannel('CodeLens');
  context.subscriptions.push(outputChannel);
  outputChannel.appendLine('[CodeLens] Extension activated');

  // ── Start Ollama Server ───────────────────────────────────────────
  startOllamaServer(outputChannel);

  // ── Tree View ──────────────────────────────────────────────────────
  const treeProvider = new EndpointTreeProvider();
  const treeView = vscode.window.createTreeView('codelens.endpointTree', {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });
  context.subscriptions.push(treeView);

  // ── Pipeline Status Webview View ───────────────────────────────────
  const statusWebviewProvider = new PipelineStatusWebviewProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      PipelineStatusWebviewProvider.viewType,
      statusWebviewProvider,
    ),
  );

  // ── Status Bar ─────────────────────────────────────────────────────
  const statusBar = createStatusBarItem();
  context.subscriptions.push(statusBar);

  // ── Commands ───────────────────────────────────────────────────────

  // 1. Scan Workspace
  const scanCmd = vscode.commands.registerCommand(
    'codelens.scanWorkspace',
    async () => {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        vscode.window.showErrorMessage('CodeLens: No workspace folder open.');
        return;
      }

      const result = await executeScan(
        workspaceFolder.uri.fsPath,
        context.extensionPath,
        outputChannel,
      );

      if (result) {
        treeProvider.setEndpoints(result.endpoints);
        updateStatusBar(statusBar, result);
        vscode.window.showInformationMessage(
          `CodeLens: Found ${result.endpoints.length} endpoint(s) across ${result.detectedFrameworks.length} framework(s).`,
        );
      }
    },
  );
  context.subscriptions.push(scanCmd);

  // 2. Generate Documentation
  const docsCmd = vscode.commands.registerCommand(
    'codelens.generateDocs',
    async () => {
      await executeGenerateDocs(outputChannel);
    },
  );
  context.subscriptions.push(docsCmd);

  // 3. Generate Tests
  const testsCmd = vscode.commands.registerCommand(
    'codelens.generateTests',
    async () => {
      await executeGenerateTests(outputChannel);
    },
  );
  context.subscriptions.push(testsCmd);

  // 4. Show Endpoints (focus the tree view)
  const showCmd = vscode.commands.registerCommand(
    'codelens.showEndpoints',
    () => {
      treeView.reveal(undefined as any, { focus: true, select: false });
    },
  );
  context.subscriptions.push(showCmd);

  // 5. Preview Documentation (open generated docs in markdown preview)
  const previewCmd = vscode.commands.registerCommand(
    'codelens.previewDoc',
    async () => {
      const result = getLatestResult();
      if (!result) {
        vscode.window.showWarningMessage('No scan results available. Run a scan first.');
        return;
      }

      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceRoot) {
        return;
      }

      const config = vscode.workspace.getConfiguration('codelens');
      const outputDir = config.get<string>('output.directory', '.codelens');
      const summaryPath = vscode.Uri.file(
        require('path').join(workspaceRoot, outputDir, 'docs', 'API_SUMMARY.md'),
      );

      try {
        await vscode.commands.executeCommand('markdown.showPreview', summaryPath);
      } catch {
        vscode.window.showWarningMessage(
          'Documentation not generated yet. Run "Generate Documentation" first.',
        );
      }
    },
  );
  context.subscriptions.push(previewCmd);

  // 6. Refresh Endpoints
  const refreshCmd = vscode.commands.registerCommand(
    'codelens.refreshEndpoints',
    () => {
      const result = getLatestResult();
      if (result) {
        treeProvider.setEndpoints(result.endpoints);
        updateStatusBar(statusBar, result);
      } else {
        treeProvider.refresh();
      }
      statusWebviewProvider.updateWebview();
    },
  );
  context.subscriptions.push(refreshCmd);

  // ── Initialise from previous scan if available ─────────────────────
  const existingResult = getLatestResult();
  if (existingResult) {
    treeProvider.setEndpoints(existingResult.endpoints);
    updateStatusBar(statusBar, existingResult);
  }

  outputChannel.appendLine('[CodeLens] All commands registered');
}

/**
 * Extension deactivation — called when VS Code unloads the extension.
 *
 * Performs any necessary cleanup (currently a no-op; disposables are managed
 * via the extension context).
 */
export function deactivate(): void {
  if (extensionOllamaProcess) {
    try {
      extensionOllamaProcess.kill();
    } catch (err) {
      // ignore
    }
  }
}
