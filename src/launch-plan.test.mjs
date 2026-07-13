import test from 'node:test';
import assert from 'node:assert';
import { resolveLaunchPlan, acquireExtension } from './launch-plan.cjs';

test('resolveLaunchPlan', async (t) => {
  const env = {
    extDataDir: '/ext-data',
    bugbugDir: '/ext-data/bugbug',
    sbaseExtDir: '/ext-data/sbase',
    fillappDir: '/ext-data/fillapp',
    cloudqaDir: '/ext-data/cloudqa',
    roverExtDir: '/app-assets/rover',
    devDist: '/dist',
    existsSync: (path) => path !== '/ext-data/sbase', // let's pretend sbase is missing
    pathJoin: (...args) => args.join('/')
  };

  await t.test('all mode', () => {
    const plan = resolveLaunchPlan('all', env);
    assert.strictEqual(plan.error, null);
    assert.strictEqual(plan.targetSources.length, 1);
    assert.strictEqual(plan.targetSources[0].id, 'bugbug');
    assert.strictEqual(plan.extensions.length, 5);
    assert.strictEqual(plan.extensions.find(e => e.id === 'rover').dir, '/app-assets/rover');
  });

  await t.test('rover mode', () => {
    const plan = resolveLaunchPlan('rover', env);
    assert.strictEqual(plan.error, null);
    assert.strictEqual(plan.targetSources.length, 0);
    assert.strictEqual(plan.extensions.length, 1);
    assert.strictEqual(plan.extensions[0].id, 'rover');
  });

  await t.test('bugbug mode', () => {
    const plan = resolveLaunchPlan('bugbug', env);
    assert.strictEqual(plan.error, null);
    assert.strictEqual(plan.targetSources.length, 1);
    assert.strictEqual(plan.targetSources[0].destZip, '/ext-data/bugbug.crx');
    assert.strictEqual(plan.extensions.length, 1);
    assert.strictEqual(plan.extensions[0].id, 'bugbug');
    assert.strictEqual(plan.extensions[0].dir, '/ext-data/bugbug');
  });

  await t.test('playwright-trace mode', () => {
    const plan = resolveLaunchPlan('playwright-trace', env);
    assert.strictEqual(plan.error, null);
    assert.strictEqual(plan.targetSources.length, 0);
    assert.strictEqual(plan.extensions.length, 0);
  });
});

test('acquireExtension validation', async (t) => {
  let mkdirCalled = false;
  let writeCalled = false;
  let renameCalled = false;
  let extracted = false;
  
  const baseSys = {
    mkdirSync: () => { mkdirCalled = true; },
    writeFileSync: () => { writeCalled = true; },
    renameSync: () => { renameCalled = true; },
    existsSync: (path) => true,
    pathDirname: (p) => p.split('/').slice(0, -1).join('/'),
    AdmZip: class { extractAllToAsync(dir, overwrite, cb) { extracted = true; cb(); } },
    Buffer: Buffer
  };

  await t.test('throws on HTML response', async () => {
    const sys = {
      ...baseSys,
      fetch: async () => ({
        ok: true,
        headers: new Headers({ 'content-type': 'text/html' }),
        arrayBuffer: async () => new ArrayBuffer(10)
      })
    };
    await assert.rejects(
      acquireExtension({ url: 'http://foo', destZip: '/foo.crx', extractDir: '/foo' }, sys),
      /HTML/
    );
  });

  await t.test('throws on empty response', async () => {
    const sys = {
      ...baseSys,
      fetch: async () => ({
        ok: true,
        headers: new Headers({ 'content-type': 'application/octet-stream' }),
        arrayBuffer: async () => new ArrayBuffer(0)
      })
    };
    await assert.rejects(
      acquireExtension({ url: 'http://foo', destZip: '/foo.crx', extractDir: '/foo' }, sys),
      /Empty response/
    );
  });

  await t.test('throws on missing manifest.json', async () => {
    const sys = {
      ...baseSys,
      fetch: async () => ({
        ok: true,
        headers: new Headers({ 'content-type': 'application/octet-stream' }),
        arrayBuffer: async () => new ArrayBuffer(10)
      }),
      existsSync: () => false // manifest not found
    };
    await assert.rejects(
      acquireExtension({ url: 'http://foo', destZip: '/foo.crx', extractDir: '/foo' }, sys),
      /manifest\.json not found/
    );
  });

  await t.test('succeeds for valid zip', async () => {
    const sys = {
      ...baseSys,
      fetch: async () => ({
        ok: true,
        headers: new Headers({ 'content-type': 'application/octet-stream' }),
        arrayBuffer: async () => new ArrayBuffer(10)
      }),
      existsSync: () => true
    };
    await acquireExtension({ url: 'http://foo', destZip: '/foo.crx', extractDir: '/foo' }, sys);
    assert.strictEqual(mkdirCalled, true);
    assert.strictEqual(writeCalled, true);
    assert.strictEqual(renameCalled, true);
    assert.strictEqual(extracted, true);
  });
});
