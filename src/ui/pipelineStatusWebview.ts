/**
 * CodeLens — Pipeline Status Sidebar Webview View Provider
 *
 * Renders an interactive glassmorphic dashboard in the VS Code sidebar
 * (codelens.pipelineStatus view) displaying scanning progress or results stats.
 *
 * @module ui/pipelineStatusWebview
 */

import * as vscode from 'vscode';
import { PipelineEvent, PipelineResult, PipelinePhase } from '../shared/types';
import { scanEventEmitter, getLatestResult, isScanRunning } from '../commands/scanWorkspace';

/**
 * WebviewViewProvider for the 'codelens.pipelineStatus' panel in the sidebar.
 */
export class PipelineStatusWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'codelens.pipelineStatus';

  private _view?: vscode.WebviewView;
  private _status: 'idle' | 'scanning' | 'complete' | 'error' = 'idle';
  private _errorMessage?: string;
  private _errorDetails?: string;
  private _phase: PipelinePhase = 'discovery';
  private _progressMessage: string = 'Starting...';
  private _progressPercent: number = 0;
  private _lastResult?: PipelineResult;

  constructor(private readonly _extensionUri: vscode.Uri) {
    // Subscribe to scan events to dynamically push updates to the webview
    scanEventEmitter.event((event) => {
      switch (event.type) {
        case 'progress':
          this._status = 'scanning';
          this._phase = event.phase;
          this._progressMessage = event.message;
          this._progressPercent = event.percent;
          this._errorMessage = undefined;
          this._errorDetails = undefined;
          break;
        case 'complete':
          this._status = 'complete';
          this._lastResult = event.data;
          break;
        case 'error':
          this._status = 'error';
          this._errorMessage = event.message;
          this._errorDetails = event.details;
          break;
      }
      this.updateWebview();
    });
  }

  /**
   * Resolve/initialise the webview view in the sidebar.
   */
  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this._view = webviewView;

    // Set options for the webview
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    // Render the initial HTML
    webviewView.webview.html = this.getHtml(webviewView.webview);

    // Listen to messages from the webview
    webviewView.webview.onDidReceiveMessage((message) => {
      switch (message.command) {
        case 'ready':
          this.updateWebview();
          break;
        case 'scan':
          vscode.commands.executeCommand('codelens.scanWorkspace');
          break;
        case 'docs':
          vscode.commands.executeCommand('codelens.generateDocs');
          break;
        case 'tests':
          vscode.commands.executeCommand('codelens.generateTests');
          break;
        case 'preview':
          vscode.commands.executeCommand('codelens.previewDoc');
          break;
      }
    });

    webviewView.onDidDispose(() => {
      this._view = undefined;
    });
  }

  /**
   * Push the current state (idle, scanning, complete) to the webview.
   */
  public updateWebview(): void {
    if (!this._view) {
      return;
    }

    const state = this.getCurrentState();
    this._view.webview.postMessage({
      type: 'updateState',
      state,
    });
  }

  /**
   * Determine the current state of the pipeline and format data for the webview.
   */
  private getCurrentState() {
    const running = isScanRunning();
    const latestResult = getLatestResult();

    if (running) {
      this._status = 'scanning';
    } else if (this._status === 'scanning') {
      if (latestResult) {
        this._status = 'complete';
        this._lastResult = latestResult;
      } else {
        this._status = 'idle';
      }
    } else if (this._status === 'idle' && latestResult) {
      this._status = 'complete';
      this._lastResult = latestResult;
    }

    if (this._status === 'scanning') {
      return {
        status: 'scanning',
        phase: this._phase,
        message: this._progressMessage,
        percent: this._progressPercent,
        latestResult: this._lastResult ? this.formatResult(this._lastResult) : null,
      };
    }

    if (this._status === 'complete' && (this._lastResult || latestResult)) {
      const result = this._lastResult || latestResult;
      return {
        status: 'complete',
        latestResult: this.formatResult(result!),
      };
    }

    if (this._status === 'error') {
      return {
        status: 'error',
        errorMessage: this._errorMessage || 'An error occurred during scan.',
        errorDetails: this._errorDetails,
      };
    }

    return {
      status: 'idle',
      config: this.getSummaryConfig(),
    };
  }

  /**
   * Format pipeline result fields for consumption in webview HTML rendering.
   */
  private formatResult(result: PipelineResult) {
    return {
      endpointsCount: result.endpoints.length,
      stats: {
        totalFiles: result.stats.totalFiles,
        totalDurationMs: result.stats.totalDurationMs,
        unresolvedCount: result.stats.unresolvedCount,
      },
      detectedFrameworks: result.detectedFrameworks,
    };
  }

  /**
   * Load a subset of configuration values for the idle view summary.
   */
  private getSummaryConfig() {
    const config = vscode.workspace.getConfiguration('codelens');
    return {
      tier3Enabled: config.get<boolean>('tier3.enabled', true),
      model: config.get<string>('ollama.model', 'qwen2.5-coder:7b'),
      outputDir: config.get<string>('output.directory', '.codelens'),
    };
  }

  /**
   * Generate self-contained HTML for the sidebar webview panel.
   */
  private getHtml(webview: vscode.Webview): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
  <title>CodeLens Pipeline</title>
  <style>
    ${this.getStyles()}
  </style>
