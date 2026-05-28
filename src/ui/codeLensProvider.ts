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
import * as path from 'path';
import { EndpointRecord } from '../shared/types';

// ─── EndpointCodeLensProvider ────────────────────────────────────────────────

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
export class EndpointCodeLensProvider implements vscode.CodeLensProvider {
  // ── Change event ─────────────────────────────────────────────────────
  private _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  /** Fires when the set of endpoints has changed and lenses should refresh. */
  public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

  /**
   * Endpoints indexed by **normalised file URI string** for O(1) lookup
   * when VS Code calls `provideCodeLenses` for a document.
   */
  private endpointsByFile: Map<string, EndpointRecord[]> = new Map();

  /** Absolute workspace root — used to resolve relative source paths. */
  private workspaceRoot: string;

  /**
   * @param workspaceRoot Absolute path to the workspace root folder.
   */
  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  // ── Public API ───────────────────────────────────────────────────────

  /**
   * Replace the internal endpoint index with fresh scan results.
   * Triggers a refresh of every open editor's code lenses.
   *
   * @param endpoints The full list of discovered endpoint records.
   */
  updateEndpoints(endpoints: EndpointRecord[]): void {
    this.endpointsByFile.clear();

    for (const ep of endpoints) {
      const absolutePath = path.resolve(this.workspaceRoot, ep.sourceFile);
      const key = vscode.Uri.file(absolutePath).toString();

      const list = this.endpointsByFile.get(key) ?? [];
      list.push(ep);
      this.endpointsByFile.set(key, list);
    }

    this._onDidChangeCodeLenses.fire();
  }

  // ── CodeLensProvider implementation ──────────────────────────────────

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
  provideCodeLenses(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken,
  ): vscode.CodeLens[] {
    const key = document.uri.toString();
    const endpoints = this.endpointsByFile.get(key);

    if (!endpoints || endpoints.length === 0) {
      return [];
    }

    const lenses: vscode.CodeLens[] = [];

    for (const ep of endpoints) {
      // Lines in EndpointRecord are 1-based; VS Code positions are 0-based.
      const line = Math.max(0, ep.sourceLines[0] - 1);
      const range = new vscode.Range(
        new vscode.Position(line, 0),
        new vscode.Position(line, 0),
      );

      // Lens 1 — View Docs
      const viewDocsLens = new EndpointCodeLens(range, ep, 'viewDocs');
      viewDocsLens.command = {
        title: '📖 View Docs',
        command: 'codelens.viewEndpointDocs',
        tooltip: `Open documentation preview for ${ep.method} ${ep.path}`,
        arguments: [ep],
      };
      lenses.push(viewDocsLens);

      // Lens 2 — Generate Tests
      const genTestsLens = new EndpointCodeLens(range, ep, 'generateTests');
      genTestsLens.command = {
        title: '🧪 Generate Tests',
        command: 'codelens.generateEndpointTests',
        tooltip: `Generate test cases for ${ep.method} ${ep.path}`,
        arguments: [ep],
      };
      lenses.push(genTestsLens);
    }

    return lenses;
  }

  /**
   * Resolve a previously unresolved CodeLens.
   *
   * In practice our lenses are created with commands already attached in
   * {@link provideCodeLenses}, so this method simply returns the lens as-is.
   * It exists to satisfy the interface and for future extensibility.
   */
  resolveCodeLens(
    codeLens: vscode.CodeLens,
    _token: vscode.CancellationToken,
  ): vscode.CodeLens {
    // Commands are already set during provideCodeLenses.
    return codeLens;
  }

  /**
   * Dispose of internal resources.
   */
  dispose(): void {
    this._onDidChangeCodeLenses.dispose();
  }
}

// ─── EndpointCodeLens ────────────────────────────────────────────────────────

/**
 * Extended CodeLens that carries the associated endpoint record and action
 * kind, so that resolution logic (or command handlers) can inspect the
 * endpoint without a separate lookup.
 */
export class EndpointCodeLens extends vscode.CodeLens {
  /** The endpoint record this lens is attached to. */
  public readonly endpoint: EndpointRecord;

  /** Which action this lens represents. */
  public readonly actionKind: 'viewDocs' | 'generateTests';

  /**
   * @param range      Source range (handler line)
   * @param endpoint   The endpoint record
   * @param actionKind Which action this lens triggers
   */
  constructor(
    range: vscode.Range,
    endpoint: EndpointRecord,
    actionKind: 'viewDocs' | 'generateTests',
  ) {
    super(range);
    this.endpoint = endpoint;
    this.actionKind = actionKind;
  }
}
