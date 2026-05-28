/**
 * CodeLens — XML/Spring Tier 1 Scanner
 *
 * Uses fast-xml-parser to scan Spring XML config files, web.xml, and WSDL files.
 * Handles: Spring MVC servlet mappings, web.xml URL patterns, WSDL operations.
 */

import * as path from 'path';
import * as fs from 'fs';
import { XMLParser } from 'fast-xml-parser';
import {
  EndpointRecord,
  HttpMethod,
  ParamRecord,
} from '../../shared/types';
import {
  generateEndpointId,
  normalizePath,
  extractPathParams,
  toRelativePath,
  unresolvedSchema,
} from '../../shared/utils';
import { Logger } from '../../shared/logger';
import { parseXmlFile, findElements, extractAttributes } from '../shared/xmlUtils';

const logger = Logger.create('xml-spring-scanner');

/**
 * Scan XML files for API endpoint definitions.
 */
export async function scanXmlFiles(
  files: string[],
  workspaceRoot: string,
): Promise<EndpointRecord[]> {
  const endpoints: EndpointRecord[] = [];

  for (const filePath of files) {
    try {
      const relPath = toRelativePath(filePath, workspaceRoot);
      const fileName = path.basename(filePath).toLowerCase();

      let fileEndpoints: EndpointRecord[] = [];

      if (fileName === 'web.xml') {
        fileEndpoints = scanWebXml(filePath, relPath);
      } else if (fileName.endsWith('.wsdl')) {
        fileEndpoints = scanWsdl(filePath, relPath);
      } else if (fileName.endsWith('.xml')) {
        fileEndpoints = scanSpringXml(filePath, relPath);
      }

      endpoints.push(...fileEndpoints);
    } catch (err) {
      logger.warn(`Failed to scan XML file: ${filePath}`, err);
    }
  }

  return endpoints;
}

// ─── web.xml Scanner ──────────────────────────────────────────────────────────

function scanWebXml(filePath: string, relPath: string): EndpointRecord[] {
  const endpoints: EndpointRecord[] = [];
  const xmlObj = parseXmlFile(filePath) as any;
  if (!xmlObj) return endpoints;

  const webApp = xmlObj['web-app'] ?? xmlObj;
  const servlets = normalizeArray(webApp?.servlet ?? []);
  const mappings = normalizeArray(webApp?.['servlet-mapping'] ?? []);

  // Build a map of servlet-name → url-pattern
  for (const mapping of mappings) {
    const servletName = mapping?.['servlet-name'];
    const urlPattern = mapping?.['url-pattern'];
    if (!servletName || !urlPattern) continue;

    const patterns = normalizeArray(urlPattern);

    for (const pattern of patterns) {
      const routePath = normalizePath(String(pattern).replace(/\*/g, '{wildcard}'));
      const servlet = servlets.find(s => s?.['servlet-name'] === servletName);
      const servletClass = servlet?.['servlet-class'] ?? servletName;

      // web.xml doesn't specify HTTP method — emit as generic GET placeholder
      const id = generateEndpointId('GET', routePath, String(servletClass));

      endpoints.push({
        id,
        method: 'GET',
        path: routePath,
        handler: {
          name: String(servletClass).split('.').pop() ?? 'servlet',
          className: String(servletClass),
          modulePath: relPath,
          isAsync: false,
        },
        params: extractPathParams(routePath).map(name => ({ name, in: 'path' as const, type: 'string', required: true })),
        middleware: [],
        decorators: [{ name: 'servlet-mapping', arguments: [servletName, pattern] }],
        framework: 'servlet',
        language: 'xml',
        sourceFile: relPath,
        sourceLines: [1, 1],
        responseSchemas: [{ statusCode: 200, contentType: 'text/html',
          schema: unresolvedSchema('Servlet response type not determinable from web.xml') }],
      });
    }
  }

  return endpoints;
}

// ─── WSDL Scanner ─────────────────────────────────────────────────────────────

