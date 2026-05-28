/**
 * Unit tests for src/shared/constants.ts
 *
 * Validates that all constant maps and sentinel values are correctly defined
 * and complete.
 */

import * as assert from 'assert';
import {
  UNRESOLVED,
  DEFAULT_OUTPUT_DIR,
  DEFAULT_OLLAMA_URL,
  DEFAULT_OLLAMA_MODEL,
  DEFAULT_OLLAMA_TEMPERATURE,
  DEFAULT_OLLAMA_CONCURRENCY,
  DEFAULT_OLLAMA_MAX_TOKENS,
  OLLAMA_API,
  DEFAULT_EXCLUDE_PATTERNS,
  LANGUAGE_FILE_PATTERNS,
  FRAMEWORK_MARKERS,
  PYTHON_FRAMEWORK_IMPORTS,
  NODE_FRAMEWORK_PACKAGES,
  HTTP_STATUS_DESCRIPTIONS,
  PYTHON_TYPE_MAP,
  TYPESCRIPT_TYPE_MAP,
  FLASK_CONVERTER_MAP,
  ORM_PATTERNS,
} from '../../shared/constants';

// ─── UNRESOLVED Sentinel ─────────────────────────────────────────────────────

describe('UNRESOLVED sentinel', () => {
  it('should equal the string "__UNRESOLVED__"', () => {
    assert.strictEqual(UNRESOLVED, '__UNRESOLVED__');
  });

  it('should be a const string literal type', () => {
    assert.strictEqual(typeof UNRESOLVED, 'string');
  });
});

// ─── Defaults ────────────────────────────────────────────────────────────────

describe('Default configuration constants', () => {
  it('DEFAULT_OUTPUT_DIR should be ".codelens"', () => {
    assert.strictEqual(DEFAULT_OUTPUT_DIR, '.codelens');
  });

  it('DEFAULT_OLLAMA_URL should be localhost:11434', () => {
    assert.strictEqual(DEFAULT_OLLAMA_URL, 'http://localhost:11434');
  });

  it('DEFAULT_OLLAMA_MODEL should be defined', () => {
    assert.strictEqual(typeof DEFAULT_OLLAMA_MODEL, 'string');
    assert.ok(DEFAULT_OLLAMA_MODEL.length > 0);
  });

  it('DEFAULT_OLLAMA_TEMPERATURE should be a small positive number', () => {
    assert.strictEqual(typeof DEFAULT_OLLAMA_TEMPERATURE, 'number');
    assert.ok(DEFAULT_OLLAMA_TEMPERATURE >= 0 && DEFAULT_OLLAMA_TEMPERATURE <= 1);
  });

  it('DEFAULT_OLLAMA_CONCURRENCY should be a positive integer', () => {
    assert.strictEqual(typeof DEFAULT_OLLAMA_CONCURRENCY, 'number');
    assert.ok(DEFAULT_OLLAMA_CONCURRENCY >= 1);
  });

  it('DEFAULT_OLLAMA_MAX_TOKENS should be a positive integer', () => {
    assert.strictEqual(typeof DEFAULT_OLLAMA_MAX_TOKENS, 'number');
    assert.ok(DEFAULT_OLLAMA_MAX_TOKENS >= 1);
  });
});

// ─── OLLAMA_API ──────────────────────────────────────────────────────────────

describe('OLLAMA_API', () => {
  it('should have GENERATE, CHAT, TAGS, and SHOW endpoints', () => {
    assert.strictEqual(OLLAMA_API.GENERATE, '/api/generate');
    assert.strictEqual(OLLAMA_API.CHAT, '/api/chat');
    assert.strictEqual(OLLAMA_API.TAGS, '/api/tags');
    assert.strictEqual(OLLAMA_API.SHOW, '/api/show');
  });
});

// ─── DEFAULT_EXCLUDE_PATTERNS ────────────────────────────────────────────────

describe('DEFAULT_EXCLUDE_PATTERNS', () => {
  it('should be an array of glob patterns', () => {
    assert.ok(Array.isArray(DEFAULT_EXCLUDE_PATTERNS));
    assert.ok(DEFAULT_EXCLUDE_PATTERNS.length > 0);
  });

  it('should exclude node_modules', () => {
    assert.ok(DEFAULT_EXCLUDE_PATTERNS.some(p => p.includes('node_modules')));
  });

  it('should exclude .git', () => {
    assert.ok(DEFAULT_EXCLUDE_PATTERNS.some(p => p.includes('.git')));
  });

  it('should exclude dist and build', () => {
    assert.ok(DEFAULT_EXCLUDE_PATTERNS.some(p => p.includes('dist')));
    assert.ok(DEFAULT_EXCLUDE_PATTERNS.some(p => p.includes('build')));
  });

  it('should exclude Python virtual environments', () => {
    assert.ok(DEFAULT_EXCLUDE_PATTERNS.some(p => p.includes('venv')));
    assert.ok(DEFAULT_EXCLUDE_PATTERNS.some(p => p.includes('.venv')));
  });

  it('should exclude minified JS and declaration files', () => {
    assert.ok(DEFAULT_EXCLUDE_PATTERNS.some(p => p.includes('.min.js')));
    assert.ok(DEFAULT_EXCLUDE_PATTERNS.some(p => p.includes('.d.ts')));
  });
});

