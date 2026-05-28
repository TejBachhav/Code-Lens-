import * as fs from 'fs';
import * as path from 'path';
import { LanguagePlugin, EndpointRecord } from '../../shared/types';
import { scanJsExpressFiles } from './scanner';
import { analyzeJsExpressEndpoints } from './analyzer';
import { Logger } from '../../shared/logger';
import { findFilesRecursively } from '../../shared/utils';

const logger = Logger.create('plugin:javascript-express');

const javascriptExpressPlugin: LanguagePlugin = {
  id: 'javascript-express',
  language: 'javascript',
  framework: 'express',
  filePatterns: ['**/*.js', '**/*.mjs', '**/*.cjs'],

  async scan(files: string[], workspaceRoot: string): Promise<EndpointRecord[]> {
    logger.info(`Scanning ${files.length} JavaScript/Express files`);
    return scanJsExpressFiles(files, workspaceRoot);
  },

  async analyze(endpoints: EndpointRecord[], workspaceRoot: string): Promise<EndpointRecord[]> {
    logger.info(`Analyzing ${endpoints.length} JS Express endpoints`);
    return analyzeJsExpressEndpoints(endpoints, workspaceRoot);
  },

  async detect(workspaceRoot: string, fileMap?: Map<string, string[]>): Promise<boolean> {
    const pkgFiles = findFilesRecursively(workspaceRoot, (name) => name === 'package.json');
    for (const file of pkgFiles) {
      try {
        const pkg = JSON.parse(fs.readFileSync(file, 'utf-8'));
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        const hasExpress = 'express' in deps;
        const hasNestJs = '@nestjs/core' in deps || '@nestjs/common' in deps;
        if (hasExpress && !hasNestJs) {
          logger.info(`Detected JavaScript/Express in configuration file: ${file}`);
          return true;
        }
      } catch {}
    }

    // Fallback: check for express imports in JS files
    const jsFiles = fileMap?.get('javascript') || findFilesRecursively(workspaceRoot, (name) => name.endsWith('.js'));
    for (let i = 0; i < Math.min(jsFiles.length, 100); i++) {
      try {
        const content = fs.readFileSync(jsFiles[i], 'utf-8');
        if (/require\s*\(\s*['"]express['"]\s*\)|import\s+.*express/i.test(content)) {
          logger.info(`Detected Express require/import in: ${jsFiles[i]}`);
          return true;
        }
      } catch {}
    }

    return false;
  },
};

export default javascriptExpressPlugin;
