/**
 * CodeLens — Pipeline Status Sidebar Webview View Provider
 *
 * Renders an interactive glassmorphic dashboard in the VS Code sidebar
 * (codelens.pipelineStatus view) displaying scanning progress or results stats.
 *
 * @module ui/pipelineStatusWebview
 */
import * as vscode from 'vscode';
/**
 * WebviewViewProvider for the 'codelens.pipelineStatus' panel in the sidebar.
 */
export declare class PipelineStatusWebviewProvider implements vscode.WebviewViewProvider {
    private readonly _extensionUri;
    static readonly viewType = "codelens.pipelineStatus";
    private _view?;
    private _status;
    private _errorMessage?;
    private _errorDetails?;
    private _phase;
    private _progressMessage;
    private _progressPercent;
    private _lastResult?;
    constructor(_extensionUri: vscode.Uri);
    /**
     * Resolve/initialise the webview view in the sidebar.
     */
    resolveWebviewView(webviewView: vscode.WebviewView, context: vscode.WebviewViewResolveContext, _token: vscode.CancellationToken): void;
    /**
     * Push the current state (idle, scanning, complete) to the webview.
     */
    updateWebview(): void;
    /**
     * Determine the current state of the pipeline and format data for the webview.
     */
    private getCurrentState;
    /**
     * Format pipeline result fields for consumption in webview HTML rendering.
     */
    private formatResult;
    /**
     * Load a subset of configuration values for the idle view summary.
     */
    private getSummaryConfig;
    /**
     * Generate self-contained HTML for the sidebar webview panel.
     */
    private getHtml;
    /**
     * Stylings for WebviewView panel.
     */
    private getStyles;
}
//# sourceMappingURL=pipelineStatusWebview.d.ts.map