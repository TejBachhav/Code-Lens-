/**
 * CodeLens — Shared XML Parsing Utilities
 *
 * Helpers for parsing XML configuration files (Spring, web.xml, WSDL, etc.)
 * using fast-xml-parser.
 */

import * as fs from 'fs';
import { XMLParser, XMLBuilder, XMLValidator } from 'fast-xml-parser';
import { Logger } from '../../shared/logger';

const logger = Logger.create('XmlUtils');

// ─── Types ───────────────────────────────────────────────────────────────────

/** Parsed XML element with attributes and children */
export interface XmlElement {
  /** Tag name */
  tagName: string;
  /** Attributes as key-value pairs */
  attributes: Record<string, string>;
  /** Text content of the element */
  textContent?: string;
  /** Child elements */
  children: XmlElement[];
  /** Raw parsed value (for leaf nodes) */
  rawValue?: unknown;
}

/** Options for the XML parser */
export interface ParseOptions {
  /** Whether to preserve namespace prefixes in tag names */
  preserveNamespaces?: boolean;
  /** Whether to parse attribute values */
  parseAttributes?: boolean;
  /** Whether to ignore comments */
  ignoreComments?: boolean;
}

// ─── Parser Configuration ────────────────────────────────────────────────────

const DEFAULT_PARSER_OPTIONS = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  commentPropName: '#comment',
  preserveOrder: false,
  removeNSPrefix: false,
  allowBooleanAttributes: true,
  parseAttributeValue: true,
  parseTagValue: true,
  trimValues: true,
};

// ─── File Parsing ────────────────────────────────────────────────────────────

/**
 * Parse an XML file and return a structured object.
 *
 * @param filePath - Absolute path to the XML file
 * @param options - Optional parser configuration
 * @returns Parsed XML as a JavaScript object, or null if parsing fails
 */
export function parseXmlFile(
  filePath: string,
  options?: ParseOptions
): Record<string, unknown> | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return parseXmlString(content, options);
  } catch (error) {
    logger.error(`Failed to parse XML file: ${filePath}`, { error: String(error) });
    return null;
  }
}

/**
 * Parse an XML string and return a structured object.
 *
 * @param xmlContent - Raw XML string
 * @param options - Optional parser configuration
 * @returns Parsed XML as a JavaScript object, or null if parsing fails
 */
export function parseXmlString(
  xmlContent: string,
  options?: ParseOptions
): Record<string, unknown> | null {
  try {
    // Validate XML first
    const validationResult = XMLValidator.validate(xmlContent);
    if (validationResult !== true) {
      logger.warn('XML validation failed', { result: validationResult });
    }

    const parserOptions = {
      ...DEFAULT_PARSER_OPTIONS,
      removeNSPrefix: options?.preserveNamespaces === false,
      ignoreAttributes: options?.parseAttributes === false,
    };

    const parser = new XMLParser(parserOptions);
    return parser.parse(xmlContent);
  } catch (error) {
    logger.error('Failed to parse XML string', { error: String(error) });
    return null;
  }
}

// ─── Element Search ──────────────────────────────────────────────────────────

/**
 * Recursively find all elements matching a tag name within a parsed XML object.
 * Handles both namespace-prefixed and non-prefixed tag names.
 *
 * @param xmlObj - Parsed XML object from fast-xml-parser
 * @param tagName - Tag name to search for (can include namespace prefix like "mvc:annotation-driven")
 * @returns Array of matching elements (their values from the parsed object)
 */
export function findElements(
  xmlObj: unknown,
  tagName: string
): unknown[] {
  const results: unknown[] = [];
  findElementsRecursive(xmlObj, tagName, results);
  return results;
}

