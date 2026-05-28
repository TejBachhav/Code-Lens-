/**
 * CodeLens — Shared TypeScript AST Utilities
 *
 * ts-morph based helpers for traversing TypeScript/JavaScript ASTs.
 * Used by typescript-express and typescript-nestjs plugins.
 */

import {
  Type,
  Decorator,
  SourceFile,
  ClassDeclaration,
  MethodDeclaration,
  Node,
  SyntaxKind,
  PropertyDeclaration,
  PropertySignature,
  Symbol as TsSymbol,
} from 'ts-morph';
import { JsonSchema } from '../../shared/types';
import { TYPESCRIPT_TYPE_MAP, UNRESOLVED } from '../../shared/constants';
import { Logger } from '../../shared/logger';

const logger = Logger.create('TypescriptAstUtils');

// ─── Type Resolution ─────────────────────────────────────────────────────────

/**
 * Convert a ts-morph Type to a JSON Schema representation.
 *
 * Handles primitives, interfaces, classes, arrays, unions, intersections,
 * enums, literals, and mapped types. Falls back to __UNRESOLVED__ for
 * types that cannot be statically determined.
 *
 * @param type - The ts-morph Type to resolve
 * @param visited - Set of type IDs already visited (to prevent infinite recursion)
 * @returns A JsonSchema representation
 */
export function resolveTypeToJsonSchema(
  type: Type,
  visited: Set<string> = new Set()
): JsonSchema {
  try {
    const typeText = type.getText();

    // Prevent infinite recursion on circular types
    const typeId = typeText;
    if (visited.has(typeId)) {
      return { $ref: `#/definitions/${typeText}` };
    }
    visited.add(typeId);

    // Check for primitive types
    if (type.isString() || type.isStringLiteral()) {
      const schema: JsonSchema = { type: 'string' };
      if (type.isStringLiteral()) {
        schema.enum = [type.getLiteralValue()];
      }
      return schema;
    }

    if (type.isNumber() || type.isNumberLiteral()) {
      const schema: JsonSchema = { type: 'number' };
      if (type.isNumberLiteral()) {
        schema.enum = [type.getLiteralValue()];
      }
      return schema;
    }

    if (type.isBoolean() || type.isBooleanLiteral()) {
      return { type: 'boolean' };
    }

    if (type.isNull() || type.isUndefined()) {
      return { type: 'null', nullable: true };
    }

    if (type.isAny() || type.isUnknown()) {
      return { type: 'object', description: UNRESOLVED };
    }

    // Void type
    if (typeText === 'void') {
      return { type: 'null' };
    }

    // Array types
    if (type.isArray()) {
      const elementType = type.getArrayElementType();
      return {
        type: 'array',
        items: elementType
          ? resolveTypeToJsonSchema(elementType, new Set(visited))
          : { type: 'object' },
      };
    }

    // Tuple types
    if (type.isTuple()) {
      const tupleTypes = type.getTupleElements();
      return {
        type: 'array',
        items: {
          oneOf: tupleTypes.map((t) =>
            resolveTypeToJsonSchema(t, new Set(visited))
          ),
        },
      };
    }

    // Union types
    if (type.isUnion()) {
      const unionTypes = type.getUnionTypes();
      // Check if it's a nullable type (T | null | undefined)
      const nonNullTypes = unionTypes.filter(
        (t) => !t.isNull() && !t.isUndefined()
      );
      const isNullable = nonNullTypes.length < unionTypes.length;

      if (nonNullTypes.length === 1) {
        const schema = resolveTypeToJsonSchema(
          nonNullTypes[0],
          new Set(visited)
        );
        if (isNullable) schema.nullable = true;
        return schema;
      }

      // Check for string literal union (enum)
      if (nonNullTypes.every((t) => t.isStringLiteral())) {
        const schema: JsonSchema = {
          type: 'string',
          enum: nonNullTypes.map((t) => t.getLiteralValue()),
        };
        if (isNullable) schema.nullable = true;
        return schema;
      }

      const schema: JsonSchema = {
        oneOf: nonNullTypes.map((t) =>
          resolveTypeToJsonSchema(t, new Set(visited))
        ),
      };
      if (isNullable) schema.nullable = true;
      return schema;
    }

    // Intersection types
    if (type.isIntersection()) {
      return {
        allOf: type
          .getIntersectionTypes()
          .map((t) => resolveTypeToJsonSchema(t, new Set(visited))),
      };
    }

    // Enum types
    if (type.isEnum()) {
      const enumDecl = type.getSymbol()?.getDeclarations()[0];
      if (enumDecl && Node.isEnumDeclaration(enumDecl)) {
        const members = enumDecl.getMembers();
        const values = members.map((m) => {
          const val = m.getValue();
          return val !== undefined ? val : m.getName();
        });
        return {
          type: typeof values[0] === 'number' ? 'number' : 'string',
          enum: values,
        };
      }
    }

    // Object types (interfaces, classes, type literals)
    if (type.isObject()) {
      return resolveObjectType(type, visited);
    }

    // Fall back to type map
    const mapped = TYPESCRIPT_TYPE_MAP[typeText];
    if (mapped) {
      return { type: mapped };
    }

    // Completely unresolvable
    return {
      type: 'object',
      description: `${UNRESOLVED}: ${typeText}`,
    };
  } catch (error) {
    logger.warn('Failed to resolve type to JSON Schema', { error: String(error) });
    return {
      type: 'object',
      description: `${UNRESOLVED}: resolution failed`,
    };
  }
}

