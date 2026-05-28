/**
 * CodeLens — XML/Spring Tier 1 Scanner
 *
 * Uses fast-xml-parser to scan Spring XML config files, web.xml, and WSDL files.
 * Handles: Spring MVC servlet mappings, web.xml URL patterns, WSDL operations.
 */
import { EndpointRecord } from '../../shared/types';
/**
 * Scan XML files for API endpoint definitions.
 */
export declare function scanXmlFiles(files: string[], workspaceRoot: string): Promise<EndpointRecord[]>;
//# sourceMappingURL=scanner.d.ts.map