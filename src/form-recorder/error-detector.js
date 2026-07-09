/**
 * Error Detector (Stage 6b)
 * Scans the DOM for common error patterns and associates them with form fields.
 */

/**
 * Normalizes text for comparison.
 */
function normalizeText(text) {
  return (text || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Checks if a string contains error-related keywords.
 */
function looksLikeErrorMessage(text) {
  const norm = normalizeText(text);
  if (norm.length < 3 || norm.length > 200) return false;
  
  const keywords = [
    'required', 'invalid', 'please enter', 'must be', 'cannot be blank',
    'does not match', 'error', 'incorrect', 'not valid', 'failed'
  ];
  return keywords.some(kw => norm.includes(kw));
}

/**
 * Scans the DOM for validation errors.
 * 
 * @returns {Array<{field: HTMLElement, message: string}>} Array of error objects
 */
export function scanForErrors() {
  const errors = [];
  
  // 1. Find elements explicitly marked with error roles or attributes
  const explicitErrors = document.querySelectorAll(
    '[role="alert"], [aria-invalid="true"], [aria-errormessage], .error, .invalid, .field-error, .has-error'
  );

  const seenErrorNodes = new Set();

  for (const el of explicitErrors) {
    if (seenErrorNodes.has(el)) continue;

    // Check if this element is an input itself (e.g. aria-invalid="true")
    if (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') {
      // Find the associated error message (sibling or aria-describedby)
      let message = 'Invalid field';
      
      const describedBy = el.getAttribute('aria-describedby');
      if (describedBy) {
        const descEl = document.getElementById(describedBy);
        if (descEl && descEl.textContent.trim()) {
          message = descEl.textContent.trim();
          seenErrorNodes.add(descEl);
        }
      } else {
        // Try to find a sibling error message
        const siblingError = el.parentElement?.querySelector('.error, .invalid-feedback, [role="alert"]');
        if (siblingError && siblingError.textContent.trim()) {
          message = siblingError.textContent.trim();
          seenErrorNodes.add(siblingError);
        }
      }

      errors.push({ field: el, message });
      seenErrorNodes.add(el);
      continue;
    }

    // Element is an error container (e.g. role="alert")
    const text = el.textContent.trim();
    if (looksLikeErrorMessage(text)) {
      // Try to find the associated input, but only if they share a small container
      let input = null;
      if (el.parentElement && !['FORM', 'BODY', 'HTML', 'MAIN', 'FIELDSET'].includes(el.parentElement.tagName)) {
        input = el.parentElement.querySelector('input, select, textarea');
      }
      
      if (input) {
        errors.push({ field: input, message: text });
      } else {
        // Unassociated form error (e.g. top of page)
        errors.push({ field: null, message: text });
      }
      seenErrorNodes.add(el);
    }
  }

  // Deduplicate errors by field
  const uniqueErrors = [];
  const fieldSet = new Set();
  const unassociatedErrors = [];

  for (const err of errors) {
    if (err.field) {
      if (!fieldSet.has(err.field)) {
        fieldSet.add(err.field);
        uniqueErrors.push(err);
      }
    } else {
      unassociatedErrors.push(err);
    }
  }

  return [...uniqueErrors, ...unassociatedErrors];
}

/**
 * Helper to run error detection and format the result for logging.
 */
export function detectErrors() {
  const errors = scanForErrors();
  return errors.map(err => {
    let fieldName = 'Form';
    if (err.field) {
      fieldName = err.field.name || err.field.id || err.field.getAttribute('aria-label') || 'Unknown Field';
    }
    return `${fieldName}: ${err.message}`;
  });
}