/**
 * Resolve an object type (interface, class, or type literal) to JSON Schema.
 */
function resolveObjectType(type: Type, visited: Set<string>): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];

  const typeSymbol = type.getSymbol() || type.getAliasSymbol();
  const typeText = type.getText();

  // Handle Promise, Observable, etc. — unwrap automatically
  if (typeText.startsWith('Promise<') || typeText.startsWith('Observable<')) {
    const typeArgs = type.getTypeArguments();
    if (typeArgs.length > 0) {
      return resolveTypeToJsonSchema(typeArgs[0], new Set(visited));
    }
  }

  // Handle Record<K,V>, Map<K,V>, etc.
  if (typeText.startsWith('Record<') || typeText.startsWith('Map<')) {
    const typeArgs = type.getTypeArguments();
    if (typeArgs.length === 2) {
      return {
        type: 'object',
        additionalProperties: resolveTypeToJsonSchema(
          typeArgs[1],
          new Set(visited)
        ),
      };
    }
  }

  // Handle Date
  if (typeText === 'Date') {
    return { type: 'string', format: 'date-time' };
  }

  // Iterate over properties of the type
  const props = type.getProperties();
  for (const prop of props) {
    const propName = prop.getName();

    // Skip internal properties
    if (propName.startsWith('_')) continue;

    const declarations = prop.getDeclarations();
    const decl = declarations[0];

    if (!decl) continue;

    let propType: Type | undefined;
    if (Node.isPropertyDeclaration(decl) || Node.isPropertySignature(decl)) {
      propType = decl.getType();

      // Check if required (no question token and no undefined in union)
      if (!decl.hasQuestionToken()) {
        required.push(propName);
      }
    } else {
      propType = prop.getTypeAtLocation(decl);
    }

    if (propType) {
      properties[propName] = resolveTypeToJsonSchema(
        propType,
        new Set(visited)
      );
    }
  }

  const schema: JsonSchema = { type: 'object', properties };
  if (required.length > 0) {
    schema.required = required;
  }

  return schema;
}

// ─── Decorator Helpers ───────────────────────────────────────────────────────

/**
 * Extract argument values from a ts-morph Decorator.
 *
 * @param decorator - The ts-morph Decorator node
 * @returns Array of argument value strings
 */
