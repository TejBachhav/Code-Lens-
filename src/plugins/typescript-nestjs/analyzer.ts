/**
 * CodeLens — TypeScript/NestJS Tier 2 Analyzer
 *
 * Resolves NestJS DTO classes to JSON Schema, extracts class-validator
 * constraints, and detects ORM side effects.
 */

import * as path from 'path';
import * as fs from 'fs';
import { Project, ClassDeclaration, Decorator } from 'ts-morph';
import {
  EndpointRecord,
  ResponseSchemaRecord,
  SideEffectRecord,
  ConstraintRecord,
  JsonSchema,
} from '../../shared/types';
import { ORM_PATTERNS } from '../../shared/constants';
import { unresolvedSchema } from '../../shared/utils';
import { Logger } from '../../shared/logger';
import { resolveTypeToJsonSchema, unwrapPromiseType } from '../shared/typescriptAstUtils';

const logger = Logger.create('nestjs-analyzer');

/** class-validator decorators that imply constraints */
const VALIDATOR_DECORATORS = [
  'IsString', 'IsInt', 'IsNumber', 'IsBoolean', 'IsEmail', 'IsUrl',
  'IsDate', 'IsUUID', 'IsOptional', 'IsNotEmpty', 'MinLength', 'MaxLength',
  'Min', 'Max', 'IsEnum', 'IsArray', 'ValidateNested', 'IsPositive',
];

export async function analyzeNestJsEndpoints(
  endpoints: EndpointRecord[],
  workspaceRoot: string,
): Promise<EndpointRecord[]> {
  const tsConfigPath = path.join(workspaceRoot, 'tsconfig.json');
  const project = fs.existsSync(tsConfigPath)
    ? new Project({ tsConfigFilePath: tsConfigPath, skipAddingFilesFromTsConfig: true })
    : new Project({ compilerOptions: { experimentalDecorators: true } });

  const sourceFiles = new Set(endpoints.map(ep => path.join(workspaceRoot, ep.sourceFile)));
  for (const f of sourceFiles) {
    if (fs.existsSync(f)) {
      try { project.addSourceFileAtPath(f); } catch { /* ignore */ }
    }
  }

  // Build a global DTO class map for cross-file resolution
  const dtoMap = new Map<string, ClassDeclaration>();
  for (const sf of project.getSourceFiles()) {
    for (const cls of sf.getClasses()) {
      dtoMap.set(cls.getName() ?? '', cls);
    }
  }

  return endpoints.map(ep => {
    try {
      return analyzeEndpoint(ep, workspaceRoot, project, dtoMap);
    } catch (err) {
      logger.warn(`Failed to analyze NestJS endpoint ${ep.method} ${ep.path}`, err);
      return ep;
    }
  });
}

function analyzeEndpoint(
  endpoint: EndpointRecord,
  workspaceRoot: string,
  project: Project,
  dtoMap: Map<string, ClassDeclaration>,
): EndpointRecord {
  const absPath = path.join(workspaceRoot, endpoint.sourceFile);
  const sf = project.getSourceFile(absPath);

  const responseSchemas: ResponseSchemaRecord[] = endpoint.responseSchemas ? [...endpoint.responseSchemas] : [];
  const sideEffects: SideEffectRecord[] = [];
  const constraints: ConstraintRecord[] = [];
  let requestBody = endpoint.requestBody;

  // Resolve request body DTO type → JSON Schema
  if (requestBody?.typeName) {
    const dtoClass = dtoMap.get(requestBody.typeName);
    if (dtoClass) {
      const schema = dtoClassToJsonSchema(dtoClass);
      const dtoConstraints = extractDtoConstraints(dtoClass, requestBody.typeName);
      requestBody = { ...requestBody, schema };
      constraints.push(...dtoConstraints);
    }
  }

  // Resolve response DTO → JSON Schema
  for (let i = 0; i < responseSchemas.length; i++) {
    const rs = responseSchemas[i];
    if (typeof rs.schema === 'string') continue; // already unresolved sentinel
    const desc = rs.schema?.description ?? '';
    const dtoMatch = desc.match(/DTO:\s*(\w+)/);
    if (dtoMatch) {
      const dtoClass = dtoMap.get(dtoMatch[1]);
      if (dtoClass) {
        responseSchemas[i] = { ...rs, schema: dtoClassToJsonSchema(dtoClass) };
      }
    }
  }

  // Side effects from source patterns
  if (sf) {
    const source = sf.getFullText();
    detectNestSideEffects(source, sideEffects);
  }

  return { ...endpoint, requestBody, responseSchemas, sideEffects, constraints };
}

