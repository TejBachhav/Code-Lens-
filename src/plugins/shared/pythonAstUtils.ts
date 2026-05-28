/**
 * CodeLens — Shared Python AST Utilities
 *
 * Tree-sitter based helpers for traversing Python AST nodes.
 * Used by both python-fastapi and python-flask scanner plugins.
 */

import Parser from 'web-tree-sitter';

// ─── Types ───────────────────────────────────────────────────────────────────

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

// ─── Node Traversal Helpers ──────────────────────────────────────────────────

/**
 * Recursively collect all descendant nodes matching a predicate.
 */
export function findAllNodes(
  root: Parser.SyntaxNode,
  predicate: (node: Parser.SyntaxNode) => boolean
): Parser.SyntaxNode[] {
  const results: Parser.SyntaxNode[] = [];
  const cursor = root.walk();
  let reachedRoot = false;

  while (true) {
    if (predicate(cursor.currentNode)) {
      results.push(cursor.currentNode);
    }

    if (cursor.gotoFirstChild()) continue;
    if (cursor.gotoNextSibling()) continue;

    while (true) {
      if (!cursor.gotoParent()) {
        reachedRoot = true;
        break;
      }
      if (cursor.gotoNextSibling()) break;
    }
    if (reachedRoot) break;
  }

  return results;
}

/**
 * Find all nodes of a given type in the tree.
 */
export function findNodesByType(
  root: Parser.SyntaxNode,
  type: string
): Parser.SyntaxNode[] {
  return findAllNodes(root, (n) => n.type === type);
}

/**
 * Get the text of a named child, or undefined if not found.
 */
export function getNamedChildText(
  node: Parser.SyntaxNode,
  fieldName: string
): string | undefined {
  const child = node.childForFieldName(fieldName);
  return child?.text;
}

// ─── Decorated Function Finder ───────────────────────────────────────────────

/**
 * Find all decorated function definitions where the decorator matches a pattern.
 *
 * @param tree - The parsed tree-sitter tree
 * @param decoratorPattern - RegExp to match against the decorator text (e.g., /\.(get|post|put|delete|patch)\s*\(/)
 * @returns Array of DecoratedFunction results
 */
export function findDecoratedFunctions(
  tree: Parser.Tree,
  decoratorPattern: RegExp
): DecoratedFunction[] {
  const results: DecoratedFunction[] = [];
  const decoratedDefs = findNodesByType(tree.rootNode, 'decorated_definition');

  for (const decoratedNode of decoratedDefs) {
    // Get all decorator nodes
    const decorators = decoratedNode.children.filter((c) => c.type === 'decorator');
    // Get the definition node (function_definition or class_definition)
    const definition = decoratedNode.children.find(
      (c) => c.type === 'function_definition'
    );

    if (!definition) continue;

    const functionName = getNamedChildText(definition, 'name') || '';

    for (const decorator of decorators) {
      // The decorator text excludes the leading @
      const decoratorText = decorator.text;

      if (decoratorPattern.test(decoratorText)) {
        results.push({
          decoratedNode,
          decoratorNode: decorator,
          functionNode: definition,
          functionName,
          startLine: decoratedNode.startPosition.row,
          endLine: decoratedNode.endPosition.row,
        });
        break; // Only match the first matching decorator per function
      }
    }
  }

  return results;
}