// ─── LANGUAGE_FILE_PATTERNS ──────────────────────────────────────────────────

describe('LANGUAGE_FILE_PATTERNS', () => {
  const expectedLanguages = ['python', 'typescript', 'javascript', 'xml', 'java', 'go'];

  for (const lang of expectedLanguages) {
    it(`should have patterns for "${lang}"`, () => {
      assert.ok(LANGUAGE_FILE_PATTERNS[lang], `Missing patterns for ${lang}`);
      assert.ok(Array.isArray(LANGUAGE_FILE_PATTERNS[lang]));
      assert.ok(LANGUAGE_FILE_PATTERNS[lang].length > 0);
    });
  }

  it('should include .py patterns for python', () => {
    assert.ok(LANGUAGE_FILE_PATTERNS.python.some(p => p.includes('.py')));
  });

  it('should include .ts patterns for typescript', () => {
    assert.ok(LANGUAGE_FILE_PATTERNS.typescript.some(p => p.includes('.ts')));
  });

  it('should include .js patterns for javascript', () => {
    assert.ok(LANGUAGE_FILE_PATTERNS.javascript.some(p => p.includes('.js')));
  });

  it('should include .xml and .wsdl patterns for xml', () => {
    assert.ok(LANGUAGE_FILE_PATTERNS.xml.some(p => p.includes('.xml')));
    assert.ok(LANGUAGE_FILE_PATTERNS.xml.some(p => p.includes('.wsdl')));
  });
});

// ─── FRAMEWORK_MARKERS ──────────────────────────────────────────────────────

describe('FRAMEWORK_MARKERS', () => {
  const expectedFrameworks = ['fastapi', 'flask', 'express', 'nestjs', 'spring-xml', 'servlet', 'wsdl'];

  for (const fw of expectedFrameworks) {
    it(`should have markers for "${fw}"`, () => {
      assert.ok(FRAMEWORK_MARKERS[fw], `Missing markers for ${fw}`);
      assert.ok(Array.isArray(FRAMEWORK_MARKERS[fw]));
      assert.ok(FRAMEWORK_MARKERS[fw].length > 0);
    });
  }
});

// ─── PYTHON_FRAMEWORK_IMPORTS ────────────────────────────────────────────────

describe('PYTHON_FRAMEWORK_IMPORTS', () => {
  it('should have fastapi imports', () => {
    assert.ok(PYTHON_FRAMEWORK_IMPORTS.fastapi);
    assert.ok(PYTHON_FRAMEWORK_IMPORTS.fastapi.includes('fastapi'));
  });

  it('should have flask imports', () => {
    assert.ok(PYTHON_FRAMEWORK_IMPORTS.flask);
    assert.ok(PYTHON_FRAMEWORK_IMPORTS.flask.includes('flask'));
  });
});

// ─── NODE_FRAMEWORK_PACKAGES ─────────────────────────────────────────────────

describe('NODE_FRAMEWORK_PACKAGES', () => {
  it('should have express packages', () => {
    assert.ok(NODE_FRAMEWORK_PACKAGES.express);
    assert.ok(NODE_FRAMEWORK_PACKAGES.express.includes('express'));
  });

  it('should have nestjs packages', () => {
    assert.ok(NODE_FRAMEWORK_PACKAGES.nestjs);
    assert.ok(NODE_FRAMEWORK_PACKAGES.nestjs.some(p => p.includes('@nestjs')));
  });
});

// ─── HTTP_STATUS_DESCRIPTIONS ────────────────────────────────────────────────

describe('HTTP_STATUS_DESCRIPTIONS', () => {
  const expectedCodes = [200, 201, 204, 400, 401, 403, 404, 405, 409, 422, 429, 500, 502, 503];

  for (const code of expectedCodes) {
    it(`should have description for status ${code}`, () => {
      assert.ok(
        HTTP_STATUS_DESCRIPTIONS[code],
        `Missing description for HTTP ${code}`
      );
      assert.strictEqual(typeof HTTP_STATUS_DESCRIPTIONS[code], 'string');
      assert.ok(HTTP_STATUS_DESCRIPTIONS[code].length > 0);
    });
  }

  it('200 should be "OK"', () => {
    assert.strictEqual(HTTP_STATUS_DESCRIPTIONS[200], 'OK');
  });

  it('201 should be "Created"', () => {
    assert.strictEqual(HTTP_STATUS_DESCRIPTIONS[201], 'Created');
  });

  it('404 should be "Not Found"', () => {
    assert.strictEqual(HTTP_STATUS_DESCRIPTIONS[404], 'Not Found');
  });

  it('500 should be "Internal Server Error"', () => {
    assert.strictEqual(HTTP_STATUS_DESCRIPTIONS[500], 'Internal Server Error');
  });
});

