import test from 'node:test';
import assert from 'node:assert/strict';

import {
  encodeHelperConfigFragment,
  extractHelperConfigFragment,
  hasHelperConfigFragment,
  isHostAllowed,
  normalizeConfig,
  stripPreviewLaunchParams,
  validateConfigInput,
} from './shared.js';

test('normalizeConfig keeps Workspace publicKey config fields', () => {
  const config = normalizeConfig({
    siteId: 'site_123',
    publicKey: 'pk_site_123',
    sessionId: 'sess_123',
    siteKeyId: 'key_123',
    apiBase: 'https://agent.rtrvr.ai',
    allowedDomains: ['example.com'],
    domainScopeMode: 'host_only',
    sessionScope: 'shared_site',
    mode: 'full',
    allowActions: true,
    cloudSandboxEnabled: true,
    pageConfig: {
      disableAutoScroll: true,
    },
    ui: {
      voice: {
        enabled: true,
        language: 'en-US',
        autoStopMs: 2800,
      },
      experience: {
        motion: {
          actionSpotlight: false,
          actionSpotlightColor: '#2563eb',
        },
      },
    },
  });

  assert.equal(config.siteId, 'site_123');
  assert.equal(config.publicKey, 'pk_site_123');
  assert.equal(config.sessionId, 'sess_123');
  assert.equal(config.siteKeyId, 'key_123');
  assert.equal(config.apiBase, 'https://agent.rtrvr.ai');
  assert.deepEqual(config.allowedDomains, ['example.com']);
  assert.equal(config.domainScopeMode, 'host_only');
  assert.equal(config.sessionScope, 'shared_site');
  assert.equal(config.mode, 'full');
  assert.equal(config.allowActions, true);
  assert.equal(config.cloudSandboxEnabled, true);
  assert.deepEqual(config.pageConfig, {
    disableAutoScroll: true,
  });
  assert.deepEqual(config.ui, {
    voice: {
      enabled: true,
      language: 'en-US',
      autoStopMs: 2800,
    },
    experience: {
      motion: {
        actionSpotlight: false,
        actionSpotlightColor: '#2563EB',
      },
    },
  });
});

test('normalizeConfig exposes default action spotlight in helper configs', () => {
  const config = normalizeConfig({
    siteId: 'site_123',
    publicKey: 'pk_site_123',
  });

  assert.deepEqual(config.ui, {
    experience: {
      motion: {
        actionSpotlight: true,
        actionSpotlightColor: '#FF4C00',
      },
    },
  });
  assert.deepEqual(config.pageConfig, {
    disableAutoScroll: true,
  });
});

test('isHostAllowed allows any host with wildcard *', () => {
  assert.ok(isHostAllowed('www.rtrvr.ai', ['*'], 'registrable_domain'));
  assert.ok(isHostAllowed('anything.example.com', ['*'], 'host_only'));
  assert.ok(isHostAllowed('localhost', ['*'], 'host_only'));
  assert.ok(isHostAllowed('some-random-site.org', ['*', 'example.com'], 'registrable_domain'));
});

test('isHostAllowed respects host_only and registrable domain rules', () => {
  assert.equal(isHostAllowed('example.com', ['example.com'], 'host_only'), true);
  assert.equal(isHostAllowed('shop.example.com', ['example.com'], 'host_only'), false);
  assert.equal(isHostAllowed('shop.example.com', ['example.com'], 'registrable_domain'), true);
  assert.equal(isHostAllowed('example.com', ['*.example.com'], 'registrable_domain'), false);
  assert.equal(isHostAllowed('shop.example.com', ['*.example.com'], 'registrable_domain'), true);
  assert.equal(isHostAllowed('app.example.com', ['=app.example.com'], 'registrable_domain'), true);
  assert.equal(isHostAllowed('shop.example.com', ['=app.example.com'], 'registrable_domain'), false);
});

