/**
 * CodeLens — TypeScript/Express Tier 2 Analyzer
 *
 * Enriches Express endpoint records with response shapes, side effects,
 * and constraints using ts-morph type resolution.
 */

import * as path from 'path';
import * as fs from 'fs';
import { Project, SyntaxKind, Node, SourceFile } from 'ts-morph';
import {
  EndpointRecord,
  ResponseSchemaRecord,
  SideEffectRecord,
  ConstraintRecord,
  ParamRecord,
  RequestBodyRecord,
} from '../../shared/types';
import { UNRESOLVED, ORM_PATTERNS } from '../../shared/constants';
import { unresolvedSchema } from '../../shared/utils';
import { Logger } from '../../shared/logger';
import { resolveTypeToJsonSchema } from '../shared/typescriptAstUtils';

const logger = Logger.create('express-analyzer');

export async function analyzeExpressEndpoints(
  endpoints: EndpointRecord[],
  workspaceRoot: string,
): Promise<EndpointRecord[]> {
  const tsConfigPath = path.join(workspaceRoot, 'tsconfig.json');
  const project = fs.existsSync(tsConfigPath)
    ? new Project({ tsConfigFilePath: tsConfigPath, skipAddingFilesFromTsConfig: true })
    : new Project({ compilerOptions: { allowJs: true } });

  // Load source files for the endpoints
  const sourceFiles = new Set(endpoints.map(ep => path.join(workspaceRoot, ep.sourceFile)));
  for (const f of sourceFiles) {
    if (fs.existsSync(f)) {
      try { project.addSourceFileAtPath(f); } catch { /* ignore */ }
    }
  }

  return endpoints.map(ep => {
    try {
      return analyzeEndpoint(ep, workspaceRoot, project);
    } catch (err) {
      logger.warn(`Failed to analyze endpoint ${ep.method} ${ep.path}`, err);
      return ep;
    }
  });
}

