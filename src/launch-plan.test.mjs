import test from 'node:test';
import assert from 'node:assert';
import { resolveLaunchPlan, acquireExtension } from './launch-plan.cjs';

test('resolveLaunchPlan', async (t) => {
  const env = {
    extDataDir: '/ext-data',
    bugbugDir: '/ext-data/bugbug',
    sbaseExtDir: '/ext-data/sbase',
    cloudqaDir: '/ext-data/cloudqa',
    roverExtDir: '/app-assets/rover',
    devDist: '/dist',
    existsSync: (path) => path !== '/ext-data/sbase', // let's pretend sbase is missing
    pathJoin: (...args) => args.join('/')
  };

  await t.test('all mode', () => {
    const plan = resolveLaunchPlan('all', env);
    assert.strictEqual(plan.error, null);
    const sourceIds = plan.targetSources.map(s => s.id).sort();
    assert.deepStrictEqual(sourceIds, ['bugbug', 'cloudqa']);
    const extIds = plan.extensions.map(e => e.id).sort();
    assert.deepStrictEqual(extIds, ['bugbug', 'cloudqa', 'rover']);
    assert.strictEqual(plan.missingRequired.length, 0);
    assert.strictEqual(plan.warnings.length, 1);
    assert.ok(plan.warnings[0].includes('seleniumbase'));
  });

  await t.test('all mode newly acquired extension included in final launch list', () => {
    const customEnv = {
      ...env,
      existsSync: (path) => path !== '/ext-data/bugbug' && path !== '/ext-data/sbase' // bugbug and sbase missing initially
    };
    const plan = resolveLaunchPlan('all', customEnv);
    assert.strictEqual(plan.error, null);
    const sourceIds = plan.targetSources.map(s => s.id).sort();
    assert.deepStrictEqual(sourceIds, ['bugbug', 'cloudqa']);
    const extIds = plan.extensions.map(e => e.id).sort();
    assert.deepStrictEqual(extIds, ['bugbug', 'cloudqa', 'rover']);
    assert.strictEqual(plan.missingRequired.length, 0);
    assert.strictEqual(plan.warnings.length, 1); // Warning for seleniumbase, none for bugbug/cloudqa/fillapp
    assert.ok(plan.warnings[0].includes('seleniumbase'));
  });

  await t.test('all mode with seleniumbase present', () => {
    const customEnv = {
      ...env,
      existsSync: () => true // Everything is present
    };
    const plan = resolveLaunchPlan('all', customEnv);
    assert.strictEqual(plan.error, null);
    const sourceIds = plan.targetSources.map(s => s.id).sort();
    assert.deepStrictEqual(sourceIds, ['bugbug', 'cloudqa']);
    const extIds = plan.extensions.map(e => e.id).sort();
    assert.deepStrictEqual(extIds, ['bugbug', 'cloudqa', 'rover', 'seleniumbase']);
    assert.strictEqual(plan.missingRequired.length, 0);
    assert.strictEqual(plan.warnings.length, 0);
  });

  await t.test('rover mode', () => {
    const plan = resolveLaunchPlan('rover', env);
    assert.strictEqual(plan.error, null);
    assert.strictEqual(plan.targetSources.length, 0);
    assert.strictEqual(plan.extensions.length, 1);
    assert.strictEqual(plan.missingRequired.length, 0);
  });

  await t.test('cloudqa mode', () => {
    const plan = resolveLaunchPlan('cloudqa', env);
    assert.strictEqual(plan.error, null);
    assert.strictEqual(plan.targetSources.length, 1);
    assert.strictEqual(plan.extensions.length, 1);
    assert.strictEqual(plan.extensions[0].id, 'cloudqa');
    assert.strictEqual(plan.missingRequired.length, 0);
  });

  await t.test('cloudqa mode downloadable-when-absent', () => {
    const customEnv = {
      ...env,
      existsSync: (path) => path !== '/ext-data/cloudqa' && path !== '/ext-data/sbase' // cloudqa missing
    };
    const plan = resolveLaunchPlan('cloudqa', customEnv);
    assert.strictEqual(plan.error, null);
    assert.ok(plan.targetSources.some(s => s.id === 'cloudqa'));
    assert.ok(plan.extensions.some(e => e.id === 'cloudqa'));
    assert.strictEqual(plan.missingRequired.length, 0);
  });



  await t.test('seleniumbase mode present', () => {
    const customEnv = {
      ...env,
      existsSync: () => true // sbase present
    };
    const plan = resolveLaunchPlan('seleniumbase', customEnv);
    assert.strictEqual(plan.error, null);
    assert.ok(plan.extensions.some(e => e.id === 'seleniumbase'));
    assert.strictEqual(plan.targetSources.some(s => s.id === 'seleniumbase'), false);
    assert.strictEqual(plan.missingRequired.length, 0);
  });

  await t.test('seleniumbase mode fail-loud (not downloadable)', () => {
    const plan = resolveLaunchPlan('seleniumbase', env);
    assert.strictEqual(plan.error, null);
    assert.strictEqual(plan.targetSources.length, 0);
    assert.strictEqual(plan.extensions.length, 0); // because env.existsSync is false for sbase
    assert.strictEqual(plan.missingRequired.length, 1);
    assert.strictEqual(plan.missingRequired[0], 'seleniumbase');
  });

  await t.test('bugbug mode', () => {
    const plan = resolveLaunchPlan('bugbug', env);
    assert.strictEqual(plan.error, null);
    assert.strictEqual(plan.targetSources.length, 1);
    assert.strictEqual(plan.extensions.length, 1);
    assert.strictEqual(plan.missingRequired.length, 0);
  });

  await t.test('bugbug mode missing initially (is Downloadable)', () => {
    const customEnv = {
      ...env,
      existsSync: (path) => path !== '/ext-data/bugbug' // bugbug missing initially
    };
    const plan = resolveLaunchPlan('bugbug', customEnv);
    assert.strictEqual(plan.error, null);
    assert.strictEqual(plan.targetSources.length, 1);
    assert.strictEqual(plan.extensions.length, 1);
    assert.strictEqual(plan.extensions[0].id, 'bugbug');
    assert.strictEqual(plan.missingRequired.length, 0); // NOT marked missing required because it's downloadable
  });

  await t.test('missing required mode fail-loud', () => {
    const customEnv = {
      ...env,
      existsSync: () => false // simulate everything missing
    };
    const plan = resolveLaunchPlan('rover', customEnv);
    assert.strictEqual(plan.error, null);
    assert.strictEqual(plan.extensions.length, 0);
    assert.strictEqual(plan.missingRequired.length, 1);
    assert.strictEqual(plan.missingRequired[0], 'rover');
  });

  await t.test('all mode missing rover fail-loud', () => {
    const customEnv = {
      ...env,
      existsSync: (path) => path !== '/app-assets/rover' && path !== '/ext-data/sbase' // simulate missing rover and sbase
    };
    const plan = resolveLaunchPlan('all', customEnv);
    assert.strictEqual(plan.error, null);
    assert.strictEqual(plan.missingRequired.length, 1);
    assert.strictEqual(plan.missingRequired[0], 'rover');
    assert.strictEqual(plan.warnings.some(w => w.includes('rover')), false);
    assert.strictEqual(plan.warnings.some(w => w.includes('seleniumbase')), true);
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
    readFileSync: (p) => {
      if (p.includes('manifest.json')) {
        return JSON.stringify({
          manifest_version: 3,
          background: { service_worker: "bg.js" }
        });
      }
      return "";
    },
    existsSync: (path) => true,
    pathDirname: (p) => p.split('/').slice(0, -1).join('/'),
    pathJoin: (...args) => args.join('/'),
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

  await t.test('throws on missing entrypoint in manifest', async () => {
    const sys = {
      ...baseSys,
      fetch: async () => ({
        ok: true,
        headers: new Headers({ 'content-type': 'application/octet-stream' }),
        arrayBuffer: async () => new ArrayBuffer(10)
      }),
      readFileSync: (p) => JSON.stringify({ manifest_version: 3 })
    };
    await assert.rejects(
      acquireExtension({ url: 'http://foo', destZip: '/foo.crx', extractDir: '/foo' }, sys),
      /no entrypoints found in manifest/
    );
  });

  await t.test('succeeds for valid zip and writes metadata', async () => {
    let writtenPath = null;
    let writtenData = null;
    const sys = {
      ...baseSys,
      fetch: async () => ({
        ok: true,
        headers: new Headers({ 'content-type': 'application/octet-stream' }),
        arrayBuffer: async () => new ArrayBuffer(10)
      }),
      writeFileSync: (p, data) => {
        if (p.includes('_meta.json')) {
          writtenPath = p;
          writtenData = data;
        } else {
          writeCalled = true;
        }
      }
    };
    await acquireExtension({ id: 'foo', name: 'FooExt', isCrx: true, url: 'http://foo', destZip: '/foo.crx', extractDir: '/foo' }, sys);
    assert.strictEqual(mkdirCalled, true);
    assert.strictEqual(writeCalled, true);
    assert.strictEqual(renameCalled, true);
    assert.strictEqual(extracted, true);
    assert.ok(writtenPath);
    const meta = JSON.parse(writtenData);
    assert.strictEqual(meta.id, 'foo');
    assert.strictEqual(meta.name, 'FooExt');
    assert.strictEqual(meta.url, 'http://foo');
    assert.strictEqual(meta.manifestVersion, 3);
    assert.strictEqual(meta.sourceType, 'crx');
    assert.ok(meta.downloadedAt);
  });
});
