import * as fs from 'fs';
import * as path from 'path';
import { LanguagePlugin, EndpointRecord } from '../../shared/types';
import { scanNestJsFiles } from './scanner';
import { analyzeNestJsEndpoints } from './analyzer';
import { Logger } from '../../shared/logger';
import { findFilesRecursively } from '../../shared/utils';

const logger = Logger.create('plugin:typescript-nestjs');

const typescriptNestjsPlugin: LanguagePlugin = {
  id: 'typescript-nestjs',
  language: 'typescript',
  framework: 'nestjs',
  filePatterns: ['**/*.ts', '**/*.tsx'],

  async scan(files: string[], workspaceRoot: string): Promise<EndpointRecord[]> {
    logger.info(`Scanning ${files.length} TypeScript/NestJS files`);
    return scanNestJsFiles(files, workspaceRoot);
  },

  async analyze(endpoints: EndpointRecord[], workspaceRoot: string): Promise<EndpointRecord[]> {
    logger.info(`Analyzing ${endpoints.length} NestJS endpoints`);
    return analyzeNestJsEndpoints(endpoints, workspaceRoot);
  },

  async detect(workspaceRoot: string, fileMap?: Map<string, string[]>): Promise<boolean> {
    // 1. Check nest-cli.json recursively
    const nestCliFiles = findFilesRecursively(workspaceRoot, (name) => name === 'nest-cli.json');
    if (nestCliFiles.length > 0) {
      logger.info(`Detected NestJS cli config: ${nestCliFiles[0]}`);
      return true;
    }

    // 2. Check package.json recursively
    const pkgFiles = findFilesRecursively(workspaceRoot, (name) => name === 'package.json');
    for (const file of pkgFiles) {
      try {
        const pkg = JSON.parse(fs.readFileSync(file, 'utf-8'));
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        if ('@nestjs/core' in deps || '@nestjs/common' in deps) {
          logger.info(`Detected NestJS in configuration file: ${file}`);
          return true;
        }
      } catch {}
    }

    // Fallback: Check for NestJS imports in TS files
    const tsFiles = fileMap?.get('typescript') || findFilesRecursively(workspaceRoot, (name) => name.endsWith('.ts'));
    for (let i = 0; i < Math.min(tsFiles.length, 100); i++) {
      try {
        const content = fs.readFileSync(tsFiles[i], 'utf-8');
        if (/from\s+['"]@nestjs/i.test(content)) {
          logger.info(`Detected NestJS import in: ${tsFiles[i]}`);
          return true;
        }
      } catch {}
    }

    return false;
  },
};

export default typescriptNestjsPlugin;
