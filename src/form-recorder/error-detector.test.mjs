import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { scanForErrors, detectErrors } from './error-detector.js';

// Setup JSDOM globally for the error-detector
function setupDOM(html) {
  const dom = new JSDOM(html);
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
}

test('scanForErrors finds role="alert" unassociated error', () => {
  setupDOM(`<div role="alert">Please fix the errors below</div>`);
  const errors = scanForErrors();
  assert.equal(errors.length, 1);
  assert.equal(errors[0].message, 'Please fix the errors below');
  assert.equal(errors[0].field, null);
});

test('scanForErrors finds aria-invalid input and sibling error', () => {
  setupDOM(`
    <div>
      <input name="email" aria-invalid="true" aria-label="Email Address" />
      <div class="error">Invalid email format</div>
    </div>
  `);
  const errors = scanForErrors();
  assert.equal(errors.length, 1);
  assert.equal(errors[0].field.name, 'email');
  assert.equal(errors[0].message, 'Invalid email format');
});

test('scanForErrors finds aria-invalid input with aria-describedby', () => {
  setupDOM(`
    <div>
      <input name="username" aria-invalid="true" aria-describedby="user-err" />
      <span id="user-err">Username is taken</span>
    </div>
  `);
  const errors = scanForErrors();
  assert.equal(errors.length, 1);
  assert.equal(errors[0].field.name, 'username');
  assert.equal(errors[0].message, 'Username is taken');
});

test('scanForErrors ignores normal elements', () => {
  setupDOM(`
    <div>
      <input name="search" />
      <p>Welcome to our site</p>
    </div>
  `);
  const errors = scanForErrors();
  assert.equal(errors.length, 0);
});

test('scanForErrors finds alert associated with sibling input', () => {
  setupDOM(`
    <div>
      <input name="password" />
      <div role="alert">Password is required</div>
    </div>
  `);
  const errors = scanForErrors();
  assert.equal(errors.length, 1);
  assert.equal(errors[0].field.name, 'password');
  assert.equal(errors[0].message, 'Password is required');
});

test('detectErrors formats messages correctly', () => {
  setupDOM(`
    <div>
      <input name="phone" aria-invalid="true" />
      <div class="error">Phone must be 10 digits</div>
    </div>
    <div role="alert">Form submission failed</div>
  `);
  const errors = detectErrors();
  assert.equal(errors.length, 2);
  assert.equal(errors[0], 'phone: Phone must be 10 digits');
  assert.equal(errors[1], 'Form: Form submission failed');
});
