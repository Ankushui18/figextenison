'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..', 'extension');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
function api(extra = {}) {
  const context = vm.createContext({ URL, Blob, DOMException, AbortController, AbortSignal, setTimeout, clearTimeout, crypto: crypto.webcrypto, location: { href: 'https://example.com/page', origin: 'https://example.com' }, ...extra });
  vm.runInContext(read('js/privacy.js'), context); vm.runInContext(read('js/capture-safety.js'), context); return { context, Safety: context.PageCaptureSafety };
}
const { Safety } = api();
const encode = async text => Buffer.from(text, 'utf8').toString('base64');
const control = (tag, options = {}) => ({ nodeType: 1, tag, attributes: { ...options.attrs }, styles: { ...options.styles }, rect: { x: 0, y: 0, width: 200, height: 24, ...options.rect }, childNodes: options.children || [] });
const doc = children => ({ version: 2, root: control('HTML', { children: [control('BODY', { children })] }), assets: {}, fonts: {} });
const record = document => ({ type: 'snapshot', id: 'saved', h2dJson: JSON.stringify(document), previewUrl: 'data:,' });
const payload = async blob => JSON.parse(Buffer.from((await blob.text()).match(/\(figh2d\)([A-Za-z0-9+/=]+)\(\/figh2d\)/)[1], 'base64').toString('utf8'));