export function extractDecoratorArguments(decorator: Decorator): string[] {
  const args = decorator.getArguments();
  return args.map((arg) => {
    // Try to evaluate literal values
    const text = arg.getText();
    return text;
  });
}

/**
 * Get the first string argument from a decorator (common for route paths).
 */
export function getDecoratorStringArg(decorator: Decorator): string | undefined {
  const args = decorator.getArguments();
  if (args.length === 0) return undefined;

  const firstArg = args[0];
  const text = firstArg.getText();

  // Strip quotes from string literals
  if (
    (text.startsWith("'") && text.endsWith("'")) ||
    (text.startsWith('"') && text.endsWith('"'))
  ) {
    return text.slice(1, -1);
  }

  // Template literals
  if (text.startsWith('`') && text.endsWith('`')) {
    return text.slice(1, -1);
  }

  return text;
}

// ─── Generic Type Unwrapping ─────────────────────────────────────────────────

/**
 * Unwrap Promise<T> or Observable<T> to get the inner type T.
 *
 * @param type - The ts-morph Type
 * @returns The unwrapped inner type, or the original type if not a wrapper
 */
export function unwrapPromiseType(type: Type): Type {
  const typeText = type.getText();

  if (
    typeText.startsWith('Promise<') ||
    typeText.startsWith('Observable<') ||
    typeText.startsWith('Awaited<')
  ) {
    const typeArgs = type.getTypeArguments();
    if (typeArgs.length > 0) {
      // Recursively unwrap nested wrappers
      return unwrapPromiseType(typeArgs[0]);
    }
  }

  return type;
}

// ─── Class & Decorator Finder ────────────────────────────────────────────────

/**
 * Find all classes in a source file that have a specific decorator.
 *
 * @param sourceFile - The ts-morph SourceFile
 * @param decoratorName - The decorator name to search for (e.g., "Controller")
 * @returns Array of ClassDeclaration nodes
 */
export function findClassesWithDecorator(
  sourceFile: SourceFile,
  decoratorName: string
): ClassDeclaration[] {
  return sourceFile.getClasses().filter((cls) => {
    return cls.getDecorators().some((d) => d.getName() === decoratorName);
  });
}

/**
 * Find all methods in a class that have a specific decorator.
 *
 * @param classDecl - The ts-morph ClassDeclaration
 * @param decoratorName - The decorator name to search for (e.g., "Get", "Post")
 * @returns Array of MethodDeclaration nodes
 */
export function findMethodsWithDecorator(
  classDecl: ClassDeclaration,
  decoratorName: string
): MethodDeclaration[] {
  return classDecl.getMethods().filter((method) => {
    return method.getDecorators().some((d) => d.getName() === decoratorName);
  });
}

/**
 * Get all decorators of a specific name from a method.
 */
export function getDecorators(
  node: MethodDeclaration | ClassDeclaration,
  decoratorName: string
): Decorator[] {
  return node.getDecorators().filter((d) => d.getName() === decoratorName);
}

// ─── Property Extraction ─────────────────────────────────────────────────────

/**
 * Extract properties from a class declaration and convert to JSON Schema.
 * Useful for DTOs, entities, and other data-carrying classes.
 */
export function classToJsonSchema(classDecl: ClassDeclaration): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];

  for (const prop of classDecl.getProperties()) {
    const propName = prop.getName();
    const propType = prop.getType();
    const isOptional = prop.hasQuestionToken() || prop.hasInitializer();

    properties[propName] = resolveTypeToJsonSchema(propType);

    if (!isOptional) {
      required.push(propName);
    }
  }

  const schema: JsonSchema = {
    type: 'object',
    properties,
  };

  if (required.length > 0) {
    schema.required = required;
  }

  return schema;
}

/**
 * Extract properties from an interface or type alias.
 */
export function interfaceToJsonSchema(
  type: Type
): JsonSchema {
  return resolveTypeToJsonSchema(type);
}
