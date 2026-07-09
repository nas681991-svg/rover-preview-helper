import test, { describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { labelFields } from './labeler.js';

describe('labeler', () => {
  beforeEach(() => {
    globalThis.window = {};
  });

  afterEach(() => {
    delete globalThis.window;
  });

  test('labelFields returns empty when no fields', async () => {
    assert.deepEqual(await labelFields(null), null);
    assert.deepEqual(await labelFields([]), []);
  });

  test('labelFields uses heuristic labeling when AI not available', async () => {
    const fields = [
      { name: 'first_name' },
      { name: 'lastName' },
      { label: 'Custom Label' },
      { selector: '#unknown' }
    ];
    const labeled = await labelFields(fields);
    assert.equal(labeled[0].columnName, 'First Name');
    assert.equal(labeled[1].columnName, 'Last Name');
    assert.equal(labeled[2].columnName, 'Custom Label');
    assert.equal(labeled[3].columnName, 'Unknown Field');
  });

  test('labelFields uses Rover AI when available', async () => {
    globalThis.window.rover = {
      send: async (msg) => {
        if (msg.type === 'ai-prompt') {
          return JSON.stringify([
            { selector: '#fname', columnName: 'AI First Name' },
            { selector: '#lname', columnName: 'AI Last Name' }
          ]);
        }
      }
    };

    const fields = [
      { selector: '#fname', name: 'first_name' },
      { selectorChain: ['#lname', 'input[name="lastName"]'], name: 'lastName' },
      { selector: '#missing' }
    ];

    const labeled = await labelFields(fields);
    assert.equal(labeled[0].columnName, 'AI First Name');
    assert.equal(labeled[1].columnName, 'AI Last Name'); // Matches selectorChain[0]
    assert.equal(labeled[2].columnName, 'Unknown Field');
  });

  test('labelFields handles AI returning markdown blocks', async () => {
    globalThis.window.rover = {
      send: async () => '```json\n[{"selector":"#test","columnName":"Test Col"}]\n```'
    };
    const labeled = await labelFields([{ selector: '#test' }]);
    assert.equal(labeled[0].columnName, 'Test Col');
  });

  test('labelFields falls back if AI returns invalid JSON', async () => {
    globalThis.window.rover = {
      send: async () => 'Not JSON'
    };
    const originalWarn = console.warn;
    console.warn = () => {};
    const labeled = await labelFields([{ name: 'testField' }]);
    console.warn = originalWarn;
    assert.equal(labeled[0].columnName, 'Test Field');
  });

  test('labelFields falls back if rover.send throws', async () => {
    globalThis.window.rover = {
      send: async () => { throw new Error('Network error'); }
    };
    const originalWarn = console.warn;
    console.warn = () => {};
    const labeled = await labelFields([{ name: 'test_field' }]);
    console.warn = originalWarn;
    assert.equal(labeled[0].columnName, 'Test Field');
  });
});