// ─── DTO → JSON Schema ────────────────────────────────────────────────────────

function dtoClassToJsonSchema(cls: ClassDeclaration): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];

  for (const prop of cls.getProperties()) {
    const name = prop.getName();
    const isOptional = prop.hasQuestionToken() || prop.getDecorator('IsOptional') !== undefined;

    if (!isOptional) required.push(name);

    let typeStr = 'string';
    try {
      const type = prop.getType();
      const text = type.getText();
      if (text === 'number' || text === 'bigint') typeStr = 'number';
      else if (text === 'boolean') typeStr = 'boolean';
      else if (text.startsWith('string')) typeStr = 'string';
      else typeStr = 'object'; // complex type
    } catch { /* ignore */ }

    const propSchema: JsonSchema = { type: typeStr };

    // Add format hints from class-validator
    const emailDec = prop.getDecorator('IsEmail');
    if (emailDec) propSchema.format = 'email';

    const uuidDec = prop.getDecorator('IsUUID');
    if (uuidDec) propSchema.format = 'uuid';

    const minLen = prop.getDecorator('MinLength');
    if (minLen) {
      const val = parseInt(minLen.getArguments()[0]?.getText() ?? '0', 10);
      propSchema.minLength = val;
    }

    const maxLen = prop.getDecorator('MaxLength');
    if (maxLen) {
      const val = parseInt(maxLen.getArguments()[0]?.getText() ?? '0', 10);
      propSchema.maxLength = val;
    }

    properties[name] = propSchema;
  }

  return {
    type: 'object',
    properties,
    required: required.length > 0 ? required : undefined,
  };
}

function extractDtoConstraints(cls: ClassDeclaration, dtoName: string): ConstraintRecord[] {
  const constraints: ConstraintRecord[] = [];

  for (const prop of cls.getProperties()) {
    const propName = prop.getName();
    for (const dec of prop.getDecorators()) {
      const decName = dec.getName();
      if (VALIDATOR_DECORATORS.includes(decName)) {
        const args = dec.getArguments().map(a => a.getText()).join(', ');
        constraints.push({
          type: 'validation',
          description: `${dtoName}.${propName}: @${decName}(${args})`,
          source: `class-validator decorator in ${dtoName}`,
        });
      }
    }
  }

  return constraints;
}

function detectNestSideEffects(source: string, effects: SideEffectRecord[]): void {
  // TypeORM Repository patterns
  for (const method of ORM_PATTERNS.typeorm.read) {
    if (new RegExp(`this\\.\\w+Repository\\.${method}|this\\.\\w+\\.${method}\\s*\\(`).test(source)) {
      if (!effects.find(e => e.operation === 'READ')) {
        effects.push({ type: 'database', operation: 'READ', confidence: 'high' });
      }
    }
  }
  for (const method of ORM_PATTERNS.typeorm.create) {
    if (new RegExp(`this\\.\\w+Repository\\.${method}|this\\.\\w+\\.${method}\\s*\\(`).test(source)) {
      effects.push({ type: 'database', operation: 'CREATE', confidence: 'high' });
    }
  }
  for (const method of ORM_PATTERNS.typeorm.update) {
    if (new RegExp(`this\\.\\w+Repository\\.${method}\\s*\\(`).test(source)) {
      if (!effects.find(e => e.operation === 'UPDATE')) {
        effects.push({ type: 'database', operation: 'UPDATE', confidence: 'high' });
      }
    }
  }
  for (const method of ORM_PATTERNS.typeorm.delete) {
    if (new RegExp(`this\\.\\w+Repository\\.${method}\\s*\\(`).test(source)) {
      effects.push({ type: 'database', operation: 'DELETE', confidence: 'high' });
    }
  }

  // Prisma
  for (const method of ORM_PATTERNS.prisma.read) {
    if (new RegExp(`this\\.prisma\\.\\w+\\.${method}\\s*\\(`).test(source)) {
      if (!effects.find(e => e.operation === 'READ')) {
        effects.push({ type: 'database', operation: 'READ', confidence: 'high' });
      }
    }
  }
}