function scanWsdl(filePath: string, relPath: string): EndpointRecord[] {
  const endpoints: EndpointRecord[] = [];
  const xmlObj = parseXmlFile(filePath);
  if (!xmlObj) return endpoints;

  // Find the root definitions element (may have namespace prefix)
  const definitions = findRootElement(xmlObj, 'definitions') as any;
  if (!definitions) return endpoints;

  // Get service name for path prefix
  const serviceName = definitions?.['@_name'] ?? 'Service';

  // Find portType → operations (abstract interface)
  const portTypes = normalizeArray(findNestedElement(definitions, 'portType') ?? []);

  for (const portType of portTypes as any[]) {
    const operations = normalizeArray(portType?.operation ?? portType?.['wsdl:operation'] ?? []);

    for (const op of operations as any[]) {
      const opName = op?.['@_name'] ?? 'operation';
      const routePath = normalizePath(`/${serviceName}/${opName}`);
      const id = generateEndpointId('POST', routePath, opName);

      // Extract input/output message names
      const inputMsg = op?.input?.['@_message'] ?? op?.['wsdl:input']?.['@_message'];
      const outputMsg = op?.output?.['@_message'] ?? op?.['wsdl:output']?.['@_message'];

      endpoints.push({
        id,
        method: 'POST', // SOAP operations are always POST
        path: routePath,
        handler: {
          name: opName,
          modulePath: relPath,
          isAsync: false,
        },
        params: [],
        requestBody: {
          contentType: 'application/soap+xml',
          schema: unresolvedSchema(`WSDL input message: ${inputMsg ?? 'unknown'}`),
          required: true,
          typeName: String(inputMsg ?? '').split(':').pop(),
        },
        middleware: [],
        decorators: [{ name: 'wsdl:operation', arguments: [opName] }],
        framework: 'wsdl',
        language: 'xml',
        sourceFile: relPath,
        sourceLines: [1, 1],
        responseSchemas: [{
          statusCode: 200,
          contentType: 'application/soap+xml',
          schema: unresolvedSchema(`WSDL output message: ${outputMsg ?? 'unknown'}`),
        }],
      });
    }
  }

  return endpoints;
}

// ─── Spring XML Scanner ───────────────────────────────────────────────────────

function scanSpringXml(filePath: string, relPath: string): EndpointRecord[] {
  const endpoints: EndpointRecord[] = [];
  const xmlObj = parseXmlFile(filePath);
  if (!xmlObj) return endpoints;

  const beans = findElements(xmlObj, 'bean');

  for (const bean of beans as any[]) {
    const beanClass = bean?.['@_class'] ?? '';
    if (!String(beanClass).toLowerCase().includes('controller') &&
        !String(beanClass).toLowerCase().includes('handler')) continue;

    const beanId = bean?.['@_id'] ?? bean?.['@_name'] ?? 'bean';
    const routePath = normalizePath(`/${beanId}`);
    const id = generateEndpointId('GET', routePath, String(beanClass));

    endpoints.push({
      id,
      method: 'GET',
      path: routePath,
      handler: {
        name: String(beanClass).split('.').pop() ?? 'controller',
        className: String(beanClass),
        modulePath: relPath,
        isAsync: false,
      },
      params: [],
      middleware: [],
      decorators: [{ name: 'spring:bean', arguments: [beanClass] }],
      framework: 'spring-xml',
      language: 'xml',
      sourceFile: relPath,
      sourceLines: [1, 1],
    });
  }

  return endpoints;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalizeArray<T>(val: T | T[]): T[] {
  if (!val) return [];
  return Array.isArray(val) ? val : [val];
}

function findRootElement(obj: Record<string, unknown>, localName: string): Record<string, unknown> | null {
  for (const key of Object.keys(obj)) {
    if (key === localName || key.endsWith(`:${localName}`) || key.endsWith(localName)) {
      return obj[key] as Record<string, unknown>;
    }
  }
  return null;
}

function findNestedElement(obj: Record<string, unknown>, localName: string): unknown {
  for (const key of Object.keys(obj)) {
    if (key === localName || key.endsWith(`:${localName}`)) {
      return obj[key];
    }
  }
  return null;
}
