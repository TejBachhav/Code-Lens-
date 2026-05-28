/**
 * CodeLens — Output Module Barrel
 *
 * Exports a single `generateOutputs()` function that the pipeline worker
 * calls to produce all output artefacts from the enriched endpoint records.
 */

import * as path from 'path';
import { EndpointRecord, PipelineOptions, OutputFileRecord } from '../shared/types';
import { generateOpenApiSpec, writeOpenApiYaml } from './openapiGenerator';
import { generateMarkdownDocs } from './markdownGenerator';
import { generateTests } from './testGenerator';
import { Logger } from '../shared/logger';

const logger = Logger.create('output');

/**
 * Generate all output artefacts for a completed pipeline run.
 *
 * @param endpoints  - Enriched endpoint records (all three tiers)
 * @param outputDir  - Absolute path to the output directory (e.g. /workspace/.codelens)
 * @param options    - Pipeline options (used for language filter, etc.)
 * @returns Array of records describing every file that was written
 */
export async function generateOutputs(
  endpoints: EndpointRecord[],
  outputDir: string,
  options: PipelineOptions,
): Promise<OutputFileRecord[]> {
  const files: OutputFileRecord[] = [];

  if (endpoints.length === 0) {
    logger.info('No endpoints to generate output for');
    return files;
  }

  // 1. OpenAPI 3.1 YAML
  try {
    const spec = generateOpenApiSpec(endpoints);
    const yamlPath = path.join(outputDir, 'openapi.yaml');
    await writeOpenApiYaml(spec, yamlPath);
    files.push({ type: 'openapi', path: yamlPath });
    logger.info(`Generated OpenAPI spec: ${yamlPath}`);
  } catch (err) {
    logger.error('Failed to generate OpenAPI spec', err);
  }

  // 2. Markdown documentation
  try {
    const mdFiles = await generateMarkdownDocs(endpoints, outputDir);
    for (const f of mdFiles) {
      files.push({ type: 'markdown', path: f });
    }
    logger.info(`Generated ${mdFiles.length} Markdown doc(s)`);
  } catch (err) {
    logger.error('Failed to generate Markdown docs', err);
  }

  // 3. Test files
  try {
    const testFiles = await generateTests(endpoints, outputDir);
    for (const f of testFiles) {
      // Determine language from path suffix
      const lang = f.includes('/python/') || f.endsWith('.py') ? 'python'
        : f.includes('/typescript/') || f.endsWith('.ts') ? 'typescript'
        : 'javascript';
      files.push({ type: 'test', path: f, language: lang });
    }
    logger.info(`Generated ${testFiles.length} test file(s)`);
  } catch (err) {
    logger.error('Failed to generate test files', err);
  }

  return files;
}