// ─── PYTHON_TYPE_MAP ─────────────────────────────────────────────────────────

describe('PYTHON_TYPE_MAP', () => {
  const expectedMappings: Record<string, string> = {
    str: 'string',
    int: 'integer',
    float: 'number',
    bool: 'boolean',
    list: 'array',
    dict: 'object',
    None: 'null',
  };

  for (const [pyType, jsonType] of Object.entries(expectedMappings)) {
    it(`should map "${pyType}" → "${jsonType}"`, () => {
      assert.strictEqual(PYTHON_TYPE_MAP[pyType], jsonType);
    });
  }

  it('should map datetime types to "string"', () => {
    assert.strictEqual(PYTHON_TYPE_MAP.datetime, 'string');
    assert.strictEqual(PYTHON_TYPE_MAP.date, 'string');
    assert.strictEqual(PYTHON_TYPE_MAP.time, 'string');
  });

  it('should map uuid and UUID to "string"', () => {
    assert.strictEqual(PYTHON_TYPE_MAP.uuid, 'string');
    assert.strictEqual(PYTHON_TYPE_MAP.UUID, 'string');
  });

  it('should map Decimal to "number"', () => {
    assert.strictEqual(PYTHON_TYPE_MAP.Decimal, 'number');
  });

  it('should map Any to "object"', () => {
    assert.strictEqual(PYTHON_TYPE_MAP.Any, 'object');
  });
});

// ─── TYPESCRIPT_TYPE_MAP ─────────────────────────────────────────────────────

describe('TYPESCRIPT_TYPE_MAP', () => {
  const expectedMappings: Record<string, string> = {
    string: 'string',
    number: 'number',
    boolean: 'boolean',
    object: 'object',
    any: 'object',
    void: 'null',
    undefined: 'null',
    null: 'null',
  };

  for (const [tsType, jsonType] of Object.entries(expectedMappings)) {
    it(`should map "${tsType}" → "${jsonType}"`, () => {
      assert.strictEqual(TYPESCRIPT_TYPE_MAP[tsType], jsonType);
    });
  }

  it('should map Date to "string"', () => {
    assert.strictEqual(TYPESCRIPT_TYPE_MAP.Date, 'string');
  });

  it('should map Buffer to "string"', () => {
    assert.strictEqual(TYPESCRIPT_TYPE_MAP.Buffer, 'string');
  });
});

// ─── FLASK_CONVERTER_MAP ─────────────────────────────────────────────────────

describe('FLASK_CONVERTER_MAP', () => {
  it('should map flask URL converter types', () => {
    assert.strictEqual(FLASK_CONVERTER_MAP.string, 'string');
    assert.strictEqual(FLASK_CONVERTER_MAP.int, 'integer');
    assert.strictEqual(FLASK_CONVERTER_MAP.float, 'number');
    assert.strictEqual(FLASK_CONVERTER_MAP.path, 'string');
    assert.strictEqual(FLASK_CONVERTER_MAP.uuid, 'string');
  });
});

// ─── ORM_PATTERNS ────────────────────────────────────────────────────────────

describe('ORM_PATTERNS', () => {
  const expectedORMs = ['sqlalchemy', 'typeorm', 'prisma', 'mongoose'];
  const expectedCategories = ['read', 'create', 'update', 'delete'];

  for (const orm of expectedORMs) {
    describe(`${orm}`, () => {
      it('should exist in ORM_PATTERNS', () => {
        assert.ok(ORM_PATTERNS[orm as keyof typeof ORM_PATTERNS], `Missing ORM: ${orm}`);
      });

      for (const category of expectedCategories) {
        it(`should have "${category}" patterns`, () => {
          const patterns = (ORM_PATTERNS as any)[orm][category];
          assert.ok(Array.isArray(patterns), `${orm}.${category} should be an array`);
          assert.ok(patterns.length > 0, `${orm}.${category} should not be empty`);
        });
      }
    });
  }

  it('sqlalchemy should have commit patterns', () => {
    assert.ok(Array.isArray(ORM_PATTERNS.sqlalchemy.commit));
    assert.ok(ORM_PATTERNS.sqlalchemy.commit.length > 0);
  });
});
