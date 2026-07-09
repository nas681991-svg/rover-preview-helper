import test, { describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { vendorBase, vendorTargets, looksLikeRoverRuntime } from './vendor.mjs';

describe('vendor', () => {
  test('vendorBase uses env or default', () => {
    assert.equal(vendorBase({}), 'https://rover.rtrvr.ai');
    assert.equal(vendorBase({ ROVER_EMBED_BASE: 'http://test.com/' }), 'http://test.com');
  });

  test('vendorTargets returns targets', () => {
    const targets = vendorTargets('http://base', '/dist');
    assert.equal(targets.length, 2);
    assert.equal(targets[0].name, 'embed');
    assert.equal(targets[0].url, 'http://base/embed-core.js');
    assert.equal(targets[1].name, 'worker');
    assert.equal(targets[1].url, 'http://base/worker/worker.js');
  });

  test('looksLikeRoverRuntime validates embed', () => {
    assert.equal(looksLikeRoverRuntime('embed', 'short'), false);
    assert.equal(looksLikeRoverRuntime('embed', '<!doctype html>' + 'a'.repeat(2000)), false);
    
    const validEmbed = 'a'.repeat(1024) + '__roverSDK __ROVER_SCRIPT_URL__ window.rover agent.rtrvr.ai data-rover-methods';
    assert.equal(looksLikeRoverRuntime('embed', validEmbed), true);
    
    const invalidEmbed = 'a'.repeat(1024) + '__roverSDK __ROVER_SCRIPT_URL__';
    assert.equal(looksLikeRoverRuntime('embed', invalidEmbed), false);
  });

  test('looksLikeRoverRuntime validates worker', () => {
    const validWorker = 'a'.repeat(1024) + 'self.onmessage self.postMessage';
    assert.equal(looksLikeRoverRuntime('worker', validWorker), true);
    
    const invalidWorker = 'a'.repeat(1024) + 'self.onmessage';
    assert.equal(looksLikeRoverRuntime('worker', invalidWorker), false);
  });
});
