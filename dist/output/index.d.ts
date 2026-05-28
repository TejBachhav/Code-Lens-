/**
 * CodeLens — Output Module Barrel
 *
 * Exports a single `generateOutputs()` function that the pipeline worker
 * calls to produce all output artefacts from the enriched endpoint records.
 */
import { EndpointRecord, PipelineOptions, OutputFileRecord } from '../shared/types';
/**
 * Generate all output artefacts for a completed pipeline run.
 *
 * @param endpoints  - Enriched endpoint records (all three tiers)
 * @param outputDir  - Absolute path to the output directory (e.g. /workspace/.codelens)
 * @param options    - Pipeline options (used for language filter, etc.)
 * @returns Array of records describing every file that was written
 */
export declare function generateOutputs(endpoints: EndpointRecord[], outputDir: string, options: PipelineOptions): Promise<OutputFileRecord[]>;
//# sourceMappingURL=index.d.ts.map