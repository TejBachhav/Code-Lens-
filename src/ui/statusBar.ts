/**
 * CodeLens — Status Bar Manager
 *
 * Manages a single VS Code status-bar item that reflects the current state
 * of the CodeLens pipeline:
 *
 *  - **Idle**      — `$(symbol-interface) CodeLens`
 *  - **Scanning**  — `$(loading~spin) Scanning… 45%`
 *  - **Complete**  — `$(check) CodeLens: 24 endpoints`
 *  - **Error**     — `$(error) CodeLens: Error`
 *
 * Clicking the status-bar item always runs the `codelens.scanWorkspace` command.
 *
 * @module ui/statusBar
 */

import * as vscode from 'vscode';

// ─── State enum (internal) ───────────────────────────────────────────────────

/**
 * Internal enumeration of status-bar visual states.
 */
enum StatusBarState {
  Idle = 'idle',
  Scanning = 'scanning',
  Complete = 'complete',
  Error = 'error',
}

// ─── StatusBarManager ────────────────────────────────────────────────────────

/**
 * Wraps a `vscode.StatusBarItem` and exposes high-level state transitions.
 *
 * Usage:
 * ```ts
 * const sbItem = vscode.window.createStatusBarItem(
 *   vscode.StatusBarAlignment.Left,
 *   100,
 * );
 * const manager = new StatusBarManager(sbItem);
 * manager.showIdle();
 * ```
 */
export class StatusBarManager {
  /** The underlying VS Code status-bar item. */
  private readonly item: vscode.StatusBarItem;

  /** Current visual state (used to avoid redundant updates). */
  private state: StatusBarState = StatusBarState.Idle;

  /** Timer used to auto-revert from "complete" back to "idle". */
  private resetTimer: ReturnType<typeof setTimeout> | undefined;

  /**
   * Duration (ms) after which the "complete" badge auto-reverts to idle.
   * Set to 0 to disable auto-revert.
   */
  private static readonly AUTO_REVERT_MS = 30_000;

  /**
   * @param statusBarItem A pre-created `vscode.StatusBarItem`.
   *        Typically created via `vscode.window.createStatusBarItem(...)`.
   */
  constructor(statusBarItem: vscode.StatusBarItem) {
    this.item = statusBarItem;
    this.item.command = 'codelens.scanWorkspace';
    this.showIdle();
    this.item.show();
  }

  // ── State transitions ────────────────────────────────────────────────

  /**
   * Show the default idle state.
   *
   * Display: `$(symbol-interface) CodeLens`
   */
  showIdle(): void {
    this.clearResetTimer();
    this.state = StatusBarState.Idle;

    this.item.text = '$(symbol-interface) CodeLens';
    this.item.tooltip = 'Click to scan workspace for API endpoints';
    this.item.backgroundColor = undefined;
    this.item.color = undefined;
  }

  /**
   * Show the scanning/progress state.
   *
   * Display: `$(loading~spin) Scanning… 45%`
   *
   * @param message Short description of what is being scanned.
   * @param percent Progress percentage (0 – 100).
   */
  showScanning(message: string, percent: number): void {
    this.clearResetTimer();
    this.state = StatusBarState.Scanning;

    const pct = Math.max(0, Math.min(100, Math.round(percent)));
    this.item.text = `$(loading~spin) Scanning… ${pct}%`;
    this.item.tooltip = message;
    this.item.backgroundColor = undefined;
    this.item.color = undefined;
  }

  /**
   * Show the successful completion state.
   *
   * Display: `$(check) CodeLens: 24 endpoints`
   *
   * After {@link StatusBarManager.AUTO_REVERT_MS} the item reverts to idle.
   *
   * @param endpointCount Number of endpoints discovered.
   */
  showComplete(endpointCount: number): void {
    this.clearResetTimer();
    this.state = StatusBarState.Complete;

    const plural = endpointCount !== 1 ? 's' : '';
    this.item.text = `$(check) CodeLens: ${endpointCount} endpoint${plural}`;
    this.item.tooltip = `Scan complete — ${endpointCount} endpoint${plural} discovered. Click to rescan.`;
    this.item.backgroundColor = undefined;
    this.item.color = undefined;

    // Auto-revert to idle after a delay
    if (StatusBarManager.AUTO_REVERT_MS > 0) {
      this.resetTimer = setTimeout(() => this.showIdle(), StatusBarManager.AUTO_REVERT_MS);
    }
  }

  /**
   * Show the error state.
   *
   * Display: `$(error) CodeLens: Error`
   *
   * The status bar background is tinted red using the VS Code error colour.
   *
   * @param message A short error description shown as tooltip.
   */
  showError(message: string): void {
    this.clearResetTimer();
    this.state = StatusBarState.Error;

    this.item.text = '$(error) CodeLens: Error';
    this.item.tooltip = `Error: ${message}. Click to retry.`;
    this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    this.item.color = undefined;
  }

  // ── Lifecycle ────────────────────────────────────────────────────────

  /**
   * Dispose of the status-bar item and any pending timers.
   */
  dispose(): void {
    this.clearResetTimer();
    this.item.dispose();
  }

  // ── Internal helpers ─────────────────────────────────────────────────

  /**
   * Cancel any pending auto-revert timer.
   */
  private clearResetTimer(): void {
    if (this.resetTimer !== undefined) {
      clearTimeout(this.resetTimer);
      this.resetTimer = undefined;
    }
  }
}
