/**
 * CodeLens — Shared XML Parsing Utilities
 *
 * Helpers for parsing XML configuration files (Spring, web.xml, WSDL, etc.)
 * using fast-xml-parser.
 */
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
/**
 * Parse an XML file and return a structured object.
 *
 * @param filePath - Absolute path to the XML file
 * @param options - Optional parser configuration
 * @returns Parsed XML as a JavaScript object, or null if parsing fails
 */
export declare function parseXmlFile(filePath: string, options?: ParseOptions): Record<string, unknown> | null;
/**
 * Parse an XML string and return a structured object.
 *
 * @param xmlContent - Raw XML string
 * @param options - Optional parser configuration
 * @returns Parsed XML as a JavaScript object, or null if parsing fails
 */
export declare function parseXmlString(xmlContent: string, options?: ParseOptions): Record<string, unknown> | null;
/**
 * Recursively find all elements matching a tag name within a parsed XML object.
 * Handles both namespace-prefixed and non-prefixed tag names.
 *
 * @param xmlObj - Parsed XML object from fast-xml-parser
 * @param tagName - Tag name to search for (can include namespace prefix like "mvc:annotation-driven")
 * @returns Array of matching elements (their values from the parsed object)
 */
export declare function findElements(xmlObj: unknown, tagName: string): unknown[];
/**
 * Extract attributes from a parsed XML element object.
 * fast-xml-parser prefixes attributes with '@_' by default.
 *
 * @param element - A parsed XML element object
 * @returns Record of attribute name → value (without the @_ prefix)
 */
export declare function extractAttributes(element: unknown): Record<string, string>;
/**
 * Get a specific attribute value from a parsed XML element.
 *
 * @param element - A parsed XML element object
 * @param attrName - The attribute name (without @_ prefix)
 * @returns The attribute value as string, or undefined if not found
 */
export declare function getAttribute(element: unknown, attrName: string): string | undefined;
/**
 * Get the text content of a parsed XML element.
 */
export declare function getTextContent(element: unknown): string | undefined;
/**
 * Get direct child elements of a specific tag name from a parsed element.
 *
 * @param element - A parsed XML element
 * @param childTag - The child tag name to look for
 * @returns Array of child elements
 */
export declare function getChildren(element: unknown, childTag: string): unknown[];
/**
 * Convert an XML element to a structured XmlElement representation.
 * Useful for more detailed analysis.
 */
export declare function toXmlElement(obj: unknown, tagName?: string): XmlElement;
//# sourceMappingURL=xmlUtils.d.ts.map