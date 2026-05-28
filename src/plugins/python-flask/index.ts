import * as fs from 'fs';
import * as path from 'path';
import { LanguagePlugin, EndpointRecord } from '../../shared/types';
import { scanFlaskFiles } from './scanner';
import { analyzeFlaskEndpoints } from './analyzer';
import { Logger } from '../../shared/logger';
import { findFilesRecursively } from '../../shared/utils';

const logger = Logger.create('plugin:python-flask');

const pythonFlaskPlugin: LanguagePlugin = {
  id: 'python-flask',
  language: 'python',
  framework: 'flask',
  filePatterns: ['**/*.py'],

  async scan(files: string[], workspaceRoot: string): Promise<EndpointRecord[]> {
    logger.info(`Scanning ${files.length} Python/Flask files`);
    return scanFlaskFiles(files, workspaceRoot);
  },

  async analyze(endpoints: EndpointRecord[], workspaceRoot: string): Promise<EndpointRecord[]> {
    logger.info(`Analyzing ${endpoints.length} Flask endpoints`);
    return analyzeFlaskEndpoints(endpoints, workspaceRoot);
  },

  async detect(workspaceRoot: string, fileMap?: Map<string, string[]>): Promise<boolean> {
    // 1. Check requirements.txt, pyproject.toml, setup.py files recursively
    const configFiles = findFilesRecursively(workspaceRoot, (name) =>
      ['requirements.txt', 'pyproject.toml', 'setup.py'].includes(name)
    );

    for (const file of configFiles) {
      try {
        const content = fs.readFileSync(file, 'utf-8').toLowerCase();
        if (content.includes('flask')) {
          logger.info(`Detected Flask in configuration file: ${file}`);
          return true;
        }
      } catch {}
    }

    // 2. Check for flask imports in Python files recursively
    const pyFiles = fileMap?.get('python') || findFilesRecursively(workspaceRoot, (name) => name.endsWith('.py'));
    // Scan up to 100 files to avoid missing imports in larger or nested projects
    for (let i = 0; i < Math.min(pyFiles.length, 100); i++) {
      try {
        const content = fs.readFileSync(pyFiles[i], 'utf-8');
        if (/from\s+flask\s+import|import\s+flask/i.test(content)) {
          logger.info(`Detected Flask import in: ${pyFiles[i]}`);
          return true;
        }
      } catch {}
    }

    return false;
  },
};

export default pythonFlaskPlugin;
