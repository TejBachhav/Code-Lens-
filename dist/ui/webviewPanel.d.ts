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
import { EndpointRecord } from '../shared/types';
/**
 * Manages a singleton webview panel that displays endpoint documentation.
 *
 * ```ts
 * // Open or update the preview
 * DocPreviewPanel.createOrShow(context.extensionUri, endpointRecord);
 * ```
 */
export declare class DocPreviewPanel {
    /** The singleton instance (if the panel is currently open). */
    private static currentPanel;
    /** The underlying VS Code webview panel. */
    private readonly panel;
    /** Extension URI (used for local resource paths if needed in future). */
    private readonly extensionUri;
    /** The endpoint currently being displayed. */
    private endpoint;
    /** Disposables owned by this panel. */
    private disposables;
    /**
     * Create or reveal the documentation preview panel for the given endpoint.
     *
     * If a panel already exists it is revealed and updated; otherwise a new
     * panel is created in the column beside the active editor.
     *
     * @param extensionUri URI of the extension installation directory.
     * @param endpoint     The endpoint record to preview.
     */
    static createOrShow(extensionUri: vscode.Uri, endpoint: EndpointRecord): void;
    /**
     * Revive a previously serialised webview panel (called by VS Code when
     * the user re-opens the workbench and the panel was open before).
     *
     * @param panel        The webview panel to revive.
     * @param extensionUri URI of the extension installation directory.
     */
    static revive(panel: vscode.WebviewPanel, extensionUri: vscode.Uri): void;
    private constructor();
    /**
     * Update the webview with a new endpoint's documentation.
     *
     * @param endpoint The endpoint record to render.
     */
    update(endpoint: EndpointRecord): void;
    /**
     * Dispose of the panel and all owned resources.
     */
    dispose(): void;
    /**
     * Build the full HTML document for the webview.
     */
    private buildHtml;
    /**
     * Render the hero header with method badge and path.
     */
    private renderHeader;
    /**
     * Render summary and description (Tier 3).
     */
    private renderSummary;
    /**
     * Render handler metadata (file, line, framework).
     */
    private renderHandlerInfo;
    /**
     * Render the parameters table.
     */
    private renderParams;
    /**
     * Render a single parameter table row.
     */
    private renderParamRow;
    /**
     * Render the request body schema.
     */
    private renderRequestBody;
    /**
     * Render response schemas table.
     */
    private renderResponses;
    /**
     * Render a single response schema row.
     */
    private renderResponseRow;
    /**
     * Render authentication requirements.
     */
    private renderAuth;
    /**
     * Render side effects list.
     */
    private renderSideEffects;
    /**
     * Render a single side effect item.
     */
    private renderSideEffectItem;
    /**
     * Render a curl example block (Tier 3).
     */
    private renderCurlExample;
    /**
     * Render generated test cases (Tier 3).
     */
    private renderTestCases;
    /**
     * Render a single test case card.
     */
    private renderTestCaseCard;
    /**
     * Highlight `{param}` segments in the path with accent colour.
     */
    private highlightPathParams;
    /**
     * Produce a compact one-line summary of a JSON Schema.
     */
    private compactSchema;
    /**
     * Escape a string for safe inclusion in HTML.
     */
    private escapeHtml;
    /**
     * Return the full CSS stylesheet inlined into the webview HTML.
     * Uses VS Code CSS custom properties so the panel respects the user's
     * current colour theme.
     */
    private getStyles;
}
//# sourceMappingURL=webviewPanel.d.ts.map