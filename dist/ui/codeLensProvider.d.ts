/**
 * CodeLens — Inline CodeLens Provider
 *
 * Provides VS Code CodeLens annotations above route handler definitions.
 * For every endpoint in the scan results whose source file matches the
 * currently viewed document, two clickable lenses appear:
 *
 *   📖 View Docs   — opens the DocPreviewPanel for this endpoint
 *   🧪 Generate Tests — triggers test generation for this endpoint
 *
 * @module ui/codeLensProvider
 */
import * as vscode from 'vscode';
import { EndpointRecord } from '../shared/types';
/**
 * VS Code CodeLensProvider that decorates route handler source lines with
 * contextual actions.
 *
 * Register during extension activation:
 * ```ts
 * const provider = new EndpointCodeLensProvider(workspaceRoot);
 * vscode.languages.registerCodeLensProvider(
 *   { scheme: 'file' },
 *   provider,
 * );
 * ```
 */
export declare class EndpointCodeLensProvider implements vscode.CodeLensProvider {
    private _onDidChangeCodeLenses;
    /** Fires when the set of endpoints has changed and lenses should refresh. */
    readonly onDidChangeCodeLenses: vscode.Event<void>;
    /**
     * Endpoints indexed by **normalised file URI string** for O(1) lookup
     * when VS Code calls `provideCodeLenses` for a document.
     */
    private endpointsByFile;
    /** Absolute workspace root — used to resolve relative source paths. */
    private workspaceRoot;
    /**
     * @param workspaceRoot Absolute path to the workspace root folder.
     */
    constructor(workspaceRoot: string);
    /**
     * Replace the internal endpoint index with fresh scan results.
     * Triggers a refresh of every open editor's code lenses.
     *
     * @param endpoints The full list of discovered endpoint records.
     */
    updateEndpoints(endpoints: EndpointRecord[]): void;
    /**
     * Return CodeLens instances for the given document.
     *
     * For each endpoint whose `sourceFile` matches the document URI we create
     * two unresolved lenses at the handler's start line:
     *  1. **View Docs**
     *  2. **Generate Tests**
     *
     * The lenses are returned unresolved (no command) so that VS Code can
     * call {@link resolveCodeLens} lazily.
     */
    provideCodeLenses(document: vscode.TextDocument, _token: vscode.CancellationToken): vscode.CodeLens[];
    /**
     * Resolve a previously unresolved CodeLens.
     *
     * In practice our lenses are created with commands already attached in
     * {@link provideCodeLenses}, so this method simply returns the lens as-is.
     * It exists to satisfy the interface and for future extensibility.
     */
    resolveCodeLens(codeLens: vscode.CodeLens, _token: vscode.CancellationToken): vscode.CodeLens;
    /**
     * Dispose of internal resources.
     */
    dispose(): void;
}
/**
 * Extended CodeLens that carries the associated endpoint record and action
 * kind, so that resolution logic (or command handlers) can inspect the
 * endpoint without a separate lookup.
 */
export declare class EndpointCodeLens extends vscode.CodeLens {
    /** The endpoint record this lens is attached to. */
    readonly endpoint: EndpointRecord;
    /** Which action this lens represents. */
    readonly actionKind: 'viewDocs' | 'generateTests';
    /**
     * @param range      Source range (handler line)
     * @param endpoint   The endpoint record
     * @param actionKind Which action this lens triggers
     */
    constructor(range: vscode.Range, endpoint: EndpointRecord, actionKind: 'viewDocs' | 'generateTests');
}
//# sourceMappingURL=codeLensProvider.d.ts.map