import test, { describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { convertToSkill, downloadSkill, convertToUASL, downloadUASL } from './skill-converter.js';

describe('skill-converter', () => {
  let downloads = [];

  let originalURL;

  beforeEach(() => {
    downloads = [];
    globalThis.chrome = {
      downloads: {
        download: async (options) => {
          downloads.push(options);
        }
      }
    };
    globalThis.Blob = class {
      constructor(parts, options) {
        this.parts = parts;
        this.options = options;
      }
    };
    originalURL = globalThis.URL;
    globalThis.URL = class {
      constructor(url) {
        this.hostname = 'test.com';
      }
      static createObjectURL(blob) {
        return 'data:application/json;base64,mock';
      }
      static revokeObjectURL(url) {
        // no-op
      }
    };
  });

  afterEach(() => {
    delete globalThis.chrome;
    delete globalThis.Blob;
    globalThis.URL = originalURL;
  });

  test('convertToSkill handles empty fields', () => {
    const skill = convertToSkill({ startUrl: 'https://test.com' });
    assert.equal(skill.description, 'An empty form automation skill.');
  });

  test('convertToSkill generates accurate description', () => {
    const skill = convertToSkill({
      name: 'Test Form',
      startUrl: 'https://test.com',
      totalPages: 2,
      fields: [
        { name: 'fname' },
        { label: 'Last Name' },
        { columnName: 'Email' },
        { name: 'Phone' },
        { name: 'Address' },
        { name: 'City' } // 6 fields, so > 5
      ]
    });
    assert.match(skill.description, /across 2 pages/);
    assert.match(skill.description, /and 1 more fields/);
    assert.ok(skill.schema.properties.fname);
    assert.ok(skill.schema.properties.last_name);
  });

  test('downloadSkill creates Blob and downloads', async () => {
    await downloadSkill({
      name: 'Test',
      startUrl: 'https://test.com',
      fields: [{ name: 'test' }]
    });
    assert.equal(downloads.length, 1);
    assert.equal(downloads[0].filename, 'Test.skill.json');
    assert.ok(downloads[0].url.startsWith('data:'));
  });
  test('convertToUASL generates correctly mapped yaml structure', () => {
    const uasl = convertToUASL({
      name: 'UASL Test',
      startUrl: 'https://test.com',
      fields: [
        {
          name: 'email',
          label: 'Email Address',
          selectorChain: ['#email', 'input[name="email"]', 'xpath://input[@id="email"]'],
          coords: { x: 100, y: 200 }
        }
      ]
    });
    
    assert.equal(uasl.version, '1.0.0');
    assert.equal(uasl.metadata.target_url, 'https://test.com');
    assert.equal(uasl.schema[0].field, 'email_address');
    
    // Test the selector cascade mapping
    const step = uasl.steps.find(s => s.action === 'fill_field');
    assert.ok(step);
    assert.equal(step.selectors.primary, '#email');
    assert.equal(step.selectors.xpath, '//input[@id="email"]');
    assert.equal(step.selectors.heuristic, 'Email Address');
    assert.equal(step.selectors.coordinates.x, 100);
  });

  test('downloadUASL creates Blob and downloads', async () => {
    await downloadUASL({
      name: 'Test',
      startUrl: 'https://test.com',
      fields: [{ name: 'test' }]
    });
    assert.equal(downloads.length, 1);
    assert.equal(downloads[0].filename, 'Test.rover.json');
    assert.ok(downloads[0].url.startsWith('data:'));
  });
});
