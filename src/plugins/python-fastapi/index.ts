/**
 * CodeLens — Python FastAPI Plugin
 *
 * LanguagePlugin implementation for FastAPI web framework.
 * Detects FastAPI projects and delegates to scanner (Tier 1) and analyzer (Tier 2).
 */

import * as fs from 'fs';
import * as path from 'path';
import { LanguagePlugin, EndpointRecord } from '../../shared/types';
import { FRAMEWORK_MARKERS, PYTHON_FRAMEWORK_IMPORTS, LANGUAGE_FILE_PATTERNS } from '../../shared/constants';
import { Logger } from '../../shared/logger';
import { scanFastAPIEndpoints } from './scanner';
import { analyzeFastAPIEndpoints } from './analyzer';
import { findFilesRecursively } from '../../shared/utils';

const logger = Logger.create('FastAPIPlugin');

/**
 * FastAPI language plugin instance.
 *
 * Handles Python projects using the FastAPI framework.
 * Detection: checks for 'fastapi' in requirements.txt/pyproject.toml,
 * or 'from fastapi import' in any .py file.
 */
const fastApiPlugin: LanguagePlugin = {
  id: 'python-fastapi',
  language: 'python',
  framework: 'fastapi',
  filePatterns: LANGUAGE_FILE_PATTERNS.python,

  /**
   * Tier 1: Scan Python source files for FastAPI endpoint definitions.
   * Pure AST parsing — no inference, no side effects.
   */
  async scan(files: string[], workspaceRoot: string): Promise<EndpointRecord[]> {
    logger.info(`Scanning ${files.length} Python files for FastAPI endpoints`);
    const endpoints = await scanFastAPIEndpoints(files, workspaceRoot);
    logger.info(`Found ${endpoints.length} FastAPI endpoints`);
    return endpoints;
  },

  /**
   * Tier 2: Enrich endpoint records with data flow analysis.
   * Resolves Pydantic models, traces responses, detects side effects.
   */
  async analyze(endpoints: EndpointRecord[], workspaceRoot: string): Promise<EndpointRecord[]> {
    logger.info(`Analyzing ${endpoints.length} FastAPI endpoints`);
    const enriched = await analyzeFastAPIEndpoints(endpoints, workspaceRoot);
    logger.info('FastAPI analysis complete');
    return enriched;
  },

  /**
   * Detect whether this workspace is a FastAPI project.
   */
  async detect(workspaceRoot: string, fileMap?: Map<string, string[]>): Promise<boolean> {
    // 1. Check requirements.txt, pyproject.toml, setup.py files recursively
    const configFiles = findFilesRecursively(workspaceRoot, (name) =>
      ['requirements.txt', 'pyproject.toml', 'setup.py'].includes(name)
    );

    for (const file of configFiles) {
      try {
        const content = fs.readFileSync(file, 'utf-8').toLowerCase();
        if (content.includes('fastapi')) {
          logger.info(`Detected FastAPI in configuration file: ${file}`);
          return true;
        }
      } catch {}
    }

    // 2. Check for fastapi imports in Python files recursively
    const pyFiles = fileMap?.get('python') || findFilesRecursively(workspaceRoot, (name) => name.endsWith('.py'));
    // Scan up to 100 files to avoid missing imports in larger or nested projects
    for (let i = 0; i < Math.min(pyFiles.length, 100); i++) {
      try {
        const content = fs.readFileSync(pyFiles[i], 'utf-8');
        if (/from\s+fastapi\s+import|import\s+fastapi/i.test(content)) {
          logger.info(`Detected FastAPI import in: ${pyFiles[i]}`);
          return true;
        }
      } catch {}
    }

    return false;
  }
};

export default fastApiPlugin;
