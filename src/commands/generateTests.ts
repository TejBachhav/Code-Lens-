/**
 * CodeLens — Generate Tests Command
 *
 * Command handler that generates runnable test files from the most recent scan
 * result. If no scan has been run yet, the user is prompted to scan first.
 *
 * @module commands/generateTests
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { PipelineResult, EndpointRecord, OutputFileRecord } from '../shared/types';
import { getLatestResult } from './scanWorkspace';

/**
 * Execute the "Generate Tests" command.
 *
 * Workflow:
 * 1. Check whether a scan result is available.
 * 2. If not, prompt the user to run a scan first.
 * 3. Show a progress notification while generating tests.
 * 4. Write test files to the output directory.
 * 5. Open the first generated test file in the editor.
 *
 * @param outputChannel - VS Code OutputChannel for log messages
 */
export async function executeGenerateTests(
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
    vscode.window.showInformationMessage(
      'No endpoints found in the last scan. Nothing to generate tests for.',
    );
    return;
  }

  // Check whether any endpoints have test cases (from Tier 3)
  const endpointsWithTests = result.endpoints.filter(
    (ep) => ep.testCases && ep.testCases.length > 0,
  );

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'CodeLens: Generating tests',
      cancellable: false,
    },
    async (progress) => {
      try {
        progress.report({ message: 'Preparing test generation…', increment: 10 });

        const workspaceRoot = getWorkspaceRoot();
        if (!workspaceRoot) {
          vscode.window.showErrorMessage('No workspace folder open.');
          return;
        }

        const outputDir = resolveOutputDir(workspaceRoot);
        const testsDir = path.join(outputDir, 'tests');

        // Ensure the tests directory exists
        if (!fs.existsSync(testsDir)) {
          fs.mkdirSync(testsDir, { recursive: true });
        }

        progress.report({ message: 'Generating test files…', increment: 30 });

        const generatedFiles = await generateTestFiles(
          result,
          endpointsWithTests,
          testsDir,
          outputChannel,
        );

        progress.report({ message: 'Finalising…', increment: 50 });

        outputChannel.appendLine(
          `[CodeLens] Generated ${generatedFiles.length} test file(s) in ${testsDir}`,
        );

        // Open the first generated test file
        if (generatedFiles.length > 0) {
          const firstFile = generatedFiles[0];
          const doc = await vscode.workspace.openTextDocument(firstFile.path);
          await vscode.window.showTextDocument(doc, { preview: true });
        }

        vscode.window.showInformationMessage(
          `CodeLens: Generated ${generatedFiles.length} test file(s).`,
          'Open Folder',
        ).then((selected) => {
          if (selected === 'Open Folder') {
            vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(testsDir));
          }
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        outputChannel.appendLine(`[CodeLens] Test generation failed: ${msg}`);
        vscode.window.showErrorMessage(`CodeLens test generation failed: ${msg}`);
      }
    },
  );
}

/**
 * Generate test files from the pipeline result.
 *
 * If Tier 3 has produced structured {@link TestCaseRecord}s, those are used.
 * Otherwise, a skeleton test file is generated from the endpoint metadata.
 *
 * @param result              - Full pipeline result
 * @param endpointsWithTests  - Endpoints that already have Tier 3 test cases
 * @param testsDir            - Absolute path to the tests output directory
 * @param outputChannel       - VS Code OutputChannel for logging
 * @returns Array of generated file records
 */
async function generateTestFiles(
  result: PipelineResult,
  endpointsWithTests: EndpointRecord[],
  testsDir: string,
  outputChannel: vscode.OutputChannel,
): Promise<OutputFileRecord[]> {
  const generatedFiles: OutputFileRecord[] = [];

  // ── Try optional test generators first ────────────────────────────────
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const outputMod = require('../output');
    if (typeof outputMod.generateTests === 'function') {
      const extra: OutputFileRecord[] = await outputMod.generateTests(result, testsDir);
      generatedFiles.push(...extra);
      return generatedFiles;
    }
  } catch {
    // Output generators module not available yet — fall through to built-in
  }

  // ── Built-in skeleton test generation ────────────────────────────────

  // Group endpoints by language for appropriate test syntax
  const byLanguage = new Map<string, EndpointRecord[]>();
  for (const endpoint of result.endpoints) {
    const lang = endpoint.language;
    if (!byLanguage.has(lang)) {
      byLanguage.set(lang, []);
    }
    byLanguage.get(lang)!.push(endpoint);
  }

  for (const [language, endpoints] of byLanguage) {
    try {
      const testContent = buildTestFile(language, endpoints, endpointsWithTests);
      const filename = getTestFilename(language);
      const testPath = path.join(testsDir, filename);
      fs.writeFileSync(testPath, testContent, 'utf-8');
      generatedFiles.push({ type: 'test', path: testPath, language: language as any });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      outputChannel.appendLine(
        `[CodeLens] Failed to generate tests for ${language}: ${msg}`,
      );
    }
  }

  return generatedFiles;
}