function findElementsRecursive(
  obj: unknown,
  tagName: string,
  results: unknown[]
): void {
  if (obj === null || obj === undefined) return;

  if (typeof obj !== 'object') return;

  if (Array.isArray(obj)) {
    for (const item of obj) {
      findElementsRecursive(item, tagName, results);
    }
    return;
  }

  const record = obj as Record<string, unknown>;

  for (const key of Object.keys(record)) {
    // Check if this key matches the tag name
    // Handle namespace variations: "mvc:annotation-driven" matches "annotation-driven"
    if (
      key === tagName ||
      key.endsWith(`:${tagName}`) ||
      (tagName.includes(':') && key === tagName.split(':').pop())
    ) {
      const value = record[key];
      if (Array.isArray(value)) {
        results.push(...value);
      } else if (value !== undefined) {
        results.push(value);
      }
    }

    // Recurse into child elements (skip attributes and text)
    if (!key.startsWith('@_') && key !== '#text' && key !== '#comment') {
      findElementsRecursive(record[key], tagName, results);
    }
  }
}

// ─── Attribute Extraction ────────────────────────────────────────────────────

/**
 * Extract attributes from a parsed XML element object.
 * fast-xml-parser prefixes attributes with '@_' by default.
 *
 * @param element - A parsed XML element object
 * @returns Record of attribute name → value (without the @_ prefix)
 */
export function extractAttributes(
  element: unknown
): Record<string, string> {
  const attrs: Record<string, string> = {};

  if (!element || typeof element !== 'object') return attrs;

  const record = element as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key.startsWith('@_')) {
      const attrName = key.substring(2);
      attrs[attrName] = String(record[key]);
    }
  }

  return attrs;
}

/**
 * Get a specific attribute value from a parsed XML element.
 *
 * @param element - A parsed XML element object
 * @param attrName - The attribute name (without @_ prefix)
 * @returns The attribute value as string, or undefined if not found
 */
export function getAttribute(
  element: unknown,
  attrName: string
): string | undefined {
  if (!element || typeof element !== 'object') return undefined;

  const record = element as Record<string, unknown>;
  const value = record[`@_${attrName}`];
  return value !== undefined ? String(value) : undefined;
}

// ─── Element Text Content ────────────────────────────────────────────────────

/**
 * Get the text content of a parsed XML element.
 */
export function getTextContent(element: unknown): string | undefined {
  if (!element || typeof element !== 'object') {
    return element != null ? String(element) : undefined;
  }

  const record = element as Record<string, unknown>;
  const text = record['#text'];
  return text !== undefined ? String(text) : undefined;
}

// ─── Child Element Access ────────────────────────────────────────────────────

/**
 * Get direct child elements of a specific tag name from a parsed element.
 *
 * @param element - A parsed XML element
 * @param childTag - The child tag name to look for
 * @returns Array of child elements
 */
export function getChildren(
  element: unknown,
  childTag: string
): unknown[] {
  if (!element || typeof element !== 'object') return [];

  const record = element as Record<string, unknown>;

  for (const key of Object.keys(record)) {
    if (
      key === childTag ||
      key.endsWith(`:${childTag}`)
    ) {
      const value = record[key];
      if (Array.isArray(value)) return value;
      if (value !== undefined) return [value];
    }
  }

  return [];
}

/**
 * Convert an XML element to a structured XmlElement representation.
 * Useful for more detailed analysis.
 */
export function toXmlElement(
  obj: unknown,
  tagName: string = 'root'
): XmlElement {
  const element: XmlElement = {
    tagName,
    attributes: {},
    children: [],
  };

  if (!obj || typeof obj !== 'object') {
    element.textContent = obj != null ? String(obj) : undefined;
    element.rawValue = obj;
    return element;
  }

  const record = obj as Record<string, unknown>;

  for (const key of Object.keys(record)) {
    if (key.startsWith('@_')) {
      element.attributes[key.substring(2)] = String(record[key]);
    } else if (key === '#text') {
      element.textContent = String(record[key]);
    } else if (key === '#comment') {
      // Skip comments
    } else {
      const value = record[key];
      if (Array.isArray(value)) {
        for (const item of value) {
          element.children.push(toXmlElement(item, key));
        }
      } else if (value !== null && typeof value === 'object') {
        element.children.push(toXmlElement(value, key));
      } else {
        element.children.push({
          tagName: key,
          attributes: {},
          textContent: value != null ? String(value) : undefined,
          rawValue: value,
          children: [],
        });
      }
    }
  }

  return element;
}
