/**
 * Form Recorder Test Suite — Pure-Node unit tests for CSV engine,
 * selector engine utilities, and fuzzy matching logic.
 *
 * Run: node --test src/form-recorder/form-recorder.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

// ── Browser API Stubs ────────────────────────────────────────────────────────
// replay-engine.js and selector-engine.js call chrome.runtime.onMessage and
// reference `document` at module load time. Provide inert stubs so the
// pure-logic exports (similarity, findMatchingOption, etc.) can be tested in
// Node without a real browser.
//
// IMPORTANT: These must be set BEFORE importing the modules. ES static imports
// are hoisted, so we use dynamic import() below instead.

globalThis.chrome = globalThis.chrome || {
  runtime: {
    onMessage: { addListener: () => {} },
    sendMessage: () => Promise.resolve(),
  },
  storage: { session: { get: () => Promise.resolve({}), set: () => Promise.resolve() } },
};

globalThis.document = globalThis.document || {
  querySelector: () => null,
  querySelectorAll: () => [],
  body: null,
  documentElement: {},
  evaluate: () => ({ singleNodeValue: null }),
};

globalThis.CSS = globalThis.CSS || { escape: (s) => s };
globalThis.Node = globalThis.Node || { ELEMENT_NODE: 1 };
globalThis.MutationObserver = globalThis.MutationObserver || class { observe() {} disconnect() {} };
globalThis.Event = globalThis.Event || class Event { constructor() {} };
globalThis.KeyboardEvent = globalThis.KeyboardEvent || class KeyboardEvent { constructor() {} };
globalThis.XPathResult = globalThis.XPathResult || { FIRST_ORDERED_NODE_TYPE: 9 };
globalThis.window = globalThis.window || { getComputedStyle: () => ({}) };

// Dynamic imports — evaluated AFTER stubs are installed
const {
  parseCSV,
  parseCSVRow,
  escapeCSVField,
  generateTemplate,
  generateOutputCSV,
  deriveColumnName,
} = await import('./csv-engine.js');

const {
  similarity,
  findBestMatch,
} = await import('./fuzzy-matcher.js');

// ── Test 3: Deliberate Data Corruption / CSV Fuzzing ─────────────────────────

test('parseCSVRow handles RFC 4180 double-quote escaping', () => {
  // "John ""Johnny"" Doe" should parse to: John "Johnny" Doe
  const row = parseCSVRow('first,last,"John ""Johnny"" Doe",email');
  assert.equal(row.length, 4);
  assert.equal(row[0], 'first');
  assert.equal(row[2], 'John "Johnny" Doe');
  assert.equal(row[3], 'email');
});

test('parseCSVRow handles embedded commas inside quoted fields', () => {
  const row = parseCSVRow('"Doe, John",age,"123 Main St, Suite 4"');
  assert.equal(row.length, 3);
  assert.equal(row[0], 'Doe, John');
  assert.equal(row[1], 'age');
  assert.equal(row[2], '123 Main St, Suite 4');
});

test('parseCSVRow handles empty fields and trailing commas', () => {
  const row = parseCSVRow('a,,c,');
  assert.equal(row.length, 4);
  assert.equal(row[0], 'a');
  assert.equal(row[1], '');
  assert.equal(row[2], 'c');
  assert.equal(row[3], '');
});

test('escapeCSVField round-trips special characters', () => {
  assert.equal(escapeCSVField('hello'), 'hello');
  assert.equal(escapeCSVField('hello, world'), '"hello, world"');
  assert.equal(escapeCSVField('say "hi"'), '"say ""hi"""');
  assert.equal(escapeCSVField('line1\nline2'), '"line1\nline2"');
  assert.equal(escapeCSVField(''), '');
  assert.equal(escapeCSVField(null), '');
  assert.equal(escapeCSVField(undefined), '');
});

test('parseCSV handles embedded newlines inside quoted data cells', () => {
  // Build a CSV with an embedded newline in one cell
  const csv = [
    'Name,Address,City',
    '# selector:name|#name;type:text,selector:address|#address;type:text,selector:city|#city;type:text',
    '"John Doe","123 Main St\nApt 4","Springfield"',
  ].join('\n');

  const result = parseCSV(csv);
  assert.equal(result.columns.length, 3);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0]['Name'], 'John Doe');
  assert.equal(result.rows[0]['Address'], '123 Main St\nApt 4');
  assert.equal(result.rows[0]['City'], 'Springfield');
});

test('parseCSV handles CR+LF line endings', () => {
  const csv = 'Name,Email\r\n# selector:#name;type:text,selector:#email;type:email\r\nAlice,alice@test.com\r\nBob,bob@test.com\r\n';
  const result = parseCSV(csv);
  assert.equal(result.columns.length, 2);
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0]['Name'], 'Alice');
  assert.equal(result.rows[1]['Email'], 'bob@test.com');
});

test('parseCSV parses metadata row into selectorMap and navActions', () => {
  const csv = [
    'First Name,Last Name,__NAV_1__,Country',
    '"# selector:#fname;type:text;coords:10,20",selector:#lname;type:text,"nav:click:#next-btn;coords:500,300",selector:#country;type:select',
    'John,Doe,,United States',
  ].join('\n');

  const result = parseCSV(csv);
  assert.equal(result.columns.length, 4);
  assert.equal(result.selectorMap.size, 3);  // First Name, Last Name, Country
  assert.equal(result.navActions.length, 1);

  const fnameField = result.selectorMap.get('First Name');
  assert.ok(fnameField, 'First Name field in selectorMap');
  assert.deepEqual(fnameField.selectorChain, ['#fname']);
  assert.equal(fnameField.fieldType, 'text');
  assert.equal(fnameField.coords.pageX, 10);
  assert.equal(fnameField.coords.pageY, 20);

  const countryField = result.selectorMap.get('Country');
  assert.ok(countryField, 'Country field in selectorMap');
  assert.equal(countryField.fieldType, 'select');

  const nav = result.navActions[0];
  assert.equal(nav.selector, '#next-btn');
  assert.equal(nav.coords.pageX, 500);
  assert.equal(nav.coords.pageY, 300);
});

test('parseCSV handles multiple data rows with mixed escaping', () => {
  const csv = [
    'Name,Bio,Score',
    '# selector:#name;type:text,selector:#bio;type:textarea,selector:#score;type:number',
    'Alice,"Loves ""coding"" and coffee",95',
    '"Bob, Jr.",Simple bio,88',
    'Charlie,"Line one\nLine two",72',
  ].join('\n');

  const result = parseCSV(csv);
  assert.equal(result.rows.length, 3);
  assert.equal(result.rows[0]['Name'], 'Alice');
  assert.equal(result.rows[0]['Bio'], 'Loves "coding" and coffee');
  assert.equal(result.rows[1]['Name'], 'Bob, Jr.');
  assert.equal(result.rows[2]['Bio'], 'Line one\nLine two');
  assert.equal(result.rows[2]['Score'], '72');
});

test('parseCSV throws on CSV with only a header and no data', () => {
  assert.throws(
    () => parseCSV('Name,Email'),
    /at least a header row and one data row/,
  );
});

test('parseCSV handles CSV without metadata comment row', () => {
  const csv = 'Name,Email\nAlice,alice@test.com\nBob,bob@test.com';
  const result = parseCSV(csv);
  assert.equal(result.columns.length, 2);
  assert.equal(result.rows.length, 2);
  assert.equal(result.selectorMap.size, 0);  // no metadata row
  assert.equal(result.rows[0]['Name'], 'Alice');
});

// ── Similarity / Fuzzy Matching ──────────────────────────────────────────────

test('similarity returns 1.0 for identical strings', () => {
  assert.equal(similarity('hello', 'hello'), 1);
  assert.equal(similarity('', ''), 1);
});

test('similarity returns 0 when one string is empty', () => {
  assert.equal(similarity('hello', ''), 0);
  assert.equal(similarity('', 'hello'), 0);
});

test('similarity correctly computes Levenshtein-based score', () => {
  // "california" vs "californa" — 1 deletion, similarity should be high
  const score = similarity('california', 'californa');
  assert.ok(score >= 0.8, `Expected >= 0.8, got ${score}`);
});

test('similarity maps "united states" vs "untied states" above 0.8 threshold', () => {
  const score = similarity('united states', 'untied states');
  assert.ok(score >= 0.8, `Expected >= 0.8 for 'untied states', got ${score}`);
});

test('similarity returns low score for completely different strings', () => {
  const score = similarity('apple', 'orange');
  assert.ok(score < 0.5, `Expected < 0.5, got ${score}`);
});

// ── findBestMatch ────────────────────────────────────────────────────────────

test('findBestMatch finds exact value match', () => {
  const options = ['United States', 'Canada', 'United Kingdom'];
  const result = findBestMatch('United States', options);
  assert.ok(result);
  assert.equal(result.match, 'United States');
  assert.equal(result.type, 'exact');
});

test('findBestMatch finds case-insensitive match', () => {
  const options = ['United States', 'Canada'];
  const result = findBestMatch('UNITED STATES', options);
  assert.ok(result);
  assert.equal(result.match, 'United States');
  assert.equal(result.type, 'exact');
});

test('findBestMatch finds includes match', () => {
  const options = ['United States of America', 'Canada'];
  const result = findBestMatch('United States', options);
  assert.ok(result);
  assert.equal(result.match, 'United States of America');
  assert.equal(result.type, 'substring');
});

test('findBestMatch fuzzy-matches misspelled "Untied States"', () => {
  const options = ['United States', 'Canada', 'United Kingdom'];
  const result = findBestMatch('Untied States', options);
  assert.ok(result);
  assert.equal(result.match, 'United States');
  assert.equal(result.type, 'fuzzy');
});

test('findBestMatch fuzzy-matches misspelled "Californa"', () => {
  const options = ['California', 'Texas', 'New York', 'Florida'];
  const result = findBestMatch('Californa', options);
  assert.ok(result, 'Should find a fuzzy match for "Californa"');
  assert.equal(result.match, 'California');
  assert.equal(result.type, 'fuzzy');
});

test('findBestMatch returns null for completely unmatched value', () => {
  const options = ['United States', 'Canada'];
  const result = findBestMatch('Xyzzy Plugh', options);
  assert.equal(result, null);
});

test('findBestMatch uses abbreviation dictionary', () => {
  const options = ['United States', 'Canada'];
  const result = findBestMatch('usa', options);
  assert.ok(result);
  assert.equal(result.match, 'United States');
  assert.equal(result.type, 'abbreviation');
});

test('findBestMatch misses abbreviation if option not present', () => {
  const options = ['Canada', 'Mexico'];
  const result = findBestMatch('usa', options);
  assert.strictEqual(result, null);
});

// ── Template Generation ──────────────────────────────────────────────────────

test('generateTemplate creates correct CSV structure from form map', () => {
  const formMap = {
    totalPages: 2,
    fields: [
      { page: 0, label: 'First Name', name: 'fname', selectorChain: ['#fname'], fieldType: 'text', value: 'John', coords: null },
      { page: 0, label: 'Last Name', name: 'lname', selectorChain: ['#lname'], fieldType: 'text', value: 'Doe', coords: null },
      { page: 1, label: 'Email', name: 'email', selectorChain: ['#email'], fieldType: 'email', value: 'john@test.com', coords: null },
    ],
    navActions: [
      { page: 0, selector: '#next-btn', coords: { pageX: 400, pageY: 500 } },
    ],
  };

  const csv = generateTemplate(formMap);
  const lines = csv.split('\n').filter(l => l.length > 0);
  assert.equal(lines.length, 3); // header, metadata, example

  // Header should have: First Name, Last Name, __NAV_1__, Email
  const headers = parseCSVRow(lines[0]);
  assert.equal(headers.length, 4);
  assert.equal(headers[0], 'First Name');
  assert.equal(headers[1], 'Last Name');
  assert.equal(headers[2], '__NAV_1__');
  assert.equal(headers[3], 'Email');

  // Metadata row starts with "# "
  assert.ok(lines[1].startsWith('# '));
});

test('generateOutputCSV appends Status and Error_Reason columns', () => {
  const columns = ['Name', 'Email'];
  const results = [
    { row: { Name: 'Alice', Email: 'alice@test.com' }, status: 'success', errorReason: '' },
    { row: { Name: 'Bob', Email: 'invalid' }, status: 'error', errorReason: 'Invalid email format' },
  ];

  const csv = generateOutputCSV(columns, results);
  const lines = csv.split('\n').filter(l => l.length > 0);
  assert.equal(lines.length, 3); // header + 2 data rows

  const headers = parseCSVRow(lines[0]);
  assert.deepEqual(headers, ['Name', 'Email', 'Status', 'Error_Reason']);

  const row1 = parseCSVRow(lines[1]);
  assert.equal(row1[2], 'success');
  assert.equal(row1[3], '');

  const row2 = parseCSVRow(lines[2]);
  assert.equal(row2[2], 'error');
  assert.equal(row2[3], 'Invalid email format');
});

// ── deriveColumnName ─────────────────────────────────────────────────────────

test('deriveColumnName uses label when available and short', () => {
  assert.equal(deriveColumnName({ label: 'First Name', name: 'fname' }, 0), 'First Name');
});

test('deriveColumnName converts camelCase name to Title Case', () => {
  assert.equal(deriveColumnName({ label: '', name: 'firstName' }, 0), 'First Name');
});

test('deriveColumnName converts snake_case name to Title Case', () => {
  assert.equal(deriveColumnName({ label: '', name: 'last_name' }, 0), 'Last Name');
});

test('deriveColumnName falls back to Field N for unknown fields', () => {
  assert.equal(deriveColumnName({ label: '', name: '' }, 4), 'Field 5');
});
