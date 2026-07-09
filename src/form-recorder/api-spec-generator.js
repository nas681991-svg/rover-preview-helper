/**
 * API Spec Generator (Stage 7b)
 * Converts intercepted network requests into an OpenAPI 3.0 specification.
 */

function guessType(val) {
  if (val === null) return 'string';
  if (typeof val === 'boolean') return 'boolean';
  if (typeof val === 'number') return 'number';
  if (Array.isArray(val)) return 'array';
  if (typeof val === 'object') return 'object';
  return 'string';
}

function generateSchema(obj) {
  if (typeof obj !== 'object' || obj === null) {
    return { type: guessType(obj) };
  }

  if (Array.isArray(obj)) {
    const items = obj.length > 0 ? generateSchema(obj[0]) : { type: 'string' };
    return { type: 'array', items };
  }

  const properties = {};
  for (const [key, value] of Object.entries(obj)) {
    properties[key] = generateSchema(value);
  }

  return { type: 'object', properties };
}

export function generateOpenApiSpec(capturedRequests, formMap) {
  if (!capturedRequests || capturedRequests.length === 0) return null;

  // Find the request that looks most like the form submission
  // Heuristic: The last successful POST/PUT request.
  const submitReq = capturedRequests
    .filter(req => [200, 201, 202, 204].includes(req.responseStatus))
    .pop() || capturedRequests.pop();

  if (!submitReq) return null;

  let url;
  let path = '/';
  try {
    url = new URL(submitReq.url);
    path = url.pathname;
  } catch {
    url = { origin: 'http://localhost' };
  }
  
  // Try to parse the request body
  let requestSchema = {};
  if (submitReq.postData) {
    try {
      const json = JSON.parse(submitReq.postData);
      requestSchema = generateSchema(json);
    } catch {
      // Not JSON, maybe URL encoded
      requestSchema = { type: 'object', description: 'Raw payload: ' + submitReq.postData.slice(0, 50) };
    }
  }

  // Try to parse the response body
  let responseSchema = {};
  if (submitReq.responseBody) {
    try {
      const json = JSON.parse(submitReq.responseBody);
      responseSchema = generateSchema(json);
    } catch {
      responseSchema = { type: 'string' };
    }
  }

  // Correlate with form fields
  // Find which JSON keys match our DOM labels or names
  if (requestSchema.properties && formMap && formMap.fields) {
    for (const field of formMap.fields) {
      const csvColumn = field.columnName || field.label || field.name;
      // Simple correlation: check if JSON body has a key that matches the field name
      const safeName = field.name || '';
      const camelName = safeName.replace(/_([a-z])/g, g => g[1].toUpperCase());
      
      if (safeName && requestSchema.properties[safeName]) {
        requestSchema.properties[safeName].description = `Mapped from CSV Column: ${csvColumn}`;
      } else if (camelName && requestSchema.properties[camelName]) {
        requestSchema.properties[camelName].description = `Mapped from CSV Column: ${csvColumn}`;
      }
    }
  }

  const spec = {
    openapi: '3.0.0',
    info: {
      title: 'Captured Form API',
      version: '1.0.0'
    },
    servers: [
      { url: url.origin }
    ],
    paths: {
      [path]: {
        [submitReq.method.toLowerCase()]: {
          summary: 'Form Submission',
          requestBody: {
            content: {
              [submitReq.contentType || 'application/json']: {
                schema: requestSchema
              }
            }
          },
          responses: {
            [submitReq.responseStatus || '200']: {
              description: 'Response',
              content: {
                [submitReq.responseMimeType || 'application/json']: {
                  schema: responseSchema
                }
              }
            }
          }
        }
      }
    }
  };

  return spec;
}
