import * as fs from 'fs';
import * as path from 'path';
import { LanguagePlugin, EndpointRecord } from '../../shared/types';
import { scanXmlFiles } from './scanner';
import { analyzeXmlEndpoints } from './analyzer';
import { Logger } from '../../shared/logger';
import { findFilesRecursively } from '../../shared/utils';

const logger = Logger.create('plugin:xml-spring');

const xmlSpringPlugin: LanguagePlugin = {
  id: 'xml-spring',
  language: 'xml',
  framework: 'spring-xml',
  filePatterns: ['**/*.xml', '**/*.wsdl', '**/*.wadl'],

  async scan(files: string[], workspaceRoot: string): Promise<EndpointRecord[]> {
    logger.info(`Scanning ${files.length} XML files`);
    return scanXmlFiles(files, workspaceRoot);
  },

  async analyze(endpoints: EndpointRecord[], workspaceRoot: string): Promise<EndpointRecord[]> {
    logger.info(`Analyzing ${endpoints.length} XML endpoints`);
    return analyzeXmlEndpoints(endpoints, workspaceRoot);
  },

  async detect(workspaceRoot: string, fileMap?: Map<string, string[]>): Promise<boolean> {
    // 1. Check for web.xml recursively
    const webXmlFiles = findFilesRecursively(workspaceRoot, (name) => name === 'web.xml');
    if (webXmlFiles.length > 0) {
      logger.info(`Detected web.xml: ${webXmlFiles[0]}`);
      return true;
    }

    // 2. Check for pom.xml or build.gradle recursively
    const pomOrGradle = findFilesRecursively(workspaceRoot, (name) => name === 'pom.xml' || name === 'build.gradle');
    if (pomOrGradle.length > 0) {
      logger.info(`Detected build config: ${pomOrGradle[0]}`);
      return true;
    }

    // 3. Check for WSDL files recursively
    const wsdlFiles = fileMap?.get('xml')?.filter(f => f.endsWith('.wsdl')) || findFilesRecursively(workspaceRoot, (name) => name.endsWith('.wsdl'));
    if (wsdlFiles.length > 0) {
      logger.info(`Detected WSDL file: ${wsdlFiles[0]}`);
      return true;
    }

    // 4. Check for Spring XML configs recursively
    const springXmls = findFilesRecursively(workspaceRoot, (name) => name === 'applicationContext.xml');
    if (springXmls.length > 0) {
      logger.info(`Detected Spring context: ${springXmls[0]}`);
      return true;
    }

    return false;
  },
};

export default xmlSpringPlugin;
