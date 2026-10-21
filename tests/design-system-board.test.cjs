'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..', 'extension');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

// Tiny dependency-free DOM model for pure construction/lifecycle tests. Real
// iframe layout, cross-realm nodes and native clipboard are tested in Chromium.
class Element {
  constructor(tag, ownerDocument) { this.tagName = tag.toUpperCase(); this.ownerDocument = ownerDocument; this.style = {}; this.attributes = {}; this.children = []; this.parentNode = null; this._text = ''; this.removals = 0; }
  get isConnected() { return !!this.parentNode?.isConnected; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this._text = String(value); this.children = []; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  attachShadow(options) { const root = new Element('shadow-root', this.ownerDocument); root.parentNode = this; root.mode = options.mode; this.privateShadow = root; this.shadowRoot = options.mode === 'closed' ? null : root; return root; }
  append(...children) { for (const child of children) { child.parentNode = this; this.children.push(child); } }
  remove() { if (this.parentNode?.children) this.parentNode.children = this.parentNode.children.filter(child => child !== this); this.parentNode = null; this.removals++; }
  getBoundingClientRect() { return { x: 0, y: 0, width: parseFloat(this.style.width) || 1120, height: this.tagName === 'MAIN' ? 2400 : 800 }; }
}
class Document {
  constructor() { this.isConnected = true; this.frames = []; this.documentElement = new Element('html', this); this.documentElement.parentNode = this; this.head = new Element('head', this); this.body = new Element('body', this); this.documentElement.append(this.head, this.body); }
  createElement(tag) { const node = new Element(tag, this); if (tag === 'iframe') { node.contentDocument = new Document(); this.frames.push(node); } return node; }
}
function harness(options = {}) {
  const document = new Document(), writes = [], timers = new Set();
  const context = vm.createContext({
    URL, Blob, AbortController, AbortSignal, DOMException, document,
    navigator: { clipboard: { write: async items => { writes.push(items); if (options.write) return options.write(items); } } },
    ClipboardItem: class { constructor(formats) { this.formats = formats; this.types = Object.keys(formats); } },
    setTimeout(fn, ms) { const id = setTimeout(fn, ms); timers.add(id); return id; },
    clearTimeout(id) { timers.delete(id); clearTimeout(id); }
  });
  vm.runInContext(read('js/design-system-core.js'), context);
  vm.runInContext(read('js/design-system-board.js'), context);
  const Core = context.PageCaptureDesignSystemCore, Board = context.PageCaptureDesignBoard;
  const mount = document.createElement('div'); document.body.append(mount);
  return { context, Core, Board, document, mount, writes, timers };
}
const record = { hasText: true, styles: {
  color: '#0d99ff', backgroundColor: 'rgba(0,0,0,.5)', fontFamily: 'Actual Website Font', fontSize: '96px', fontWeight: '700', fontStyle: 'italic', lineHeight: '120px', letterSpacing: '1px',
  paddingTop: '16px', marginLeft: '-4px', borderTopLeftRadius: '8px 16px', boxShadow: 'rgba(0,0,0,.2) 0px 4px 12px 0px', borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: '#dddddd'
} };
const system = Core => Core.buildSystem([record], { title: '日本語 Design "<script>"', url: 'https://user:password@example.com/path?secret=private#fragment', viewport: { width: 1280, height: 800 } });
const descendants = node => [node, ...node.children.flatMap(descendants)];
const snapshot = () => ({ version: 2, documentTitle: 'Original site title', root: { nodeType: 1, tag: 'MAIN', rect: { x: 0, y: 0, width: 1120, height: 2400 }, childNodes: [{ nodeType: 3, text: '日本語 editable Aa' }] }, assets: new Map(), fonts: {} });
const encode = async value => Buffer.from(value, 'utf8').toString('base64');
const helpers = (overrides = {}) => ({
  capture: async () => ({ document: snapshot() }),
  serialize: async doc => JSON.stringify({ ...doc, assets: Object.fromEntries(doc.assets) }), encode, ...overrides
});
const clipboardData = html => JSON.parse(Buffer.from(html.match(/\(figh2d\)([A-Za-z0-9+/=]+)\(\/figh2d\)/)[1], 'base64').toString('utf8'));

test('Board contains all six included categories as real text/cards and does not mutate the review', () => {
  const h = harness(), model = system(h.Core), before = JSON.stringify(model);
  const board = h.Board.buildBoard(model), nodes = descendants(board);
  assert.equal(board.id, 'design-system'); assert.equal(board.style.width, '1120px');
  assert.deepEqual(nodes.filter(node => node.tagName === 'SECTION').map(node => node.attributes['aria-label']), ['Colors', 'Typography', 'Spacing', 'Radii', 'Shadows', 'Borders']);
  assert.equal(nodes.filter(node => node.tagName === 'ARTICLE').length, model.tokens.length);
  for (const token of model.tokens) assert.ok(nodes.some(node => node.id === `token-${token.name}`));
  assert.equal(JSON.stringify(model), before);
});
test('Reviewed names and exclusions are honored; empty categories are omitted', () => {
  const h = harness(), model = system(h.Core);
  model.tokens.find(token => token.category === 'colors').name = 'reviewed-brand';
  model.tokens.filter(token => token.category === 'borders').forEach(token => { token.included = false; token.name = 'excluded-private-token'; });
  const board = h.Board.buildBoard(model), nodes = descendants(board);
  assert.ok(nodes.some(node => node.id === 'token-reviewed-brand'));
  assert.ok(!board.textContent.includes('excluded-private-token'));
  assert.ok(!nodes.some(node => node.id === 'section-borders'));
});
test('Merged canonical tokens remain a single card with the chosen value', () => {
  const h = harness(), model = system(h.Core), colors = model.tokens.filter(token => token.category === 'colors');
  const merged = h.Core.mergeTokens(model, colors.slice(0, 2).map(token => token.id), colors[0].id);
  const board = h.Board.buildBoard(merged), nodes = descendants(board);
  assert.equal(nodes.filter(node => node.tagName === 'ARTICLE').length, model.tokens.length - 1);
  assert.match(board.textContent, /Merged/);
  assert.ok(nodes.some(node => node.style.backgroundColor === colors[0].value));
});
test('Alpha previews are editable rectangles with no gradients, images, canvas or SVG outlines', () => {
  const h = harness(), board = h.Board.buildBoard(system(h.Core)), nodes = descendants(board);
  assert.ok(nodes.some(node => node.style.backgroundColor === '#00000080'));
  assert.ok(nodes.filter(node => node.style.backgroundColor === '#cccccc').length >= 16);
  assert.ok(!nodes.some(node => ['IMG', 'CANVAS', 'SVG', 'SCRIPT', 'LINK', 'IFRAME'].includes(node.tagName)));
  assert.ok(!JSON.stringify(nodes.map(node => node.style)).includes('gradient'));
});
test('Typography uses safe bounded Arial specimens and lists every original metric', () => {
  const h = harness(), model = system(h.Core), token = model.tokens.find(token => token.category === 'typography');
  const board = h.Board.buildBoard(model), nodes = descendants(board), specimen = nodes.find(node => node._text === 'Aa Bb 0123');
  assert.equal(specimen.style.fontFamily, 'Arial, sans-serif'); assert.equal(specimen.style.fontSize, '48px');
  for (const key of h.Core.typeProperties) assert.ok(board.textContent.includes(token.value[key]));
  assert.ok(!nodes.some(node => node.style.fontFamily === token.value.fontFamily));
});
test('Elliptical corners preserve their axes and spacing signs remain in labels', () => {
  const h = harness(), board = h.Board.buildBoard(system(h.Core)), nodes = descendants(board);
  assert.ok(nodes.some(node => node.style.borderRadius === '8px / 16px'));
  assert.ok(board.textContent.includes('-4px'));
  assert.ok(!nodes.some(node => /^-/.test(node.style.width || '')));
});
test('Source URL is sanitized again and source/title strings are text, never executable markup', () => {
  const h = harness(), model = system(h.Core); model.source.url = 'https://private:secret@example.com/path?key=secret#private';
  const board = h.Board.buildBoard(model), nodes = descendants(board);
  assert.ok(board.textContent.includes('https://example.com/path'));
  assert.ok(board.textContent.includes('<script>')); // literal textContent, not HTML parsing
  assert.doesNotMatch(board.textContent, /private:secret|\?key=|#private/);
  assert.ok(!nodes.some(node => Object.keys(node.attributes).some(key => /^on|^href|^src/.test(key))));
});
test('Invalid names, duplicate names and no included tokens prevent board construction', () => {
  const h = harness();
  const invalid = system(h.Core); invalid.tokens[0].name = 'Invalid Name'; assert.throws(() => h.Board.buildBoard(invalid), /lowercase/);
  invalid.tokens[0].name = invalid.tokens[1].name; assert.throws(() => h.Board.buildBoard(invalid), /Duplicate/);
  invalid.tokens.forEach(token => { token.included = false; }); assert.throws(() => h.Board.buildBoard(invalid), /at least one/);
});
test('Unsupported categories or more than 480 tokens fail explicitly, not by silently dropping tokens', () => {
  const h = harness(), model = system(h.Core); model.tokens[0].category = 'components';
  assert.throws(() => h.Board.buildBoard(model), /supported token categories/);
  model.tokens = Array.from({ length: 481 }, (_, i) => ({ ...model.tokens[1], name: `token-${i}` }));
  assert.throws(() => h.Board.buildBoard(model), /supported token categories/);
});
test('Rich clipboard matches existing snapshot array/metadata markers and preserves Unicode', async () => {
  const h = harness(), doc = snapshot(); doc.assets = {};
  const html = await h.Board.makeClipboardHtml(JSON.stringify(doc), encode);
  assert.match(html, /^<span data-metadata="<!--\(figmeta\)/);
  assert.match(html, /<span data-h2d="<!--\(figh2d\)/);
  const data = clipboardData(html); assert.equal(data.length, 1); assert.equal(data[0].type, 'snapshot');
  assert.equal(data[0].root.childNodes[0].text, '日本語 editable Aa');
  const meta = JSON.parse(Buffer.from(html.match(/\(figmeta\)([A-Za-z0-9+/=]+)\(\/figmeta\)/)[1], 'base64').toString());
  assert.equal(meta.dataType, 'h2d'); assert.equal(meta.source, 'chrome-extension'); assert.ok(!Number.isNaN(Date.parse(meta.capturedAtIso)));
  assert.deepEqual(Object.keys(meta).sort(), ['capturedAtIso', 'dataType', 'source']);
});
for (const [label, change] of [
  ['unknown snapshot version', doc => { doc.version = 99; }],
  ['non-element root', doc => { doc.root.nodeType = 3; }],
  ['unexpected raster/URL asset', doc => { doc.assets = { 'https://site.example/image.png': {} }; }]
]) test(`Clipboard rejects ${label}`, async () => {
  const h = harness(), doc = snapshot(); doc.assets = {}; change(doc);
  await assert.rejects(h.Board.makeClipboardHtml(JSON.stringify(doc), encode), /invalid|unexpected assets/);
});
test('Clipboard encoder output is constrained to base64, never raw HTML interpolation', async () => {
  const h = harness(), doc = snapshot(); doc.assets = {};
  await assert.rejects(h.Board.makeClipboardHtml(JSON.stringify(doc), async () => '"><script>bad</script>'), /encode/);
});
test('Missing private helpers disable the optional copier without affecting other generator features', () => {
  const h = harness(); assert.equal(h.Board.createCopier(), null); assert.equal(h.Board.createCopier({ capture() {} }), null);
});
test('Copier captures only its isolated board, opts out of page scrollbar/style/source extraction, and writes rich HTML', async () => {
  const h = harness(), model = system(h.Core); let captured, options, serialized, phase;
  const copy = h.Board.createCopier(helpers({
    capture: async (element, opts) => { captured = element; options = opts; return { document: snapshot() }; },
    serialize: async doc => { serialized = doc; return JSON.stringify({ ...doc, assets: {} }); }
  }));
  const result = await copy(model, { mount: h.mount, onPhase: value => { phase = value; assert.equal(h.document.frames[0].isConnected, false); } });
  assert.equal(result.count, model.tokens.length); assert.equal(captured.id, 'design-system');
  const frameDocument = h.document.frames[0].contentDocument, island = frameDocument.body.children[0];
  assert.equal(captured.parentNode, island.privateShadow); assert.equal(island.shadowRoot, null);
  assert.equal(frameDocument.head.children[0].httpEquiv, 'Content-Security-Policy'); assert.match(frameDocument.head.children[0].content, /font-src 'none'/);
  assert.equal(options.extractCssVariables, false); assert.equal(options.captureSourceProps, false);
  assert.equal(options.skipRemoteAssetSerialization, true); assert.equal(options.skipScrollbarHiding, true); assert.equal(options.assertLayoutValid, false);
  assert.equal(serialized.documentTitle, `${model.source.title} — Design system`);
  assert.equal(phase, 'writing'); assert.equal(h.writes.length, 1); assert.deepEqual(h.writes[0][0].types, ['text/html']);
  const html = await h.writes[0][0].formats['text/html'].text(); assert.equal(clipboardData(html)[0].documentTitle, serialized.documentTitle);
  assert.equal(h.mount.children.length, 0); assert.equal(h.timers.size, 0);
  assert.equal(h.document.frames[0].attributes.sandbox, 'allow-same-origin');
  assert.equal(h.document.frames[0].attributes.src, undefined); assert.equal(h.document.frames[0].attributes.srcdoc, undefined);
});
test('Pre-aborted or disconnected copy never builds a frame or writes the clipboard', async () => {
  const h = harness(), abort = new AbortController(); abort.abort();
  const copy = h.Board.createCopier(helpers());
  await assert.rejects(copy(system(h.Core), { mount: h.mount, signal: abort.signal }), { name: 'AbortError' });
  h.mount.remove(); await assert.rejects(copy(system(h.Core), { mount: h.mount }), /no longer open/);
  assert.equal(h.document.frames.length, 0); assert.equal(h.writes.length, 0); assert.equal(h.timers.size, 0);
});
test('Missing rich clipboard is reported without a screenshot/plain-text fallback', async () => {
  const h = harness(); delete h.context.navigator.clipboard;
  await assert.rejects(h.Board.createCopier(helpers())(system(h.Core), { mount: h.mount }), /unavailable/);
  assert.equal(h.document.frames.length, 0); assert.equal(h.writes.length, 0);
});
test('Cancelling during capture removes the frame immediately and prevents a later write', async () => {
  const h = harness(), abort = new AbortController(); let release;
  const copy = h.Board.createCopier(helpers({ capture: () => new Promise(resolve => { release = resolve; }) }));
  const pending = copy(system(h.Core), { mount: h.mount, signal: abort.signal });
  assert.equal(h.mount.children.length, 1); abort.abort(); assert.equal(h.mount.children.length, 0);
  release({ document: snapshot() }); await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(h.writes.length, 0); assert.equal(h.timers.size, 0);
});
test('Cancelling after serialization starts still prevents clipboard writing', async () => {
  const h = harness(), abort = new AbortController(); let release, entered;
  const ready = new Promise(resolve => { entered = resolve; });
  const copy = h.Board.createCopier(helpers({ serialize: () => new Promise(resolve => { release = resolve; entered(); }) }));
  const pending = copy(system(h.Core), { mount: h.mount, signal: abort.signal }); await ready;
  abort.abort(); release(JSON.stringify({ ...snapshot(), assets: {} })); await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(h.mount.children.length, 0); assert.equal(h.writes.length, 0); assert.equal(h.timers.size, 0);
});
for (const stage of ['capture', 'serialize', 'encode']) test(`${stage} failure removes frame/timer and never writes the clipboard`, async () => {
  const h = harness(), copy = h.Board.createCopier(helpers({ [stage]: async () => { throw new Error('Local test failure'); } }));
  await assert.rejects(copy(system(h.Core), { mount: h.mount }), /Local test failure/);
  assert.equal(h.mount.children.length, 0); assert.equal(h.writes.length, 0); assert.equal(h.timers.size, 0);
});
test('Native clipboard denial rejects rather than reporting a successful copy; cleanup is complete', async () => {
  const h = harness({ write: async () => { throw new DOMException('Blocked', 'NotAllowedError'); } });
  await assert.rejects(h.Board.createCopier(helpers())(system(h.Core), { mount: h.mount }), { name: 'NotAllowedError' });
  assert.equal(h.mount.children.length, 0); assert.equal(h.timers.size, 0); assert.equal(h.writes.length, 1);
});
test('Cancellation cannot revoke a native clipboard write already handed to the browser', async () => {
  let release, entered; const ready = new Promise(resolve => { entered = resolve; });
  const h = harness({ write: () => new Promise(resolve => { release = resolve; entered(); }) }), abort = new AbortController();
  const pending = h.Board.createCopier(helpers())(system(h.Core), { mount: h.mount, signal: abort.signal }); await ready;
  assert.equal(h.mount.children.length, 0); assert.equal(h.timers.size, 0);
  abort.abort(); release(); const result = await pending; assert.ok(result.count > 0); assert.equal(h.writes.length, 1);
});
test('Unexpected capture assets fail before the serializer/native clipboard is called', async () => {
  const h = harness(); let calls = 0;
  const copy = h.Board.createCopier(helpers({ capture: async () => ({ document: { ...snapshot(), assets: new Map([['unexpected.png', {}]]) } }), serialize: async () => { calls++; } }));
  await assert.rejects(copy(system(h.Core), { mount: h.mount }), /unexpected assets/);
  assert.equal(calls, 0); assert.equal(h.writes.length, 0); assert.equal(h.mount.children.length, 0);
});
test('Oversize layout or clipboard data fails explicitly instead of silently dropping tokens', async () => {
  const h = harness(), original = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function() { return { width: 1120, height: 200001 }; };
  try { await assert.rejects(h.Board.createCopier(helpers())(system(h.Core), { mount: h.mount }), /too large/); }
  finally { Element.prototype.getBoundingClientRect = original; }
  const copy = h.Board.createCopier(helpers({ encode: async () => 'A'.repeat(9 * 1024 * 1024) }));
  await assert.rejects(copy(system(h.Core), { mount: h.mount }), /too large/);
  assert.equal(h.writes.length, 0); assert.equal(h.mount.children.length, 0); assert.equal(h.timers.size, 0);
});
test('Missing, collapsed or non-finite captured layout is an error, never an empty-board success', async () => {
  const h = harness();
  for (const rect of [undefined, { width: 0, height: 100 }, { width: NaN, height: 100 }, { width: 1120, height: 0 }, { width: 1120, height: Infinity }]) {
    const doc = snapshot(); doc.root.rect = rect;
    const copy = h.Board.createCopier(helpers({ capture: async () => ({ document: doc }) }));
    await assert.rejects(copy(system(h.Core), { mount: h.mount }), /invalid layout/);
    assert.equal(h.writes.length, 0); assert.equal(h.mount.children.length, 0); assert.equal(h.timers.size, 0);
  }
});
test('Board module is idempotent and has no network, storage, clipboard reads, remote iframe or native-variable APIs', () => {
  const h = harness(), first = h.Board, source = read('js/design-system-board.js');
  vm.runInContext(source, h.context); assert.equal(h.context.PageCaptureDesignBoard, first);
  assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|chrome\.(?:storage|tabs|runtime)|clipboard\.(?:read|readText)|figma\.variables|createTextStyle|createEffectStyle|innerHTML\s*=|srcdoc\s*=/);
  assert.match(source, /navigator\.clipboard\.write\(/); assert.match(source, /extractCssVariables: false/);
  assert.match(read('js/background.js'), /"js\/design-system-core\.js", "js\/design-system-board\.js", "js\/design-system\.js", "js\/viewports\.js", "js\/wireframe-core\.js", "js\/wireframe\.js", "js\/h2d_toolbar\.js"/);
  const manifest = JSON.parse(read('manifest.json')); assert.equal(manifest.version, '1.8.2');
  assert.deepEqual(manifest.permissions, ['storage', 'tabs', 'unlimitedStorage', 'scripting', 'clipboardWrite']);
});
