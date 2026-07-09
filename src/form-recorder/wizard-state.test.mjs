import assert from 'node:assert';
import test, { describe } from 'node:test';
import { WizardState } from './wizard-state.js';

describe('WizardState', () => {
  test('tracks page navigation correctly', () => {
    const ws = new WizardState();
    assert.strictEqual(ws.currentPage, 0);

    ws.recordNavigation({ buttonText: 'Next' });
    assert.strictEqual(ws.currentPage, 1);
    assert.strictEqual(ws.navActions.length, 1);
    assert.strictEqual(ws.navActions[0].page, 0);
  });

  test('tracks conditional dependencies', async () => {
    const ws = new WizardState();
    
    // User interacts with "Country"
    ws.recordInteraction('path:select[name="country"]', 'US');
    
    // Simulate some fields appearing quickly
    const newFields = [{ key: 'path:input[name="state"]' }];
    const deps = ws.checkDependencies(newFields);
    
    assert.strictEqual(deps.length, 1);
    assert.strictEqual(deps[0].dependentField, 'path:input[name="state"]');
    assert.strictEqual(deps[0].dependsOn.field, 'path:select[name="country"]');
    assert.strictEqual(deps[0].dependsOn.value, 'US');
  });

  test('ignores conditional dependencies after timeout', async () => {
    const ws = new WizardState();
    
    // User interacts with "Country" 6 seconds ago
    ws.recordInteraction('path:select[name="country"]', 'US');
    ws.lastInteraction.timestamp = Date.now() - 6000;
    
    const newFields = [{ key: 'path:input[name="state"]' }];
    const deps = ws.checkDependencies(newFields);
    
    assert.strictEqual(deps.length, 0); // Should be empty because it took too long
  });

  test('getState and reset work correctly', () => {
    const ws = new WizardState();
    ws.recordInteraction('test', 'value');
    ws.recordNavigation({ buttonText: 'Next' });
    
    let state = ws.getState();
    assert.strictEqual(state.currentPage, 1);
    assert.strictEqual(state.navActions.length, 1);

    ws.reset();
    state = ws.getState();
    assert.strictEqual(state.currentPage, 0);
    assert.strictEqual(state.navActions.length, 0);
    assert.strictEqual(ws.lastInteraction, null);
  });
});