function analyzeEndpoint(
  endpoint: EndpointRecord,
  workspaceRoot: string,
  project: Project,
): EndpointRecord {
  const absPath = path.join(workspaceRoot, endpoint.sourceFile);
  const sf = project.getSourceFile(absPath);
  if (!sf) return endpoint;

  const source = sf.getFullText();
  const responseSchemas: ResponseSchemaRecord[] = [];
  const sideEffects: SideEffectRecord[] = [];
  const constraints: ConstraintRecord[] = [];
  let requestBody = endpoint.requestBody;

  // Detect res.json() / res.send() patterns
  detectResponseSchemas(source, responseSchemas);

  // Detect req.body usage → mark request body
  if (/req\.body/.test(source) && !requestBody) {
    const bodyFields = new Set<string>();
    const bodyRegexes = [
      /req\.body\.(\w+)/g,
      /req\.body\[['"](\w+)['"]\]/g,
    ];
    for (const regex of bodyRegexes) {
      let match;
      while ((match = regex.exec(source)) !== null) {
        bodyFields.add(match[1]);
      }
    }

    if (bodyFields.size > 0) {
      const properties: Record<string, any> = {};
      for (const field of bodyFields) {
        properties[field] = { type: 'string', description: `Request body field: ${field}` };
      }
      requestBody = {
        contentType: 'application/json',
        schema: {
          type: 'object',
          properties,
          required: [],
        },
        required: false,
      };
    } else {
      requestBody = {
        contentType: 'application/json',
        schema: unresolvedSchema('req.body accessed but type not statically resolvable'),
        required: false,
      };
    }
  }

  // Detect query params from req.query access
  const queryParams = detectQueryParams(source, endpoint.params);

  // Detect ORM side effects
  detectOrmSideEffects(source, sideEffects);

  // Default response schema if none detected
  if (responseSchemas.length === 0) {
    responseSchemas.push({
      statusCode: 200,
      contentType: 'application/json',
      schema: unresolvedSchema('Response type not statically determinable'),
    });
  }

  return {
    ...endpoint,
    params: [...endpoint.params, ...queryParams],
    requestBody,
    responseSchemas,
    sideEffects,
    constraints,
  };
}

function detectResponseSchemas(source: string, schemas: ResponseSchemaRecord[]): void {
  // res.json(...)
  if (/res\.json\s*\(/.test(source)) {
    schemas.push({ statusCode: 200, contentType: 'application/json', schema: unresolvedSchema('res.json() call') });
  }

  // res.status(N).json(...)
  const statusJsonRegex = /res\.status\s*\(\s*(\d{3})\s*\)\.(?:json|send)\s*\(/g;
  let match;
  while ((match = statusJsonRegex.exec(source)) !== null) {
    const code = parseInt(match[1], 10);
    if (!schemas.find(s => s.statusCode === code)) {
      schemas.push({ statusCode: code, contentType: 'application/json', schema: unresolvedSchema(`res.status(${code}).json()`) });
    }
  }
}

function detectQueryParams(source: string, existing: ParamRecord[]): ParamRecord[] {
  const params: ParamRecord[] = [];
  const regex = /req\.query\.(\w+)|req\.query\[['"](\w+)['"]\]/g;
  let match;
  while ((match = regex.exec(source)) !== null) {
    const name = match[1] || match[2];
    if (!existing.find(p => p.name === name) && !params.find(p => p.name === name)) {
      params.push({ name, in: 'query', type: 'string', required: false });
    }
  }
  return params;
}

function detectOrmSideEffects(source: string, effects: SideEffectRecord[]): void {
  // TypeORM
  for (const method of ORM_PATTERNS.typeorm.read) {
    if (new RegExp(`\\.${method}\\s*\\(`).test(source)) {
      effects.push({ type: 'database', operation: 'READ', confidence: 'medium' });
      break;
    }
  }
  for (const method of ORM_PATTERNS.typeorm.create) {
    if (new RegExp(`\\.${method}\\s*\\(`).test(source)) {
      effects.push({ type: 'database', operation: 'CREATE', confidence: 'medium' });
      break;
    }
  }
  for (const method of ORM_PATTERNS.typeorm.update) {
    if (new RegExp(`\\.${method}\\s*\\(`).test(source)) {
      effects.push({ type: 'database', operation: 'UPDATE', confidence: 'medium' });
      break;
    }
  }
  for (const method of ORM_PATTERNS.typeorm.delete) {
    if (new RegExp(`\\.${method}\\s*\\(`).test(source)) {
      effects.push({ type: 'database', operation: 'DELETE', confidence: 'medium' });
      break;
    }
  }

  // Prisma
  for (const method of ORM_PATTERNS.prisma.read) {
    if (new RegExp(`prisma\\.\\w+\\.${method}\\s*\\(`).test(source)) {
      if (!effects.find(e => e.operation === 'READ')) {
        effects.push({ type: 'database', operation: 'READ', confidence: 'high' });
      }
    }
  }
  for (const method of ORM_PATTERNS.prisma.create) {
    if (new RegExp(`prisma\\.\\w+\\.${method}\\s*\\(`).test(source)) {
      effects.push({ type: 'database', operation: 'CREATE', confidence: 'high' });
    }
  }
  for (const method of ORM_PATTERNS.prisma.update) {
    if (new RegExp(`prisma\\.\\w+\\.${method}\\s*\\(`).test(source)) {
      effects.push({ type: 'database', operation: 'UPDATE', confidence: 'high' });
    }
  }
  for (const method of ORM_PATTERNS.prisma.delete) {
    if (new RegExp(`prisma\\.\\w+\\.${method}\\s*\\(`).test(source)) {
      effects.push({ type: 'database', operation: 'DELETE', confidence: 'high' });
    }
  }

  // Mongoose
  for (const method of ORM_PATTERNS.mongoose.read) {
    if (new RegExp(`\\.${method}\\s*\\(`).test(source)) {
      if (!effects.find(e => e.operation === 'READ')) {
        effects.push({ type: 'database', operation: 'READ', confidence: 'medium' });
      }
    }
  }
}
