/**
 * PDF-to-CSV Pipeline — extracts structured data from PDF documents
 * and maps it to a recorded form's CSV schema.
 *
 * Primary: LlamaParse API (agentic tier)
 * Fallback: Mindee Invoice API (specialized for invoices)
 *
 * Runs in the background service worker (has full network access).
 */

const LLAMAPARSE_API_KEY = process.env.LLAMAPARSE_API_KEY;
const LLAMAPARSE_BASE = 'https://api.cloud.llamaindex.ai/api/v1/parsing';

const MINDEE_API_KEY = process.env.MINDEE_API_KEY;
const MINDEE_BASE = 'https://api.mindee.net/v1/products/mindee/invoices/v4/predict';

// ── LlamaParse ───────────────────────────────────────────────────────────────

/**
 * Upload a PDF to LlamaParse and get the parsed markdown.
 * @param {ArrayBuffer} pdfBuffer
 * @returns {Promise<string>} Parsed markdown text
 */
async function llamaParseExtract(pdfBuffer) {
  // 1. Upload the file
  const formData = new FormData();
  formData.append('file', new Blob([pdfBuffer], { type: 'application/pdf' }), 'document.pdf');

  const uploadResponse = await fetch(`${LLAMAPARSE_BASE}/upload`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${LLAMAPARSE_API_KEY}`,
      'Accept': 'application/json',
    },
    body: formData,
  });

  if (!uploadResponse.ok) {
    const text = await uploadResponse.text().catch(() => '');
    throw new Error(`LlamaParse upload failed (${uploadResponse.status}): ${text}`);
  }

  const uploadResult = await uploadResponse.json();
  const jobId = uploadResult.id;
  if (!jobId) throw new Error('LlamaParse: no job ID returned');

  // 2. Poll for completion
  const maxAttempts = 60;
  const pollInterval = 3000;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise(r => setTimeout(r, pollInterval));

    const statusResponse = await fetch(`${LLAMAPARSE_BASE}/job/${jobId}`, {
      headers: {
        'Authorization': `Bearer ${LLAMAPARSE_API_KEY}`,
        'Accept': 'application/json',
      },
    });

    if (!statusResponse.ok) continue;

    const statusResult = await statusResponse.json();
    if (statusResult.status === 'SUCCESS') {
      // 3. Fetch the markdown result
      const resultResponse = await fetch(`${LLAMAPARSE_BASE}/job/${jobId}/result/markdown`, {
        headers: {
          'Authorization': `Bearer ${LLAMAPARSE_API_KEY}`,
          'Accept': 'application/json',
        },
      });

      if (!resultResponse.ok) {
        throw new Error(`LlamaParse result fetch failed (${resultResponse.status})`);
      }

      const resultData = await resultResponse.json();
      return resultData.markdown || resultData.text || JSON.stringify(resultData);
    }

    if (statusResult.status === 'ERROR' || statusResult.status === 'FAILED') {
      throw new Error(`LlamaParse job failed: ${statusResult.error || 'unknown'}`);
    }
    // Otherwise status is PENDING — keep polling
  }

  throw new Error('LlamaParse: job timed out after polling');
}

// ── Mindee (Invoice Fallback) ────────────────────────────────────────────────

/**
 * Extract invoice data via Mindee API.
 * @param {ArrayBuffer} pdfBuffer
 * @returns {Promise<Object>} Structured invoice fields
 */
async function mindeeExtract(pdfBuffer) {
  const base64 = arrayBufferToBase64(pdfBuffer);

  const response = await fetch(MINDEE_BASE, {
    method: 'POST',
    headers: {
      'Authorization': `Token ${MINDEE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      document: base64,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Mindee API failed (${response.status}): ${text}`);
  }

  const result = await response.json();
  const prediction = result?.document?.inference?.prediction || {};

  return {
    invoiceNumber: prediction.invoice_number?.value || '',
    invoiceDate: prediction.date?.value || '',
    dueDate: prediction.due_date?.value || '',
    supplierName: prediction.supplier_name?.value || '',
    supplierAddress: prediction.supplier_address?.value || '',
    customerName: prediction.customer_name?.value || '',
    customerAddress: prediction.customer_address?.value || '',
    totalAmount: prediction.total_amount?.value || '',
    totalNet: prediction.total_net?.value || '',
    totalTax: prediction.total_tax?.value || '',
    currency: prediction.locale?.currency || '',
    lineItems: (prediction.line_items || []).map(item => ({
      description: item.description || '',
      quantity: item.quantity || '',
      unitPrice: item.unit_price || '',
      totalPrice: item.total_amount || '',
    })),
  };
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

// ── Field Mapping ────────────────────────────────────────────────────────────

/**
 * Map extracted markdown/structured data to a CSV schema.
 *
 * @param {string} markdown - The parsed document text
 * @param {string[]} csvColumns - Column names from the form map
 * @returns {Object} Mapped key-value pairs { columnName: extractedValue }
 */
function mapMarkdownToSchema(markdown, csvColumns) {
  const mapped = {};
  const lines = markdown.split('\n');

  for (const column of csvColumns) {
    if (column.startsWith('__NAV_')) continue;

    const normalizedCol = column.toLowerCase().replace(/[_\s-]+/g, ' ').trim();
    let bestValue = '';

    // Strategy 1: Look for "Key: Value" patterns
    for (const line of lines) {
      const colonMatch = line.match(new RegExp(
        escapeRegex(normalizedCol) + '\\s*[:=|]\\s*(.+)',
        'i'
      ));
      if (colonMatch) {
        bestValue = colonMatch[1].trim().replace(/^\*+|\*+$/g, '').trim();
        break;
      }
    }

    // Strategy 2: Look for markdown table rows
    if (!bestValue) {
      for (let i = 0; i < lines.length; i++) {
        const cells = lines[i].split('|').map(c => c.trim()).filter(Boolean);
        const colIdx = cells.findIndex(c =>
          c.toLowerCase().replace(/[_\s-]+/g, ' ').trim() === normalizedCol
        );
        if (colIdx >= 0 && i + 2 < lines.length) {
          // Skip separator row, get data row
          const dataRow = lines[i + 2]?.split('|').map(c => c.trim()).filter(Boolean);
          if (dataRow?.[colIdx]) {
            bestValue = dataRow[colIdx];
            break;
          }
        }
      }
    }

    // Strategy 3: Fuzzy keyword search (grab the line after a matching keyword)
    if (!bestValue) {
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes(normalizedCol)) {
          // Check same line for "Key: Value"
          const rest = lines[i].split(/[:=]/)[1];
          if (rest?.trim()) {
            bestValue = rest.trim();
            break;
          }
          // Check next non-empty line
          for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
            if (lines[j].trim()) {
              bestValue = lines[j].trim();
              break;
            }
          }
          if (bestValue) break;
        }
      }
    }

    mapped[column] = bestValue;
  }

  return mapped;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Map Mindee invoice data to a CSV schema.
 */
function mapMindeeToSchema(invoiceData, csvColumns) {
  const mapped = {};
  const flat = {};

  // Flatten Mindee fields into a searchable map
  for (const [key, value] of Object.entries(invoiceData)) {
    if (typeof value === 'object' && !Array.isArray(value)) continue;
    if (Array.isArray(value)) continue;
    flat[key.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().replace(/[_\s-]+/g, ' ')] = String(value);
  }

  for (const column of csvColumns) {
    if (column.startsWith('__NAV_')) continue;

    const normalizedCol = column.toLowerCase().replace(/[_\s-]+/g, ' ').trim();

    // Direct match
    if (flat[normalizedCol] !== undefined) {
      mapped[column] = flat[normalizedCol];
      continue;
    }

    // Partial match
    const partialKey = Object.keys(flat).find(k =>
      k.includes(normalizedCol) || normalizedCol.includes(k)
    );
    if (partialKey) {
      mapped[column] = flat[partialKey];
    } else {
      mapped[column] = '';
    }
  }

  return mapped;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Extract data from a PDF and map it to a CSV schema.
 *
 * @param {ArrayBuffer} pdfBuffer - The raw PDF bytes
 * @param {string[]} csvColumns - Column names from the recorded form map
 * @returns {Promise<{ rows: Object[], source: string }>}
 */
export async function extractFromPDF(pdfBuffer, csvColumns) {
  let rows = [];
  let source = '';

  // Try LlamaParse first
  try {
    const markdown = await llamaParseExtract(pdfBuffer);
    const mapped = mapMarkdownToSchema(markdown, csvColumns);
    rows = [mapped];
    source = 'llamaparse';
    return { rows, source };
  } catch (llamaError) {
    console.warn('LlamaParse failed, trying Mindee:', llamaError.message);
  }

  // Fall back to Mindee (specialized for invoices)
  try {
    const invoiceData = await mindeeExtract(pdfBuffer);
    const mapped = mapMindeeToSchema(invoiceData, csvColumns);
    rows = [mapped];
    source = 'mindee';
    return { rows, source };
  } catch (mindeeError) {
    throw new Error(
      `PDF extraction failed. LlamaParse and Mindee both errored. ` +
      `Last error: ${mindeeError.message}`
    );
  }
}

/**
 * Extract data from multiple PDFs and combine into rows.
 */
export async function extractFromMultiplePDFs(pdfBuffers, csvColumns) {
  const allRows = [];
  const errors = [];

  for (let i = 0; i < pdfBuffers.length; i++) {
    try {
      const { rows } = await extractFromPDF(pdfBuffers[i], csvColumns);
      allRows.push(...rows);
    } catch (err) {
      errors.push({ index: i, error: err.message });
    }
  }

  return { rows: allRows, errors };
}
