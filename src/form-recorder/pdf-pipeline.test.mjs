import test, { describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { extractFromPDF, extractFromMultiplePDFs } from './pdf-pipeline.js';

describe('pdf-pipeline', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('extractFromPDF uses LlamaParse successfully', async () => {
    let fetchCount = 0;
    globalThis.fetch = async (url, opts) => {
      fetchCount++;
      if (url.includes('/upload')) {
        return { ok: true, json: async () => ({ id: 'job-123' }) };
      }
      if (url.includes('/job/job-123/result/markdown')) {
        return { ok: true, json: async () => ({ markdown: 'Invoice Number: INV-001\nTotal Amount: $100.00' }) };
      }
      if (url.includes('/job/job-123')) {
        return { ok: true, json: async () => ({ status: 'SUCCESS' }) };
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    const buffer = new ArrayBuffer(8);
    const { rows, source } = await extractFromPDF(buffer, ['Invoice Number', 'Total Amount']);
    
    assert.equal(source, 'llamaparse');
    assert.equal(rows.length, 1);
    assert.equal(rows[0]['Invoice Number'], 'INV-001');
    assert.equal(rows[0]['Total Amount'], '$100.00');
  });

  test('extractFromPDF falls back to Mindee when LlamaParse fails', async () => {
    globalThis.fetch = async (url, opts) => {
      if (url.includes('llamaindex')) {
        return { ok: false, status: 500, text: async () => 'Internal Server Error' };
      }
      if (url.includes('mindee')) {
        return {
          ok: true,
          json: async () => ({
            document: {
              inference: {
                prediction: {
                  invoice_number: { value: 'MIND-999' },
                  total_amount: { value: '250.00' }
                }
              }
            }
          })
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    // Suppress console.warn during test
    const originalWarn = console.warn;
    console.warn = () => {};

    const buffer = new ArrayBuffer(8);
    const { rows, source } = await extractFromPDF(buffer, ['Invoice Number', 'Total Amount']);
    
    console.warn = originalWarn;

    assert.equal(source, 'mindee');
    assert.equal(rows.length, 1);
    assert.equal(rows[0]['Invoice Number'], 'MIND-999');
    assert.equal(rows[0]['Total Amount'], '250.00');
  });

  test('extractFromMultiplePDFs handles successes and errors', async () => {
    let callCount = 0;
    globalThis.fetch = async (url, opts) => {
      if (url.includes('llamaindex')) {
        callCount++;
        if (callCount === 1) { // First PDF fails
          return { ok: false, status: 500, text: async () => 'Error' };
        } else { // Second PDF succeeds
          if (url.includes('/upload')) return { ok: true, json: async () => ({ id: 'job-123' }) };
          if (url.includes('/result/markdown')) return { ok: true, json: async () => ({ markdown: 'Test: Data' }) };
          if (url.includes('/job/')) return { ok: true, json: async () => ({ status: 'SUCCESS' }) };
        }
      }
      if (url.includes('mindee')) {
        return { ok: false, status: 400, text: async () => 'Bad Request' };
      }
    };

    const originalWarn = console.warn;
    console.warn = () => {};

    const buf1 = new ArrayBuffer(8);
    const buf2 = new ArrayBuffer(8);
    const result = await extractFromMultiplePDFs([buf1, buf2], ['Test']);
    
    console.warn = originalWarn;

    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0]['Test'], 'Data');
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].index, 0);
  });

  test('extractFromPDF covers markdown tables and fuzzy keyword matching', async () => {
    globalThis.fetch = async (url) => {
      if (url.includes('/upload')) return { ok: true, json: async () => ({ id: 'job-123' }) };
      if (url.includes('/job/job-123/result/markdown')) {
        return { ok: true, json: async () => ({ markdown: 'Random text\n| Column 1 | Tax | Amount |\n|---|---|---|\n| Data 1 | 10% | $50.00 |\n\nTotal Due\n$999.99\n\n' }) };
      }
      if (url.includes('/job/job-123')) return { ok: true, json: async () => ({ status: 'SUCCESS' }) };
    };
    
    const buffer = new ArrayBuffer(8);
    const { rows } = await extractFromPDF(buffer, ['Amount', 'Total Due', 'Missing Field']);
    
    assert.equal(rows[0]['Amount'], '$50.00'); // Strategy 2: Table
    assert.equal(rows[0]['Total Due'], '$999.99'); // Strategy 3: Fuzzy
    assert.equal(rows[0]['Missing Field'], '');
  });

  test('extractFromPDF LlamaParse handles result fetch error', async () => {
    globalThis.fetch = async (url) => {
      if (url.includes('/upload')) return { ok: true, json: async () => ({ id: 'job-123' }) };
      if (url.includes('/job/job-123/result/markdown')) return { ok: false, status: 500 };
      if (url.includes('/job/job-123')) return { ok: true, json: async () => ({ status: 'SUCCESS' }) };
      if (url.includes('mindee')) return { ok: false, status: 400, text: async () => 'err' };
    };
    const originalWarn = console.warn;
    console.warn = () => {};
    await assert.rejects(extractFromPDF(new ArrayBuffer(8), []), /LlamaParse and Mindee both errored/);
    console.warn = originalWarn;
  });

  test('extractFromPDF LlamaParse handles failed status', async () => {
    globalThis.fetch = async (url) => {
      if (url.includes('/upload')) return { ok: true, json: async () => ({ id: 'job-123' }) };
      if (url.includes('/job/job-123')) return { ok: true, json: async () => ({ status: 'FAILED', error: 'Bad PDF' }) };
      if (url.includes('mindee')) return { ok: false, status: 400, text: async () => 'err' };
    };
    const originalWarn = console.warn;
    console.warn = () => {};
    await assert.rejects(extractFromPDF(new ArrayBuffer(8), []), /LlamaParse and Mindee both errored/);
    console.warn = originalWarn;
  });

  test('extractFromPDF LlamaParse handles timeout', async () => {
    globalThis.fetch = async (url) => {
      if (url.includes('/upload')) return { ok: true, json: async () => ({ id: 'job-123' }) };
      if (url.includes('/job/job-123')) return { ok: true, json: async () => ({ status: 'PENDING' }) }; // Always pending
      if (url.includes('mindee')) return { ok: false, status: 400, text: async () => 'err' };
    };

    // Override setTimeout to speed up the test loop
    const originalSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = (cb, ms) => originalSetTimeout(cb, 1);

    const originalWarn = console.warn;
    console.warn = () => {};
    await assert.rejects(extractFromPDF(new ArrayBuffer(8), []), /LlamaParse and Mindee both errored/);
    console.warn = originalWarn;

    globalThis.setTimeout = originalSetTimeout;
  });

  test('extractFromPDF handles Mindee with line items and partial matching', async () => {
    globalThis.fetch = async (url) => {
      if (url.includes('llamaindex')) return { ok: false, status: 500, text: async () => 'err' };
      if (url.includes('mindee')) return {
        ok: true,
        json: async () => ({
          document: { inference: { prediction: {
            total_tax: { value: '5.00' },
            line_items: [{ description: 'Item 1', quantity: 2 }]
          }}}
        })
      };
    };
    const originalWarn = console.warn;
    console.warn = () => {};
    const { rows } = await extractFromPDF(new ArrayBuffer(8), ['Total Tax', '__NAV_1__']);
    console.warn = originalWarn;

    assert.equal(rows[0]['Total Tax'], '5.00'); // Partial match 'tax'
  });
});
