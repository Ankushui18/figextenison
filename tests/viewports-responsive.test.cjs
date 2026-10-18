'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const source = read('js/viewports.js');
const context = vm.createContext({ URL, DOMException, AbortController, AbortSignal, setTimeout, clearTimeout });
vm.runInContext(read('js/privacy.js'), context); vm.runInContext(source, context);
const API = context.PageCaptureViewports, plain = value => JSON.parse(JSON.stringify(value));

test('Responsive module is idempotent, read-only and introduces no tab/window/navigation/clipboard/network APIs', () => {
  vm.runInContext(source, context); assert.equal(context.PageCaptureViewports, API); assert.ok(Object.isFrozen(API)); assert.ok(Object.isFrozen(API.limits));
  assert.doesNotMatch(source, /chrome\.|\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|window\.open|location\.(?:href|assign|replace)|clipboard|innerHTML\s*=|srcdoc\s*=/);
  assert.match(source, /setAttribute\("sandbox", "allow-same-origin"\)/); assert.match(source, /script-src 'none'/);
  assert.match(source, /isolated\.write\("<!DOCTYPE html><html><head><\/head><body><\/body><\/html>"\)/);
});
test('Responsive dimensions are rounded and support widths beyond the physical browser window', () => {
  assert.deepEqual(plain(API.dimensions(1599.8, 899.8)), { width: 1600, height: 900 });
  assert.deepEqual(plain(API.dimensions(200, 200)), { width: 200, height: 200 });
  assert.deepEqual(plain(API.dimensions(3840, 4000)), { width: 3840, height: 4000 });
});
test('Invalid/non-finite viewport dimensions are rejected before any DOM work', () => {
  for (const [width, height] of [[199, 900], [3841, 900], [NaN, 900], [Infinity, 900], [393, 0], [393, 4001]]) assert.throws(() => API.dimensions(width, height), /Invalid responsive capture size/);
});
test('Copied CSS resolves URLs against each original stylesheet, not the source page or blank frame', () => {
  assert.equal(API.cssUrls('a{background:url(../img/hero.png)}', 'https://example.com/css/site.css'), 'a{background:url("https://example.com/img/hero.png")}');
  assert.equal(API.cssUrls('@import "./extra.css" screen;', 'https://example.com/css/site.css'), '@import "https://example.com/css/extra.css" screen;');
});
test('CSS URL rewriting retains data/blob/fragment references and decodes CSS escapes', () => {
  const input = 'a{background:url("data:image/png;base64,AAAA");mask:url(#clip);src:url(icons\\2f check.svg)}';
  const output = API.cssUrls(input, 'https://example.com/');
  assert.ok(output.includes('data:image/png;base64,AAAA')); assert.ok(output.includes('url("#clip")')); assert.ok(output.includes('https://example.com/icons/check.svg'));
});
test('Known service/telemetry hosts and executable URL schemes are not reintroduced through copied CSS', () => {
  for (const url of ['https://api.figma.com/a.svg', 'https://o123.ingest.sentry.io/a', 'javascript:alert(1)']) assert.ok(API.cssUrls(`a{background:url("${url}")}`, 'https://example.com/').includes('data:,'));
});
test('Responsive srcset assets keep descriptors while resolving all candidates and blocking forbidden destinations', () => {
  assert.equal(API.srcsetUrls('small.png 393w, ../large.png 1600w', 'https://example.com/images/'), 'https://example.com/images/small.png 393w, https://example.com/large.png 1600w');
  assert.equal(API.srcsetUrls('data:image/png;base64,AAAA 1x, https://api.figma.com/a.png 2x', 'https://example.com/'), 'data:image/png;base64,AAAA 1x, data:, 2x');
});
test('Missing engine helpers cannot start a responsive capture', () => {
  assert.equal(API.createCapturer({}), null); assert.equal(API.createCapturer({ capture() {}, serialize() {} }), null);
});
test('A pre-aborted operation rejects before creating a DOM or scheduling a timer', async () => {
  const abort = new AbortController(); abort.abort();
  const capture = API.createCapturer({ capture() {}, serialize() {}, createId() {} });
  await assert.rejects(capture({ width: 393, height: 900, signal: abort.signal, source: {}, mount: {} }), { name: 'AbortError' });
});

