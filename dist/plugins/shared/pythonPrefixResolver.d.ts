/**
 * CodeLens — Python Cross-File Route Prefix Resolver
 *
 * Scans all Python files to resolve APIRouter (FastAPI) and Blueprint (Flask)
 * mount prefixes. Maps each file's router variables to their final composed paths.
 */
import Parser from 'web-tree-sitter';
/**
 * Resolves all cross-file prefixes for APIRouters and Blueprints.
 * Returns a Map: FilePath → Map<RouterVariableName, ComposedPrefix>
 */
export declare function resolvePythonPrefixes(files: string[], workspaceRoot: string, parser: Parser): Promise<Map<string, Map<string, string>>>;
//# sourceMappingURL=pythonPrefixResolver.d.ts.map