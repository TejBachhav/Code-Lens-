/**
 * CodeLens — Shared Type Definitions
 *
 * This file defines the pipeline JSON schema that flows through the three tiers:
 *   Tier 1 (AST Parsing) → Tier 2 (Data Flow Analysis) → Tier 3 (LLM Enrichment)
 *
 * Each tier adds fields without modifying previous tiers' data.
 * The "__UNRESOLVED__" sentinel marks types/info that could not be statically determined.
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD';
export type SupportedLanguage = 'python' | 'typescript' | 'javascript' | 'xml' | 'java' | 'go';
export type SupportedFramework = 'fastapi' | 'flask' | 'express' | 'nestjs' | 'spring-xml' | 'servlet' | 'wsdl' | 'generic';
/**
 * Primary pipeline record. Created by Tier 1 scanners, enriched by Tier 2 and Tier 3.
 */
export interface EndpointRecord {
    /** Unique identifier: hash of method + path + handler */
    id: string;
    /** HTTP method */
    method: HttpMethod;
    /** Normalized path with curly-brace params, e.g. "/users/{id}" */
    path: string;
    /** Handler function/method information */
    handler: HandlerInfo;
    /** All detected parameters */
    params: ParamRecord[];
    /** Request body definition, if applicable */
    requestBody?: RequestBodyRecord;
    /** Authentication/authorization info */
    auth?: AuthRecord;
    /** Middleware/interceptor names applied to this route */
    middleware: string[];
    /** Raw decorator/annotation records for reference */
    decorators: DecoratorRecord[];
    /** Which framework detected this endpoint */
    framework: SupportedFramework;
    /** Source language */
    language: SupportedLanguage;
    /** Relative path from workspace root */
    sourceFile: string;
    /** [startLine, endLine] in the source file */
    sourceLines: [number, number];
    /** Inferred response schemas by status code */
    responseSchemas?: ResponseSchemaRecord[];
    /** Detected side effects (DB writes, file I/O, etc.) */
    sideEffects?: SideEffectRecord[];
    /** Validation rules, permissions, business constraints */
    constraints?: ConstraintRecord[];
    /** Resolved type definitions mapped by name → JSON Schema */
    resolvedTypes?: Record<string, JsonSchema>;
    /** One-line summary of the endpoint's purpose */
    summary?: string;
    /** Detailed description of behavior and usage */
    description?: string;
    /** Working curl command example */
    curlExample?: string;
    /** Generated test cases */
    testCases?: TestCaseRecord[];
    /** Categorization tags */
    tags?: string[];
}
export interface HandlerInfo {
    /** Function or method name */
    name: string;
    /** Class name if this is a class method */
    className?: string;
    /** Relative module/file path */
    modulePath: string;
    /** Whether the handler is async */
    isAsync: boolean;
}
export interface ParamRecord {
    /** Parameter name */
    name: string;
    /** Where the parameter comes from */
    in: 'path' | 'query' | 'header' | 'cookie' | 'body';
    /** Type string: "string", "integer", "boolean", or "__UNRESOLVED__" */
    type: string;
    /** Whether the parameter is required */
    required: boolean;
    /** Default value, if any */
    default?: unknown;
    /** Human-readable description (populated in Tier 3) */
    description?: string;
    /** Validation constraints detected in Tier 2 */
    validationRules?: string[];
}
export interface RequestBodyRecord {
    /** MIME type */
    contentType: string;
    /** JSON Schema for the body, or "__UNRESOLVED__" */
    schema: JsonSchema | '__UNRESOLVED__';
    /** Whether the body is required */
    required: boolean;
    /** Original type name (e.g., "CreateUserDto", "UserCreate") */
    typeName?: string;
}
export interface AuthRecord {
    /** Auth scheme type */
    type: 'bearer' | 'api_key' | 'basic' | 'oauth2' | 'custom' | 'unknown';
    /** Auth scheme identifier */
    scheme?: string;
    /** Guard class name (NestJS) */
    guardName?: string;
    /** Dependency function name (FastAPI) */
    dependencyName?: string;
    /** Decorator name (Flask login_required, etc.) */
    decoratorName?: string;
}
export interface DecoratorRecord {
    /** Decorator/annotation name */
    name: string;
    /** Raw argument values */
    arguments: unknown[];
}
export interface ResponseSchemaRecord {
    /** HTTP status code */
    statusCode: number;
    /** Response content type */
    contentType: string;
    /** JSON Schema of the response body, or "__UNRESOLVED__" */
    schema: JsonSchema | '__UNRESOLVED__';
    /** Human-readable description (populated in Tier 3) */
    description?: string;
}
export interface SideEffectRecord {
    /** Category of side effect */
    type: 'database' | 'file_system' | 'cache' | 'queue' | 'external_call' | 'logging' | 'unknown';
    /** CRUD operation type */
    operation: 'CREATE' | 'READ' | 'UPDATE' | 'DELETE' | 'WRITE' | 'SEND' | 'UNKNOWN';
    /** Target entity: table name, file path, queue name, etc. */
    target?: string;
    /** How confident we are in this detection */
    confidence: 'high' | 'medium' | 'low';
}
export interface ConstraintRecord {
    /** Constraint category */
    type: 'validation' | 'rate_limit' | 'permission' | 'business_rule' | 'type_check';
    /** Human-readable description */
    description: string;
    /** Where the constraint was detected (decorator, guard, validator, etc.) */
    source: string;
}
export interface TestCaseRecord {
    /** Test name/title */
    name: string;
    /** What this test verifies */
    description: string;
    /** HTTP method for the test request */
    method: HttpMethod;
    /** URL path with substituted parameters */
    path: string;
    /** Request headers */
    headers?: Record<string, string>;
    /** Request body */
    body?: unknown;
    /** Expected HTTP status code */
    expectedStatus: number;
    /** Expected response body shape */
    expectedBodyShape?: JsonSchema;
    /** Assertion strings (framework-specific) */
    assertions: string[];
}
export interface JsonSchema {
    type?: string;
    properties?: Record<string, JsonSchema>;
    items?: JsonSchema;
    required?: string[];
    enum?: unknown[];
    format?: string;
    description?: string;
    $ref?: string;
    additionalProperties?: boolean | JsonSchema;
    nullable?: boolean;
    oneOf?: JsonSchema[];
    anyOf?: JsonSchema[];
    allOf?: JsonSchema[];
    default?: unknown;
    example?: unknown;
    minLength?: number;
    maxLength?: number;
    minimum?: number;
    maximum?: number;
    pattern?: string;
}
/**
 * Every language/framework module must implement this interface.
 * The plugin registry discovers and loads plugins at runtime.
 */
