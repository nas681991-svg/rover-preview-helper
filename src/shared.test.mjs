import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { 
  readCurrentTabId, normalizeHost, normalizeAllowedDomains,
  isHostAllowed, normalizeConfig, extractPreviewLaunchParams,
  hasHelperConfigFragment, extractHelperConfigFragment,
  stripPreviewLaunchParams, buildLaunchUrl, validateConfigInput,
  encodeHelperConfigFragment
} from './shared.js';

describe('shared', () => {
  test('readCurrentTabId handles inputs', () => {
    assert.equal(readCurrentTabId(10), 10);
    assert.equal(readCurrentTabId('10'), 10);
    assert.equal(readCurrentTabId(-1), null);
    assert.equal(readCurrentTabId('foo'), null);
  });

  test('normalizeHost handles URLs', () => {
    assert.equal(normalizeHost('https://example.com/path'), 'example.com');
    assert.equal(normalizeHost('invalid url'), '');
  });

  test('normalizeAllowedDomains handles arrays and strings', () => {
    assert.deepEqual(normalizeAllowedDomains(['a', 'b', 'b', null]), ['a', 'b']);
    assert.deepEqual(normalizeAllowedDomains('a, b, b,'), ['a', 'b']);
    assert.deepEqual(normalizeAllowedDomains(null), []);
  });

  test('isHostAllowed checks patterns', () => {
    const domains = ['example.com', '*.test.com', '=exact.com', '*'];
    assert.equal(isHostAllowed('sub.example.com', domains), true);
    assert.equal(isHostAllowed('example.com', domains), true);
    assert.equal(isHostAllowed('sub.test.com', domains), true);
    assert.equal(isHostAllowed('test.com', ['example.com', '*.test.com']), false); // Needs sub for *.
    assert.equal(isHostAllowed('exact.com', domains), true);
    assert.equal(isHostAllowed('sub.exact.com', domains), true); // because * is there
    
    assert.equal(isHostAllowed('foo.com', ['foo.com'], 'host_only'), true);
    assert.equal(isHostAllowed('sub.foo.com', ['foo.com'], 'host_only'), false);
  });

  test('normalizeConfig defaults', () => {
    const cfg = normalizeConfig();
    assert.equal(cfg.apiBase, 'https://agent.rtrvr.ai');
    assert.equal(cfg.pageConfig.disableAutoScroll, true);
  });

  test('normalizeConfig overrides', () => {
    const input = {
      siteId: '123',
      apiBase: 'http://test.com',
      allowedDomains: 'foo.com',
      domainScopeMode: 'host_only',
      ui: { voice: { enabled: true, language: 'en', autoStopMs: 2000 } }
    };
    const cfg = normalizeConfig(input);
    assert.equal(cfg.siteId, '123');
    assert.equal(cfg.apiBase, 'http://test.com');
    assert.deepEqual(cfg.allowedDomains, ['foo.com']);
    assert.equal(cfg.domainScopeMode, 'host_only');
    assert.equal(cfg.ui.voice.enabled, true);
  });

  test('extractPreviewLaunchParams parses query params', () => {
    assert.equal(extractPreviewLaunchParams('http://t'), null);
    const res = extractPreviewLaunchParams('http://t?rover_preview_id=1&rover_preview_token=2&rover_preview_api=3');
    assert.equal(res.previewId, '1');
    assert.equal(res.previewToken, '2');
    assert.equal(res.apiBase, '3');
  });

  test('helper config fragment functions', () => {
    assert.equal(hasHelperConfigFragment('http://t'), false);
    
    const config = { foo: 'bar' };
    const frag = encodeHelperConfigFragment(config);
    const url = 'http://t#' + frag;
    
    assert.equal(hasHelperConfigFragment(url), true);
    const extracted = extractHelperConfigFragment(url);
    assert.deepEqual(extracted, config);
  });

  test('extractHelperConfigFragment throws on invalid', () => {
    assert.throws(() => extractHelperConfigFragment('http://t#rover_helper_payload=invalid_base64'), /Invalid Rover helper handoff/);
  });

  test('stripPreviewLaunchParams removes params', () => {
    const url = 'http://t?rover_preview_id=1&other=2#rover_helper_payload=3';
    const stripped = stripPreviewLaunchParams(url);
    assert.equal(stripped, 'http://t/?other=2');
  });

  test('buildLaunchUrl adds params', () => {
    const res = buildLaunchUrl('http://t', { requestId: 'r', attachToken: 'a' });
    assert.equal(res, 'http://t/?rover_launch=r&rover_attach=a');
  });

  test('validateConfigInput handles various inputs', () => {
    assert.equal(validateConfigInput(null)[0].level, 'error');
    assert.equal(validateConfigInput([])[0].level, 'error');

    let issues = validateConfigInput({});
    assert.ok(issues.some(i => i.message.includes('siteId')));
    assert.ok(issues.some(i => i.message.includes('publicKey')));

    issues = validateConfigInput({ siteId: '1', publicKey: '123', apiBase: 'ftp://foo' });
    assert.ok(issues.some(i => i.message.includes('protocol should be http or https')));

    issues = validateConfigInput({ siteId: '1', publicKey: 'pk_123', allowedDomains: 'foo.com' });
    assert.ok(issues.some(i => i.message.includes('allowedDomains should be an array')));
  });
});