const toolbar = read('js/h2d_toolbar.js');
const runSource = toolbar.slice(toolbar.indexOf('async function __vpRun('), toolbar.indexOf('async function __vpDom('));
function runner({ failure, missing = false, abortDuring, beforeAbort = false } = {}) {
  const calls = [], views = [], controllerAbort = new AbortController(), abort = new AbortController();
  class Cancelled extends Error {}
  const sandbox = { AbortSignal, window: { innerWidth: 1280, innerHeight: 900 }, Sn() {}, zr() {}, xn() {}, q: Cancelled,
    jr: (error, fallback) => error?.message || fallback, O: signal => { if (signal.aborted) throw new Cancelled(); },
    __vpDom: async () => { calls.push('browser'); return { id: 'browser', type: 'snapshot' }; }
  };
  if (!missing) sandbox.PageCaptureViewports = { createCapturer: () => async options => {
    calls.push(options.width); assert.equal(options.mount, mount); assert.equal(options.height, 900);
    if (abortDuring) { (abortDuring === 'controller' ? controllerAbort : abort).abort(); options.signal.throwIfAborted(); }
    if (failure === options.width) throw new Error('Test copy failure');
    return { capture: { id: options.width, type: 'snapshot' }, actualWidth: options.width };
  } };
  const mount = {}, ctl = { shadowRoot: mount, lifecycleAbort: controllerAbort, setView: view => views.push(plain(view)) };
  const run = vm.runInNewContext(`${runSource};__vpRun`, sandbox);
  if (beforeAbort) abort.abort();
  return { calls, views, run: rows => run(rows, abort.signal, ctl), Cancelled };
}
const rows = [{ id: 'browser' }, { id: '1600', w: 1600 }, { id: '393', w: 393 }];
test('Browser retains the original capture and each extra width uses the local renderer once', async () => {
  const h = runner(), result = await h.run(rows);
  assert.deepEqual(h.calls, ['browser', 1600, 393]); assert.deepEqual(plain(result.caps).map(cap => cap.id), ['browser', 1600, 393]);
  assert.equal(h.views[2].message, 'Capturing 3 of 3 · 393px…');
});
test('Disabling Browser creates exactly the two selected responsive captures, not a duplicate third frame', async () => {
  const h = runner(), result = await h.run(rows.slice(1)); assert.deepEqual(h.calls, [1600, 393]); assert.equal(result.caps.length, 2);
});
test('Missing/reloaded renderer cannot break the normal Browser-only path', async () => {
  const h = runner({ missing: true }); assert.equal((await h.run(rows.slice(0, 1))).caps.length, 1);
});
test('Failed extra capture retains completed captures and reports the actual width, not a generic worker timeout', async () => {
  const h = runner({ failure: 393 });
  await assert.rejects(h.run(rows), error => {
    assert.match(error.message, /Could not capture 393px: Test copy failure/); assert.match(error.message, /Earlier captures were kept/);
    assert.deepEqual(plain(error.partialCaptures).map(cap => cap.id), ['browser', 1600]); return true;
  });
});
test('A missing renderer explains extension reload/refresh and keeps the original capture', async () => {
  const h = runner({ missing: true }); await assert.rejects(h.run(rows), error => { assert.match(error.message, /Reload the extension and refresh/); assert.equal(error.partialCaptures[0].id, 'browser'); return true; });
});
for (const abortDuring of ['session', 'controller']) test(`${abortDuring} cancellation stops the batch without wrapping it as a capture failure`, async () => {
  const h = runner({ abortDuring }); await assert.rejects(h.run(rows), error => error instanceof h.Cancelled); assert.deepEqual(h.calls, ['browser', 1600]);
});
test('Pre-cancelled batches perform no source or responsive capture', async () => {
  const h = runner({ beforeAbort: true }); await assert.rejects(h.run(rows), error => error instanceof h.Cancelled); assert.deepEqual(h.calls, []);
});
test('Pseudo-element measuring accepts iframe documents and constructs styles in the correct document realm', () => {
  assert.equal(toolbar.split('l instanceof Document||l instanceof ShadowRoot||l.nodeType===Node.DOCUMENT_NODE').length - 1, 2);
  assert.match(toolbar, /l===document\|\|l.ownerDocument===document\?CSSStyleSheet:\(l.ownerDocument\?\.defaultView\|\|l.defaultView\)\.CSSStyleSheet/);
});
