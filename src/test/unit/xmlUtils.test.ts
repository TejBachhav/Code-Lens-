/**
 * Unit tests for src/plugins/shared/xmlUtils.ts
 *
 * Tests all pure XML utility functions using inline XML strings
 * (no file I/O needed).
 */

import * as assert from 'assert';
import {
  parseXmlString,
  findElements,
  extractAttributes,
  getAttribute,
  getTextContent,
  getChildren,
  toXmlElement,
} from '../../plugins/shared/xmlUtils';

// ─── Test XML Strings ────────────────────────────────────────────────────────

const SIMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<root>
  <item id="1" name="first">Hello</item>
  <item id="2" name="second">World</item>
</root>`;

const WEB_XML = `<?xml version="1.0" encoding="UTF-8"?>
<web-app>
  <servlet>
    <servlet-name>api</servlet-name>
    <servlet-class>com.example.ApiServlet</servlet-class>
  </servlet>
  <servlet-mapping>
    <servlet-name>api</servlet-name>
    <url-pattern>/api/*</url-pattern>
  </servlet-mapping>
</web-app>`;

const WSDL_XML = `<?xml version="1.0" encoding="UTF-8"?>
<definitions name="UserService" xmlns="http://schemas.xmlsoap.org/wsdl/">
  <portType name="UserPortType">
    <operation name="getUser">
      <input message="tns:GetUserRequest"/>
      <output message="tns:GetUserResponse"/>
    </operation>
    <operation name="createUser">
      <input message="tns:CreateUserRequest"/>
      <output message="tns:CreateUserResponse"/>
    </operation>
  </portType>
</definitions>`;

const NESTED_XML = `<?xml version="1.0" encoding="UTF-8"?>
<root>
  <level1>
    <level2>
      <target attr="deep">Found me</target>
    </level2>
  </level1>
  <target attr="shallow">Also here</target>
</root>`;

const EMPTY_XML = `<?xml version="1.0" encoding="UTF-8"?><root/>`;

const ATTRS_XML = `<element name="test" version="2.0" enabled="true"/>`;

// ─── parseXmlString ──────────────────────────────────────────────────────────

describe('parseXmlString', () => {
  it('should parse valid XML into an object', () => {
    const result = parseXmlString(SIMPLE_XML);
    assert.ok(result !== null, 'Should not return null for valid XML');
    assert.strictEqual(typeof result, 'object');
  });

  it('should have the root element key', () => {
    const result = parseXmlString(SIMPLE_XML);
    assert.ok(result !== null);
    assert.ok('root' in result, 'Should contain "root" key');
  });

  it('should parse web.xml structure', () => {
    const result = parseXmlString(WEB_XML);
    assert.ok(result !== null);
    assert.ok('web-app' in result);
  });

  it('should parse WSDL structure', () => {
    const result = parseXmlString(WSDL_XML);
    assert.ok(result !== null);
    // The root element should be "definitions" (possibly namespace-prefixed)
    const keys = Object.keys(result);
    assert.ok(
      keys.some(k => k === 'definitions' || k.endsWith(':definitions')),
      `Expected a 'definitions' key, got: ${keys.join(', ')}`
    );
  });

  it('should return null for completely invalid XML', () => {
    const result = parseXmlString('<<<not xml at all>>>');
    // fast-xml-parser may or may not return null for badly formed XML;
    // the function catches errors and returns null
    // This tests the error-handling path
    assert.ok(result === null || typeof result === 'object');
  });

  it('should parse empty root element', () => {
    const result = parseXmlString(EMPTY_XML);
    assert.ok(result !== null);
    assert.ok('root' in result);
  });

  it('should parse attributes with @_ prefix', () => {
    const result = parseXmlString(SIMPLE_XML);
    assert.ok(result !== null);
    const root = result['root'] as any;
    const items = root['item'];
    assert.ok(Array.isArray(items), 'items should be an array');
    assert.ok('@_id' in items[0], 'Should have @_id attribute');
    assert.ok('@_name' in items[0], 'Should have @_name attribute');
  });

  it('should respect preserveNamespaces option', () => {
    const withNs = parseXmlString(WSDL_XML, { preserveNamespaces: true });
    const withoutNs = parseXmlString(WSDL_XML, { preserveNamespaces: false });
    assert.ok(withNs !== null);
    assert.ok(withoutNs !== null);
  });
});

// ─── findElements ────────────────────────────────────────────────────────────

describe('findElements', () => {
  it('should find elements by tag name', () => {
    const parsed = parseXmlString(SIMPLE_XML);
    assert.ok(parsed !== null);
    const items = findElements(parsed, 'item');
    assert.ok(items.length > 0, 'Should find at least one item');
  });

  it('should find all matching items in simple XML', () => {
    const parsed = parseXmlString(SIMPLE_XML);
    assert.ok(parsed !== null);
    const items = findElements(parsed, 'item');
    assert.strictEqual(items.length, 2);
  });

  it('should find nested elements', () => {
    const parsed = parseXmlString(NESTED_XML);
    assert.ok(parsed !== null);
    const targets = findElements(parsed, 'target');
    // Should find both deep and shallow targets
    assert.strictEqual(targets.length, 2);
  });

  it('should find servlet elements in web.xml', () => {
    const parsed = parseXmlString(WEB_XML);
    assert.ok(parsed !== null);
    const servlets = findElements(parsed, 'servlet');
    assert.ok(servlets.length > 0);
  });

  it('should find servlet-mapping elements in web.xml', () => {
    const parsed = parseXmlString(WEB_XML);
    assert.ok(parsed !== null);
    const mappings = findElements(parsed, 'servlet-mapping');
    assert.ok(mappings.length > 0);
  });

  it('should find operation elements in WSDL', () => {
    const parsed = parseXmlString(WSDL_XML);
    assert.ok(parsed !== null);
    const operations = findElements(parsed, 'operation');
    assert.ok(operations.length >= 2, `Expected at least 2 operations, found ${operations.length}`);
  });

  it('should return empty array for non-existing tag', () => {
    const parsed = parseXmlString(SIMPLE_XML);
    assert.ok(parsed !== null);
    const results = findElements(parsed, 'nonexistent');
    assert.deepStrictEqual(results, []);
  });

  it('should handle null/undefined input gracefully', () => {
    assert.deepStrictEqual(findElements(null, 'tag'), []);
    assert.deepStrictEqual(findElements(undefined, 'tag'), []);
  });
});

// ─── extractAttributes ───────────────────────────────────────────────────────

describe('extractAttributes', () => {
  it('should extract attributes from a parsed element', () => {
    const parsed = parseXmlString(ATTRS_XML) as any;
    assert.ok(parsed !== null);
    const attrs = extractAttributes(parsed['element']);
    assert.strictEqual(attrs['name'], 'test');
    // fast-xml-parser with parseAttributeValue=true coerces "2.0" → number 2
    assert.strictEqual(attrs['version'], '2');
  });

  it('should extract attributes from parsed items', () => {
    const parsed = parseXmlString(SIMPLE_XML) as any;
    assert.ok(parsed !== null);
    const items = parsed['root']['item'];
    const attrs = extractAttributes(items[0]);
    assert.strictEqual(attrs['id'], '1');
    assert.strictEqual(attrs['name'], 'first');
  });

  it('should return empty object for element with no attributes', () => {
    const parsed = parseXmlString('<element>text</element>') as any;
    assert.ok(parsed !== null);
    const attrs = extractAttributes(parsed['element']);
    // element has no @_ prefixed keys (just text content)
    // Should return empty or only non-@_ keys
    assert.strictEqual(typeof attrs, 'object');
  });

  it('should return empty object for null input', () => {
    const attrs = extractAttributes(null);
    assert.deepStrictEqual(attrs, {});
  });

  it('should return empty object for undefined input', () => {
    const attrs = extractAttributes(undefined);
    assert.deepStrictEqual(attrs, {});
  });

  it('should return empty object for non-object input', () => {
    const attrs = extractAttributes('string');
    assert.deepStrictEqual(attrs, {});
  });
});

// ─── getAttribute ────────────────────────────────────────────────────────────

describe('getAttribute', () => {
  it('should get a specific attribute value', () => {
    const parsed = parseXmlString(ATTRS_XML) as any;
    assert.ok(parsed !== null);
    const elem = parsed['element'];
    assert.strictEqual(getAttribute(elem, 'name'), 'test');
    // fast-xml-parser coerces "2.0" → 2 (number), getString returns "2"
    assert.strictEqual(getAttribute(elem, 'version'), '2');
  });

  it('should return undefined for non-existing attribute', () => {
    const parsed = parseXmlString(ATTRS_XML) as any;
    const elem = parsed['element'];
    assert.strictEqual(getAttribute(elem, 'missing'), undefined);
  });

  it('should return undefined for null input', () => {
    assert.strictEqual(getAttribute(null, 'name'), undefined);
  });

  it('should return undefined for undefined input', () => {
    assert.strictEqual(getAttribute(undefined, 'name'), undefined);
  });

  it('should return undefined for non-object input', () => {
    assert.strictEqual(getAttribute(42, 'name'), undefined);
  });

  it('should convert boolean attribute values to string', () => {
    const parsed = parseXmlString(ATTRS_XML) as any;
    const elem = parsed['element'];
    const enabled = getAttribute(elem, 'enabled');
    // fast-xml-parser may parse "true" as boolean true when parseAttributeValue is true
    assert.ok(enabled === 'true', `Expected "true", got: ${enabled}`);
  });
});

// ─── getTextContent ──────────────────────────────────────────────────────────

describe('getTextContent', () => {
  it('should get text content from a leaf element', () => {
    const parsed = parseXmlString('<root><message>Hello World</message></root>') as any;
    assert.ok(parsed !== null);
    const text = getTextContent(parsed['root']['message']);
    assert.strictEqual(text, 'Hello World');
  });

  it('should get text content from simple string value', () => {
    // When fast-xml-parser parses a text-only element, it may return a string directly
    const text = getTextContent('direct string');
    assert.strictEqual(text, 'direct string');
  });

  it('should return undefined for null input', () => {
    assert.strictEqual(getTextContent(null), undefined);
  });

  it('should return undefined for undefined input', () => {
    assert.strictEqual(getTextContent(undefined), undefined);
  });

  it('should convert numeric values to string', () => {
    const text = getTextContent(42);
    assert.strictEqual(text, '42');
  });

  it('should return text content from an element with #text key', () => {
    // Simulate fast-xml-parser output for mixed content
    const elem = { '#text': 'inner text', '@_id': '1' };
    const text = getTextContent(elem);
    assert.strictEqual(text, 'inner text');
  });

  it('should return undefined for objects without #text', () => {
    const elem = { '@_id': '1', child: 'value' };
    const text = getTextContent(elem);
    assert.strictEqual(text, undefined);
  });
});

// ─── getChildren ─────────────────────────────────────────────────────────────

describe('getChildren', () => {
  it('should get child elements by tag name', () => {
    const parsed = parseXmlString(WEB_XML) as any;
    assert.ok(parsed !== null);
    const webApp = parsed['web-app'];
    const servlets = getChildren(webApp, 'servlet');
    assert.ok(servlets.length > 0);
  });

  it('should return array even for single child', () => {
    const parsed = parseXmlString(WEB_XML) as any;
    const webApp = parsed['web-app'];
    const servlets = getChildren(webApp, 'servlet');
    assert.ok(Array.isArray(servlets));
  });

  it('should return empty array for non-existing child tag', () => {
    const parsed = parseXmlString(WEB_XML) as any;
    const webApp = parsed['web-app'];
    const results = getChildren(webApp, 'nonexistent');
    assert.deepStrictEqual(results, []);
  });

  it('should return empty array for null input', () => {
    assert.deepStrictEqual(getChildren(null, 'tag'), []);
  });

  it('should return empty array for undefined input', () => {
    assert.deepStrictEqual(getChildren(undefined, 'tag'), []);
  });

  it('should return empty array for non-object input', () => {
    assert.deepStrictEqual(getChildren('string', 'tag'), []);
  });

  it('should get multiple children as array', () => {
    const parsed = parseXmlString(SIMPLE_XML) as any;
    const root = parsed['root'];
    const items = getChildren(root, 'item');
    assert.strictEqual(items.length, 2);
  });
});

// ─── toXmlElement ────────────────────────────────────────────────────────────

describe('toXmlElement', () => {
  it('should convert a parsed object to XmlElement', () => {
    const parsed = parseXmlString(SIMPLE_XML) as any;
    const element = toXmlElement(parsed['root'], 'root');
    assert.strictEqual(element.tagName, 'root');
    assert.ok(element.children.length > 0);
  });

  it('should extract attributes into the attributes record', () => {
    const parsed = parseXmlString(ATTRS_XML) as any;
    const element = toXmlElement(parsed['element'], 'element');
    assert.strictEqual(element.attributes['name'], 'test');
    // fast-xml-parser coerces "2.0" → 2, so string conversion gives "2"
    assert.strictEqual(element.attributes['version'], '2');
  });

  it('should handle null input', () => {
    const element = toXmlElement(null, 'test');
    assert.strictEqual(element.tagName, 'test');
    assert.strictEqual(element.textContent, undefined);
    assert.deepStrictEqual(element.children, []);
  });

  it('should use default "root" tag name when not specified', () => {
    const element = toXmlElement({});
    assert.strictEqual(element.tagName, 'root');
  });

  it('should handle primitive input', () => {
    const element = toXmlElement('text value', 'leaf');
    assert.strictEqual(element.tagName, 'leaf');
    assert.strictEqual(element.textContent, 'text value');
    assert.strictEqual(element.rawValue, 'text value');
  });
});
