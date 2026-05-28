/**
 * CodeLens — Shared Python AST Utilities
 *
 * Tree-sitter based helpers for traversing Python AST nodes.
 * Used by both python-fastapi and python-flask scanner plugins.
 */
import Parser from 'web-tree-sitter';
/** Represents a positional argument extracted from a decorator call */
export interface DecoratorArg {
    /** The raw text of the argument */
    value: string;
    /** The AST node for further inspection */
    node: Parser.SyntaxNode;
}
/** Represents a keyword argument extracted from a decorator call */
export interface DecoratorKwarg {
    /** The keyword name */
    key: string;
    /** The raw text of the value */
    value: string;
    /** The AST node for further inspection */
    node: Parser.SyntaxNode;
}
/** Structured decorator arguments */
export interface DecoratorArgs {
    positional: DecoratorArg[];
    keyword: DecoratorKwarg[];
}
/** Extracted function parameter */
export interface FunctionParam {
    /** Parameter name */
    name: string;
    /** Type annotation text, if present */
    typeAnnotation?: string;
    /** Default value text, if present */
    defaultValue?: string;
    /** Whether this is *args */
    isVarArgs: boolean;
    /** Whether this is **kwargs */
    isKwargs: boolean;
}
/** Extracted class field from a class body */
export interface ClassField {
    /** Field name */
    name: string;
    /** Type annotation text */
    typeAnnotation?: string;
    /** Default value text */
    defaultValue?: string;
    /** Whether the field has a Field() call as default */
    hasFieldDescriptor: boolean;
    /** Field() arguments if present */
    fieldArgs?: DecoratorArgs;
}
/** Result of finding a decorated function definition */
export interface DecoratedFunction {
    /** The entire decorated_definition node */
    decoratedNode: Parser.SyntaxNode;
    /** The decorator node that matched */
    decoratorNode: Parser.SyntaxNode;
    /** The function_definition node */
    functionNode: Parser.SyntaxNode;
    /** The function name */
    functionName: string;
    /** Start line (0-indexed) */
    startLine: number;
    /** End line (0-indexed) */
    endLine: number;
}
/** Result of finding a class definition */
export interface ClassDefinition {
    /** The class_definition node */
    classNode: Parser.SyntaxNode;
    /** The class name */
    className: string;
    /** Base class names */
    baseClasses: string[];
    /** Start line (0-indexed) */
    startLine: number;
    /** End line (0-indexed) */
    endLine: number;
}
/**
 * Recursively collect all descendant nodes matching a predicate.
 */
export declare function findAllNodes(root: Parser.SyntaxNode, predicate: (node: Parser.SyntaxNode) => boolean): Parser.SyntaxNode[];
/**
 * Find all nodes of a given type in the tree.
 */
export declare function findNodesByType(root: Parser.SyntaxNode, type: string): Parser.SyntaxNode[];
/**
 * Get the text of a named child, or undefined if not found.
 */
export declare function getNamedChildText(node: Parser.SyntaxNode, fieldName: string): string | undefined;
/**
 * Find all decorated function definitions where the decorator matches a pattern.
 *
 * @param tree - The parsed tree-sitter tree
 * @param decoratorPattern - RegExp to match against the decorator text (e.g., /\.(get|post|put|delete|patch)\s*\(/)
 * @returns Array of DecoratedFunction results
 */
export declare function findDecoratedFunctions(tree: Parser.Tree, decoratorPattern: RegExp): DecoratedFunction[];
/**
 * Extract positional and keyword arguments from a decorator call node.
 *
 * Handles decorators like:
 *   @app.get("/users", response_model=UserList, status_code=200)
 *   @app.route("/items", methods=["GET", "POST"])
 *
 * @param decoratorNode - A tree-sitter decorator node
 * @returns Parsed positional and keyword arguments
 */
export declare function extractDecoratorArgs(decoratorNode: Parser.SyntaxNode): DecoratorArgs;
/**
 * Extract typed parameters from a function_definition node.
 *
 * Handles:
 *   def handler(request: Request, user_id: int, q: str = "default")
 *   def handler(self, item: Item, db: Session = Depends(get_db))
 *
 * @param functionNode - A tree-sitter function_definition node
 * @returns Array of extracted function parameters
 */
export declare function extractFunctionParams(functionNode: Parser.SyntaxNode): FunctionParam[];
/**
 * Find class definitions that extend a specific base class.
 *
 * @param tree - The parsed tree-sitter tree
 * @param baseClass - The base class name to match (e.g., "BaseModel", "Resource")
 *                    If undefined, returns all class definitions
 * @returns Array of ClassDefinition results
 */
export declare function findClassDefinitions(tree: Parser.Tree, baseClass?: string): ClassDefinition[];
/**
 * Extract typed fields from a class body.
 *
 * Handles Pydantic-style fields:
 *   class User(BaseModel):
 *       name: str
 *       age: int = 0
 *       email: str = Field(..., description="User email")
 *
 * @param classNode - A tree-sitter class_definition node
 * @returns Array of extracted class fields
 */
export declare function extractClassFields(classNode: Parser.SyntaxNode): ClassField[];
/**
 * Remove surrounding quotes from a Python string literal.
 */
export declare function stripQuotes(text: string): string;
/**
 * Extract list items from a Python list literal node.
 * Returns the text of each element.
 */
export declare function extractListItems(node: Parser.SyntaxNode): string[];
//# sourceMappingURL=pythonAstUtils.d.ts.map