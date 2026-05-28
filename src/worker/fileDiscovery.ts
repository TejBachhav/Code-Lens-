/**
 * CodeLens — File Discovery Module
 *
 * Discovers source files in a workspace using fast-glob, respecting exclude
 * patterns and .gitignore rules. Groups discovered files by their language
 * for downstream processing by language-specific plugins.
 *
 * @module worker/fileDiscovery
 */

import * as path from 'path';
import * as fs from 'fs';
import fg from 'fast-glob';
import { LANGUAGE_FILE_PATTERNS, DEFAULT_EXCLUDE_PATTERNS } from '../shared/constants';
import { SupportedLanguage } from '../shared/types';
import { Logger } from '../shared/logger';

const logger = Logger.create('FileDiscovery');

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
export function parseGitignore(gitignorePath: string): string[] {
  try {
    const content = fs.readFileSync(gitignorePath, 'utf-8');
    const patterns: string[] = [];

    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();

      // Skip blank lines and comments
      if (!line || line.startsWith('#')) {
        continue;
      }

      // Skip negation patterns — they are not reliably supported
      if (line.startsWith('!')) {
        continue;
      }

      // Normalise the pattern to a leading-double-star glob
      let pattern = line;

      // Strip a leading slash — it makes the pattern root-relative which
      // fast-glob already handles when cwd is the workspace root.
      if (pattern.startsWith('/')) {
        pattern = pattern.slice(1);
      }

      // If the pattern refers to a directory (trailing slash) ensure
      // it recursively matches all children.
      if (pattern.endsWith('/')) {
        pattern = `${pattern}**`;
      }

      // Wrap with leading ** so it matches at any depth unless the
      // pattern already contains a directory component.
      if (!pattern.startsWith('**/') && !pattern.includes('/')) {
        pattern = `**/${pattern}`;
      }

      patterns.push(pattern);
    }

    return patterns;
  } catch (error) {
    // .gitignore is optional — if it cannot be read, return nothing
    logger.debug('Could not read .gitignore', { path: gitignorePath, error });
    return [];
  }
}

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
export function buildExcludePatterns(
  workspaceRoot: string,
  userExcludes: string[],
): string[] {
  const allPatterns = new Set<string>([
    ...DEFAULT_EXCLUDE_PATTERNS,
    ...userExcludes,
  ]);

  // Attempt to read .gitignore from the workspace root
  const gitignorePath = path.join(workspaceRoot, '.gitignore');
  const gitignorePatterns = parseGitignore(gitignorePath);
  for (const pat of gitignorePatterns) {
    allPatterns.add(pat);
  }

  return Array.from(allPatterns);
}

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
export async function discoverFiles(
  workspaceRoot: string,
  languages: SupportedLanguage[],
  excludePatterns: string[],
): Promise<Map<SupportedLanguage, string[]>> {
  logger.info('Starting file discovery', { workspaceRoot, languages });

  const result = new Map<SupportedLanguage, string[]>();
  const excludes = buildExcludePatterns(workspaceRoot, excludePatterns);

  logger.debug('Exclude patterns', { count: excludes.length, patterns: excludes });

  for (const language of languages) {
    const patterns = LANGUAGE_FILE_PATTERNS[language];
    if (!patterns || patterns.length === 0) {
      logger.warn(`No file patterns defined for language: ${language}`);
      result.set(language, []);
      continue;
    }

    try {
      const files = await fg(patterns, {
        cwd: workspaceRoot,
        absolute: true,
        ignore: excludes,
        dot: false,
        onlyFiles: true,
        followSymbolicLinks: false,
        // Normalise to forward slashes for cross-platform consistency
        markDirectories: false,
      });

      // Normalise all paths to use the OS-native separator
      const normalised = files.map((f) => path.resolve(f));

      logger.info(`Discovered ${normalised.length} ${language} file(s)`);
      result.set(language, normalised);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`File discovery failed for ${language}: ${message}`);
      result.set(language, []);
    }
  }

  const totalFiles = Array.from(result.values()).reduce((sum, arr) => sum + arr.length, 0);
  logger.info(`File discovery complete — ${totalFiles} total file(s) across ${languages.length} language(s)`);

  return result;
}
