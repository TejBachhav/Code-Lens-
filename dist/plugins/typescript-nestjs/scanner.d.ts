/**
 * CodeLens — TypeScript/NestJS Tier 1 Scanner
 *
 * Uses ts-morph to scan NestJS controller files and extract endpoint records.
 * Handles: @Controller(), @Get/@Post/@Put/@Delete/@Patch decorators,
 *          @Param/@Query/@Body parameter decorators, @UseGuards auth detection,
 *          @HttpCode status codes, Promise<T>/Observable<T> return types.
 */
import { EndpointRecord } from '../../shared/types';
/**
 * Scan NestJS TypeScript files using ts-morph.
 */
export declare function scanNestJsFiles(files: string[], workspaceRoot: string): Promise<EndpointRecord[]>;
//# sourceMappingURL=scanner.d.ts.map