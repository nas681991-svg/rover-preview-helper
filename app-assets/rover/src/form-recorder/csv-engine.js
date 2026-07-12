/**
 * CSV Engine — generates CSV templates from recorded form maps and parses
 * filled CSVs back into structured row data for the replay engine.
 *
 * Format:
 *   Row 1: Human-readable column headers (First Name, Email, etc.)
 *   Row 2: Metadata comment row mapping columns to selector chains
 *   Row 3+: Data rows
 *
 * Navigation columns (__NAV_N__) are inserted between page groups.
 * They are left empty in data rows; the replay engine handles clicks.
 */

// ── RFC 4180 Helpers ─────────────────────────────────────────────────────────

function escapeCSVField(value) {
  const str = String(value ?? '');
  if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function parseCSVRow(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++; // skip escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        fields.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
  }
  fields.push(current);
  return fields;
}

// ── Template Generation ──────────────────────────────────────────────────────

/**
 * Generate a CSV template from a recorded form map.
 *
 * @param {Object} formMap - The complete form map from the recorder
 * @param {Array<Object>} formMap.fields - Array of field descriptors
 * @param {Array<Object>} formMap.navActions - Array of navigation actions
 * @param {number} formMap.totalPages - Total wizard pages
 * @returns {string} CSV text ready for download
 */
export function generateTemplate(formMap) {
  const { fields = [], navActions = [], totalPages = 1 } = formMap;

  // Group fields by page
  const pageGroups = [];
  for (let p = 0; p < totalPages; p++) {
    pageGroups.push(fields.filter(f => f.page === p));
  }

  // Build column definitions in order: page0 fields, __NAV_1__, page1 fields, ...
  const columns = []; // { header, metadata, exampleValue }

  for (let p = 0; p < pageGroups.length; p++) {
    const pageFields = pageGroups[p];

    for (const field of pageFields) {
      const header = deriveColumnName(field, columns.length);
      const selectorMeta = field.selectorChain.map(encodeURIComponent).join('|');
      const coordsMeta = field.coords
        ? `coords:${field.coords.pageX},${field.coords.pageY}`
        : '';
      const typeMeta = `type:${field.fieldType}`;
      const metadata = [
        `selector:${selectorMeta}`,
        typeMeta,
        coordsMeta,
      ].filter(Boolean).join(';');

      columns.push({
        header,
        metadata,
        exampleValue: field.value ?? '',
      });
    }

    // Insert navigation column between pages (not after the last page)
    if (p < pageGroups.length - 1) {
      const nav = navActions.find(n => n.page === p);
      const navSelector = encodeURIComponent(nav ? nav.selector : '');
      const navCoords = nav?.coords
        ? `coords:${nav.coords.pageX},${nav.coords.pageY}`
        : '';
      columns.push({
        header: `__NAV_${p + 1}__`,
        metadata: `nav:click:${navSelector};${navCoords}`.replace(/;$/, ''),
        exampleValue: '',
      });
    }
  }

  // Build CSV rows
  const headerRow = columns.map(c => escapeCSVField(c.header)).join(',');
  const metadataRow = '# ' + columns.map(c => escapeCSVField(c.metadata)).join(',');
  const exampleRow = '# example: ' + columns.map(c => escapeCSVField(c.exampleValue)).join(',');

  return [headerRow, metadataRow, exampleRow, ''].join('\n');
}

/**
 * Derive a human-readable column name for a field.
 */
function deriveColumnName(field, index) {
  if (field.label && field.label.length > 0 && field.label.length <= 60) {
    return field.label;
  }
  if (field.name) {
    // Convert camelCase/snake_case to Title Case
    return field.name
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[_-]/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase())
      .trim();
  }
  return `Field ${index + 1}`;
}

// ── CSV Parsing ──────────────────────────────────────────────────────────────

/**
 * Parse a filled CSV back into structured data for the replay engine.
 *
 * @param {string} csvText - The CSV text (with metadata row)
 * @returns {{ columns: string[], selectorMap: Map<string, Object>, rows: Object[], navActions: Object[] }}
 */