function liveControl(tag = 'input', styles = {}, rect = {}) {
  const node = { localName: tag, type: 'text', nodeType: 1, parentElement: null, styles: { display: 'block', opacity: '1', visibility: 'visible', contentVisibility: 'visible', ...styles }, getBoundingClientRect: () => ({ width: 200, height: 24, x: 0, y: 4000, ...rect }), getRootNode: () => ({}) };
  node.ownerDocument = { defaultView: { getComputedStyle: target => target.styles } }; return node;
}
test('Hidden input nodes are removed from snapshots, not just masked in UI', () => {
  const source = doc([control('INPUT', { attrs: { type: 'hidden', value: 'SECRET_HIDDEN' } }), control('INPUT', { attrs: { type: 'text', value: 'visible value' } })]);
  const result = Safety.sanitizeDocument(source); assert.equal(result.removed, 1); assert.ok(!JSON.stringify(source).includes('SECRET_HIDDEN')); assert.ok(JSON.stringify(source).includes('visible value'));
});
for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) test(`Invisible ${tag} data is removed together with its text/option children`, () => {
  const source = doc([control(tag, { attrs: { value: 'SECRET' }, styles: { display: 'none' }, children: [{ nodeType: 3, text: 'SECRET' }] })]);
  assert.equal(Safety.sanitizeDocument(source).removed, 1); assert.ok(!JSON.stringify(source).includes('SECRET'));
});
test('Inherited display/opacity hiding and tiny controls are redacted without dropping layout siblings', () => {
  const source = doc([control('DIV', { styles: { opacity: '0' }, children: [control('INPUT', { attrs: { value: 'SECRET' } })] }), control('INPUT', { attrs: { value: 'TINY' }, rect: { width: 1, height: 1 } }), control('DIV', { attrs: { id: 'kept' } })]);
  Safety.sanitizeDocument(source); assert.ok(!JSON.stringify(source).includes('SECRET')); assert.ok(!JSON.stringify(source).includes('TINY')); assert.ok(JSON.stringify(source).includes('kept'));
});
test('Password values are removed while visible field geometry and values of ordinary visible inputs are retained', () => {
  const source = doc([control('INPUT', { attrs: { type: 'password', value: 'SECRET_PASS' } }), control('INPUT', { attrs: { type: 'email', value: 'visible@example.com' } })]);
  Safety.sanitizeDocument(source); assert.ok(!JSON.stringify(source).includes('SECRET_PASS')); assert.ok(JSON.stringify(source).includes('visible@example.com')); assert.equal(source.root.childNodes[0].childNodes.length, 2);
});
test('Nonvisual control value IDs are removed while checked/selected states and visible labels remain', () => {
  const source = doc([control('INPUT', { attrs: { type: 'checkbox', value: 'PRIVATE_ID', checked: 'true' } }), control('BUTTON', { attrs: { value: 'PRIVATE_ID' }, children: [{ nodeType: 3, text: 'Visible action' }] }), control('OPTION', { attrs: { value: 'PRIVATE_ID', selected: 'true', label: 'Visible option' } })]);
  Safety.sanitizeDocument(source); assert.ok(!JSON.stringify(source).includes('PRIVATE_ID')); assert.ok(JSON.stringify(source).includes('Visible action')); assert.ok(JSON.stringify(source).includes('Visible option')); assert.equal(source.root.childNodes[0].childNodes[0].attributes.checked, 'true');
});
test('Visibility overrides are not confused with inherited display/opacity hiding', () => {
  const source = doc([control('DIV', { styles: { visibility: 'hidden' }, children: [control('INPUT', { attrs: { value: 'visible child' }, styles: { visibility: 'visible' } })] })]);
  Safety.sanitizeDocument(source); assert.ok(JSON.stringify(source).includes('visible child'));
});
test('Off-screen visible form controls are preserved; viewport location is not a privacy filter', () => {
  assert.equal(Safety.nonVisualControl(liveControl()), false); const hidden = liveControl(); hidden.type = 'hidden'; assert.equal(Safety.nonVisualControl(hidden), true);
});
for (const styles of [{ display: 'none' }, { opacity: '0' }, { visibility: 'hidden' }, { contentVisibility: 'hidden' }]) test(`Live hidden form detection: ${Object.keys(styles)[0]}`, () => {
  assert.equal(Safety.nonVisualControl(liveControl('textarea', styles)), true);
});
test('Live controls inside closed/open component hosts respect ancestor opacity without modifying it', () => {
  const child = liveControl(), host = liveControl('div', { opacity: '0' }); child.getRootNode = () => ({ host }); assert.equal(Safety.nonVisualControl(child), true); assert.equal(host.styles.opacity, '0');
});
test('Decorative non-control elements are never removed by the form privacy predicate', () => {
  const element = liveControl('svg', { display: 'none' }, { width: 0, height: 0 }); assert.equal(Safety.nonVisualControl(element), false);
});
test('Stored legacy snapshots are migrated without altering raw HTML/MHTML or losing IDs/previews', async () => {
  const old = record(doc([control('INPUT', { attrs: { type: 'hidden', value: 'OLD_SECRET' } })])), html = { id: 'raw', type: 'mhtml', mhtml: { content: 'KEEP_RAW' } };
  const result = await Safety.cleanSavedCaptures([old, html], new AbortController().signal);
  assert.equal(result.changed, true); assert.equal(result.records[0].id, old.id); assert.equal(result.records[0].previewUrl, old.previewUrl); assert.ok(!result.records[0].h2dJson.includes('OLD_SECRET')); assert.equal(result.records[1], html); assert.ok(old.h2dJson.includes('OLD_SECRET'));
});
test('Corrupt legacy work is retained locally but blocked instead of silently discarded or exported', async () => {
  const bad = { type: 'snapshot', id: 'bad', h2dJson: 'not json' }; const result = await Safety.cleanSavedCaptures([bad], new AbortController().signal);
  assert.equal(result.records.length, 1); assert.equal(result.records[0].h2dJson, 'not json'); assert.equal(result.records[0].copyBlocked, 'needs_recapture');
  await assert.rejects(Safety.prepareClipboard(result.records, { encode, signal: new AbortController().signal }), error => error.code === 'INVALID_CAPTURE');
});
test('UTF-8 byte counting matches real encoding for Unicode, emoji and lone surrogates', async () => {
  for (const text of ['ascii', '日本語', 'emoji 😀', '\ud800', '\udc00', 'a\ud800b']) assert.equal(await Safety.utf8Bytes(text, 1024), Buffer.byteLength(text));
});
test('Input size is checked before parsing or base64 encoding, including all-snapshot batches', async () => {
  let calls = 0;
  await assert.rejects(Safety.prepareClipboard([record(doc([]))], { encode: async text => { calls++; return encode(text); }, limits: { jsonBytes: 32, htmlBytes: 1000 } }), error => error.code === 'COPY_TOO_LARGE'); assert.equal(calls, 0);
});
test('Combined record bytes are budgeted, not just each capture independently', async () => {
  const a = record(doc([])), oneBytes = Buffer.byteLength(a.h2dJson) + 30;
  await assert.rejects(Safety.prepareClipboard([a, a], { encode, limits: { jsonBytes: oneBytes, htmlBytes: 10000 } }), error => error.code === 'COPY_TOO_LARGE');
});
test('Predicted HTML/base64 size is checked before encoding the expensive data payload', async () => {
  let calls = 0;
  await assert.rejects(Safety.prepareClipboard([record(doc([]))], { encode: async text => { calls++; return encode(text); }, limits: { jsonBytes: 4096, htmlBytes: 100 } }), error => error.code === 'COPY_TOO_LARGE'); assert.equal(calls, 1);
});
test('Bounds extend the existing 48 MiB JSON / 64 MiB HTML limits to normal snapshots', () => {
  assert.equal(Safety.limits.jsonBytes, 50331648); assert.equal(Safety.limits.htmlBytes, 67108864); assert.ok(Object.isFrozen(Safety.limits));
});
test('Actual rich clipboard format is unchanged and legacy snapshots are sanitized before copy', async () => {
  const old = record(doc([control('INPUT', { attrs: { type: 'hidden', value: 'LEGACY_SECRET' } }), control('P', { children: [{ nodeType: 3, text: '日本語 😀' }] })]));
  const blob = await Safety.prepareClipboard([old], { encode, signal: new AbortController().signal }); const data = await payload(blob);
  assert.equal(blob.type, 'text/html'); assert.equal(data.length, 1); assert.equal(data[0].type, 'snapshot'); assert.ok(!JSON.stringify(data).includes('LEGACY_SECRET')); assert.ok(JSON.stringify(data).includes('日本語 😀'));
  const html = await blob.text(); assert.match(html, /\(figmeta\)/); assert.match(html, /\(\/figmeta\)/); assert.match(html, /\(figh2d\)/); assert.ok(old.h2dJson.includes('LEGACY_SECRET'));
});
test('Image asset diagnostics expose aggregate embedded/not-embedded counts and never expose URLs or errors', () => {
  const privateUrl = 'https://private.example/image.png?token=SECRET', privateError = 'read failed for SECRET';
  const first = record({ ...doc([]), assets: {
    [privateUrl]: { blob: { type: 'image/png', base64Blob: 'data:application/octet-stream;base64,AAAA' } },
    'https://private.example/missing.webp': { blob: null, error: privateError }
  } });
  const second = record({ ...doc([]), assets: { 'rasterized:0': { blob: null } } });
  const summary = Safety.imageAssetSummary([first, second, { type: 'mhtml' }, { type: 'snapshot', h2dJson: 'not JSON' }]);
  assert.deepEqual(plain(summary), { total: 3, included: 1, notEmbedded: 2 }); assert.ok(Object.isFrozen(summary));
  assert.ok(!JSON.stringify(summary).includes('private.example')); assert.ok(!JSON.stringify(summary).includes('SECRET'));
});
test('No-asset snapshots produce a zero summary and do not add UI diagnostics', () => {
  assert.deepEqual(plain(Safety.imageAssetSummary([record(doc([]))])), { total: 0, included: 0, notEmbedded: 0 });
});
test('Malformed capture errors never echo source JSON, values or URLs into status text', async () => {
  try { await Safety.prepareClipboard([{ type: 'snapshot', h2dJson: 'SECRET_PRIVATE_JSON' }], { encode }); assert.fail('expected failure'); } catch (error) { assert.ok(!Safety.copyMessage(error, 'encoding_failed', true).includes('SECRET_PRIVATE_JSON')); }
  assert.ok(!Safety.copyMessage(new Error('https://private.example/?token=SECRET'), 'clipboard_write_failed', true).includes('SECRET'));
});
test('Automatic copy failure explicitly preserves capture and offers manual retry; manual errors are actionable', () => {
  assert.match(Safety.copyMessage(new Error(), 'clipboard_write_failed', true), /Capture saved.*Copy all/);
  assert.match(Safety.copyMessage(new Error(), 'clipboard_write_failed', false), /focused.*clipboard access/);
  assert.match(Safety.copyMessage(new Safety.CopyBudgetError(), 'encoding_failed', false), /^These captures/);
});
test('Cancellation interrupts preparation before data encoding and emits no result', async () => {
  const abort = new AbortController(); abort.abort(); let calls = 0;
  await assert.rejects(Safety.prepareClipboard([record(doc([]))], { encode: async text => { calls++; return encode(text); }, signal: abort.signal }), { name: 'AbortError' }); assert.equal(calls, 0);
});
test('A long preflight yields for cancellation instead of monopolizing the event loop', async () => {
  const abort = new AbortController(); const pending = Safety.utf8Bytes('x'.repeat(1200000), 2000000, abort.signal); setTimeout(() => abort.abort(), 0); await assert.rejects(pending, { name: 'AbortError' });
});
test('Sessions prevent cancelling/restarting an irreversible native write, but allow explicit disposal', () => {
  const session = Safety.createSession(), signal = session.begin(); session.copyPhase(signal, 'preparing'); assert.equal(session.phase(), 'preparing'); session.copyPhase(signal, 'writing');
  assert.equal(session.cancel(), false); assert.equal(signal.aborted, false); assert.throws(() => session.begin(), /already in progress/); assert.equal(session.isWriting(), true);
  assert.equal(session.cancel(true), true); assert.equal(signal.aborted, true);
});
test('Stale cleanup cannot unlock or clear a newer capture/copy job', () => {
  const session = Safety.createSession(), old = session.begin(), current = session.begin(); assert.equal(old.aborted, true); session.copyPhase(current, 'writing'); session.finishCopy(old); session.clear(old);
  assert.equal(session.isCurrent(current), true); assert.equal(session.isWriting(), true); assert.equal(session.isLatest(old), false); session.finishCopy(current); session.clear(current); assert.equal(session.isActive(), false); assert.equal(session.isLatest(current), true);
});
test('Abortable waiting consumes late resolution/rejection without publishing it', async () => {
  const abort = new AbortController(); let release; const pending = Safety.wait(new Promise(resolve => { release = resolve; }), abort.signal); abort.abort(); await assert.rejects(pending, { name: 'AbortError' }); release('late');
});
test('Pre-aborted waiting consumes an already rejected promise without an unhandled late rejection', async () => {
  const abort = new AbortController(); abort.abort();
  await assert.rejects(Safety.wait(Promise.reject(new Error('late source failure')), abort.signal), { name: 'AbortError' });
});
test('FileReader work is cancelled and detached on abort', async () => {
  let reader;
  class Reader { constructor() { reader = this; this.readyState = 0; } readAsDataURL() { this.readyState = 1; } abort() { this.readyState = 2; this.aborted = true; this.onabort?.(); } }
  const { Safety: S } = api({ FileReader: Reader }); const abort = new AbortController(), pending = S.blobDataURL(new Blob(['fixture']), abort.signal); abort.abort(); await assert.rejects(pending, { name: 'AbortError' }); assert.equal(reader.aborted, true); assert.equal(reader.onload, null);
});
test('Detached image conversion releases the URL/image on abort without touching source DOM', async () => {
  const released = [], images = [];
  class TestURL extends URL { static createObjectURL() { return 'blob:fixture'; } static revokeObjectURL(url) { released.push(url); } }
  class Image { constructor() { images.push(this); } decode() { return new Promise(() => {}); } }
  const { Safety: S } = api({ URL: TestURL, Image }); const abort = new AbortController(), pending = S.convertImage(new Blob(['fixture']), abort.signal, async () => new Blob()); abort.abort(); await assert.rejects(pending, { name: 'AbortError' }); assert.equal(images[0].src, ''); assert.deepEqual(released, ['blob:fixture']);
});
test('A pending cross-origin video clone is stopped/released on cancellation; the original is never paused', async () => {
  let temporary, paused = 0;
  class Video extends EventTarget { pause() { this.paused = true; } removeAttribute(name) { this[name] = ''; } load() { this.released = true; } cancelVideoFrameCallback() {} }
  const { Safety: S } = api({ document: { createElement: tag => { assert.equal(tag, 'video'); return temporary = new Video(); } } });
  const source = { currentSrc: 'https://cdn.example.com/movie.mp4', crossOrigin: null, currentTime: 0, pause: () => { paused++; } }, abort = new AbortController();
  const pending = S.videoBlob(source, abort.signal, async () => new Blob()); abort.abort(); await assert.rejects(pending, { name: 'AbortError' }); assert.equal(paused, 0); assert.equal(temporary.src, ''); assert.equal(temporary.released, true);
});
test('A temporary video seeks to the time captured at job start, not a later mutable source time', async () => {
  let temporary, reads = 0, requested;
  class Video extends EventTarget {
    constructor() { super(); this.videoWidth = 320; this.videoHeight = 180; }
    set src(value) { this.url = value; queueMicrotask(() => this.dispatchEvent(new Event('loadedmetadata'))); }
    set currentTime(value) { requested = value; queueMicrotask(() => { this.dispatchEvent(new Event('seeked')); this.frame(); }); }
    requestVideoFrameCallback(callback) { this.frame = callback; return 1; }
    cancelVideoFrameCallback() {} pause() {} removeAttribute() {} load() {}
  }
  const canvas = { getContext: () => ({ drawImage() {} }) };
  const { Safety: S } = api({ document: { createElement: tag => tag === 'video' ? temporary = new Video() : canvas } });
  const source = { currentSrc: 'https://cdn.example.com/movie.mp4', crossOrigin: null, get currentTime() { reads++; return reads === 1 ? 1.5 : 0; } };
  await S.videoBlob(source, new AbortController().signal, async () => new Blob(['frame'])); assert.equal(requested, 1.5); assert.equal(reads, 1); assert.ok(temporary);
});
test('Source same-origin video frame capture does not play, pause or reload the original', async () => {
  const source = { currentSrc: 'https://example.com/movie.mp4', crossOrigin: null, videoWidth: 320, videoHeight: 180 }; let drawn;
  const canvas = { getContext: () => ({ drawImage: video => { drawn = video; } }) };
  const { Safety: S } = api({ document: { createElement: tag => { assert.equal(tag, 'canvas'); return canvas; } } });
  const blob = await S.videoBlob(source, new AbortController().signal, async () => new Blob(['frame'])); assert.equal(blob.size, 5); assert.equal(drawn, source); assert.equal(canvas.width, 320);
});
test('Asset RPC cancellation is sent with the same random job ID and no captured content', async () => {
  const abort = new AbortController(), sent = [];
  const pending = Safety.requestAssets(['https://example.com/a.png'], abort.signal, request => { sent.push(plain(request)); return request.cancel ? Promise.resolve([]) : new Promise(() => {}); });
  abort.abort(); await assert.rejects(pending, { name: 'AbortError' }); assert.equal(sent.length, 2); assert.equal(sent[1].cancel, sent[0].requestId); assert.deepEqual(Object.keys(sent[1]), ['cancel']); assert.match(sent[0].requestId, /^[a-f0-9-]{36}$/);
});

