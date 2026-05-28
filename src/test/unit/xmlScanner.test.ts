/**
 * Unit tests for src/plugins/xml-spring/scanner.ts
 *
 * Tests scanXmlFiles() using the XML fixture files (web.xml, service.wsdl).
 * These are pure file-parsing tests — no network or tree-sitter required.
 */

import * as assert from 'assert';
import * as path from 'path';
import { scanXmlFiles } from '../../plugins/xml-spring/scanner';
import { EndpointRecord } from '../../shared/types';

const FIXTURES_DIR = path.resolve(__dirname, '..', 'fixtures', 'xml-app');
const WORKSPACE_ROOT = path.resolve(__dirname, '..', 'fixtures');

// ─── web.xml scanning ────────────────────────────────────────────────────────

describe('scanXmlFiles — web.xml', () => {
  let endpoints: EndpointRecord[];

  before(async () => {
    const webXmlPath = path.join(FIXTURES_DIR, 'web.xml');
    endpoints = await scanXmlFiles([webXmlPath], WORKSPACE_ROOT);
  });

  it('should produce at least one endpoint from web.xml', () => {
    assert.ok(endpoints.length > 0, `Expected endpoints, got ${endpoints.length}`);
  });

  it('should detect servlet framework', () => {
    for (const ep of endpoints) {
      assert.strictEqual(ep.framework, 'servlet');
    }
  });

  it('should detect xml language', () => {
    for (const ep of endpoints) {
      assert.strictEqual(ep.language, 'xml');
    }
  });

  it('should extract the url-pattern as the route path', () => {
    // The fixture has url-pattern /api/* which becomes /api/{wildcard}
    const apiEndpoint = endpoints.find(ep => ep.path.includes('/api'));
    assert.ok(apiEndpoint, 'Should find an endpoint with /api path');
  });

  it('should set the handler class from servlet-class', () => {
    const apiEndpoint = endpoints.find(ep => ep.path.includes('/api'));
    assert.ok(apiEndpoint);
    assert.ok(
      apiEndpoint.handler.className?.includes('ApiServlet') ||
      apiEndpoint.handler.name.includes('ApiServlet'),
      `Expected handler to reference ApiServlet, got: ${JSON.stringify(apiEndpoint.handler)}`
    );
  });

  it('should generate a unique non-empty ID', () => {
    for (const ep of endpoints) {
      assert.ok(ep.id, 'Endpoint ID should not be empty');
      assert.ok(ep.id.length > 0);
    }
  });

  it('should set method to GET (web.xml default)', () => {
    for (const ep of endpoints) {
      assert.strictEqual(ep.method, 'GET');
    }
  });

  it('should include decorators with servlet-mapping info', () => {
    const apiEndpoint = endpoints.find(ep => ep.path.includes('/api'));
    assert.ok(apiEndpoint);
    assert.ok(apiEndpoint.decorators.length > 0);
    assert.strictEqual(apiEndpoint.decorators[0].name, 'servlet-mapping');
  });

  it('should have a relative sourceFile path', () => {
    for (const ep of endpoints) {
      assert.ok(ep.sourceFile, 'sourceFile should be set');
      assert.ok(!path.isAbsolute(ep.sourceFile), `sourceFile should be relative, got: ${ep.sourceFile}`);
    }
  });

  it('should have sourceLines as a tuple', () => {
    for (const ep of endpoints) {
      assert.ok(Array.isArray(ep.sourceLines));
      assert.strictEqual(ep.sourceLines.length, 2);
    }
  });

  it('should include responseSchemas with unresolved schema', () => {
    const apiEndpoint = endpoints.find(ep => ep.path.includes('/api'));
    assert.ok(apiEndpoint);
    assert.ok(apiEndpoint.responseSchemas);
    assert.ok(apiEndpoint.responseSchemas.length > 0);
    assert.strictEqual(apiEndpoint.responseSchemas[0].statusCode, 200);
    assert.strictEqual(apiEndpoint.responseSchemas[0].contentType, 'text/html');
  });
});

// ─── WSDL scanning ───────────────────────────────────────────────────────────

