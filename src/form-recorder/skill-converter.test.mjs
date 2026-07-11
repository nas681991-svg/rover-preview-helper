import test, { describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { convertToSkill, downloadSkill } from './skill-converter.js';

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
});
