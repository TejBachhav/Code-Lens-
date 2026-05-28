/**
 * CodeLens — Python FastAPI Plugin
 *
 * LanguagePlugin implementation for FastAPI web framework.
 * Detects FastAPI projects and delegates to scanner (Tier 1) and analyzer (Tier 2).
 */
import { LanguagePlugin } from '../../shared/types';
/**
 * FastAPI language plugin instance.
 *
 * Handles Python projects using the FastAPI framework.
 * Detection: checks for 'fastapi' in requirements.txt/pyproject.toml,
 * or 'from fastapi import' in any .py file.
 */
declare const fastApiPlugin: LanguagePlugin;
export default fastApiPlugin;
//# sourceMappingURL=index.d.ts.map