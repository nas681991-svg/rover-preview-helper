import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { generateFingerprintSeed, buildCDPStealthScript } = require('./fingerprint-manager.cjs');

describe('fingerprint-manager', () => {
  test('generateFingerprintSeed creates coherent fingerprint seeds', () => {
    const fp = generateFingerprintSeed();
    assert.ok(fp.userAgent, 'userAgent should be present');
    assert.ok(fp.webglVendor, 'webglVendor should be present');
    assert.ok(fp.webglRenderer, 'webglRenderer should be present');
    assert.ok(fp.hardwareConcurrency >= 4, 'hardwareConcurrency should be >= 4');
    assert.ok(fp.deviceMemory >= 4, 'deviceMemory should be >= 4');
    assert.ok(fp.canvasNoise.r !== undefined, 'canvasNoise.r should be defined');
    assert.ok(fp.audioNoise !== undefined, 'audioNoise should be defined');
  });

  test('buildCDPStealthScript returns a valid JavaScript script string', () => {
    const fp = generateFingerprintSeed();
    const script = buildCDPStealthScript(fp);
    assert.ok(script.includes(fp.webglVendor), 'script should include webglVendor');
    assert.ok(script.includes(fp.webglRenderer), 'script should include webglRenderer');
    assert.ok(script.includes('WebGLRenderingContext'), 'script should hook WebGLRenderingContext');
    assert.ok(script.includes('CanvasRenderingContext2D'), 'script should hook CanvasRenderingContext2D');
    assert.doesNotThrow(() => {
      new Function(script);
    }, 'script should be syntactically valid JavaScript');
  });
});
