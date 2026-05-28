/**
 * CodeLens — Python Cross-File Route Prefix Resolver
 *
 * Scans all Python files to resolve APIRouter (FastAPI) and Blueprint (Flask)
 * mount prefixes. Maps each file's router variables to their final composed paths.
 */

import * as fs from 'fs';
import * as path from 'path';
import Parser from 'web-tree-sitter';
import { findNodesByType, stripQuotes } from './pythonAstUtils';
import { toRelativePath } from '../../shared/utils';
import { Logger } from '../../shared/logger';

const logger = Logger.create('PythonPrefixResolver');

interface ImportRecord {
  importedVar: string;     // the local name in the file (e.g. "users_router" or "users")
  sourceModule: string;    // the module imported from (e.g. "app.routers.users")
  originalSymbol?: string; // the symbol imported, if from import (e.g. "router")
}

interface CreationRecord {
  varName: string;
  prefix: string; // e.g. "/v1"
}

interface MountRecord {
  expr: string;   // e.g. "users_router" or "users.router"
  prefix: string; // e.g. "/users"
}

/**
 * Resolves all cross-file prefixes for APIRouters and Blueprints.
 * Returns a Map: FilePath → Map<RouterVariableName, ComposedPrefix>
 */
export async function resolvePythonPrefixes(
  files: string[],
  workspaceRoot: string,
  parser: Parser
): Promise<Map<string, Map<string, string>>> {
  const result = new Map<string, Map<string, string>>();

  // 1. Map python module names to absolute file paths
  const moduleToPathMap = new Map<string, string>();
  for (const f of files) {
    const rel = toRelativePath(f, workspaceRoot);
    let mod = rel.replace(/\.py$/, '').replace(/\\/g, '/').replace(/\//g, '.');
    if (mod.endsWith('.__init__')) {
      mod = mod.slice(0, -9);
    }
    moduleToPathMap.set(mod, f);
  }

  // 2. Scan each file for imports, creations, and mounts
  const fileCreations = new Map<string, CreationRecord[]>();
  const fileMounts = new Map<string, MountRecord[]>();
  const fileImports = new Map<string, ImportRecord[]>();

  for (const filePath of files) {
    try {
      const source = fs.readFileSync(filePath, 'utf-8');
      const tree = parser.parse(source);

      const creations: CreationRecord[] = [];
      const mounts: MountRecord[] = [];
      const imports: ImportRecord[] = [];

      // Find assignments (Router / Blueprint creation)
      const assignments = findNodesByType(tree.rootNode, 'assignment');
      for (const node of assignments) {
        const left = node.childForFieldName('left');
        const right = node.childForFieldName('right');
        if (!left || !right) continue;

        const leftText = left.text.trim();
        const rightText = right.text.trim();

        // Match router = APIRouter(prefix="/v1")
        if (rightText.includes('APIRouter(')) {
          const prefixMatch = rightText.match(/prefix\s*=\s*(['"])(.*?)\1/);
          const prefix = prefixMatch ? prefixMatch[2] : '';
          creations.push({ varName: leftText, prefix: '/' + prefix.replace(/^\/+|\/+$/g, '') });
        }
        // Match bp = Blueprint('auth', __name__, url_prefix="/auth")
        else if (rightText.includes('Blueprint(')) {
          const prefixMatch = rightText.match(/url_prefix\s*=\s*(['"])(.*?)\1/);
          const prefix = prefixMatch ? prefixMatch[2] : '';
          creations.push({ varName: leftText, prefix: '/' + prefix.replace(/^\/+|\/+$/g, '') });
        }
      }

      // Find call expressions (router include / blueprint register)
      const calls = findNodesByType(tree.rootNode, 'call');
      for (const call of calls) {
        const fnNode = call.childForFieldName('function');
        if (!fnNode) continue;
        const fnText = fnNode.text;

        const isInclude = fnText.endsWith('include_router');
        const isRegister = fnText.endsWith('register_blueprint');

        if (isInclude || isRegister) {
          const argsNode = call.childForFieldName('arguments');
          if (!argsNode) continue;

          const argsText = argsNode.text;
          const argList = argsNode.namedChildren;
          if (argList.length === 0) continue;

          // First argument is the router/blueprint variable expression
          const expr = argList[0].text.trim();

          // Extract prefix or url_prefix keyword argument
          let prefix = '';
          const prefixMatch = argsText.match(/prefix\s*=\s*(['"])(.*?)\1/);
          const urlPrefixMatch = argsText.match(/url_prefix\s*=\s*(['"])(.*?)\1/);

          if (isInclude && prefixMatch) {
            prefix = prefixMatch[2];
          } else if (isRegister && urlPrefixMatch) {
            prefix = urlPrefixMatch[2];
          } else if (isRegister && prefixMatch) { // fallback
            prefix = prefixMatch[2];
          }

          mounts.push({
            expr,
            prefix: '/' + prefix.replace(/^\/+|\/+$/g, ''),
          });
        }
      }

      // Find import statements
      const importNodes = findNodesByType(tree.rootNode, 'import_statement');
      for (const imp of importNodes) {
        const text = imp.text.trim();
        const match = text.match(/^import\s+(.+)$/);
        if (match) {
          const parts = match[1].split(',');
          for (const part of parts) {
            const aliasMatch = part.match(/^([\w.]+)\s+as\s+(\w+)$/);
            if (aliasMatch) {
              imports.push({ importedVar: aliasMatch[2], sourceModule: aliasMatch[1] });
            } else {
              const dotted = part.trim();
              const lastPart = dotted.split('.').pop() || '';
              imports.push({ importedVar: lastPart, sourceModule: dotted });
            }
          }
        }
      }

      // Find from-import statements
      const importFromNodes = findNodesByType(tree.rootNode, 'import_from_statement');
      for (const imp of importFromNodes) {
        const text = imp.text.trim();
        // matches: from <module> import <symbol> [as <alias>]
        const match = text.match(/^from\s+([\w.]+)\s+import\s+(.+)$/);
        if (match) {
          const sourceModule = match[1];
          const symbolsStr = match[2].replace(/[()]/g, ''); // strip parentheses if any
          const symbols = symbolsStr.split(',');

          for (const sym of symbols) {
            const trimmedSym = sym.trim();
            if (!trimmedSym) continue;

            const aliasMatch = trimmedSym.match(/^(\w+)\s+as\s+(\w+)$/);
            if (aliasMatch) {
              imports.push({
                importedVar: aliasMatch[2],
                sourceModule,
                originalSymbol: aliasMatch[1],
              });
            } else {
              imports.push({
                importedVar: trimmedSym,
                sourceModule,
                originalSymbol: trimmedSym,
              });
            }
          }
        }
      }

      fileCreations.set(filePath, creations);
      fileMounts.set(filePath, mounts);
      fileImports.set(filePath, imports);
    } catch (err) {
      logger.warn(`Failed to pre-scan prefixes for ${filePath}`, err);
    }
  }

  // Helper to resolve module path relative to current file path
  function resolveImportedFile(
    currentFile: string,
    importedModule: string
  ): string | undefined {
    // If it's absolute, look up directly
    if (moduleToPathMap.has(importedModule)) {
      return moduleToPathMap.get(importedModule);
    }

    // Try relative import resolution
    const currentRel = toRelativePath(currentFile, workspaceRoot);
    const currentParts = currentRel.replace(/\.py$/, '').split(/[\\/]/);
    currentParts.pop(); // remove file name to get dir module path

    const leadingDots = importedModule.match(/^\.+/);
    if (leadingDots) {
      const dotCount = leadingDots[0].length;
      // . means same folder, .. means parent, etc.
      // Python: from . import foo -> dotCount = 1 -> currentParts unchanged
      // from .. import bar -> dotCount = 2 -> pop 1 part
      for (let i = 1; i < dotCount; i++) {
        currentParts.pop();
      }
      const rest = importedModule.slice(dotCount);
      const composedModule = [...currentParts, rest].filter(Boolean).join('.');
      if (moduleToPathMap.has(composedModule)) {
        return moduleToPathMap.get(composedModule);
      }
    }

    // Heuristic: check if the module name matches the end of any file in the workspace
    // e.g. "routers.items" matches "app/routers/items.py"
    const dottedEnd = '.' + importedModule;
    for (const [mod, path] of moduleToPathMap.entries()) {
      if (mod.endsWith(dottedEnd) || mod === importedModule) {
        return path;
      }
    }

    return undefined;
  }

  // 3. Resolve all mounts globally
  const resolvedPrefixes = new Map<string, Map<string, string>>();

  for (const [filePath, mounts] of fileMounts.entries()) {
    const imports = fileImports.get(filePath) || [];

    for (const mount of mounts) {
      let targetFile: string | undefined;
      let targetVar = 'router';

      const expr = mount.expr;

      if (expr.includes('.')) {
        // e.g., "items.router"
        const [objName, propName] = expr.split('.');
        targetVar = propName;

        const imp = imports.find(i => i.importedVar === objName);
        if (imp) {
          targetFile = resolveImportedFile(filePath, imp.sourceModule);
        }
      } else {
        // e.g., "items_router"
        const imp = imports.find(i => i.importedVar === expr);
        if (imp) {
          targetFile = resolveImportedFile(filePath, imp.sourceModule);
          targetVar = imp.originalSymbol || 'router';
        } else {
          // It might be a locally defined router being mounted in the same file
          targetFile = filePath;
          targetVar = expr;
        }
      }

      if (targetFile) {
        if (!resolvedPrefixes.has(targetFile)) {
          resolvedPrefixes.set(targetFile, new Map());
        }
        // Save the mount prefix for this variable in the target file
        const varPrefixes = resolvedPrefixes.get(targetFile)!;
        varPrefixes.set(targetVar, mount.prefix);
      }
    }
  }

  // 4. Combine mount prefix and creation prefix for each variable in each file
  for (const f of files) {
    const creations = fileCreations.get(f) || [];
    const mountMap = resolvedPrefixes.get(f) || new Map();

    const fileFinalPrefixes = new Map<string, string>();

    for (const creation of creations) {
      const mountPrefix = mountMap.get(creation.varName) || '';
      // Composed prefix: mount prefix + creation prefix
      const composed = (mountPrefix + creation.prefix).replace(/\/+/g, '/').replace(/\/$/, '');
      fileFinalPrefixes.set(creation.varName, composed || '/');
    }

    result.set(f, fileFinalPrefixes);
  }

  return result;
}
