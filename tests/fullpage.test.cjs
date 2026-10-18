'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const context = vm.createContext({ URL, AbortController, AbortSignal, DOMException, setTimeout, clearTimeout });
vm.runInContext(fs.readFileSync(path.join(root, 'js/privacy.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(root, 'js/viewports.js'), 'utf8'), context);
const API = context.PageCaptureViewports, plain = value => JSON.parse(JSON.stringify(value));
const placeholder = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/%3E';
function image(attributes = {}, properties = {}) {
  const attrs = new Map(Object.entries(attributes));
  return Object.assign({
    currentSrc: placeholder, naturalWidth: 1, naturalHeight: 1,
    ownerDocument: { baseURI: 'https://example.com/page', defaultView: { devicePixelRatio: 1, innerWidth: 1280, matchMedia: query => ({ matches: query.includes('500px') }) } },
    getAttribute: name => attrs.has(name) ? attrs.get(name) : null,
    setAttribute: (name, value) => attrs.set(name, value), removeAttribute: name => attrs.delete(name),
    getBoundingClientRect: () => ({ width: 400, height: 300 }), decode: async () => {},
    get loading() { return attrs.get('loading') || 'auto'; }, set loading(value) { attrs.set('loading', value); },
    get decoding() { return attrs.get('decoding') || 'auto'; }, set decoding(value) { attrs.set('decoding', value); },
    attrs
  }, properties);
}

test('Full-page snapshot height contains the page instead of a 100%-height viewport root', () => {
  const root = { rect: { x: 0, y: -100, width: 1280, height: 900 }, styles: { height: '900px', maxHeight: '100vh', overflowX: 'hidden' }, computedStyles: { height: '100%', maxHeight: '100vh', width: '100%' }, childNodes: [{ rect: { x: 0, y: 2800, width: 100, height: 100 } }] };
  const child = JSON.stringify(root.childNodes); API.expandFullPage(root, { width: 1280, height: 4000 });
  assert.deepEqual(plain(root.rect), { x: 0, y: -100, width: 1280, height: 4000 }); assert.equal(root.styles.height, '4000px'); assert.equal(root.styles.maxHeight, 'none'); assert.equal(root.styles.overflowX, 'hidden');
  assert.deepEqual(root.computedStyles, { width: '100%' }); assert.equal(JSON.stringify(root.childNodes), child);
});
test('Correctly sized roots never shrink, and non-finite/invalid bounds are ignored', () => {
  const root = { rect: { x: 0, y: 0, width: 393, height: 5000 }, styles: { height: 'auto' } }, before = JSON.stringify(root);
  for (const height of [1000, NaN, Infinity, -1, 0]) API.expandFullPage(root, { height });
  assert.equal(JSON.stringify(root), before);
});
test('Already loaded real images win over lazy metadata and are not changed', () => {
  const img = image({ 'data-src': '/later.png' }, { currentSrc: 'https://example.com/current.png', naturalWidth: 800, naturalHeight: 600 });
  assert.equal(API.imageSource(img), 'https://example.com/current.png'); assert.equal(img.getAttribute('data-src'), '/later.png');
});
test('Dribbble-style lazy width/height URL templates become real measured image URLs', () => {
  const img = image({ 'data-src': 'https://cdn.dribbble.com/userupload/1/file/art.png?resize={width}x{height}&vertical=center' });
  assert.equal(API.imageSource(img), 'https://cdn.dribbble.com/userupload/1/file/art.png?resize=400x300&vertical=center');
  assert.equal(img.currentSrc, placeholder); assert.equal(img.attrs.size, 1);
});
test('An empty src never becomes a fetch of the document URL', () => {
  const img = image({ src: '  ' }, { currentSrc: '', src: 'https://example.com/page' });
  assert.equal(API.imageSource(img), '');
});
test('Encoded image URL templates are resolved, including an already present unresolved src', () => {
  const img = image({}, { currentSrc: 'https://example.com/photo.png?w=%7Bwidth%7D&h=%7Bheight%7D' });
  assert.equal(API.imageSource(img), 'https://example.com/photo.png?w=400&h=300');
});
for (const key of ['data-lazy-src', 'data-original', 'data-original-src']) test(`${key} is resolved relative to the original document`, () => {
  assert.equal(API.imageSource(image({ [key]: './art.png' })), 'https://example.com/art.png');
});
test('Lazy srcset selects a width candidate from the actual rendered width and DPR', () => {
  const img = image({ 'data-srcset': '/small.png 300w, /medium.png 600w, /large.png 1200w' }); img.ownerDocument.defaultView.devicePixelRatio = 2;
  assert.equal(API.imageSource(img), 'https://example.com/large.png');
  assert.equal(API.imageSource(image({ 'data-srcset': '/one.png 1x, /two.png 2x' })), 'https://example.com/one.png');
});
test('Lazy picture uses the active media source, not the desktop source blindly', () => {
  const img = image(); img.parentElement = { localName: 'picture', querySelectorAll: () => [
    { media: '(min-width:1000px)', getAttribute: () => '/desktop.png 1x' }, { media: '(max-width:500px)', getAttribute: () => '/phone.png 1x' }
  ] };
  assert.equal(API.imageSource(img), 'https://example.com/phone.png');
});
test('Lazy values cannot bypass blocked service destinations or executable schemes', () => {
  for (const value of ['javascript:alert(1)', 'https://api.figma.com/a.png', 'https://o123.ingest.sentry.io/a.png']) assert.equal(API.imageSource(image({ 'data-src': value })), placeholder);
});
test('Image dimensions are bounded even for oversized elements and high DPR', () => {
  const img = image({ 'data-src': '/art?w={width}&h={height}' }, { getBoundingClientRect: () => ({ width: 100000, height: 100000 }) }); img.ownerDocument.defaultView.devicePixelRatio = 10;
  assert.equal(API.imageSource(img), 'https://example.com/art?w=4096&h=4096');
});
test('Image decoding restores original loading/decoding attributes after success and decode failure', async () => {
  const first = image({ loading: 'lazy', decoding: 'async' }), second = image({}, { decode: async () => { throw new Error('Unavailable image'); } });
  await API.decodeImages([first, second], new AbortController().signal);
  assert.equal(first.loading, 'lazy'); assert.equal(first.decoding, 'async'); assert.equal(second.getAttribute('loading'), null); assert.equal(second.getAttribute('decoding'), null);
});
test('Cancellation interrupts a pending decode and restores attributes without waiting for the image', async () => {
  const abort = new AbortController(), img = image({ loading: 'lazy' }, { decode: () => new Promise(() => {}) });
  const pending = API.decodeImages([img], abort.signal); abort.abort(); await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(img.loading, 'lazy'); assert.equal(img.getAttribute('decoding'), null);
});
test('A pre-cancelled decode performs no work or attribute mutation', async () => {
  const abort = new AbortController(); abort.abort(); let calls = 0;
  const img = image({}, { decode: async () => { calls++; } });
  await assert.rejects(API.decodeImages([img], abort.signal), { name: 'AbortError' });
  assert.equal(calls, 0); assert.equal(img.attrs.size, 0);
});
test('Recovery splits 130 unique images into legal 64/64/2 URL requests instead of rejecting the whole page', async () => {
  const sizes = [], urls = Array.from({ length: 130 }, (_, i) => `https://example.com/${i}.png`);
  const result = await API.fetchAssetBatches(urls, async batch => { sizes.push(batch.length); return batch.map(url => ({ url, blob: {} })); }, new AbortController().signal);
  assert.deepEqual(sizes, [64, 64, 2]); assert.equal(result.length, 130);
});
test('Recovery deduplicates URLs, ignores unsolicited results, and continues after one failed batch', async () => {
  const urls = Array.from({ length: 70 }, (_, i) => `https://example.com/${i}.png`); let calls = 0;
  const result = await API.fetchAssetBatches([...urls, urls[0]], async batch => { if (++calls === 1) throw new Error('First batch unavailable'); return [...batch.map(url => ({ url, blob: {} })), { url: 'https://unrequested.example/x', blob: {} }]; }, new AbortController().signal);
  assert.equal(calls, 2); assert.equal(result.length, 6);
});
test('Recovery cancellation prevents starting later batches', async () => {
  const abort = new AbortController(); let calls = 0;
  await assert.rejects(API.fetchAssetBatches(Array.from({ length: 130 }, (_, i) => `https://example.com/${i}`), async () => { calls++; abort.abort(); return []; }, abort.signal), { name: 'AbortError' }); assert.equal(calls, 1);
});
test('Full-page normalization is opt-in for element captures; raw HTML and board capture keep their existing paths', () => {
  const toolbar = fs.readFileSync(path.join(root, 'js/h2d_toolbar.js'), 'utf8');
  assert.match(toolbar, /\(d\|\|n.captureFullPage\)&&globalThis.PageCaptureViewports\?\.expandFullPage/);
  assert.match(toolbar, /attributes:imageUrl\?\{\.\.\.\$c\(t\),currentSrc:imageUrl\}:\$c\(t\)/);
  assert.match(toolbar, /let html=document.documentElement.outerHTML;await navigator.clipboard.writeText\(html\)/);
  const board = fs.readFileSync(path.join(root, 'js/design-system-board.js'), 'utf8'); assert.doesNotMatch(board, /captureFullPage/);
});
