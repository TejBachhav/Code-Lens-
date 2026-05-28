import * as fs from 'fs';
import * as path from 'path';
import { LanguagePlugin, EndpointRecord } from '../../shared/types';
import { scanExpressFiles } from './scanner';
import { analyzeExpressEndpoints } from './analyzer';
import { Logger } from '../../shared/logger';
import { findFilesRecursively } from '../../shared/utils';

const logger = Logger.create('plugin:typescript-express');

const typescriptExpressPlugin: LanguagePlugin = {
  id: 'typescript-express',
  language: 'typescript',
  framework: 'express',
  filePatterns: ['**/*.ts', '**/*.tsx'],

  async scan(files: string[], workspaceRoot: string): Promise<EndpointRecord[]> {
    logger.info(`Scanning ${files.length} TypeScript/Express files`);
    return scanExpressFiles(files, workspaceRoot);
  },

  async analyze(endpoints: EndpointRecord[], workspaceRoot: string): Promise<EndpointRecord[]> {
    logger.info(`Analyzing ${endpoints.length} Express endpoints`);
    return analyzeExpressEndpoints(endpoints, workspaceRoot);
  },

  async detect(workspaceRoot: string, fileMap?: Map<string, string[]>): Promise<boolean> {
    const pkgFiles = findFilesRecursively(workspaceRoot, (name) => name === 'package.json');
    for (const file of pkgFiles) {
      try {
        const pkg = JSON.parse(fs.readFileSync(file, 'utf-8'));
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        if ('express' in deps && !('@nestjs/core' in deps)) {
          logger.info(`Detected TypeScript/Express in configuration file: ${file}`);
          return true;
        }
      } catch {}
    }

    // Fallback: check for express imports in TypeScript files
    const tsFiles = fileMap?.get('typescript') || findFilesRecursively(workspaceRoot, (name) => name.endsWith('.ts'));
    for (let i = 0; i < Math.min(tsFiles.length, 100); i++) {
      try {
        const content = fs.readFileSync(tsFiles[i], 'utf-8');
        if (/import\s+.*express|import\s+['"]express['"]/i.test(content)) {
          logger.info(`Detected Express import in: ${tsFiles[i]}`);
          return true;
        }
      } catch {}
    }

    return false;
  },
};

export default typescriptExpressPlugin;
