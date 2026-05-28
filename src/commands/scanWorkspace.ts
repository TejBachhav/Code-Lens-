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
import * as path from 'path';
import { fork, ChildProcess } from 'child_process';
import {
  PipelineCommand,
  PipelineEvent,
  PipelineResult,
  PipelineOptions,
  SupportedLanguage,
} from '../shared/types';

// ─── Module-level State ───────────────────────────────────────────────────────

/** The most recent pipeline result, or `undefined` if no scan has run yet. */
let latestResult: PipelineResult | undefined;

/** The currently running worker process, if any. */
let activeWorker: ChildProcess | undefined;

/** Event emitter for pipeline events, shared with the status webview provider. */
export const scanEventEmitter = new vscode.EventEmitter<PipelineEvent>();

/**
 * Retrieve the most recent pipeline result.
 *
 * @returns The last {@link PipelineResult}, or `undefined` if no scan has completed
 */
export function getLatestResult(): PipelineResult | undefined {
  return latestResult;
}

/**
 * Check whether a scan is currently in progress.
 */
export function isScanRunning(): boolean {
  return activeWorker !== undefined && activeWorker.connected;
}

/**
 * Cancel the currently running scan, if any.
 */
export function cancelActiveScan(): void {
  if (activeWorker && activeWorker.connected) {
    const cancelCmd: PipelineCommand = { type: 'cancel' };
    activeWorker.send(cancelCmd);
  }
}

// ─── Configuration Helpers ────────────────────────────────────────────────────

/**
 * Build {@link PipelineOptions} from the user's VS Code settings.
 *
 * @returns Fully resolved pipeline options
 */
function getOptionsFromSettings(): PipelineOptions {
  const config = vscode.workspace.getConfiguration('codelens');

  const languages = config.get<SupportedLanguage[]>('scan.languages', [
    'python',
    'typescript',
    'javascript',
    'xml',
  ]);

  const excludePatterns = config.get<string[]>('scan.excludePatterns', [
    '**/node_modules/**',
    '**/.venv/**',
    '**/venv/**',
    '**/__pycache__/**',
    '**/dist/**',
    '**/build/**',
    '**/.git/**',
    '**/target/**',
  ]);

  const enableTier3 = config.get<boolean>('tier3.enabled', true);
  const outputDir = config.get<string>('output.directory', '.codelens');

  const ollamaUrl = config.get<string>('ollama.url', 'http://localhost:11434');
  const ollamaModel = config.get<string>('ollama.model', 'qwen2.5-coder:7b');
  const temperature = config.get<number>('tier3.temperature', 0.1);
  const concurrency = config.get<number>('tier3.concurrency', 2);

  return {
    languages,
    excludePatterns,
    enableTier3,
    outputDir,
    ollama: enableTier3
      ? { url: ollamaUrl, model: ollamaModel, temperature, concurrency }
      : undefined,
  };
}

// ─── Execute Scan ─────────────────────────────────────────────────────────────

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
export async function executeScan(
  workspaceRoot: string,
  extensionPath: string,
  outputChannel: vscode.OutputChannel,
): Promise<PipelineResult | undefined> {
  // Prevent concurrent scans
  if (isScanRunning()) {
    vscode.window.showWarningMessage('A CodeLens scan is already in progress.');
    return undefined;
  }

  const workerScript = path.join(extensionPath, 'dist', 'pipelineWorker.js');
  const options = getOptionsFromSettings();

  outputChannel.appendLine(`[CodeLens] Starting scan for: ${workspaceRoot}`);
  outputChannel.appendLine(`[CodeLens] Languages: ${options.languages.join(', ')}`);
  outputChannel.appendLine(`[CodeLens] Tier 3 enabled: ${options.enableTier3}`);
  outputChannel.show(true);

  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'CodeLens: Scanning workspace',
      cancellable: true,
    },
    async (progress, token) => {
      return new Promise<PipelineResult | undefined>((resolve) => {
        // Fork the worker process with IPC channel, stripping inspector flags to prevent port conflicts
        const worker = fork(workerScript, [], {
          stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
          execArgv: process.execArgv.filter(arg => !arg.startsWith('--inspect')),
        });
        activeWorker = worker;

        // Notify listeners that the scan has started
        scanEventEmitter.fire({
          type: 'progress',
          phase: 'discovery',
          message: 'Starting scan...',
          percent: 0,
        });

        // Handle cancellation from the progress UI
        token.onCancellationRequested(() => {
          outputChannel.appendLine('[CodeLens] Scan cancelled by user');
          cancelActiveScan();
        });

        // Track the last reported percentage for incremental updates
        let lastPercent = 0;

        // Listen for pipeline events
        worker.on('message', (event: PipelineEvent) => {
          // Forward event to listeners
          scanEventEmitter.fire(event);

          switch (event.type) {
            case 'progress': {
              const increment = event.percent - lastPercent;
              lastPercent = event.percent;
              progress.report({
                message: event.message,
                increment: Math.max(0, increment),
              });
              outputChannel.appendLine(
                `[CodeLens] [${event.phase}] ${event.message} (${event.percent}%)`,
              );
              break;
            }

            case 'log':
              outputChannel.appendLine(`[CodeLens] [${event.level.toUpperCase()}] ${event.message}`);
              break;

            case 'endpoints':
              outputChannel.appendLine(
                `[CodeLens] Intermediate: ${event.data.length} endpoint(s) discovered so far`,
              );
              break;

            case 'complete':
              outputChannel.appendLine(
                `[CodeLens] Scan complete — ${event.data.endpoints.length} endpoint(s) found in ${event.data.stats.totalDurationMs}ms`,
              );
              latestResult = event.data;
              cleanup();
              resolve(event.data);
              break;

            case 'error':
              outputChannel.appendLine(`[CodeLens] ERROR: ${event.message}`);
              if (event.details) {
                outputChannel.appendLine(`[CodeLens] ${event.details}`);
              }
              vscode.window.showErrorMessage(`CodeLens scan failed: ${event.message}`);
              cleanup();
              resolve(undefined);
              break;
          }
        });

        // Handle worker process exit
        worker.on('exit', (code) => {
          if (code !== 0 && code !== null) {
            outputChannel.appendLine(`[CodeLens] Worker exited with code ${code}`);
            vscode.window.showErrorMessage(`CodeLens worker process exited unexpectedly (code ${code})`);
          }
          cleanup();
          // Resolve with undefined if we haven't already resolved
          resolve(latestResult ?? undefined);
        });

        worker.on('error', (error) => {
          outputChannel.appendLine(`[CodeLens] Worker error: ${error.message}`);
          vscode.window.showErrorMessage(`CodeLens worker error: ${error.message}`);
          cleanup();
          resolve(undefined);
        });

        // Forward worker stdout/stderr to the output channel
        worker.stdout?.on('data', (data: Buffer) => {
          outputChannel.appendLine(`[Worker stdout] ${data.toString().trim()}`);
        });
        worker.stderr?.on('data', (data: Buffer) => {
          outputChannel.appendLine(`[Worker stderr] ${data.toString().trim()}`);
        });

        // Send the start command
        const startCmd: PipelineCommand = {
          type: 'start',
          workspaceRoot,
          options,
        };
        worker.send(startCmd);

        /**
         * Cleanup helper: clear the active worker reference.
         */
        function cleanup(): void {
          activeWorker = undefined;
        }
      });
    },
  );
}
