import assert from 'node:assert';
import test, { describe } from 'node:test';
import { generateOpenApiSpec } from './api-spec-generator.js';

describe('generateOpenApiSpec', () => {
  test('generates valid OpenAPI spec from captured requests', () => {
    const capturedRequests = [
      {
        url: 'https://example.com/api/submit',
        method: 'POST',
        contentType: 'application/json',
        postData: JSON.stringify({ firstName: 'John', age: 30, tags: ['a'], emptyArr: [] }),
        responseStatus: 201,
        responseMimeType: 'application/json',
        responseBody: JSON.stringify({ success: true, id: 123 })
      }
    ];

    const formMap = {
      fields: [
        { name: 'first_name', columnName: 'First Name' },
        { name: 'age', columnName: 'Age' }
      ]
    };

    const spec = generateOpenApiSpec(capturedRequests, formMap);

    assert.ok(spec);
    assert.strictEqual(spec.openapi, '3.0.0');
    assert.strictEqual(spec.servers[0].url, 'https://example.com');
    
    const operation = spec.paths['/api/submit'].post;
    assert.ok(operation);
    
    const requestSchema = operation.requestBody.content['application/json'].schema;
    assert.strictEqual(requestSchema.type, 'object');
    assert.strictEqual(requestSchema.properties.firstName.type, 'string');
    assert.strictEqual(requestSchema.properties.firstName.description, 'Mapped from CSV Column: First Name');
    assert.strictEqual(requestSchema.properties.tags.type, 'array');
    assert.strictEqual(requestSchema.properties.tags.items.type, 'string');
    assert.strictEqual(requestSchema.properties.emptyArr.type, 'array');
    assert.strictEqual(requestSchema.properties.emptyArr.items.type, 'string');
    
    const responseSchema = operation.responses['201'].content['application/json'].schema;
    assert.strictEqual(responseSchema.properties.success.type, 'boolean');
  });

  test('handles empty or missing parameters', () => {
    assert.strictEqual(generateOpenApiSpec([], null), null);
    assert.strictEqual(generateOpenApiSpec(null, null), null);
  });

  test('handles non-JSON bodies gracefully', () => {
    const capturedRequests = [
      {
        url: 'https://example.com/api/form',
        method: 'POST',
        contentType: 'application/x-www-form-urlencoded',
        postData: 'firstName=John&age=30',
        responseStatus: 200,
        responseBody: 'Success'
      }
    ];

    const spec = generateOpenApiSpec(capturedRequests, null);
    const operation = spec.paths['/api/form'].post;
    const requestSchema = operation.requestBody.content['application/x-www-form-urlencoded'].schema;
    
    assert.strictEqual(requestSchema.type, 'object');
    assert.ok(requestSchema.description.includes('Raw payload'));
  });
});
