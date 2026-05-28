/**
 * CodeLens — Scan Workspace Command
 *
 * Extracts the workspace scan logic into a reusable module. Forks the pipeline
 * worker as a child process, manages the VS Code progress notification, and
 * stores the most recent {@link PipelineResult} for use by other commands.
 *
 * @module commands/scanWorkspace
 */
import * as vscode from 'vscode';
import { PipelineEvent, PipelineResult } from '../shared/types';
/** Event emitter for pipeline events, shared with the status webview provider. */
export declare const scanEventEmitter: vscode.EventEmitter<PipelineEvent>;
/**
 * Retrieve the most recent pipeline result.
 *
 * @returns The last {@link PipelineResult}, or `undefined` if no scan has completed
 */
export declare function getLatestResult(): PipelineResult | undefined;
/**
 * Check whether a scan is currently in progress.
 */
export declare function isScanRunning(): boolean;
/**
 * Cancel the currently running scan, if any.
 */
export declare function cancelActiveScan(): void;
/**
 * Execute a full workspace scan.
 *
 * Forks the pipeline worker as a child process, sends a `start` command with
 * the workspace configuration, and drives a VS Code progress notification
 * from the {@link PipelineEvent} messages received over IPC.
 *
 * @param workspaceRoot  - Absolute path to the workspace root
 * @param extensionPath  - Absolute path to the extension installation directory
 * @param outputChannel  - VS Code OutputChannel for log messages
 * @returns The pipeline result on success, or `undefined` on failure/cancellation
 */
export declare function executeScan(workspaceRoot: string, extensionPath: string, outputChannel: vscode.OutputChannel): Promise<PipelineResult | undefined>;
//# sourceMappingURL=scanWorkspace.d.ts.map