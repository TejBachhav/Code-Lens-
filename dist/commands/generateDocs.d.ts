/**
 * CodeLens — Generate Documentation Command
 *
 * Command handler that generates API documentation from the most recent scan
 * result. If no scan has been run yet, the user is prompted to scan first.
 *
 * @module commands/generateDocs
 */
import * as vscode from 'vscode';
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
export declare function executeGenerateDocs(outputChannel: vscode.OutputChannel): Promise<void>;
//# sourceMappingURL=generateDocs.d.ts.map