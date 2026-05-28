/**
 * CodeLens — JavaScript/Express Tier 2 Analyzer
 *
 * Pattern-based analysis for plain JS Express files. Uses regex since
 * tree-sitter provides CST only and we cannot do type resolution in JS.
 * Aggressively uses __UNRESOLVED__ since JS lacks type annotations.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  EndpointRecord,
  ResponseSchemaRecord,
  SideEffectRecord,
  ParamRecord,
  RequestBodyRecord,
} from '../../shared/types';
import { ORM_PATTERNS } from '../../shared/constants';
import { unresolvedSchema } from '../../shared/utils';
import { Logger } from '../../shared/logger';

const logger = Logger.create('js-express-analyzer');

export async function analyzeJsExpressEndpoints(
  endpoints: EndpointRecord[],
  workspaceRoot: string,
): Promise<EndpointRecord[]> {
  const sourceCache = new Map<string, string>();

  return endpoints.map(ep => {
    try {
      const absPath = path.join(workspaceRoot, ep.sourceFile);
      let source = sourceCache.get(absPath);
      if (!source) {
        try { source = fs.readFileSync(absPath, 'utf-8'); sourceCache.set(absPath, source); }
        catch { return ep; }
      }

      const responseSchemas: ResponseSchemaRecord[] = detectResponseSchemas(source);
      const sideEffects: SideEffectRecord[] = detectSideEffects(source);
      const queryParams: ParamRecord[] = detectQueryParams(source, ep.params);
      let requestBody: RequestBodyRecord | undefined = ep.requestBody;

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
            schema: unresolvedSchema('req.body — JS cannot statically determine body shape'),
            required: false,
          };
        }
      }

      if (responseSchemas.length === 0) {
        responseSchemas.push({ statusCode: 200, contentType: 'application/json',
          schema: unresolvedSchema('No res.json() pattern detected') });
      }

      return { ...ep, params: [...ep.params, ...queryParams], requestBody, responseSchemas, sideEffects, constraints: [] };
    } catch (err) {
      logger.warn(`Failed to analyze JS endpoint ${ep.method} ${ep.path}`, err);
      return ep;
    }
  });
}

function detectResponseSchemas(source: string): ResponseSchemaRecord[] {
  const schemas: ResponseSchemaRecord[] = [];
  if (/res\.json\s*\(/.test(source)) {
    schemas.push({ statusCode: 200, contentType: 'application/json',
      schema: unresolvedSchema('res.json() — object shape not resolvable in plain JS') });
  }
  const statusRegex = /res\.status\s*\(\s*(\d{3})\s*\)\./g;
  let match;
  while ((match = statusRegex.exec(source)) !== null) {
    const code = parseInt(match[1], 10);
    if (!schemas.find(s => s.statusCode === code)) {
      schemas.push({ statusCode: code, contentType: 'application/json',
        schema: unresolvedSchema(`res.status(${code}) response`) });
    }
  }
  return schemas;
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

function detectSideEffects(source: string): SideEffectRecord[] {
  const effects: SideEffectRecord[] = [];
  // Mongoose
  for (const method of ORM_PATTERNS.mongoose.read) {
    if (new RegExp(`\\.${method}\\s*\\(`).test(source)) {
      effects.push({ type: 'database', operation: 'READ', confidence: 'medium' }); break;
    }
  }
  for (const method of ORM_PATTERNS.mongoose.create) {
    if (new RegExp(`\\.${method}\\s*\\(`).test(source)) {
      effects.push({ type: 'database', operation: 'CREATE', confidence: 'medium' }); break;
    }
  }
  for (const method of ORM_PATTERNS.mongoose.delete) {
    if (new RegExp(`\\.${method}\\s*\\(`).test(source)) {
      effects.push({ type: 'database', operation: 'DELETE', confidence: 'medium' }); break;
    }
  }
  // Prisma
  for (const method of ORM_PATTERNS.prisma.read) {
    if (new RegExp(`prisma\\.\\w+\\.${method}\\s*\\(`).test(source)) {
      if (!effects.find(e => e.operation === 'READ'))
        effects.push({ type: 'database', operation: 'READ', confidence: 'high' });
    }
  }
  return effects;
}