test('helper fragment handoff round-trips generic publicKey config and strips itself from the URL', () => {
  const fragment = encodeHelperConfigFragment({
    siteId: 'site_123',
    publicKey: 'pk_site_123',
    sessionId: 'sess_123',
    allowedDomains: ['example.com'],
    domainScopeMode: 'registrable_domain',
    sessionScope: 'shared_site',
  });
  const url = `https://www.example.com/products#${fragment}`;

  assert.equal(hasHelperConfigFragment(url), true);
  assert.deepEqual(extractHelperConfigFragment(url), {
    siteId: 'site_123',
    publicKey: 'pk_site_123',
    sessionId: 'sess_123',
    allowedDomains: ['example.com'],
    domainScopeMode: 'registrable_domain',
    sessionScope: 'shared_site',
  });
  assert.equal(stripPreviewLaunchParams(url), 'https://www.example.com/products');
});

test('helper fragment handoff also round-trips hosted preview payloads', () => {
  const fragment = encodeHelperConfigFragment({
    previewId: 'rpv_123',
    previewToken: 'rvprv_123',
    apiBase: 'https://agent.rtrvr.ai',
    sessionId: 'rpv_123',
    sessionScope: 'shared_site',
    targetUrl: 'https://www.example.com/products',
  });
  const url = `https://www.example.com/products#${fragment}`;

  assert.deepEqual(extractHelperConfigFragment(url), {
    previewId: 'rpv_123',
    previewToken: 'rvprv_123',
    apiBase: 'https://agent.rtrvr.ai',
    sessionId: 'rpv_123',
    sessionScope: 'shared_site',
    targetUrl: 'https://www.example.com/products',
  });
});

test('old helper fragment param is ignored after the cutover', () => {
  const payload = encodeURIComponent(Buffer.from(JSON.stringify({
    siteId: 'old_site',
    publicKey: 'pk_site_old',
  })).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, ''));
  const oldParam = `rover_helper_${'config'}`;
  const url = `https://www.example.com/#${oldParam}=${payload}`;

  assert.equal(hasHelperConfigFragment(url), false);
  assert.equal(extractHelperConfigFragment(url), null);
});

test('invalid helper fragments throw a clear error', () => {
  assert.throws(
    () => extractHelperConfigFragment('https://www.example.com/#rover_helper_payload=not-valid-base64'),
    /Invalid Rover helper handoff:/,
  );
});

// validateConfigInput tests

test('validateConfigInput returns empty array for valid config', () => {
  const issues = validateConfigInput({
    siteId: 'site_123',
    publicKey: 'pk_site_123',
    allowedDomains: ['*'],
  });
  assert.deepStrictEqual(issues, []);
});

test('validateConfigInput reports missing siteId and auth', () => {
  const issues = validateConfigInput({});
  assert.ok(issues.length >= 2);
  assert.ok(issues.some(i => i.level === 'error' && i.message.includes('siteId')));
  assert.ok(issues.some(i => i.level === 'error' && i.message.includes('publicKey')));
});

test('validateConfigInput warns on unusual token formats', () => {
  const issues = validateConfigInput({
    siteId: 'site_123',
    publicKey: 'not_a_pk',
    sessionToken: 'bad_token',
  });
  assert.ok(issues.some(i => i.level === 'warning' && i.message.includes('pk_')));
  assert.ok(issues.some(i => i.level === 'warning' && i.message.includes('sessionToken')));
});

test('validateConfigInput accepts sessionToken-only auth', () => {
  const issues = validateConfigInput({
    siteId: 'site_123',
    sessionToken: 'rvrsess_abc123',
  });
  assert.deepStrictEqual(issues, []);
});

test('validateConfigInput rejects non-object input', () => {
  assert.ok(validateConfigInput(null).length > 0);
  assert.ok(validateConfigInput([]).length > 0);
  assert.ok(validateConfigInput('string').length > 0);
});