test('Asset request IDs still work on HTTP pages without crypto.randomUUID', async () => {
  const { Safety: S } = api({ crypto: { getRandomValues: target => crypto.webcrypto.getRandomValues(target) } }); let sent;
  await S.requestAssets([], new AbortController().signal, async request => { sent = request; return []; });
  assert.match(sent.requestId, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
});

function workerHarness() {
  let listener, removed; const signals = [], calls = [], event = { addListener() {} }; let started;
  const ready = new Promise(resolve => { started = resolve; });
  const sandbox = { URL, URLSearchParams, AbortController, AbortSignal, Promise, Blob, Response, Uint8Array, atob, crypto: crypto.webcrypto,
    fetch: async (url, options) => { calls.push(url); signals.push(options.signal); started(); return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })); },
    chrome: { runtime: { id: 'fixture-extension', getURL: name => `chrome-extension://fixture-extension/${name}`, onMessage: { addListener(fn) { listener = fn; } } }, action: { onClicked: event }, commands: { onCommand: event }, tabs: { onUpdated: event, onRemoved: { addListener(fn) { removed = fn; } } }, storage: { local: { remove: async () => {} } } }
  };
  const context = vm.createContext(sandbox); sandbox.importScripts = (...names) => names.forEach(name => vm.runInContext(read('js/' + name), context)); vm.runInContext(read('js/background.js'), context);
  const sender = { id: 'fixture-extension', tab: { id: 8 }, frameId: 0 };
  return { context, ready, signals, calls, sender, remove: id => removed(id), send: (payload, from = sender) => new Promise(resolve => listener({ cmd: 'H2D_FETCH_ASSETS', payload }, from, resolve)) };
}
test('Worker declines CSP-blocked asset recovery without attempting a network request', async () => {
  const h = workerHarness();
  const result = await h.send({ urls: Array.from({ length: 20 }, (_, i) => `https://example.com/${i}.png`) });
  assert.equal(result.success, true);
  assert.ok(result.value.every(asset => asset.blob === null && asset.error === 'recovery_failed'));
  assert.equal(h.calls.length, 0);
});
test('Recovery RPC still rejects malformed and unauthorized requests', async () => {
  const h = workerHarness();
  assert.equal((await h.send({ urls: ['https://example.com/a.png'] }, { ...h.sender, frameId: 1 })).success, false);
  for (const payload of [{ cancel: 'bad' }, { requestId: 'bad', urls: [] }, { urls: 'invalid' }]) {
    assert.equal((await h.send(payload)).success, false);
  }
  assert.equal(h.calls.length, 0);
});
test('Worker-side FileReader encoding is also cancellable', async () => {
  const h = workerHarness(); let entered, reader; const ready = new Promise(resolve => { entered = resolve; });
  h.context.FileReader = class { constructor() { reader = this; } readAsDataURL() { this.readyState = 1; entered(); } abort() { this.readyState = 2; this.aborted = true; this.onabort?.(); } };
  const pending = vm.runInContext('globalThis.testAbort = new AbortController();toDataUrl(new Blob(["fixture"]),testAbort.signal)', h.context);
  await ready; vm.runInContext('testAbort.abort()', h.context); await assert.rejects(pending, { name: 'AbortError' }); assert.equal(reader.aborted, true); assert.equal(reader.onload, null);
});
test('Cancellation tombstones are bounded rather than accumulating across a long session', async () => {
  const h = workerHarness(); for (let i = 0; i < 140; i++) await h.send({ cancel: crypto.randomUUID() }); assert.equal(vm.runInContext('cancelledAssetJobs.size', h.context), 128);
});
test('The board encoder forwards the same active signal to metadata and snapshot encoding', async () => {
  const sandbox = vm.createContext({}); vm.runInContext(read('js/design-system-core.js'), sandbox); vm.runInContext(read('js/design-system-board.js'), sandbox);
  const signal = new AbortController().signal, passed = [];
  await sandbox.PageCaptureDesignBoard.makeClipboardHtml(JSON.stringify(doc([])), async (text, active) => { passed.push(active); return encode(text); }, signal);
  assert.equal(passed.length, 2); assert.ok(passed.every(active => active === signal));
});
test('Permissions, CSP, six-RPC allowlist and raw HTML content are not loosened by safety work', () => {
  const manifest = JSON.parse(read('manifest.json')); assert.deepEqual(manifest.permissions, ['storage', 'tabs', 'unlimitedStorage', 'scripting', 'clipboardWrite']); assert.match(manifest.content_security_policy.extension_pages, /connect-src 'self'/);
  assert.match(read('js/h2d_toolbar.js'), /let html=document.documentElement.outerHTML;await navigator.clipboard.writeText\(html\)/);
  assert.doesNotMatch(read('js/capture-safety.js'), /\bfetch\s*\(|XMLHttpRequest|sendBeacon|window\.open|figma\.variables/);
});
