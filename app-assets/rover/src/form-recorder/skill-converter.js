/**
 * Skill Converter (Stage 10)
 * Converts a recorded form map into a reusable Rover AI `.skill.json` file.
 */

/**
 * Generates a natural language description of the form based on its fields.
 */
function generateDescription(formMap) {
  const fields = formMap.fields || [];
  const fieldNames = fields.map(f => f.columnName || f.label || f.name).filter(Boolean);
  
  if (fieldNames.length === 0) {
    return 'An empty form automation skill.';
  }

  const pages = formMap.totalPages || 1;
  const pageStr = pages > 1 ? ` across ${pages} pages` : '';
  
  const topFields = fieldNames.slice(0, 5).join(', ');
  const moreCount = fieldNames.length > 5 ? ` and ${fieldNames.length - 5} more fields` : '';

  let hostname = 'unknown host';
  try {
    hostname = new URL(formMap.startUrl).hostname;
  } catch {
    // startUrl might be invalid or missing
  }

  return `Fills out the form on ${hostname}${pageStr}. It expects data including: ${topFields}${moreCount}.`;
}

/**
 * Converts a formMap into a Skill JSON object.
 * @param {Object} formMap 
 * @returns {Object}
 */
export function convertToSkill(formMap) {
  const description = generateDescription(formMap);

  const skill = {
    name: `Automate: ${formMap.name || 'Web Form'}`,
    version: '1.0.0',
    description: description,
    targetUrl: formMap.startUrl,
    schema: {
      type: 'object',
      properties: {}
    },
    recording: {
      fields: formMap.fields,
      navActions: formMap.navActions,
      totalPages: formMap.totalPages
    },
    apiSpec: formMap.apiSpec || null
  };

  // Build JSON schema for the skill inputs
  for (const field of (formMap.fields || [])) {
    const key = field.columnName || field.label || field.name || 'unknown_field';
    // Clean key for JSON schema
    const safeKey = key.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
    
    skill.schema.properties[safeKey] = {
      type: field.fieldType === 'number' ? 'number' : 'string',
      description: `Original field: ${key}`
    };
  }

  return skill;
}

/**
 * Triggers a download of the skill file in the browser.
 * Note: Must be called from a context where chrome.downloads or Blob URLs are supported.
 */
export async function downloadSkill(formMap) {
  const skill = convertToSkill(formMap);
  const jsonStr = JSON.stringify(skill, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  
  const filename = `${formMap.name || 'form'}.skill.json`.replace(/[^a-zA-Z0-9.\-_]/g, '_');
  
  const objectUrl = URL.createObjectURL(blob);

  await chrome.downloads.download({
    url: objectUrl,
    filename: filename,
    saveAs: true
  });
  
  // Cleanup to avoid memory leaks
  setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
}

/**
 * Converts a formMap into a UASL .rover.json object.
 * @param {Object} formMap 
 * @returns {Object}
 */
export function convertToUASL(formMap) {
  const uasl = {
    version: "1.0.0",
    metadata: {
      target_url: formMap.startUrl || "",
      description: generateDescription(formMap),
      dependencies: [
        { plugin: "vision-ai" },
        { plugin: "shadow-dom-piercer" }
      ]
    },
    schema: [],
    steps: []
  };

  if (formMap.startUrl) {
    uasl.steps.push({
      action: "navigate",
      url: formMap.startUrl
    });
  }

  for (const field of (formMap.fields || [])) {
    const key = field.columnName || field.label || field.name || 'unknown_field';
    const safeKey = key.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
    
    // Add to schema
    if (!uasl.schema.find(s => s.field === safeKey)) {
      uasl.schema.push({
        field: safeKey,
        type: field.fieldType === 'number' ? 'number' : 'string',
        description: `Original field: ${key}`
      });
    }

    // Determine primary and xpath selectors
    const chain = field.selectorChain || [];
    let primary = "";
    let xpath = "";
    for (const sel of chain) {
      if (sel.startsWith("xpath:")) {
        if (!xpath) xpath = sel.slice(6);
      } else {
        if (!primary) primary = sel;
      }
    }

    const step = {
      action: "fill_field",
      selectors: {},
      data_source: `$schema.${safeKey}`,
      wait_for_stability: 500
    };

    if (primary) step.selectors.primary = primary;
    if (xpath) step.selectors.xpath = xpath;
    if (field.label || field.name) step.selectors.heuristic = field.label || field.name;
    if (field.coords && field.coords.x !== undefined && field.coords.y !== undefined) {
      step.selectors.coordinates = { x: field.coords.x, y: field.coords.y };
    }

    uasl.steps.push(step);
  }

  return uasl;
}

/**
 * Triggers a download of the UASL script file in the browser.
 */
export async function downloadUASL(formMap) {
  const uasl = convertToUASL(formMap);
  const jsonStr = JSON.stringify(uasl, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  
  const filename = `${formMap.name || 'form'}.rover.json`.replace(/[^a-zA-Z0-9.\-_]/g, '_');
  
  const objectUrl = URL.createObjectURL(blob);

  await chrome.downloads.download({
    url: objectUrl,
    filename: filename,
    saveAs: true
  });
  
  setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
}
