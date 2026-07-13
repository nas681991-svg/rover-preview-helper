/**
 * Rover Automation Script (RAS) Engine
 * 
 * Generates and parses the Unified Automation Script Language (UASL)
 * in JSON format (.ras.json). This allows a form map to be exported as 
 * a declarative, transpilable script that utilizes the Selector Cascade.
 */

/**
 * Generate a RAS JSON script from a recorded form map.
 * 
 * @param {Object} formMap - The complete form map from the recorder
 * @returns {string} JSON string of the RAS script
 */
export function generateRAS(formMap) {
  const { fields = [], navActions = [], totalPages = 1, startUrl = '', telemetry = [] } = formMap;

  const script = {
    version: "1.0.0",
    metadata: {
      target_url: startUrl,
      description: "Rover exported automation script",
      captured_at: new Date().toISOString(),
      dependencies: [
        { plugin: "shadow-dom-piercer" },
        { plugin: "vision-fallback" }
      ]
    },
    schema: [],
    steps: [],
    telemetry: telemetry || []
  };

  // Add initial navigation
  if (startUrl) {
    script.steps.push({
      action: "navigate",
      url: startUrl
    });
  }

  // Populate schema from fields
  const schemaSet = new Set();
  fields.forEach(f => {
    const varName = f.name || `field_${f.id}`;
    if (!schemaSet.has(varName)) {
      script.schema.push({
        field: varName,
        type: f.fieldType === 'checkbox' ? 'boolean' : 'string',
        description: `Input for ${f.name || f.id}`,
        exampleValue: f.value || ''
      });
      schemaSet.add(varName);
    }
  });

  // Group fields and nav actions by page
  for (let p = 0; p < totalPages; p++) {
    const pageFields = fields.filter(f => f.page === p);
    
    // Add wait step for DOM stability on new pages (except first if navigate handles it)
    if (p > 0) {
      script.steps.push({
        action: "wait",
        condition: "dom_stability",
        timeout_ms: 5000
      });
    }

    // Add field filling steps
    pageFields.forEach(f => {
      const varName = f.name || `field_${f.id}`;
      script.steps.push({
        action: "fill_field",
        data_source: `$schema.${varName}`,
        selectors: {
          primary: f.selectorChain && f.selectorChain.length > 0 ? f.selectorChain[f.selectorChain.length - 1] : f.selector,
          shadow_dom_path: f.selectorChain || (f.selector ? [f.selector] : []),
          heuristic: f.name || f.id,
          coordinates: f.coords ? { x: f.coords.pageX, y: f.coords.pageY } : null
        }
      });
    });

    // Add navigation action for this page, if any
    const navs = navActions.filter(n => n.page === p);
    navs.forEach(nav => {
      const selectors = {
        primary: nav.selector,
        coordinates: nav.coords ? { x: nav.coords.pageX, y: nav.coords.pageY } : null
      };
      if (nav.selector) {
        selectors.shadow_dom_path = [nav.selector];
      }
      script.steps.push({
        action: "click",
        selectors
      });
    });
  }

  return JSON.stringify(script, null, 2);
}

/**
 * Parse a RAS JSON string back into a replay-compatible format.
 * (Transforms UASL back into a format `replay-worker.js` can consume).
 * 
 * @param {string} rasText - JSON string
 * @returns {Object} { columns, selectorMap, rows, navActions }
 */
export function parseRAS(rasText) {
  let script;
  try {
    script = JSON.parse(rasText);
  } catch (e) {
    throw new Error("Invalid RAS JSON format.");
  }

  if (script.version !== "1.0.0") {
    throw new Error("Unsupported RAS version.");
  }

  // Convert schema to columns
  const columns = script.schema.map(s => s.field);
  
  // Construct a dummy row of data based on schema exampleValues
  const rowData = {};
  columns.forEach(col => {
    const schemaDef = script.schema.find(s => s.field === col);
    rowData[col] = schemaDef ? schemaDef.exampleValue : "";
  });

  const selectorMap = {};
  const navActions = [];
  let currentPage = 0;

  script.steps.forEach(step => {
    if (step.action === "wait" && step.condition === "dom_stability") {
      currentPage++;
    } else if (step.action === "fill_field") {
      const colMatch = step.data_source?.match(/^\$schema\.(.+)$/);
      if (colMatch) {
        const colName = colMatch[1];
        const schemaEntry = script.schema.find(s => s.field === colName);
        const fieldType = schemaEntry?.type === 'boolean' ? 'checkbox' : 'text';
        
        selectorMap[colName] = {
          selectorChain: step.selectors?.shadow_dom_path || [step.selectors?.primary],
          fieldType,
          coords: step.selectors?.coordinates ? { pageX: step.selectors.coordinates.x, pageY: step.selectors.coordinates.y } : null
        };
      }
    } else if (step.action === "click") {
      navActions.push({
        selector: step.selectors?.primary,
        coords: step.selectors?.coordinates ? { pageX: step.selectors.coordinates.x, pageY: step.selectors.coordinates.y } : null,
        page: currentPage,
        type: '__NAV__'
      });
    }
  });

  return {
    columns,
    selectorMap,
    rows: [rowData],
    navActions
  };
}
