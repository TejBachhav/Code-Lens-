/**
 * CodeLens — Generate Tests Command
 *
 * Command handler that generates runnable test files from the most recent scan
 * result. If no scan has been run yet, the user is prompted to scan first.
 *
 * @module commands/generateTests
 */
import * as vscode from 'vscode';
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
export declare function executeGenerateTests(outputChannel: vscode.OutputChannel): Promise<void>;
//# sourceMappingURL=generateTests.d.ts.map