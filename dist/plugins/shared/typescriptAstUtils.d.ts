/**
 * CodeLens — Shared TypeScript AST Utilities
 *
 * ts-morph based helpers for traversing TypeScript/JavaScript ASTs.
 * Used by typescript-express and typescript-nestjs plugins.
 */
import { Type, Decorator, SourceFile, ClassDeclaration, MethodDeclaration } from 'ts-morph';
import { JsonSchema } from '../../shared/types';
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
export declare function resolveTypeToJsonSchema(type: Type, visited?: Set<string>): JsonSchema;
/**
 * Extract argument values from a ts-morph Decorator.
 *
 * @param decorator - The ts-morph Decorator node
 * @returns Array of argument value strings
 */
export declare function extractDecoratorArguments(decorator: Decorator): string[];
/**
 * Get the first string argument from a decorator (common for route paths).
 */
export declare function getDecoratorStringArg(decorator: Decorator): string | undefined;
/**
 * Unwrap Promise<T> or Observable<T> to get the inner type T.
 *
 * @param type - The ts-morph Type
 * @returns The unwrapped inner type, or the original type if not a wrapper
 */
export declare function unwrapPromiseType(type: Type): Type;
/**
 * Find all classes in a source file that have a specific decorator.
 *
 * @param sourceFile - The ts-morph SourceFile
 * @param decoratorName - The decorator name to search for (e.g., "Controller")
 * @returns Array of ClassDeclaration nodes
 */
export declare function findClassesWithDecorator(sourceFile: SourceFile, decoratorName: string): ClassDeclaration[];
/**
 * Find all methods in a class that have a specific decorator.
 *
 * @param classDecl - The ts-morph ClassDeclaration
 * @param decoratorName - The decorator name to search for (e.g., "Get", "Post")
 * @returns Array of MethodDeclaration nodes
 */
export declare function findMethodsWithDecorator(classDecl: ClassDeclaration, decoratorName: string): MethodDeclaration[];
/**
 * Get all decorators of a specific name from a method.
 */
export declare function getDecorators(node: MethodDeclaration | ClassDeclaration, decoratorName: string): Decorator[];
/**
 * Extract properties from a class declaration and convert to JSON Schema.
 * Useful for DTOs, entities, and other data-carrying classes.
 */
export declare function classToJsonSchema(classDecl: ClassDeclaration): JsonSchema;
/**
 * Extract properties from an interface or type alias.
 */
export declare function interfaceToJsonSchema(type: Type): JsonSchema;
//# sourceMappingURL=typescriptAstUtils.d.ts.map