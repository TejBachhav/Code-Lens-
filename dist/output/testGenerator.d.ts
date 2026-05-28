/**
 * CodeLens — Test File Generator
 *
 * Generates framework-appropriate test files from enriched endpoint records.
 *
 * Strategy:
 *   - Python endpoints → pytest tests using httpx
 *   - TypeScript/JavaScript endpoints → Jest tests using supertest
 *   - If Tier 3 test cases are available, uses them; otherwise generates basic smoke tests
 *   - Groups tests by source file / controller class
 *   - Generates boilerplate: conftest.py for pytest, jest.config.js for Jest
 *
 * Uses Handlebars templates for customizability.
 */
import { EndpointRecord } from '../shared/types';
/**
 * Generate test files for all endpoints.
 *
 * @param endpoints - The enriched endpoint records.
 * @param outputDir - Absolute path to the test output directory.
 * @returns Paths to all generated test files.
 */
export declare function generateTests(endpoints: EndpointRecord[], outputDir: string): Promise<string[]>;
//# sourceMappingURL=testGenerator.d.ts.map