export function parseCSV(csvText) {
  const text = csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = [];
  let currentLine = '';
  let inQuotes = false;
  
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      currentLine += ch;
    } else if (ch === '\n' && !inQuotes) {
      if (currentLine.trim().length > 0) lines.push(currentLine);
      currentLine = '';
    } else {
      currentLine += ch;
    }
  }
  if (currentLine.trim().length > 0) lines.push(currentLine);

  if (lines.length < 2) {
    throw new Error('CSV must have at least a header row and one data row.');
  }

  const headerLine = lines[0];
  const columns = parseCSVRow(headerLine);

  // Check if line 2 is a metadata comment row
  let metadataLine = null;
  let dataStartIndex = 1;

  if (lines.length > 1 && (lines[1].startsWith('#') || lines[1].startsWith('"#'))) {
    metadataLine = lines[1];
    dataStartIndex = 2;
  }

  // Parse metadata into selector map
  const selectorMap = new Map();
  const navActions = [];

  if (metadataLine) {
    const metaFields = parseCSVRow(metadataLine);
    for (let i = 0; i < columns.length && i < metaFields.length; i++) {
      const col = columns[i];
      let meta = metaFields[i];
      if (i === 0 && meta.startsWith('# ')) {
        meta = meta.slice(2);
      }

      if (col.startsWith('__NAV_') && col.endsWith('__')) {
        // Navigation column
        const parts = meta.split(';');
        const navInfo = { column: col, index: i };

        for (const part of parts) {
          if (part.startsWith('nav:click:')) {
            navInfo.selector = decodeURIComponent(part.slice('nav:click:'.length));
          } else if (part.startsWith('coords:')) {
            const [x, y] = part.slice(7).split(',').map(Number);
            navInfo.coords = { pageX: x || 0, pageY: y || 0 };
          }
        }
        navActions.push(navInfo);
      } else {
        // Regular field column
        const fieldInfo = { column: col, index: i, selectorChain: [], fieldType: 'text', coords: null };
        const parts = meta.split(';');

        for (const part of parts) {
          if (part.startsWith('selector:')) {
            fieldInfo.selectorChain = part.slice(9).split('|').map(decodeURIComponent);
          } else if (part.startsWith('type:')) {
            fieldInfo.fieldType = part.slice(5);
          } else if (part.startsWith('coords:')) {
            const [x, y] = part.slice(7).split(',').map(Number);
            fieldInfo.coords = { pageX: x || 0, pageY: y || 0 };
          }
        }
        selectorMap.set(col, fieldInfo);
      }
    }
  }

  // Parse data rows
  const rows = [];
  for (let i = dataStartIndex; i < lines.length; i++) {
    if (lines[i].trim() === '' || lines[i].startsWith('#') || lines[i].startsWith('"#')) continue;
    const values = parseCSVRow(lines[i]);
    const row = {};
    for (let j = 0; j < columns.length; j++) {
      row[columns[j]] = j < values.length ? values[j] : '';
    }
    rows.push(row);
  }

  return { columns, selectorMap, rows, navActions };
}

// ── Output CSV (with Status + Error columns) ────────────────────────────────

/**
 * Generate an output CSV with appended Status and Error_Reason columns.
 *
 * @param {string[]} originalColumns - The original CSV column headers
 * @param {Object[]} results - Array of { row: Object, status: string, errorReason?: string }
 * @returns {string} CSV text
 */
export function generateOutputCSV(originalColumns, results) {
  const outputColumns = [...originalColumns, 'Status', 'Error_Reason'];
  const headerRow = outputColumns.map(c => escapeCSVField(c)).join(',');

  const dataRows = results.map(r => {
    const values = originalColumns.map(col => escapeCSVField(r.row[col] ?? ''));
    values.push(escapeCSVField(r.status || 'unknown'));
    values.push(escapeCSVField(r.errorReason || ''));
    return values.join(',');
  });

  return [headerRow, ...dataRows, ''].join('\n');
}

// Export parsing helper for unit tests
export { escapeCSVField, parseCSVRow, deriveColumnName };
