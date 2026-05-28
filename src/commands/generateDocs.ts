/**
 * CodeLens — Generate Documentation Command
 *
 * Command handler that generates API documentation from the most recent scan
 * result. If no scan has been run yet, the user is prompted to scan first.
 *
 * @module commands/generateDocs
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { PipelineResult, OutputFileRecord } from '../shared/types';
import { getLatestResult } from './scanWorkspace';

/**
 * Execute the "Generate Documentation" command.
 *
 * Workflow:
 * 1. Check whether a scan result is available.
 * 2. If not, prompt the user to run a scan first.
 * 3. Show a progress notification while generating docs.
 * 4. Write documentation files to the output directory.
 * 5. Open the docs folder in the file explorer.
 *
 * @param outputChannel - VS Code OutputChannel for log messages
 */
export async function executeGenerateDocs(
  outputChannel: vscode.OutputChannel,
): Promise<void> {
  const result = getLatestResult();

  if (!result) {
    const action = await vscode.window.showWarningMessage(
      'No scan results available. Run a workspace scan first?',
      'Scan Now',
      'Cancel',
    );

    if (action === 'Scan Now') {
      await vscode.commands.executeCommand('codelens.scanWorkspace');
    }
    return;
  }

  if (result.endpoints.length === 0) {
    vscode.window.showInformationMessage('No endpoints found in the last scan. Nothing to document.');
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'CodeLens: Generating documentation',
      cancellable: false,
    },
    async (progress) => {
      try {
        progress.report({ message: 'Preparing documentation…', increment: 10 });

        const workspaceRoot = getWorkspaceRoot();
        if (!workspaceRoot) {
          vscode.window.showErrorMessage('No workspace folder open.');
          return;
        }

        const outputDir = resolveOutputDir(workspaceRoot);
        const docsDir = path.join(outputDir, 'docs');

        // Ensure the docs directory exists
        if (!fs.existsSync(docsDir)) {
          fs.mkdirSync(docsDir, { recursive: true });
        }

        progress.report({ message: 'Writing documentation files…', increment: 30 });

        const generatedFiles = await generateDocumentationFiles(result, docsDir, outputChannel);

        progress.report({ message: 'Finalising…', increment: 50 });

        outputChannel.appendLine(
          `[CodeLens] Generated ${generatedFiles.length} documentation file(s) in ${docsDir}`,
        );

        // Open the docs folder
        const docsUri = vscode.Uri.file(docsDir);
        await vscode.commands.executeCommand('revealFileInOS', docsUri);

        vscode.window.showInformationMessage(
          `CodeLens: Generated ${generatedFiles.length} documentation file(s).`,
          'Open Folder',
        ).then((selected) => {
          if (selected === 'Open Folder') {
            vscode.commands.executeCommand('revealFileInOS', docsUri);
          }
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        outputChannel.appendLine(`[CodeLens] Doc generation failed: ${msg}`);
        vscode.window.showErrorMessage(`CodeLens doc generation failed: ${msg}`);
      }
    },
  );
}

/**
 * Generate documentation files from the pipeline result.
 *
 * Writes a Markdown summary and per-endpoint pages. Attempts to call optional
 * output generators if they are available.
 *
 * @param result        - The pipeline scan result
 * @param docsDir       - Absolute path to the docs output directory
 * @param outputChannel - VS Code OutputChannel for logging
 * @returns Array of generated file records
 */
async function generateDocumentationFiles(
  result: PipelineResult,
  docsDir: string,
  outputChannel: vscode.OutputChannel,
): Promise<OutputFileRecord[]> {
  const generatedFiles: OutputFileRecord[] = [];

  // ── Summary Markdown ─────────────────────────────────────────────────
  const summaryPath = path.join(docsDir, 'API_SUMMARY.md');
  const summaryContent = buildSummaryMarkdown(result);
  fs.writeFileSync(summaryPath, summaryContent, 'utf-8');
  generatedFiles.push({ type: 'markdown', path: summaryPath });

  // ── Per-endpoint Markdown pages ──────────────────────────────────────
  for (const endpoint of result.endpoints) {
    try {
      const safeName = `${endpoint.method}_${endpoint.path.replace(/[{}\/]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '')}`.toLowerCase();
      const endpointPath = path.join(docsDir, `${safeName}.md`);
      const content = buildEndpointMarkdown(endpoint);
      fs.writeFileSync(endpointPath, content, 'utf-8');
      generatedFiles.push({ type: 'markdown', path: endpointPath });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      outputChannel.appendLine(
        `[CodeLens] Failed to generate doc for ${endpoint.method} ${endpoint.path}: ${msg}`,
      );
    }
  }

  // ── Optional: call registered output generators ──────────────────────
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const outputMod = require('../output');
    if (typeof outputMod.generateDocs === 'function') {
      const extra: OutputFileRecord[] = await outputMod.generateDocs(result, docsDir);
      generatedFiles.push(...extra);
    }
  } catch {
    // Output generators module not available yet — that is fine
  }

  return generatedFiles;
}

