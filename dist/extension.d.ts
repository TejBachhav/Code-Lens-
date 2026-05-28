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
/**
 * Extension activation — called when VS Code loads the extension.
 *
 * Registers all commands, creates the TreeView and status bar, and sets up the
 * OutputChannel.
 *
 * @param context - VS Code extension context
 */
export declare function activate(context: vscode.ExtensionContext): void;
/**
 * Extension deactivation — called when VS Code unloads the extension.
 *
 * Performs any necessary cleanup (currently a no-op; disposables are managed
 * via the extension context).
 */
export declare function deactivate(): void;
//# sourceMappingURL=extension.d.ts.map