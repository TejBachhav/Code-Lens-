/**
 * CodeLens — Markdown Documentation Generator
 *
 * Generates human-readable Markdown documentation from enriched endpoint records.
 *
 * Output structure:
 *   docs/
 *   ├── README.md              — Overview with endpoint index table
 *   ├── endpoints/
 *   │   └── METHOD_path.md     — Per-endpoint detail pages
 *   └── schemas/
 *       └── TypeName.md        — Schema documentation from resolvedTypes
 *
 * Uses Handlebars templates stored in src/output/templates/ for customizability.
 */
import { EndpointRecord } from '../shared/types';
/**
 * Generate complete Markdown documentation for all endpoints.
 *
 * @param endpoints - The enriched endpoint records.
 * @param outputDir - Absolute path to the output directory (e.g., workspace/.codelens/docs).
 * @returns Paths to all generated files.
 */
export declare function generateMarkdownDocs(endpoints: EndpointRecord[], outputDir: string): Promise<string[]>;
//# sourceMappingURL=markdownGenerator.d.ts.map