export interface LanguagePlugin {
    /** Unique plugin identifier, e.g. "python-fastapi" */
    id: string;
    /** Source language this plugin handles */
    language: SupportedLanguage;
    /** Framework this plugin handles */
    framework: SupportedFramework;
    /** Glob patterns for files this plugin can scan */
    filePatterns: string[];
    /**
     * Tier 1: Scan source files and extract endpoint records.
     * This must be purely deterministic — AST parsing only, no inference.
     */
    scan(files: string[], workspaceRoot: string): Promise<EndpointRecord[]>;
    /**
     * Tier 2: Enrich endpoint records with inter-procedural data flow analysis.
     * Adds response schemas, side effects, and constraints.
     */
    analyze(endpoints: EndpointRecord[], workspaceRoot: string): Promise<EndpointRecord[]>;
    /**
     * Detect whether this plugin should handle the given workspace.
     * Checks for framework-specific markers (package.json, requirements.txt, etc.)
     */
    detect(workspaceRoot: string, fileMap?: Map<string, string[]>): Promise<boolean>;
}
export type PipelineCommand = {
    type: 'start';
    workspaceRoot: string;
    options: PipelineOptions;
} | {
    type: 'cancel';
} | {
    type: 'status';
};
export type PipelineEvent = {
    type: 'progress';
    phase: PipelinePhase;
    message: string;
    percent: number;
} | {
    type: 'endpoints';
    data: EndpointRecord[];
} | {
    type: 'complete';
    data: PipelineResult;
} | {
    type: 'error';
    message: string;
    details?: string;
} | {
    type: 'log';
    level: LogLevel;
    message: string;
};
export type PipelinePhase = 'discovery' | 'detection' | 'tier1' | 'tier2' | 'tier3' | 'output' | 'complete';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export interface PipelineOptions {
    /** Which languages to scan */
    languages: SupportedLanguage[];
    /** Glob patterns to exclude */
    excludePatterns: string[];
    /** Whether to run Tier 3 LLM enrichment */
    enableTier3: boolean;
    /** Ollama configuration (only if Tier 3 enabled) */
    ollama?: OllamaConfig;
    /** Output directory (relative to workspace root) */
    outputDir: string;
}
export interface OllamaConfig {
    /** Ollama server URL */
    url: string;
    /** Model identifier */
    model: string;
    /** Temperature for generation */
    temperature: number;
    /** Max concurrent requests */
    concurrency: number;
}
export interface PipelineResult {
    /** All discovered endpoints */
    endpoints: EndpointRecord[];
    /** Detected frameworks and their file counts */
    detectedFrameworks: FrameworkDetection[];
    /** Paths to generated output files */
    outputFiles: OutputFileRecord[];
    /** Pipeline execution stats */
    stats: PipelineStats;
}
export interface FrameworkDetection {
    pluginId: string;
    language: SupportedLanguage;
    framework: SupportedFramework;
    fileCount: number;
    endpointCount: number;
}
export interface OutputFileRecord {
    type: 'openapi' | 'markdown' | 'test' | 'pipeline_json';
    path: string;
    language?: SupportedLanguage;
}
export interface PipelineStats {
    totalFiles: number;
    totalEndpoints: number;
    tier1DurationMs: number;
    tier2DurationMs: number;
    tier3DurationMs: number;
    outputDurationMs: number;
    totalDurationMs: number;
    unresolvedCount: number;
    errors: string[];
}
//# sourceMappingURL=types.d.ts.map