describe('scanXmlFiles — WSDL', () => {
  let endpoints: EndpointRecord[];

  before(async () => {
    const wsdlPath = path.join(FIXTURES_DIR, 'service.wsdl');
    endpoints = await scanXmlFiles([wsdlPath], WORKSPACE_ROOT);
  });

  it('should produce endpoints from WSDL operations', () => {
    assert.ok(endpoints.length > 0, `Expected WSDL endpoints, got ${endpoints.length}`);
  });

  it('should produce exactly 2 endpoints for 2 operations', () => {
    assert.strictEqual(endpoints.length, 2, `Expected 2 endpoints, got ${endpoints.length}`);
  });

  it('should detect wsdl framework', () => {
    for (const ep of endpoints) {
      assert.strictEqual(ep.framework, 'wsdl');
    }
  });

  it('should set all WSDL operations as POST', () => {
    for (const ep of endpoints) {
      assert.strictEqual(ep.method, 'POST', 'SOAP operations should be POST');
    }
  });

  it('should include the service name and operation name in the path', () => {
    const paths = endpoints.map(ep => ep.path);
    // The fixture has definitions name="UserService" with operations getUser and createUser
    assert.ok(
      paths.some(p => p.includes('UserService') && p.includes('getUser')),
      `Expected path with UserService/getUser, got: ${paths.join(', ')}`
    );
    assert.ok(
      paths.some(p => p.includes('UserService') && p.includes('createUser')),
      `Expected path with UserService/createUser, got: ${paths.join(', ')}`
    );
  });

  it('should set handler name from operation name', () => {
    const getUserEp = endpoints.find(ep => ep.path.includes('getUser'));
    assert.ok(getUserEp);
    assert.strictEqual(getUserEp.handler.name, 'getUser');

    const createUserEp = endpoints.find(ep => ep.path.includes('createUser'));
    assert.ok(createUserEp);
    assert.strictEqual(createUserEp.handler.name, 'createUser');
  });

  it('should set requestBody for SOAP operations', () => {
    for (const ep of endpoints) {
      assert.ok(ep.requestBody, `Endpoint ${ep.path} should have requestBody`);
      assert.strictEqual(ep.requestBody.contentType, 'application/soap+xml');
      assert.strictEqual(ep.requestBody.required, true);
    }
  });

  it('should include WSDL input message type name in request body', () => {
    const getUserEp = endpoints.find(ep => ep.path.includes('getUser'));
    assert.ok(getUserEp?.requestBody);
    assert.ok(
      getUserEp.requestBody.typeName?.includes('GetUserRequest'),
      `Expected GetUserRequest, got: ${getUserEp.requestBody.typeName}`
    );
  });

  it('should include responseSchemas for SOAP operations', () => {
    for (const ep of endpoints) {
      assert.ok(ep.responseSchemas);
      assert.ok(ep.responseSchemas.length > 0);
      assert.strictEqual(ep.responseSchemas[0].statusCode, 200);
      assert.strictEqual(ep.responseSchemas[0].contentType, 'application/soap+xml');
    }
  });

  it('should have unique IDs per endpoint', () => {
    const ids = endpoints.map(ep => ep.id);
    const uniqueIds = new Set(ids);
    assert.strictEqual(uniqueIds.size, ids.length, 'All endpoint IDs should be unique');
  });

  it('should set xml language', () => {
    for (const ep of endpoints) {
      assert.strictEqual(ep.language, 'xml');
    }
  });

  it('should include wsdl:operation decorators', () => {
    for (const ep of endpoints) {
      assert.ok(ep.decorators.length > 0);
      assert.strictEqual(ep.decorators[0].name, 'wsdl:operation');
    }
  });
});

// ─── Combined scanning ───────────────────────────────────────────────────────

describe('scanXmlFiles — multiple files', () => {
  it('should scan both web.xml and WSDL in a single call', async () => {
    const files = [
      path.join(FIXTURES_DIR, 'web.xml'),
      path.join(FIXTURES_DIR, 'service.wsdl'),
    ];
    const endpoints = await scanXmlFiles(files, WORKSPACE_ROOT);
    assert.ok(endpoints.length >= 3, `Expected at least 3 endpoints total, got ${endpoints.length}`);

    const frameworks = new Set(endpoints.map(ep => ep.framework));
    assert.ok(frameworks.has('servlet'), 'Should include servlet endpoints');
    assert.ok(frameworks.has('wsdl'), 'Should include wsdl endpoints');
  });

  it('should handle empty file list', async () => {
    const endpoints = await scanXmlFiles([], WORKSPACE_ROOT);
    assert.deepStrictEqual(endpoints, []);
  });

  it('should handle non-existent files gracefully', async () => {
    const endpoints = await scanXmlFiles(['/nonexistent/file.xml'], WORKSPACE_ROOT);
    assert.deepStrictEqual(endpoints, []);
  });
});
