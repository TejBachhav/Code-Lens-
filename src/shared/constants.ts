/**
 * CodeLens — Constants and Sentinel Values
 *
 * Centralized constants used across the pipeline.
 */

/** Sentinel value for types/schemas that could not be statically resolved */
export const UNRESOLVED = '__UNRESOLVED__' as const;

/** Default output directory name */
export const DEFAULT_OUTPUT_DIR = '.codelens';

/** Default Ollama configuration */
export const DEFAULT_OLLAMA_URL = 'http://localhost:11434';
export const DEFAULT_OLLAMA_MODEL = 'qwen2.5-coder:7b';
export const DEFAULT_OLLAMA_TEMPERATURE = 0.1;
export const DEFAULT_OLLAMA_CONCURRENCY = 2;
export const DEFAULT_OLLAMA_MAX_TOKENS = 2048;

/** Ollama API endpoints */
export const OLLAMA_API = {
  GENERATE: '/api/generate',
  CHAT: '/api/chat',
  TAGS: '/api/tags',
  SHOW: '/api/show',
} as const;

/** Default glob patterns to exclude from scanning */
export const DEFAULT_EXCLUDE_PATTERNS = [
  '**/node_modules/**',
  '**/.venv/**',
  '**/venv/**',
  '**/__pycache__/**',
  '**/dist/**',
  '**/build/**',
  '**/.git/**',
  '**/target/**',
  '**/.codelens/**',
  '**/*.min.js',
  '**/*.d.ts',
  '**/*.map',
  '**/*.lock',
] as const;

/** File patterns by language */
export const LANGUAGE_FILE_PATTERNS: Record<string, string[]> = {
  python: ['**/*.py'],
  typescript: ['**/*.ts', '**/*.tsx'],
  javascript: ['**/*.js', '**/*.jsx', '**/*.mjs', '**/*.cjs'],
  xml: ['**/*.xml', '**/*.wsdl', '**/*.wadl'],
  java: ['**/*.java'],
  go: ['**/*.go'],
};

/** Framework detection markers — files whose presence indicates a framework */
export const FRAMEWORK_MARKERS: Record<string, string[]> = {
  fastapi: ['requirements.txt', 'pyproject.toml', 'setup.py'],
  flask: ['requirements.txt', 'pyproject.toml', 'setup.py'],
  express: ['package.json'],
  nestjs: ['package.json', 'nest-cli.json'],
  'spring-xml': ['pom.xml', 'build.gradle'],
  servlet: ['web.xml', 'WEB-INF'],
  wsdl: ['**/*.wsdl'],
};

/** Python import patterns that indicate specific frameworks */
export const PYTHON_FRAMEWORK_IMPORTS: Record<string, string[]> = {
  fastapi: ['fastapi', 'FastAPI'],
  flask: ['flask', 'Flask'],
};

/** Node.js package names that indicate specific frameworks */
export const NODE_FRAMEWORK_PACKAGES: Record<string, string[]> = {
  express: ['express'],
  nestjs: ['@nestjs/core', '@nestjs/common'],
};

/** Common HTTP status codes and their descriptions */
export const HTTP_STATUS_DESCRIPTIONS: Record<number, string> = {
  200: 'OK',
  201: 'Created',
  204: 'No Content',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  409: 'Conflict',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
};

/** Python type annotation → JSON Schema type mapping */
export const PYTHON_TYPE_MAP: Record<string, string> = {
  str: 'string',
  int: 'integer',
  float: 'number',
  bool: 'boolean',
  list: 'array',
  dict: 'object',
  None: 'null',
  bytes: 'string',
  datetime: 'string',
  date: 'string',
  time: 'string',
  uuid: 'string',
  UUID: 'string',
  Decimal: 'number',
  Any: 'object',
};

/** TypeScript type → JSON Schema type mapping */
export const TYPESCRIPT_TYPE_MAP: Record<string, string> = {
  string: 'string',
  number: 'number',
  boolean: 'boolean',
  object: 'object',
  any: 'object',
  void: 'null',
  undefined: 'null',
  null: 'null',
  Date: 'string',
  Buffer: 'string',
};

/** Flask URL converter types → JSON Schema types */
export const FLASK_CONVERTER_MAP: Record<string, string> = {
  string: 'string',
  int: 'integer',
  float: 'number',
  path: 'string',
  uuid: 'string',
};

/** ORM patterns that indicate database side effects */
export const ORM_PATTERNS = {
  sqlalchemy: {
    read: ['query', 'filter', 'filter_by', 'get', 'all', 'first', 'one', 'scalar'],
    create: ['add', 'add_all', 'bulk_save_objects'],
    update: ['merge', 'bulk_update_mappings'],
    delete: ['delete'],
    commit: ['commit', 'flush'],
  },
  typeorm: {
    read: ['find', 'findOne', 'findOneBy', 'findBy', 'findAndCount', 'count', 'query'],
    create: ['save', 'insert', 'create'],
    update: ['update', 'save'],
    delete: ['delete', 'remove', 'softDelete'],
  },
  prisma: {
    read: ['findUnique', 'findFirst', 'findMany', 'count', 'aggregate', 'groupBy'],
    create: ['create', 'createMany'],
    update: ['update', 'updateMany', 'upsert'],
    delete: ['delete', 'deleteMany'],
  },
  mongoose: {
    read: ['find', 'findOne', 'findById', 'countDocuments', 'aggregate'],
    create: ['create', 'insertMany', 'save'],
    update: ['updateOne', 'updateMany', 'findOneAndUpdate', 'findByIdAndUpdate'],
    delete: ['deleteOne', 'deleteMany', 'findOneAndDelete', 'findByIdAndDelete'],
  },
} as const;
