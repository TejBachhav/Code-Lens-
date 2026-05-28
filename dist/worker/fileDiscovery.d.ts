/**
 * CodeLens — File Discovery Module
 *
 * Discovers source files in a workspace using fast-glob, respecting exclude
 * patterns and .gitignore rules. Groups discovered files by their language
 * for downstream processing by language-specific plugins.
 *
 * @module worker/fileDiscovery
 */
import { SupportedLanguage } from '../shared/types';
/**
 * Parse a .gitignore file and convert its patterns to glob exclude patterns.
 *
 * Each non-comment, non-blank line becomes a glob exclusion pattern.
 * Lines already prefixed with `!` (negation) are dropped — fast-glob does
 * not support negated ignore patterns in the same way Git does.
 *
 * @param gitignorePath - Absolute path to the .gitignore file
 * @returns An array of glob-compatible exclude patterns
 */
export declare function parseGitignore(gitignorePath: string): string[];
/**
 * Build the complete set of exclude patterns by merging:
 * 1. Default built-in excludes ({@link DEFAULT_EXCLUDE_PATTERNS})
 * 2. User-supplied excludes (from VS Code settings)
 * 3. Patterns parsed from the workspace `.gitignore` (if present)
 *
 * Duplicate entries are removed.
 *
 * @param workspaceRoot   - Absolute path to the workspace root
 * @param userExcludes    - Additional patterns supplied by the user
 * @returns Deduplicated array of glob exclude patterns
 */
export declare function buildExcludePatterns(workspaceRoot: string, userExcludes: string[]): string[];
/**
 * Discover source files in a workspace, grouped by language.
 *
 * For each requested language the function looks up the corresponding glob
 * patterns from {@link LANGUAGE_FILE_PATTERNS} and runs `fast-glob` against
 * the workspace root.  Results are absolute paths.
 *
 * @param workspaceRoot    - Absolute path to the workspace root directory
 * @param languages        - Languages to scan for
 * @param excludePatterns  - User-supplied glob exclusion patterns
 * @returns A map from language to an array of discovered absolute file paths
 *
 * @example
 * ```ts
 * const files = await discoverFiles('/repo', ['python', 'typescript'], []);
 * // files.get('python')  → ['/repo/app/main.py', '/repo/app/routes.py']
 * // files.get('typescript') → ['/repo/src/index.ts']
 * ```
 */
export declare function discoverFiles(workspaceRoot: string, languages: SupportedLanguage[], excludePatterns: string[]): Promise<Map<SupportedLanguage, string[]>>;
//# sourceMappingURL=fileDiscovery.d.ts.map