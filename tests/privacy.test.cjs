'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..', 'extension');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const policyContext = { URL };
vm.runInNewContext(read('js/privacy.js'), policyContext);
const Policy = policyContext.PageCapturePrivacy;

for (const url of [
  'https://api.figma.com/v1/files/example', 'https://www.figma.com/api/example',
  'https://s3-alpha.figma.com/assets/example.png', 'https://images.figmausercontent.com/example.png',
  'https://example.figma.site/image.svg', 'https://figma-alpha-api.s3.us-west-2.amazonaws.com/example.png',
  'https://o123.ingest.sentry.io/api/123/envelope/', 'https://API.FIGMA.COM./v1/files/example'
]) {
  test(`Capture reads deny service destination: ${url}`, () => {
    assert.equal(Policy.isAllowedAssetUrl(url), false);
    assert.equal(Policy.isPublicAssetUrl(url), false);
  });
}
for (const url of ['https://example.com/image.png', 'https://cdn.example.com/icons.svg']) {
  test(`Ordinary website asset GET remains eligible: ${url}`, () => {
    assert.equal(Policy.isAllowedAssetUrl(url), true);
    assert.equal(Policy.isPublicAssetUrl(url), true);
  });
}
for (const url of ['http://localhost/a.png', 'http://127.1/a.png', 'http://10.0.0.1/a.png', 'http://192.168.1.1/a.png', 'http://172.20.0.1/a.png', 'http://[::1]/a.png', 'http://host.internal/a.png', 'http://user:password@example.com/a.png']) {
  test(`Privileged recovery denies local/credentialed URL: ${url}`, () => {
    assert.equal(Policy.isPublicAssetUrl(url), false);
  });
}
test('Local document assets stay local and unsafe protocols are denied', () => {
  assert.equal(Policy.isAllowedAssetUrl('data:image/png;base64,AA=='), true);
  assert.equal(Policy.isAllowedAssetUrl('blob:https://example.com/test'), true);
  assert.equal(Policy.isAllowedAssetUrl('file:///home/example.png', 'file:///home/page.html'), true);
  assert.equal(Policy.isAllowedAssetUrl('file:///home/example.png', 'https://example.com'), false);
  assert.equal(Policy.isAllowedAssetUrl('javascript:alert(1)'), false);
  assert.equal(Policy.isAllowedAssetUrl('https://figma.com@evil.example/a.png'), false);
});

function workerHarness() {
  let listener;
  const calls = [];
  const event = { addListener() {} };
  const sandbox = {
    URL, URLSearchParams, AbortController, AbortSignal, Promise, Blob, Response, Uint8Array,
    atob, crypto: require('node:crypto').webcrypto,
    fetch: async (url, options) => {
      calls.push({ url, options });
      return new Response('', { status: 404, headers: { 'content-type': 'image/png' } });
    },
    chrome: {
      runtime: { id: 'local-test-extension', getURL: name => `chrome-extension://local-test-extension/${name}`,
        onMessage: { addListener(fn) { listener = fn; } } },
      action: { onClicked: event }, commands: { onCommand: event },
      tabs: { onUpdated: event, onRemoved: event },
      storage: { local: { remove: async () => {} } }
    }
  };
  const context = vm.createContext(sandbox);
  sandbox.importScripts = (...names) => names.forEach(name => vm.runInContext(read(`js/${name}`), context));
  vm.runInContext(read('js/background.js'), context);
  return {
    context, calls,
    send(cmd, payload, sender = { id: 'local-test-extension', tab: { id: 1 }, frameId: 0 }) {
      return new Promise(resolve => listener({ cmd, payload }, sender, resolve));
    }
  };
}

test('Only the six local capture RPCs remain', () => {
  const harness = workerHarness();
  const commands = Array.from(vm.runInContext('Object.keys(handlers).sort()', harness.context));
  assert.deepEqual(commands, ['H2D_CAPTURE_ELEMENT_PREVIEW', 'H2D_CAPTURE_VISIBLE_TAB', 'H2D_FETCH_ASSETS', 'H2D_GET_TAB_ID', 'H2D_OPEN_TOOLBAR', 'H2D_TOOLBAR_CLOSED']);
});
test('Removed account, upload, calendar and telemetry commands cannot execute', async () => {
  const harness = workerHarness();
  for (const cmd of ['LOGIN', 'LOGOUT', 'GET_USER', 'GET_FILES', 'GET_FILE', 'CREATE_FILE', 'SEARCH_FILES', 'IS_LOGGED_IN', 'SENTRY_EXCEPTION', 'SENTRY_BREADCRUMB', 'TRACK', 'EXPERIMENT', 'CLOSE_TAB', 'H2D_CAPTURE_CODE', 'H2D_CAPTURE_VIEWPORT']) {
    assert.equal((await harness.send(cmd, {})).success, false, cmd);
  }
  assert.equal(harness.calls.length, 0);
});
test('Foreign sender cannot invoke a capture RPC', async () => {
  const harness = workerHarness();
  const result = await harness.send('H2D_GET_TAB_ID', {}, { id: 'another-extension', tab: { id: 1 } });
  assert.equal(result.success, false);
});
test('Known service destinations are rejected before fetch is invoked', async () => {
  const harness = workerHarness();
  const result = await harness.send('H2D_FETCH_ASSETS', { urls: ['https://api.figma.com/v1/files/example', 'https://o123.ingest.sentry.io/api/123/envelope/'] });
  assert.equal(result.success, true);
  assert.ok(result.value.every(asset => asset.error === 'blocked' && asset.blob === null));
  assert.equal(harness.calls.length, 0);
});
test('Worker does not attempt page-hosted asset recovery that extension CSP blocks', async () => {
  const harness = workerHarness();
  const result = await harness.send('H2D_FETCH_ASSETS', { urls: ['https://example.com/image.png'] });
  assert.equal(harness.calls.length, 0);
  assert.deepEqual(Array.from(result.value, asset => [asset.error, asset.blob]), [['recovery_failed', null]]);
});
test('Recovery rejects malformed and unbounded asset lists', async () => {
  const harness = workerHarness();
  for (const payload of [null, { urls: 'not-an-array' }, { urls: [123] }, { urls: new Array(65).fill('https://example.com/a.png') }]) {
    assert.equal((await harness.send('H2D_FETCH_ASSETS', payload)).success, false);
  }
  assert.equal(harness.calls.length, 0);
});
test('Capture engine keeps local clipboard formats, not removed telemetry helpers', () => {
  const toolbar = read('js/h2d_toolbar.js') + read('js/capture-safety.js');
  assert.match(toolbar, /clipboard\.writeText\(/);
  assert.match(toolbar, /clipboard\.write\(/);
  assert.match(toolbar, /figh2d/);
  assert.match(toolbar, /PageCapturePrivacy/);
  assert.doesNotMatch(toolbar, /H2D_CAPTURE_CODE|function Kc\(|h2d_capture_code|function Ce\(|function su\(/);
});
test('Unused bundles, their font assets and the native archive permission are removed', () => {
  for (const name of ['js/vendor.js', 'js/vendor.js.LICENSE.txt', 'js/background.js.LICENSE.txt', 'font/MaterialIcons.woff2', 'font/InterVariable-Italic.woff2']) {
    assert.equal(fs.existsSync(path.join(root, name)), false, name);
  }
  const manifest = JSON.parse(read('manifest.json'));
  assert.ok(!manifest.permissions.includes('pageCapture'));
  assert.ok(!manifest.description.includes('no network calls'));
  assert.doesNotMatch(read('options.html'), /vendor\.js|https?:\/\//);
});
