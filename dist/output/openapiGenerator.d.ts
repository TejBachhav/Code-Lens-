/**
 * CodeLens — OpenAPI 3.1 Specification Generator
 *
 * Transforms EndpointRecord[] into a complete OpenAPI 3.1 specification object,
 * then serializes it to YAML for consumption by Swagger UI, Postman, etc.
 *
 * Design decisions:
 *   - __UNRESOLVED__ schemas are emitted with a TODO description so the user
 *     knows what needs manual completion.
 *   - Unique type definitions from resolvedTypes are collected into
 *     components/schemas and referenced via $ref.
 *   - Uses js-yaml for YAML serialization (listed in package.json dependencies).
 */
import { EndpointRecord } from '../shared/types';
/**
 * Generate a complete OpenAPI 3.1 specification object from endpoint records.
 *
 * @param endpoints - The enriched endpoint records (all tiers).
 * @returns A plain object representing a valid OpenAPI 3.1 document.
 */
export declare function generateOpenApiSpec(endpoints: EndpointRecord[]): object;
/**
 * Write an OpenAPI specification object to a YAML file.
 *
 * @param spec       - The OpenAPI spec object (from generateOpenApiSpec).
 * @param outputPath - Absolute path to the output .yaml file.
 */
export declare function writeOpenApiYaml(spec: object, outputPath: string): Promise<void>;
//# sourceMappingURL=openapiGenerator.d.ts.map