/**
 * CodeLens — Express Cross-File Route Prefix Resolver
 *
 * Scans Express files and builds a directed graph of router mounts.
 * Resolves the complete mount prefix(es) for each source file.
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * Resolves all cross-file prefixes for Express routers.
 * Returns a Map: absoluteFilePath → Array of ComposedPrefixes
 */
export function resolveExpressPrefixes(
  files: string[],
  workspaceRoot: string
): Map<string, string[]> {
  const filePrefixes = new Map<string, string[]>(); // absoluteFilePath -> list of prefixes
  const fileImports = new Map<string, Map<string, string>>(); // absoluteFilePath -> Map<localVar, resolvedFilePath>
  const fileMounts = new Map<string, Array<{ localVar: string, prefix: string }>>(); // absoluteFilePath -> list of mounts
  const rootFiles = new Set<string>(); // Files that aren't imported by any other file (likely app.ts/server.ts)

  // 1. Scan each file to find imports/requires and mounts
  for (const filePath of files) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const dir = path.dirname(filePath);

      const imports = new Map<string, string>();
      const mounts: Array<{ localVar: string, prefix: string }> = [];

      // A. Extract CommonJS require
      const requireRegex = /(?:const|let|var)\s+(\w+)\s*=\s*require\(\s*(['"])(.*?)\2\s*\)/g;
      let match;
      while ((match = requireRegex.exec(content)) !== null) {
        const localVar = match[1];
        const importPath = match[3];
        const resolved = resolveModulePath(dir, importPath, files);
        if (resolved) {
          imports.set(localVar, resolved);
        }
      }

      // B. Extract ES Imports
      const esImportRegex = /import\s+(?:(\w+)|\*\s+as\s+(\w+))\s+from\s*(['"])(.*?)\3/g;
      while ((match = esImportRegex.exec(content)) !== null) {
        const localVar = match[1] || match[2];
        const importPath = match[4];
        const resolved = resolveModulePath(dir, importPath, files);
        if (resolved) {
          imports.set(localVar, resolved);
        }
      }

      // C. Extract mounts: .use('/prefix', routerVar)
      const mountWithPrefixRegex = /\.use\(\s*(['"])(.*?)\1\s*,\s*(\w+)\s*\)/g;
      while ((match = mountWithPrefixRegex.exec(content)) !== null) {
        const prefix = match[2];
        const localVar = match[3];
        mounts.push({ localVar, prefix: '/' + prefix.replace(/^\/+|\/+$/g, '') });
      }

      // D. Extract mounts: .use(routerVar) -> prefix is "/"
      const mountWithoutPrefixRegex = /\.use\(\s*(\w+)\s*\)/g;
      while ((match = mountWithoutPrefixRegex.exec(content)) !== null) {
        const localVar = match[1];
        // skip if it's a string literal or middleware function like express.json
        if (localVar !== 'express' && localVar !== 'cors' && !content.includes(`function ${localVar}`)) {
          mounts.push({ localVar, prefix: '/' });
        }
      }

      fileImports.set(filePath, imports);
      fileMounts.set(filePath, mounts);
    } catch {
      // ignore read errors
    }
  }

  // Helper to resolve local import path to absolute file path in files list
  function resolveModulePath(dir: string, importPath: string, allFiles: string[]): string | undefined {
    if (!importPath.startsWith('.')) return undefined; // skip node_modules
    
    // Resolve absolute path candidate
    const resolvedBase = path.resolve(dir, importPath);
    const extensions = ['.ts', '.js', '.tsx', '.jsx', '/index.ts', '/index.js'];
    
    for (const ext of extensions) {
      const candidate = resolvedBase + ext;
      const resolvedCandidate = path.resolve(candidate);
      if (allFiles.includes(resolvedCandidate)) {
        return resolvedCandidate;
      }
    }
    
    return undefined;
  }

  // 2. Build the mount graph: childFile -> parentFile with prefix
  const mountGraph = new Map<string, Array<{ parent: string, prefix: string }>>();
  const allTargetFiles = new Set<string>();

  for (const [parentFile, mounts] of fileMounts.entries()) {
    const imports = fileImports.get(parentFile);
    if (!imports) continue;

    for (const mount of mounts) {
      const childFile = imports.get(mount.localVar);
      if (childFile) {
        allTargetFiles.add(childFile);
        if (!mountGraph.has(childFile)) {
          mountGraph.set(childFile, []);
        }
        mountGraph.get(childFile)!.push({ parent: parentFile, prefix: mount.prefix });
      }
    }
  }

  // Files that aren't mounted by any other file are "roots" (like app.ts / server.ts)
  for (const file of files) {
    if (!allTargetFiles.has(file)) {
      rootFiles.add(file);
      filePrefixes.set(file, ['']); // root files have prefix ""
    }
  }

  // 3. Compute final prefixes recursively using BFS/DFS
  const queue = Array.from(rootFiles);
  const visited = new Set<string>(queue);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentPrefixes = filePrefixes.get(current) || [''];

    // Find all children mounted by current
    const imports = fileImports.get(current);
    const mounts = fileMounts.get(current);

    if (imports && mounts) {
      for (const mount of mounts) {
        const childFile = imports.get(mount.localVar);
        if (childFile) {
          // Compute child prefixes: combine each parent prefix with this mount's prefix
          const childPrefixes: string[] = [];
          for (const parentPrefix of currentPrefixes) {
            const combined = (parentPrefix + mount.prefix).replace(/\/+/g, '/').replace(/\/$/, '');
            childPrefixes.push(combined || '/');
          }

          // Merge with existing prefixes for childFile if any
          const existing = filePrefixes.get(childFile) || [];
          const merged = Array.from(new Set([...existing, ...childPrefixes]));
          filePrefixes.set(childFile, merged);

          if (!visited.has(childFile)) {
            visited.add(childFile);
            queue.push(childFile);
          }
        }
      }
    }
  }

  // Ensure every scanned file has at least [''] prefix
  for (const file of files) {
    if (!filePrefixes.has(file) || filePrefixes.get(file)!.length === 0) {
      filePrefixes.set(file, ['']);
    }
  }

  return filePrefixes;
}
