/**
 * CodeLens — Express Cross-File Route Prefix Resolver
 *
 * Scans Express files and builds a directed graph of router mounts.
 * Resolves the complete mount prefix(es) for each source file.
 */
/**
 * Resolves all cross-file prefixes for Express routers.
 * Returns a Map: absoluteFilePath → Array of ComposedPrefixes
 */
export declare function resolveExpressPrefixes(files: string[], workspaceRoot: string): Map<string, string[]>;
//# sourceMappingURL=expressPrefixResolver.d.ts.map