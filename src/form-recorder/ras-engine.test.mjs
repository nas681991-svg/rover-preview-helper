import test from 'node:test';
import assert from 'node:assert';
import { generateRAS, parseRAS } from './ras-engine.js';

test('ras-engine', async (t) => {
  const mockFormMap = {
    id: 'test-form',
    totalPages: 2,
    startUrl: 'https://example.com/start',
    fields: [
      {
        id: 'f1',
        name: 'email',
        selectorChain: ['#shadow-root', 'input[name="email"]'],
        fieldType: 'email',
        coords: { x: 10, y: 20, pageX: 100, pageY: 200 },
        page: 0,
        value: 'test@example.com'
      },
      {
        id: 'f2',
        name: 'subscribe',
        selectorChain: ['input[type="checkbox"]'],
        fieldType: 'checkbox',
        coords: { x: 15, y: 25, pageX: 150, pageY: 250 },
        page: 1,
        value: 'on'
      }
    ],
    navActions: [
      {
        selector: '#next',
        coords: { x: 30, y: 40, pageX: 300, pageY: 400 },
        page: 0,
        type: '__NAV__'
      }
    ]
  };

  let generatedJson;

  await t.test('generateRAS does not throw with nav selector string and generates valid script', () => {
    assert.doesNotThrow(() => {
      generatedJson = generateRAS(mockFormMap);
    });
    const parsed = JSON.parse(generatedJson);
    assert.strictEqual(parsed.version, "1.0.0");
    
    // Check nav step
    const navStep = parsed.steps.find(s => s.action === 'click');
    assert.ok(navStep);
    assert.strictEqual(navStep.selectors.primary, '#next');
    assert.deepStrictEqual(navStep.selectors.coordinates, { x: 300, y: 400 });

    // Check fill_field step
    const fillStep = parsed.steps.find(s => s.action === 'fill_field' && s.data_source === '$schema.email');
    assert.ok(fillStep);
    assert.deepStrictEqual(fillStep.selectors.shadow_dom_path, ['#shadow-root', 'input[name="email"]']);
    assert.deepStrictEqual(fillStep.selectors.coordinates, { x: 100, y: 200 });
  });

  await t.test('generateRAS -> parseRAS round-trip works', () => {
    const roundTripped = parseRAS(generatedJson);
    
    // Check columns
    assert.ok(roundTripped.columns.includes('email'));
    assert.ok(roundTripped.columns.includes('subscribe'));

    // Check selectorMap
    const emailMap = roundTripped.selectorMap['email'];
    assert.ok(emailMap);
    assert.deepStrictEqual(emailMap.selectorChain, ['#shadow-root', 'input[name="email"]']);
    assert.strictEqual(emailMap.fieldType, 'text'); // email maps back to text
    assert.deepStrictEqual(emailMap.coords, { pageX: 100, pageY: 200 });

    const subscribeMap = roundTripped.selectorMap['subscribe'];
    assert.ok(subscribeMap);
    assert.deepStrictEqual(subscribeMap.selectorChain, ['input[type="checkbox"]']);
    assert.strictEqual(subscribeMap.fieldType, 'checkbox');
    assert.deepStrictEqual(subscribeMap.coords, { pageX: 150, pageY: 250 });

    // Check rows
    assert.strictEqual(roundTripped.rows.length, 1);
    assert.strictEqual(roundTripped.rows[0]['email'], 'test@example.com');
    assert.strictEqual(roundTripped.rows[0]['subscribe'], 'on');

    // Check navActions
    assert.strictEqual(roundTripped.navActions.length, 1);
    assert.strictEqual(roundTripped.navActions[0].selector, '#next');
    assert.deepStrictEqual(roundTripped.navActions[0].coords, { pageX: 300, pageY: 400 });
    assert.strictEqual(roundTripped.navActions[0].page, 0);
  });
});
