/**
 * CodeLens — XML/Spring Tier 2 Analyzer
 * Minimal analysis for XML-defined endpoints — XSD type extraction from WSDL.
 */

import * as fs from 'fs';
import * as path from 'path';
import { EndpointRecord, ResponseSchemaRecord } from '../../shared/types';
import { unresolvedSchema } from '../../shared/utils';
import { parseXmlFile, findElements, getAttribute } from '../shared/xmlUtils';
import { Logger } from '../../shared/logger';

const logger = Logger.create('xml-spring-analyzer');

export async function analyzeXmlEndpoints(
  endpoints: EndpointRecord[],
  workspaceRoot: string,
): Promise<EndpointRecord[]> {
  return endpoints.map(ep => {
    // For WSDL endpoints, attempt to extract XSD type information
    if (ep.framework === 'wsdl' && ep.requestBody?.typeName) {
      return extractWsdlTypes(ep, workspaceRoot);
    }
    return ep;
  });
}

function extractWsdlTypes(endpoint: EndpointRecord, workspaceRoot: string): EndpointRecord {
  const absPath = path.join(workspaceRoot, endpoint.sourceFile);
  const xmlObj = parseXmlFile(absPath);
  if (!xmlObj) return endpoint;

  // Find schema elements and try to build a minimal JSON Schema
  const schemaElements = findElements(xmlObj, 'element');
  if (schemaElements.length === 0) return endpoint;

  // Very basic XSD → JSON Schema conversion
  const properties: Record<string, { type: string }> = {};
  for (const el of schemaElements.slice(0, 20)) {
    const name = getAttribute(el, 'name');
    const xsdType = getAttribute(el, 'type') ?? 'xs:string';
    if (!name) continue;
    const jsonType = xsdTypeToJsonType(String(xsdType));
    properties[String(name)] = { type: jsonType };
  }

  if (Object.keys(properties).length > 0 && endpoint.requestBody) {
    return {
      ...endpoint,
      requestBody: {
        ...endpoint.requestBody,
        schema: { type: 'object', properties },
      },
    };
  }

  return endpoint;
}

function xsdTypeToJsonType(xsdType: string): string {
  const map: Record<string, string> = {
    'xs:string': 'string', 'xsd:string': 'string',
    'xs:integer': 'integer', 'xsd:integer': 'integer',
    'xs:int': 'integer', 'xsd:int': 'integer',
    'xs:boolean': 'boolean', 'xsd:boolean': 'boolean',
    'xs:decimal': 'number', 'xsd:decimal': 'number',
    'xs:float': 'number', 'xsd:float': 'number',
    'xs:double': 'number', 'xsd:double': 'number',
    'xs:date': 'string', 'xsd:date': 'string',
    'xs:dateTime': 'string', 'xsd:dateTime': 'string',
  };
  return map[xsdType] ?? 'string';
}