</head>
<body>
  <div class="dashboard">
    <!-- Header -->
    <div class="header-card">
      <span class="header-icon">⚡</span>
      <span class="header-title">CodeLens Pipeline</span>
    </div>

    <!-- Dynamic Content Container -->
    <div id="content">
      <div style="text-align:center; padding:20px; color:rgba(255,255,255,0.4);">
        Loading status...
      </div>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    // Signal readiness to get initial state
    vscode.postMessage({ command: 'ready' });

    // Handle updates from the extension host
    window.addEventListener('message', event => {
      const message = event.data;
      if (message.type === 'updateState') {
        renderState(message.state);
      }
    });

    function renderState(state) {
      const container = document.getElementById('content');
      if (state.status === 'idle') {
        container.innerHTML = renderIdle(state);
      } else if (state.status === 'scanning') {
        container.innerHTML = renderScanning(state);
      } else if (state.status === 'complete') {
        container.innerHTML = renderComplete(state);
      } else if (state.status === 'error') {
        container.innerHTML = renderError(state);
      }
    }

    function renderError(state) {
      return \`
        <div style="display:flex; flex-direction:column; gap:16px;">
          <div class="card" style="border-color: var(--error); background: rgba(249, 62, 62, 0.05);">
            <div style="display:flex; align-items:flex-start; gap:10px;">
              <span style="font-size:16px; color:var(--error)">❌</span>
              <div>
                <div style="font-size: 13px; font-weight: 600; color:#fff;">Scan Failed</div>
                <div style="font-size: 11px; margin-top: 4px; color:rgba(255,255,255,0.75); line-height: 1.4;">
                  \${state.errorMessage}
                </div>
                \${state.errorDetails ? \`<div style="font-size: 10px; margin-top: 8px; color:rgba(255,255,255,0.45); font-family:var(--font-mono); white-space:pre-wrap; word-break:break-all;">\${state.errorDetails}</div>\` : ''}
              </div>
            </div>
          </div>
          
          <button class="btn" onclick="vscode.postMessage({ command: 'scan' })">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M14 8c0 3.31-2.69 6-6 6S2 11.31 2 8s2.69-6 6-6c1.66 0 3.14.67 4.22 1.78L10 6h5V1L13.12 2.88C11.8 1.7 10 1 8 1 4.14 1 1 4.14 1 8s3.14 7 7 7 7-3.14 7-7h-1z"/></svg>
            Retry Scan
          </button>
        </div>
      \`;
    }

    function renderIdle(state) {
      const tier3Text = state.config.tier3Enabled ? 'Enabled (' + state.config.model + ')' : 'Disabled';
      return \`
        <div style="display:flex; flex-direction:column; gap:16px;">
          <div class="card" style="text-align:center; padding: 24px 16px;">
            <div style="font-size: 32px; margin-bottom: 12px; filter: drop-shadow(0 4px 6px rgba(0,0,0,0.2));">🔍</div>
            <div style="font-size: 14px; font-weight: 600; margin-bottom: 6px; color:#fff;">Ready to Scan</div>
            <div style="font-size: 11px; color:rgba(255,255,255,0.4); margin-bottom: 18px; line-height: 1.5;">
              Scan your workspace to discover API endpoints, analyze data flows, and enrich with local LLMs.
            </div>
            <button class="btn" onclick="vscode.postMessage({ command: 'scan' })">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M15.7 14.3l-4.2-4.2c.8-1 1.3-2.2 1.3-3.6 0-3.3-2.7-6-6-6S.8 3.2.8 6.5s2.7 6 6 6c1.4 0 2.6-.5 3.6-1.3l4.2 4.2c.2.2.5.3.7.3.2 0 .5-.1.7-.3.4-.4.4-1 0-1.4zM6.8 11.2c-2.6 0-4.7-2.1-4.7-4.7S4.2 1.8 6.8 1.8s4.7 2.1 4.7 4.7-2.1 4.7-4.7 4.7z"/></svg>
              Scan Workspace
            </button>
          </div>

          <div class="card">
            <div class="card-title">Settings Summary</div>
            <div class="config-list">
              <div class="config-item">
                <span>Tier 3 LLM</span>
                <span class="config-val">\${tier3Text}</span>
              </div>
              <div class="config-item">
                <span>Output Dir</span>
                <span class="config-val">\${state.config.outputDir}</span>
              </div>
            </div>
          </div>
        </div>
      \`;
    }

    function renderScanning(state) {
      const activePhase = state.phase;
      const progressPercent = state.percent;
      const progressMessage = state.message;

      const phases = ['discovery', 'detection', 'tier1', 'tier2', 'tier3', 'output'];
      const phaseLabels = {
        discovery: 'Discovery',
        detection: 'Detection',
        tier1: 'AST Scan (Tier 1)',
        tier2: 'Flow Analysis (Tier 2)',
        tier3: 'LLM Enrichment (Tier 3)',
        output: 'Generating Output'
      };

      let phasesHtml = '';
      let activeFound = false;

      for (const phase of phases) {
        let statusClass = '';
        if (phase === activePhase) {
          statusClass = 'active';
          activeFound = true;
        } else if (!activeFound) {
          statusClass = 'done';
        }
        phasesHtml += \`
          <div class="phase-item \${statusClass}">
            <div class="phase-bullet"></div>
            <span>\${phaseLabels[phase]}</span>
          </div>
        \`;
      }

      return \`
        <div style="display:flex; flex-direction:column; gap:16px;">
          <div class="card" style="border-color: var(--accent);">
            <div class="card-title">
              <span>Scanning...</span>
              <span class="config-val" style="color:var(--accent);">\${progressPercent}%</span>
            </div>
            
            <div class="progress-wrapper">
              <div class="progress-bar-container">
                <div class="progress-bar" style="width: \${progressPercent}%"></div>
              </div>
              <div class="progress-info">
                <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:100%;">\${progressMessage}</span>
              </div>
            </div>
          </div>

          <div class="card">
            <div class="card-title">Pipeline Progress</div>
            <div class="phases-list">
              \${phasesHtml}
            </div>
          </div>
        </div>
      \`;
    }

    function renderComplete(state) {
      const res = state.latestResult;
      const durationSec = (res.stats.totalDurationMs / 1000).toFixed(1);
      
      let frameworksHtml = '';
      if (res.detectedFrameworks && res.detectedFrameworks.length > 0) {
        for (const f of res.detectedFrameworks) {
          const badgeClass = 'fw-' + f.framework;
          frameworksHtml += \`
            <span class="framework-badge \${badgeClass}">
              \${f.framework} (\${f.endpointCount})
            </span>
          \`;
        }
      } else {
        frameworksHtml = '<span style="font-size:11px; color:rgba(255,255,255,0.4)">None detected</span>';
      }

      return \`
        <div style="display:flex; flex-direction:column; gap:12px;">
          <div class="card" style="border-color: rgba(73, 204, 144, 0.3); background: rgba(73, 204, 144, 0.03);">
            <div style="display:flex; align-items:center; gap:10px;">
              <span style="font-size:18px; color:var(--success)">✔</span>
              <div>
                <div style="font-size: 13px; font-weight: 600; color:#fff;">Scan Complete</div>
                <div style="font-size: 11px; color:rgba(255,255,255,0.4);">Pipeline finished successfully in \${durationSec}s</div>
              </div>
            </div>
          </div>

          <div class="card">
            <div class="card-title">Metrics</div>
            <div class="metrics-grid">
              <div class="metric">
                <div class="metric-value">\${res.endpointsCount}</div>
                <div class="metric-label">Endpoints</div>
              </div>
              <div class="metric">
                <div class="metric-value">\${res.stats.totalFiles}</div>
                <div class="metric-label">Files</div>
              </div>
            </div>
          </div>

          <div class="card">
            <div class="card-title">Frameworks</div>
            <div class="frameworks-list">
              \${frameworksHtml}
            </div>
          </div>

          <div class="card">
            <div class="card-title">Resolution</div>
            <div style="display:flex; justify-content:space-between; font-size:11px; align-items:center;">
              <span style="color:rgba(255,255,255,0.6)">Unresolved Items</span>
              <span class="config-val" style="padding: 1px 6px; border-radius: 3px; background:\${res.stats.unresolvedCount > 0 ? 'rgba(252,161,48,0.15)' : 'rgba(73,204,144,0.15)'}; color:\${res.stats.unresolvedCount > 0 ? 'var(--warning)' : 'var(--success)'}">\${res.stats.unresolvedCount}</span>
            </div>
          </div>

          <div class="button-group" style="margin-top: 8px;">
            <button class="btn" onclick="vscode.postMessage({ command: 'scan' })">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M14 8c0 3.31-2.69 6-6 6S2 11.31 2 8s2.69-6 6-6c1.66 0 3.14.67 4.22 1.78L10 6h5V1L13.12 2.88C11.8 1.7 10 1 8 1 4.14 1 1 4.14 1 8s3.14 7 7 7 7-3.14 7-7h-1z"/></svg>
              Run Re-Scan
            </button>
            <button class="btn btn-secondary" onclick="vscode.postMessage({ command: 'docs' })">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M14.5 1H2.5C1.67 1 1 1.67 1 2.5v11c0 .83.67 1.5 1.5 1.5h12c.28 0 .5-.22.5-.5V1.5c0-.28-.22-.5-.5-.5zM14 14H3c-.55 0-1-.45-1-1v-.5c0-.55.45-1 1-1h11v2.5zm0-3.5H3c-1.1 0-2 .9-2 2V2.5C1 1.67 1.67 1 2.5 1h12v9.5z"/></svg>
              Generate Docs
            </button>
            <button class="btn btn-secondary" onclick="vscode.postMessage({ command: 'tests' })">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M13.6 13L9 5V1.7c.3-.1.5-.4.5-.7 0-.6-.4-1-1-1h-3c-.6 0-1 .4-1 1 0 .3.2.6.5.7V5L.4 13c-.3.5-.4 1-.1 1.5.3.5.8.8 1.4.8h11.6c.6 0 1.1-.3 1.4-.8.3-.5.2-1.1-.1-1.5zM6.5 2h3v3h-3V2zm-3.3 11l3.3-5.7V8h3v.7L12.8 13H3.2z"/></svg>
              Generate Tests
            </button>
            <button class="btn btn-secondary" onclick="vscode.postMessage({ command: 'preview' })">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1.5c-3.9 0-7.2 2.6-8 6.5.8 3.9 4.1 6.5 8 6.5s7.2-2.6 8-6.5c-.8-3.9-4.1-6.5-8-6.5zm0 10.5c-2.2 0-4-1.8-4-4s1.8-4 4-4 4 1.8 4 4-1.8 4-4 4zm0-6.5c-1.4 0-2.5 1.1-2.5 2.5S6.6 10.5 8 10.5s2.5-1.1 2.5-2.5S9.4 5.5 8 5.5z"/></svg>
              Preview Docs
            </button>
          </div>
        </div>
      \`;
    }
  </script>
</body>
</html>`;
  }

  /**
   * Stylings for WebviewView panel.
   */
  private getStyles(): string {
    return `
      :root {
        --bg: var(--vscode-sideBar-background, #1e1e24);
        --fg: var(--vscode-sideBar-foreground, #cccccc);
        --card-bg: var(--vscode-editorWidget-background, rgba(30, 30, 30, 0.45));
        --border: var(--vscode-sideBar-border, rgba(255, 255, 255, 0.08));
        --button-bg: var(--vscode-button-background, #007acc);
        --button-fg: var(--vscode-button-foreground, #ffffff);
        --button-hover: var(--vscode-button-hoverBackground, #0062a3);
        --accent: var(--vscode-activityBar-activeBorder, #007acc);
        --success: #49cc90;
        --warning: #fca130;
        --error: #f93e3e;
        --font-mono: var(--vscode-editor-font-family, Consolas, Monaco, monospace);
      }
      
      * { box-sizing: border-box; margin: 0; padding: 0; }
      
      body {
        font-family: var(--vscode-font-family, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
        font-size: var(--vscode-font-size, 12px);
        color: var(--fg);
        background: var(--bg);
        margin: 0;
        padding: 8px 12px;
        line-height: 1.4;
        user-select: none;
        overflow-y: auto;
      }
      
      .dashboard {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      
      .header-card {
        display: flex;
        align-items: center;
        gap: 8px;
        padding-bottom: 8px;
        border-bottom: 1px solid var(--border);
      }
      .header-icon {
        font-size: 16px;
      }
      .header-title {
        font-weight: 700;
        font-size: 11px;
        letter-spacing: 0.8px;
        text-transform: uppercase;
        color: var(--fg);
        opacity: 0.85;
      }
      
      .card {
        background: var(--card-bg);
        border: 1px solid var(--border);
        border-radius: 6px;
        padding: 12px;
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
        backdrop-filter: blur(8px);
        transition: border-color 0.2s;
      }
      .card:hover {
        border-color: rgba(255, 255, 255, 0.12);
      }
      
      .card-title {
        font-size: 11px;
        font-weight: 600;
        color: rgba(255, 255, 255, 0.7);
        margin-bottom: 8px;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      
      .metrics-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
      }
      
      .metric {
        background: rgba(255, 255, 255, 0.02);
        border: 1px solid rgba(255, 255, 255, 0.04);
        border-radius: 4px;
        padding: 8px;
        text-align: center;
      }
      .metric-value {
        font-size: 18px;
        font-weight: 700;
        color: #fff;
      }
      .metric-label {
        font-size: 9px;
        color: rgba(255, 255, 255, 0.4);
        text-transform: uppercase;
        margin-top: 2px;
        letter-spacing: 0.3px;
      }
      
      .progress-wrapper {
        margin-top: 6px;
      }
      .progress-bar-container {
        background: rgba(255, 255, 255, 0.05);
        border-radius: 3px;
        height: 6px;
        overflow: hidden;
        position: relative;
      }
      .progress-bar {
        background: linear-gradient(90deg, #007acc 0%, #00bfff 100%);
        height: 100%;
        width: 0%;
        border-radius: 3px;
        transition: width 0.25s ease-out;
      }
      .progress-info {
        display: flex;
        justify-content: space-between;
        font-size: 10px;
        margin-top: 4px;
        color: rgba(255, 255, 255, 0.45);
      }
      
      .phases-list {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .phase-item {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 11px;
        color: rgba(255, 255, 255, 0.35);
      }
      .phase-item.active {
        color: #fff;
        font-weight: 600;
      }
      .phase-item.done {
        color: var(--success);
      }
      .phase-bullet {
        width: 5px;
        height: 5px;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.15);
      }
      .phase-item.active .phase-bullet {
        background: var(--accent);
        box-shadow: 0 0 6px var(--accent);
        animation: pulse 1s infinite alternate;
      }
      .phase-item.done .phase-bullet {
        background: var(--success);
      }
      
      .btn {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        background: var(--button-bg);
        color: var(--button-fg);
        border: none;
        padding: 6px 12px;
        border-radius: 4px;
        cursor: pointer;
        font-weight: 600;
        transition: background 0.1s, transform 0.1s;
        width: 100%;
        text-align: center;
      }
      .btn:hover {
        background: var(--button-hover);
      }
      .btn:active {
        transform: scale(0.98);
      }
      .btn svg {
        flex-shrink: 0;
      }
      .btn-secondary {
        background: rgba(255, 255, 255, 0.05);
        color: #e2e2e2;
        border: 1px solid rgba(255, 255, 255, 0.08);
      }
      .btn-secondary:hover {
        background: rgba(255, 255, 255, 0.1);
        color: #fff;
      }
      .btn-danger {
        background: rgba(249, 62, 62, 0.12);
        color: #f93e3e;
        border: 1px solid rgba(249, 62, 62, 0.2);
      }
      .btn-danger:hover {
        background: rgba(249, 62, 62, 0.2);
      }
      
      .button-group {
        display: flex;
        flex-direction: column;
        gap: 6px;
        width: 100%;
      }
      
      .frameworks-list {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
      }
      .framework-badge {
        display: inline-flex;
        align-items: center;
        padding: 2px 6px;
        border-radius: 4px;
        font-size: 9px;
        font-weight: 600;
        text-transform: capitalize;
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.06);
      }
      .fw-fastapi { background: rgba(0, 150, 136, 0.12); color: #009688; border-color: rgba(0, 150, 136, 0.2); }
      .fw-flask { background: rgba(120, 120, 120, 0.12); color: #b0b0b0; border-color: rgba(120, 120, 120, 0.2); }
      .fw-express { background: rgba(76, 175, 80, 0.12); color: #4caf50; border-color: rgba(76, 175, 80, 0.2); }
      .fw-nestjs { background: rgba(229, 57, 53, 0.12); color: #e53935; border-color: rgba(229, 57, 53, 0.2); }
      .fw-spring-xml { background: rgba(139, 195, 74, 0.12); color: #8bc34a; border-color: rgba(139, 195, 74, 0.2); }
      .fw-wsdl { background: rgba(156, 39, 176, 0.12); color: #9c27b0; border-color: rgba(156, 39, 176, 0.2); }
      
      .config-list {
        display: flex;
        flex-direction: column;
        gap: 6px;
        font-size: 11px;
        color: rgba(255, 255, 255, 0.45);
      }
      .config-item {
        display: flex;
        justify-content: space-between;
      }
      .config-val {
        color: rgba(255, 255, 255, 0.75);
        font-family: var(--font-mono);
      }
      
      @keyframes pulse {
        0% { opacity: 0.5; }
        100% { opacity: 1; }
      }
    `;
  }
}