// ─── Decorator Argument Extraction ───────────────────────────────────────────

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
export function extractDecoratorArgs(decoratorNode: Parser.SyntaxNode): DecoratorArgs {
  const result: DecoratorArgs = { positional: [], keyword: [] };

  // Find the call expression within the decorator
  // Decorator structure: @ -> expression (which may be a call)
  const children = decoratorNode.children;

  // Find the argument_list or call node
  let argList: Parser.SyntaxNode | null = null;

  for (const child of children) {
    if (child.type === 'call') {
      // The call node should have an argument_list
      argList = child.children.find((c) => c.type === 'argument_list') || null;
      break;
    }
    if (child.type === 'argument_list') {
      argList = child;
      break;
    }
  }

  // If the decorator expression itself is a call (e.g., the whole thing after @)
  if (!argList) {
    // Try walking deeper — the decorator's first child after @ might be an expression
    const expr = children.find(
      (c) => c.type !== '@' && c.type !== 'comment'
    );
    if (expr?.type === 'call') {
      argList = expr.children.find((c) => c.type === 'argument_list') || null;
    }
  }

  if (!argList) return result;

  for (const arg of argList.namedChildren) {
    if (arg.type === 'keyword_argument') {
      const key = arg.childForFieldName('name')?.text || '';
      const valueNode = arg.childForFieldName('value');
      result.keyword.push({
        key,
        value: valueNode?.text || '',
        node: valueNode || arg,
      });
    } else {
      // Positional argument
      result.positional.push({
        value: arg.text,
        node: arg,
      });
    }
  }

  return result;
}

// ─── Function Parameter Extraction ───────────────────────────────────────────

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
export function extractFunctionParams(functionNode: Parser.SyntaxNode): FunctionParam[] {
  const params: FunctionParam[] = [];

  const parameters = functionNode.childForFieldName('parameters');
  if (!parameters) return params;

  for (const param of parameters.namedChildren) {
    switch (param.type) {
      case 'identifier': {
        // Simple parameter without annotation: def f(x)
        params.push({
          name: param.text,
          isVarArgs: false,
          isKwargs: false,
        });
        break;
      }

      case 'typed_parameter': {
        const nameNode = param.children.find(
          (c) => c.type === 'identifier'
        );
        const typeNode = param.childForFieldName('type');
        params.push({
          name: nameNode?.text || '',
          typeAnnotation: typeNode?.text,
          isVarArgs: false,
          isKwargs: false,
        });
        break;
      }

      case 'default_parameter': {
        const nameNode = param.childForFieldName('name');
        const valueNode = param.childForFieldName('value');
        params.push({
          name: nameNode?.text || '',
          defaultValue: valueNode?.text,
          isVarArgs: false,
          isKwargs: false,
        });
        break;
      }

      case 'typed_default_parameter': {
        const nameNode = param.children.find(
          (c) => c.type === 'identifier'
        );
        const typeNode = param.childForFieldName('type');
        const valueNode = param.childForFieldName('value');
        params.push({
          name: nameNode?.text || '',
          typeAnnotation: typeNode?.text,
          defaultValue: valueNode?.text,
          isVarArgs: false,
          isKwargs: false,
        });
        break;
      }

      case 'list_splat_pattern': {
        // *args
        const nameNode = param.namedChildren[0];
        params.push({
          name: nameNode?.text || 'args',
          isVarArgs: true,
          isKwargs: false,
        });
        break;
      }

      case 'dictionary_splat_pattern': {
        // **kwargs
        const nameNode = param.namedChildren[0];
        params.push({
          name: nameNode?.text || 'kwargs',
          isVarArgs: false,
          isKwargs: true,
        });
        break;
      }
    }
  }

  return params;
}

// ─── Class Definition Finder ─────────────────────────────────────────────────

/**
 * Find class definitions that extend a specific base class.
 *
 * @param tree - The parsed tree-sitter tree
 * @param baseClass - The base class name to match (e.g., "BaseModel", "Resource")
 *                    If undefined, returns all class definitions
 * @returns Array of ClassDefinition results
 */
export function findClassDefinitions(
  tree: Parser.Tree,
  baseClass?: string
): ClassDefinition[] {
  const results: ClassDefinition[] = [];
  const classDefs = findNodesByType(tree.rootNode, 'class_definition');

  for (const classNode of classDefs) {
    const className = getNamedChildText(classNode, 'name') || '';

    // Extract base classes from the argument_list or superclasses
    const baseClasses: string[] = [];
    const superclasses = classNode.childForFieldName('superclasses');
    if (superclasses) {
      for (const child of superclasses.namedChildren) {
        baseClasses.push(child.text);
      }
    }

    // Filter by base class if specified
    if (baseClass && !baseClasses.some((bc) => bc === baseClass || bc.endsWith(`.${baseClass}`))) {
      continue;
    }

    results.push({
      classNode,
      className,
      baseClasses,
      startLine: classNode.startPosition.row,
      endLine: classNode.endPosition.row,
    });
  }

  return results;
}