/**
 * Build a Markdown summary of all discovered endpoints.
 */
function buildSummaryMarkdown(result: PipelineResult): string {
  const lines: string[] = [
    '# API Endpoint Summary',
    '',
    `> Generated by CodeLens on ${new Date().toISOString()}`,
    '',
    `**Total endpoints:** ${result.endpoints.length}`,
    '',
    '## Detected Frameworks',
    '',
    '| Plugin | Language | Framework | Files | Endpoints |',
    '|--------|----------|-----------|-------|-----------|',
  ];

  for (const fw of result.detectedFrameworks) {
    lines.push(
      `| ${fw.pluginId} | ${fw.language} | ${fw.framework} | ${fw.fileCount} | ${fw.endpointCount} |`,
    );
  }

  lines.push('', '## Endpoints', '', '| Method | Path | Handler | Source |', '|--------|------|---------|--------|');

  for (const ep of result.endpoints) {
    const handler = ep.handler.className
      ? `${ep.handler.className}.${ep.handler.name}`
      : ep.handler.name;
    lines.push(`| ${ep.method} | ${ep.path} | ${handler} | ${ep.sourceFile}:${ep.sourceLines[0]} |`);
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Build a Markdown page for a single endpoint.
 */
function buildEndpointMarkdown(endpoint: PipelineResult['endpoints'][0]): string {
  const lines: string[] = [
    `# ${endpoint.method} ${endpoint.path}`,
    '',
  ];

  if (endpoint.summary) {
    lines.push(endpoint.summary, '');
  }

  if (endpoint.description) {
    lines.push(endpoint.description, '');
  }

  lines.push(
    '## Details',
    '',
    `- **Framework:** ${endpoint.framework}`,
    `- **Language:** ${endpoint.language}`,
    `- **Handler:** ${endpoint.handler.className ? `${endpoint.handler.className}.` : ''}${endpoint.handler.name}`,
    `- **Source:** ${endpoint.sourceFile}:${endpoint.sourceLines[0]}-${endpoint.sourceLines[1]}`,
    `- **Async:** ${endpoint.handler.isAsync ? 'Yes' : 'No'}`,
    '',
  );

  if (endpoint.params.length > 0) {
    lines.push(
      '## Parameters',
      '',
      '| Name | In | Type | Required | Default |',
      '|------|----|------|----------|---------|',
    );
    for (const param of endpoint.params) {
      lines.push(
        `| ${param.name} | ${param.in} | ${param.type} | ${param.required ? 'Yes' : 'No'} | ${param.default ?? '—'} |`,
      );
    }
    lines.push('');
  }

  if (endpoint.auth) {
    lines.push('## Authentication', '', `- **Type:** ${endpoint.auth.type}`, '');
  }

  if (endpoint.middleware.length > 0) {
    lines.push('## Middleware', '', ...endpoint.middleware.map((m) => `- ${m}`), '');
  }

  if (endpoint.curlExample) {
    lines.push('## Example', '', '```bash', endpoint.curlExample, '```', '');
  }

  return lines.join('\n');
}

/**
 * Get the workspace root from the first open folder.
 */
function getWorkspaceRoot(): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  return folders && folders.length > 0 ? folders[0].uri.fsPath : undefined;
}

/**
 * Resolve the output directory from settings.
 */
function resolveOutputDir(workspaceRoot: string): string {
  const config = vscode.workspace.getConfiguration('codelens');
  const outputDir = config.get<string>('output.directory', '.codelens');
  return path.resolve(workspaceRoot, outputDir);
}
