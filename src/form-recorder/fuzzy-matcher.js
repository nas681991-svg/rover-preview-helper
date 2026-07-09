/**
 * Fuzzy Matcher (Stage 6a)
 * Resolves slight dropdown value mismatches (e.g. 'USA' to 'United States') 
 * using Levenshtein distance algorithms.
 */

/**
 * Computes Levenshtein distance between two strings.
 */
export function levenshteinDistance(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  
  // Prevent OOM from massive inputs (e.g. pasted text)
  if (a.length > 500 || b.length > 500) return Math.max(a.length, b.length);

  const matrix = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));

  for (let i = 0; i <= a.length; i++) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,      // Deletion
        matrix[i][j - 1] + 1,      // Insertion
        matrix[i - 1][j - 1] + cost // Substitution
      );
    }
  }

  return matrix[a.length][b.length];
}

/**
 * Computes similarity percentage between two strings (0 to 1).
 */
export function similarity(a, b) {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1.0;
  
  const distance = levenshteinDistance(a.toLowerCase(), b.toLowerCase());
  return (maxLen - distance) / maxLen;
}

/**
 * Common abbreviation dictionaries for fast fallback.
 */
const ABBREVIATIONS = {
  'usa': 'united states',
  'us': 'united states',
  'uk': 'united kingdom',
  'au': 'australia',
  'nsw': 'new south wales',
  'vic': 'victoria',
  'qld': 'queensland',
  'wa': 'western australia',
  'sa': 'south australia',
  'tas': 'tasmania',
  'act': 'australian capital territory',
  'nt': 'northern territory'
};

/**
 * Finds the best matching option from a list of strings, using exact, include, and fuzzy logic.
 * 
 * @param {string} target - The value we are trying to find.
 * @param {string[]} options - The list of available options text.
 * @param {number} threshold - Minimum similarity threshold (default 0.8 / 80%).
 * @returns {object|null} - The matched string and its score, or null if no match meets threshold.
 */
export function findBestMatch(target, options, threshold = 0.8) {
  if (!target || !options || options.length === 0) return null;

  const cleanTarget = target.trim().toLowerCase();
  
  // 1. Exact match
  for (const opt of options) {
    if (!opt || opt.trim() === '') continue;
    if (opt.trim().toLowerCase() === cleanTarget) {
      return { match: opt, score: 1.0, type: 'exact' };
    }
  }

  // 2. Abbreviation dictionary match
  if (ABBREVIATIONS[cleanTarget]) {
    const fullForm = ABBREVIATIONS[cleanTarget];
    for (const opt of options) {
      if (!opt || opt.trim() === '') continue;
      if (opt.trim().toLowerCase() === fullForm) {
        return { match: opt, score: 0.95, type: 'abbreviation' };
      }
    }
  }

  // 3. Includes / Substring match
  for (const opt of options) {
    if (!opt || opt.trim() === '') continue;
    const cleanOpt = opt.trim().toLowerCase();
    if (cleanOpt.includes(cleanTarget) || cleanTarget.includes(cleanOpt)) {
      // Prioritize substring matches that are close in length
      const lenDiff = Math.abs(cleanOpt.length - cleanTarget.length);
      if (lenDiff < 15) {
        return { match: opt, score: 0.9, type: 'substring' };
      }
    }
  }

  // 4. Fuzzy Levenshtein match
  let bestMatch = null;
  let highestScore = 0;

  for (const opt of options) {
    if (!opt || opt.trim() === '') continue;
    const score = similarity(cleanTarget, opt.trim().toLowerCase());
    if (score > highestScore) {
      highestScore = score;
      bestMatch = opt;
    }
  }

  if (highestScore >= threshold && bestMatch) {
    return { match: bestMatch, score: highestScore, type: 'fuzzy' };
  }

  return null; // Confidence too low
}
