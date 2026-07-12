/**
 * AI Semantic Field Labeler (Stage 2)
 * Connects raw recorded DOM selectors to Rover's AI to auto-generate human-readable CSV column names.
 */

/**
 * Heuristic fallback for labeling fields if AI fails or is disabled.
 * Converts snake_case or camelCase to Title Case.
 */
function heuristicLabel(name) {
  if (!name) return 'Unknown Field';
  
  // Replace underscores and dashes with spaces
  let clean = name.replace(/[_-]/g, ' ');
  
  // Insert space before capital letters (camelCase)
  clean = clean.replace(/([a-z])([A-Z])/g, '$1 $2');
  
  // Capitalize words and remove double spaces
  return clean.replace(/\s+/g, ' ').replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()).trim();
}

/**
 * Main labeler function that enriches the fieldMap with 'columnName'.
 * 
 * @param {Array} fieldMap - The raw array of field objects recorded by recorder.js
 * @returns {Promise<Array>} - The enriched fieldMap
 */
export async function labelFields(fieldMap) {
  // If there are no fields, just return
  if (!Array.isArray(fieldMap) || fieldMap.length === 0) return fieldMap;

  // Attempt to use Rover AI if available in the execution environment
  try {
    if (typeof window !== 'undefined' && window.rover && typeof window.rover.send === 'function') {
      const prompt = `
Given these form fields, return a JSON array mapping each to a human-readable CSV column name:
${JSON.stringify(fieldMap.map(f => ({ selector: f.selectorChain?.[0] || f.selector, label: f.label, name: f.name, type: f.type, options: f.options })), null, 2)}
Return EXACTLY this JSON structure and nothing else:
[{ "selector": "...", "columnName": "..." }]
      `.trim();

      const response = await window.rover.send({ type: 'ai-prompt', prompt });
      
      let aiLabels = [];
      try {
        aiLabels = JSON.parse(response);
      } catch (parseError) {
        // Response might have markdown code blocks, try stripping them
        const stripped = response.replace(/```json/g, '').replace(/```/g, '').trim();
        aiLabels = JSON.parse(stripped);
      }

      if (Array.isArray(aiLabels)) {
        // Map the AI results back to our field map
        const selectorToName = {};
        for (const labelObj of aiLabels) {
          if (labelObj.selector && labelObj.columnName) {
            selectorToName[labelObj.selector] = labelObj.columnName;
          }
        }

        return fieldMap.map(f => {
          const mainSelector = f.selectorChain?.[0] || f.selector;
          return {
            ...f,
            columnName: selectorToName[mainSelector] || f.label || heuristicLabel(f.name) || 'Unknown Field'
          };
        });
      }
    }
  } catch (error) {
    console.warn('Rover AI semantic labeling failed, falling back to heuristics:', error);
  }

  // Fallback if AI fails or isn't available
  return fieldMap.map(f => ({
    ...f,
    columnName: f.label || heuristicLabel(f.name) || 'Unknown Field'
  }));
}
