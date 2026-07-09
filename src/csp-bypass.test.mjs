import test, { describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { 
  ruleIdForTab, buildCspRemovalRule, enableCspBypass, 
  disableCspBypass, cleanupOrphanedRules, CSP_RULE_ID_BASE 
} from './csp-bypass.js';

describe('csp-bypass', () => {
  let sessionRules = [];

  beforeEach(() => {
    sessionRules = [];
    globalThis.chrome = {
      declarativeNetRequest: {
        getSessionRules: async () => sessionRules,
        updateSessionRules: async ({ removeRuleIds = [], addRules = [] }) => {
          sessionRules = sessionRules.filter(r => !removeRuleIds.includes(r.id));
          sessionRules.push(...addRules);
        }
      }
    };
  });

  afterEach(() => {
    delete globalThis.chrome;
  });

  test('ruleIdForTab calculates correctly', () => {
    assert.equal(ruleIdForTab(5), CSP_RULE_ID_BASE + 5);
    assert.equal(ruleIdForTab('10'), CSP_RULE_ID_BASE + 10);
    assert.throws(() => ruleIdForTab('abc'), /Invalid tabId/);
  });

  test('buildCspRemovalRule structure is correct', () => {
    const rule = buildCspRemovalRule(7);
    assert.equal(rule.id, CSP_RULE_ID_BASE + 7);
    assert.equal(rule.action.type, 'modifyHeaders');
    assert.equal(rule.action.responseHeaders.length, 2);
    assert.deepEqual(rule.condition.tabIds, [7]);
  });

  test('enableCspBypass adds rule and returns true if new', async () => {
    const isNew = await enableCspBypass(8);
    assert.equal(isNew, true);
    assert.equal(sessionRules.length, 1);
    assert.equal(sessionRules[0].id, CSP_RULE_ID_BASE + 8);

    // Calling again returns false
    const isNewAgain = await enableCspBypass(8);
    assert.equal(isNewAgain, false);
    assert.equal(sessionRules.length, 1); // Removes and re-adds
  });

  test('enableCspBypass ignores invalid tab id', async () => {
    const isNew = await enableCspBypass('foo');
    assert.equal(isNew, false);
    assert.equal(sessionRules.length, 0);
  });

  test('disableCspBypass removes rule', async () => {
    await enableCspBypass(9);
    assert.equal(sessionRules.length, 1);
    await disableCspBypass(9);
    assert.equal(sessionRules.length, 0);
  });

  test('disableCspBypass ignores invalid tab id', async () => {
    await disableCspBypass('foo');
    assert.equal(sessionRules.length, 0);
  });

  test('cleanupOrphanedRules removes only CSP rules', async () => {
    sessionRules = [
      { id: 1 }, // Some other rule
      { id: CSP_RULE_ID_BASE + 10 } // Orphaned CSP rule
    ];
    await cleanupOrphanedRules();
    assert.equal(sessionRules.length, 1);
    assert.equal(sessionRules[0].id, 1);
  });
});