// ─── Class Field Extraction ──────────────────────────────────────────────────

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
export function extractClassFields(classNode: Parser.SyntaxNode): ClassField[] {
  const fields: ClassField[] = [];
  const body = classNode.childForFieldName('body');
  if (!body) return fields;

  for (const stmt of body.namedChildren) {
    // Type-annotated assignment: name: str = "default"
    if (stmt.type === 'expression_statement') {
      const expr = stmt.namedChildren[0];
      if (!expr) continue;

      if (expr.type === 'assignment') {
        // name: type = value  →  type_annotation with assignment
        // Actually in tree-sitter-python, annotated assignments are 'assignment' nodes
        const leftNode = expr.childForFieldName('left');
        const rightNode = expr.childForFieldName('right');
        const typeNode = expr.childForFieldName('type');

        if (leftNode) {
          const field: ClassField = {
            name: leftNode.text,
            typeAnnotation: typeNode?.text,
            defaultValue: rightNode?.text,
            hasFieldDescriptor: false,
          };

          // Check if default is a Field() call
          if (rightNode?.type === 'call') {
            const funcName = rightNode.childForFieldName('function')?.text || '';
            if (funcName === 'Field' || funcName.endsWith('.Field')) {
              field.hasFieldDescriptor = true;
              field.fieldArgs = extractCallArgs(rightNode);
            }
          }

          fields.push(field);
        }
      } else if (expr.type === 'type') {
        // Standalone type annotation: name: str
        // In tree-sitter-python this shows up differently
        continue;
      }
    }

    // Handle standalone type annotations
    if (stmt.type === 'type') {
      // name: type
      const identNode = stmt.children.find((c) => c.type === 'identifier');
      const typeNode = stmt.childForFieldName('type');
      if (identNode) {
        fields.push({
          name: identNode.text,
          typeAnnotation: typeNode?.text,
          hasFieldDescriptor: false,
        });
      }
    }
  }

  return fields;
}

/**
 * Extract arguments from a call expression node.
 */
function extractCallArgs(callNode: Parser.SyntaxNode): DecoratorArgs {
  const result: DecoratorArgs = { positional: [], keyword: [] };
  const argList = callNode.children.find((c) => c.type === 'argument_list');
  if (!argList) return result;

  for (const arg of argList.namedChildren) {
    if (arg.type === 'keyword_argument') {
      const key = arg.childForFieldName('name')?.text || '';
      const valueNode = arg.childForFieldName('value');
      result.keyword.push({
        key,
        value: valueNode?.text || '',
        node: valueNode || arg,
      });
    } else {
      result.positional.push({
        value: arg.text,
        node: arg,
      });
    }
  }

  return result;
}

// ─── Utility: String Literal Cleaning ────────────────────────────────────────

/**
 * Remove surrounding quotes from a Python string literal.
 */
export function stripQuotes(text: string): string {
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    return text.slice(1, -1);
  }
  // Triple-quoted strings
  if (
    (text.startsWith('"""') && text.endsWith('"""')) ||
    (text.startsWith("'''") && text.endsWith("'''"))
  ) {
    return text.slice(3, -3);
  }
  // f-strings
  if (text.startsWith('f"') || text.startsWith("f'")) {
    return text.slice(2, -1);
  }
  return text;
}

/**
 * Extract list items from a Python list literal node.
 * Returns the text of each element.
 */
export function extractListItems(node: Parser.SyntaxNode): string[] {
  if (node.type !== 'list') return [];
  return node.namedChildren.map((child) => stripQuotes(child.text));
}
