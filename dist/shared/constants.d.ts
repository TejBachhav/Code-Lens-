/**
 * CodeLens — Constants and Sentinel Values
 *
 * Centralized constants used across the pipeline.
 */
/** Sentinel value for types/schemas that could not be statically resolved */
export declare const UNRESOLVED: "__UNRESOLVED__";
/** Default output directory name */
export declare const DEFAULT_OUTPUT_DIR = ".codelens";
/** Default Ollama configuration */
export declare const DEFAULT_OLLAMA_URL = "http://localhost:11434";
export declare const DEFAULT_OLLAMA_MODEL = "qwen2.5-coder:7b";
export declare const DEFAULT_OLLAMA_TEMPERATURE = 0.1;
export declare const DEFAULT_OLLAMA_CONCURRENCY = 2;
export declare const DEFAULT_OLLAMA_MAX_TOKENS = 2048;
/** Ollama API endpoints */
export declare const OLLAMA_API: {
    readonly GENERATE: "/api/generate";
    readonly CHAT: "/api/chat";
    readonly TAGS: "/api/tags";
    readonly SHOW: "/api/show";
};
/** Default glob patterns to exclude from scanning */
export declare const DEFAULT_EXCLUDE_PATTERNS: readonly ["**/node_modules/**", "**/.venv/**", "**/venv/**", "**/__pycache__/**", "**/dist/**", "**/build/**", "**/.git/**", "**/target/**", "**/.codelens/**", "**/*.min.js", "**/*.d.ts", "**/*.map", "**/*.lock"];
/** File patterns by language */
export declare const LANGUAGE_FILE_PATTERNS: Record<string, string[]>;
/** Framework detection markers — files whose presence indicates a framework */
export declare const FRAMEWORK_MARKERS: Record<string, string[]>;
/** Python import patterns that indicate specific frameworks */
export declare const PYTHON_FRAMEWORK_IMPORTS: Record<string, string[]>;
/** Node.js package names that indicate specific frameworks */
export declare const NODE_FRAMEWORK_PACKAGES: Record<string, string[]>;
/** Common HTTP status codes and their descriptions */
export declare const HTTP_STATUS_DESCRIPTIONS: Record<number, string>;
/** Python type annotation → JSON Schema type mapping */
export declare const PYTHON_TYPE_MAP: Record<string, string>;
/** TypeScript type → JSON Schema type mapping */
export declare const TYPESCRIPT_TYPE_MAP: Record<string, string>;
/** Flask URL converter types → JSON Schema types */
export declare const FLASK_CONVERTER_MAP: Record<string, string>;
/** ORM patterns that indicate database side effects */
export declare const ORM_PATTERNS: {
    readonly sqlalchemy: {
        readonly read: readonly ["query", "filter", "filter_by", "get", "all", "first", "one", "scalar"];
        readonly create: readonly ["add", "add_all", "bulk_save_objects"];
        readonly update: readonly ["merge", "bulk_update_mappings"];
        readonly delete: readonly ["delete"];
        readonly commit: readonly ["commit", "flush"];
    };
    readonly typeorm: {
        readonly read: readonly ["find", "findOne", "findOneBy", "findBy", "findAndCount", "count", "query"];
        readonly create: readonly ["save", "insert", "create"];
        readonly update: readonly ["update", "save"];
        readonly delete: readonly ["delete", "remove", "softDelete"];
    };
    readonly prisma: {
        readonly read: readonly ["findUnique", "findFirst", "findMany", "count", "aggregate", "groupBy"];
        readonly create: readonly ["create", "createMany"];
        readonly update: readonly ["update", "updateMany", "upsert"];
        readonly delete: readonly ["delete", "deleteMany"];
    };
    readonly mongoose: {
        readonly read: readonly ["find", "findOne", "findById", "countDocuments", "aggregate"];
        readonly create: readonly ["create", "insertMany", "save"];
        readonly update: readonly ["updateOne", "updateMany", "findOneAndUpdate", "findByIdAndUpdate"];
        readonly delete: readonly ["deleteOne", "deleteMany", "findOneAndDelete", "findByIdAndDelete"];
    };
};
//# sourceMappingURL=constants.d.ts.map