/**
 * Build a test file for the given language and endpoints.
 *
 * @param language             - Source language
 * @param endpoints            - All endpoints for this language
 * @param endpointsWithTests   - Endpoints that have Tier 3 test cases
 * @returns Test file contents as a string
 */
function buildTestFile(
  language: string,
  endpoints: EndpointRecord[],
  endpointsWithTests: EndpointRecord[],
): string {
  switch (language) {
    case 'python':
      return buildPythonTests(endpoints, endpointsWithTests);
    case 'typescript':
    case 'javascript':
      return buildJsTests(endpoints, endpointsWithTests);
    default:
      return buildGenericTests(endpoints, endpointsWithTests);
  }
}

/**
 * Build a pytest-style test file.
 */
function buildPythonTests(
  endpoints: EndpointRecord[],
  endpointsWithTests: EndpointRecord[],
): string {
  const lines: string[] = [
    '"""',
    'Auto-generated API tests by CodeLens',
    `Generated: ${new Date().toISOString()}`,
    '"""',
    '',
    'import pytest',
    'import requests',
    '',
    '',
    'BASE_URL = "http://localhost:8000"',
    '',
    '',
  ];

  for (const ep of endpoints) {
    const tier3 = endpointsWithTests.find((e) => e.id === ep.id);
    const funcName = `test_${ep.method.toLowerCase()}_${ep.path.replace(/[{}\/]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '')}`;

    if (tier3?.testCases && tier3.testCases.length > 0) {
      // Use Tier 3 test cases
      for (const tc of tier3.testCases) {
        lines.push(
          `def ${funcName}_${tc.name.replace(/\s+/g, '_').toLowerCase()}():`,
          `    """${tc.description}"""`,
          `    response = requests.${ep.method.toLowerCase()}(f"{BASE_URL}${tc.path}")`,
          `    assert response.status_code == ${tc.expectedStatus}`,
          '',
          '',
        );
      }
    } else {
      // Skeleton test
      lines.push(
        `def ${funcName}():`,
        `    """Test ${ep.method} ${ep.path}"""`,
        `    response = requests.${ep.method.toLowerCase()}(f"{BASE_URL}${ep.path}")`,
        `    assert response.status_code == 200  # TODO: adjust expected status`,
        '',
        '',
      );
    }
  }

  return lines.join('\n');
}

/**
 * Build a Jest/Mocha-style test file.
 */
function buildJsTests(
  endpoints: EndpointRecord[],
  endpointsWithTests: EndpointRecord[],
): string {
  const lines: string[] = [
    '/**',
    ' * Auto-generated API tests by CodeLens',
    ` * Generated: ${new Date().toISOString()}`,
    ' */',
    '',
    "const BASE_URL = 'http://localhost:3000';",
    '',
    '',
  ];

  for (const ep of endpoints) {
    const tier3 = endpointsWithTests.find((e) => e.id === ep.id);
    const testName = `${ep.method} ${ep.path}`;

    lines.push(`describe('${testName}', () => {`);

    if (tier3?.testCases && tier3.testCases.length > 0) {
      for (const tc of tier3.testCases) {
        lines.push(
          `  it('${tc.description.replace(/'/g, "\\'")}', async () => {`,
          `    const response = await fetch(\`\${BASE_URL}${tc.path}\`, {`,
          `      method: '${ep.method}',`,
          `    });`,
          `    expect(response.status).toBe(${tc.expectedStatus});`,
          `  });`,
          '',
        );
      }
    } else {
      lines.push(
        `  it('should respond successfully', async () => {`,
        `    const response = await fetch(\`\${BASE_URL}${ep.path}\`, {`,
        `      method: '${ep.method}',`,
        `    });`,
        `    expect(response.status).toBe(200); // TODO: adjust expected status`,
        `  });`,
        '',
      );
    }

    lines.push('});', '', '');
  }

  return lines.join('\n');
}

/**
 * Build a generic test outline for unsupported languages.
 */
function buildGenericTests(
  endpoints: EndpointRecord[],
  _endpointsWithTests: EndpointRecord[],
): string {
  const lines: string[] = [
    `# Auto-generated API Test Plan by CodeLens`,
    `# Generated: ${new Date().toISOString()}`,
    '',
    `# Total endpoints: ${endpoints.length}`,
    '',
  ];

  for (const ep of endpoints) {
    lines.push(
      `## ${ep.method} ${ep.path}`,
      `   Handler: ${ep.handler.className ? `${ep.handler.className}.` : ''}${ep.handler.name}`,
      `   Source:  ${ep.sourceFile}:${ep.sourceLines[0]}`,
      `   Params:  ${ep.params.map((p) => `${p.name} (${p.in})`).join(', ') || 'none'}`,
      '',
    );
  }

  return lines.join('\n');
}

/**
 * Determine the appropriate test file name for a language.
 */
function getTestFilename(language: string): string {
  switch (language) {
    case 'python':
      return 'test_api.py';
    case 'typescript':
      return 'api.test.ts';
    case 'javascript':
      return 'api.test.js';
    default:
      return `api_tests_${language}.md`;
  }
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
