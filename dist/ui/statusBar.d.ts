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
export declare class StatusBarManager {
    /** The underlying VS Code status-bar item. */
    private readonly item;
    /** Current visual state (used to avoid redundant updates). */
    private state;
    /** Timer used to auto-revert from "complete" back to "idle". */
    private resetTimer;
    /**
     * Duration (ms) after which the "complete" badge auto-reverts to idle.
     * Set to 0 to disable auto-revert.
     */
    private static readonly AUTO_REVERT_MS;
    /**
     * @param statusBarItem A pre-created `vscode.StatusBarItem`.
     *        Typically created via `vscode.window.createStatusBarItem(...)`.
     */
    constructor(statusBarItem: vscode.StatusBarItem);
    /**
     * Show the default idle state.
     *
     * Display: `$(symbol-interface) CodeLens`
     */
    showIdle(): void;
    /**
     * Show the scanning/progress state.
     *
     * Display: `$(loading~spin) Scanning… 45%`
     *
     * @param message Short description of what is being scanned.
     * @param percent Progress percentage (0 – 100).
     */
    showScanning(message: string, percent: number): void;
    /**
     * Show the successful completion state.
     *
     * Display: `$(check) CodeLens: 24 endpoints`
     *
     * After {@link StatusBarManager.AUTO_REVERT_MS} the item reverts to idle.
     *
     * @param endpointCount Number of endpoints discovered.
     */
    showComplete(endpointCount: number): void;
    /**
     * Show the error state.
     *
     * Display: `$(error) CodeLens: Error`
     *
     * The status bar background is tinted red using the VS Code error colour.
     *
     * @param message A short error description shown as tooltip.
     */
    showError(message: string): void;
    /**
     * Dispose of the status-bar item and any pending timers.
     */
    dispose(): void;
    /**
     * Cancel any pending auto-revert timer.
     */
    private clearResetTimer;
}
//# sourceMappingURL=statusBar.d.ts.map