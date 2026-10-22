'use strict';
/* Route A: keep Figma's own copy and write it back later.
 * The format facts these tests encode are in docs/CANVAS-RESEARCH.md (§7).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..', 'extension');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

function api(extra = {}) {
  const context = vm.createContext({ Blob, crypto: require('node:crypto').webcrypto, URL, ...extra });
  vm.runInContext(read('js/figma-clip.js'), context);
  return { context, Clip: context.PageCaptureFigmaClip };
}
const { Clip } = api();

// A real fig-kiwi container starts with its 8-byte magic; the body after it is
// opaque to this module, which only validates and stores it.
// One continuous base64 stream: the magic is the first 8 decoded bytes, exactly
// as Figma writes it. Concatenating two base64 strings would break decoding.
const figmaPayload = (magic = 'fig-kiwi', body = 'a-fake-scene-body') =>
  `<meta charset="utf-8"><span data-metadata="<!--(figmeta)${Buffer.from(JSON.stringify({ dataType: 'scene', fileKey: 'FAKE123', pasteID: 7 })).toString('base64')}(/figmeta)-->"></span>` +
  `<span data-buffer="<!--(figma)${Buffer.concat([Buffer.from(magic), Buffer.from(body)]).toString('base64')}(/figma)-->"></span>`;
const plain = value => JSON.parse(JSON.stringify(value));
const html = figmaPayload();

test('A Figma scene copy is accepted and its decoded size is reported', () => {
  const info = Clip.detect(html);
  assert.ok(info, 'payload should be detected');
  assert.equal(info.magic, 'fig-kiwi');
  assert.equal(info.bytes, 8 + Buffer.from('a-fake-scene-body').length);
  assert.equal(info.metadata.fileKey, 'FAKE123');
});
for (const magic of ['fig-jam.', 'fig-deck']) test(`${magic} containers from FigJam/Slides are accepted too`, () => {
  assert.equal(Clip.detect(figmaPayload(magic))?.magic, magic);
});
test('Clipboards that are not a Figma copy are refused', () => {
  for (const value of [
    '',
    '<p>Hello</p>',
    '<div style="color:red">styled html</div>',
    figmaPayload('not-a-fig'),                                   // wrong magic
    '<span data-buffer="<!--(figma)AAAA(/figma)-->"></span>',     // too small to be a container
    '<span data-buffer="<!--(figma)!!!!(/figma)-->"></span>',     // not base64
    '<!--(figma)fig-kiwi(/figma)-->',                             // marker without the base64 body
    null,
    undefined,
    42
  ]) assert.equal(Clip.detect(value), null, String(value));
});
test("This extension's own (figh2d) capture is never mistaken for a Figma scene", () => {
  const ours = `<span data-h2d="<!--(figh2d)eyJ2ZXJzaW9uIjoyfQ==(/figh2d)-->"></span>`;
  assert.equal(Clip.detect(ours), null);
  assert.equal(Clip.detect(ours + html), null, 'a page that also mentions figma must still not pass');
});
test('Base64 with line breaks survives (clipboard HTML can be wrapped)', () => {
  const wrapped = html.replace(/(.{40})/g, '$1\n');
  assert.equal(Clip.detect(wrapped)?.magic, 'fig-kiwi');
});
test('Base64 byte counting matches the decoder, including padding', () => {
  for (const value of ['', 'A', 'AA==', 'AAA=', 'AAAA', 'QUJD', 'QUJDRA==', Buffer.from('fig-kiwi').toString('base64')]) {
    const decoded = value ? Buffer.from(value, 'base64') : Buffer.alloc(0);
    assert.equal(Clip.base64Bytes(value), decoded.length, value);
  }
  assert.equal(Clip.base64Bytes(null), 0);
});
test('A record carries a stable shape and a readable label', () => {
  const entry = Clip.record(html, Date.UTC(2026, 9, 23, 9, 0, 0));
  assert.equal(entry.type, 'figma-clip');
  assert.match(entry.id, /^fig-/);
  assert.equal(entry.html, html);
  assert.equal(entry.fileKey, 'FAKE123');
  assert.equal(entry.createdAtIso, '2026-10-23T09:00:00.000Z');
  assert.match(entry.label, /^Figma copy · \d+ B$/);
  assert.ok(Object.isFrozen(entry));
});
test('Refusals are typed so the page can explain them', () => {
  assert.throws(() => Clip.record(''), error => error.code === 'clipboard_empty');
  assert.throws(() => Clip.record('<p>page</p>'), error => error.code === 'not_figma_copy');
});
test('Oversized copies are refused instead of filling storage', () => {
  const huge = html + 'A'.repeat(Clip.LIMITS.recordBytes);
  assert.throws(() => Clip.record(huge), error => error.code === 'too_large');
});
test('Newest copy is first, duplicates collapse and the list is capped', () => {
  const entry = id => ({ id, html: '<span></span>' });
  const list = Clip.merge([entry('b'), entry('a')], entry('c'));
  assert.deepEqual(plain(list.map(item => item.id)), ['c', 'b', 'a']);
  assert.deepEqual(plain(Clip.merge([entry('a')], entry('a')).map(item => item.id)), ['a']);
  const capped = Clip.merge(Array.from({ length: 30 }, (_, index) => entry(`x${index}`)), entry('fresh'));
  assert.equal(capped.length, Clip.LIMITS.records);
  assert.equal(capped[0].id, 'fresh');
});
function fakeStorage() {
  const data = {};
  return {
    data,
    async get(key) { return { [key]: data[key] }; },
    async set(values) { Object.assign(data, values); },
    async remove(key) { delete data[key]; }
  };
}
test('Saved copies live under one local key and can be removed', async () => {
  const storage = fakeStorage();
  const first = Clip.record(html), second = Clip.record(figmaPayload('fig-jam.'));
  assert.deepEqual(plain(await Clip.readAll(storage)), []);
  assert.deepEqual(plain((await Clip.saveClip(storage, first)).map(item => item.id)), [first.id]);
  assert.deepEqual(plain((await Clip.saveClip(storage, second)).map(item => item.id)), [second.id, first.id]);
  assert.equal((await Clip.readAll(storage)).length, 2);
  assert.deepEqual(plain((await Clip.removeClip(storage, second.id)).map(item => item.id)), [first.id]);
  assert.deepEqual(plain(await Clip.clearClips(storage)), []);
  assert.equal(storage.data[Clip.STORAGE_KEY], undefined);
});
test('Junk in storage is ignored rather than rendered', async () => {
  const storage = fakeStorage();
  storage.data[Clip.STORAGE_KEY] = [null, { id: 'ok', html: '<x></x>' }, { id: 'broken' }, 'text'];
  assert.deepEqual(plain((await Clip.readAll(storage)).map(item => item.id)), ['ok']);
});
test('Clipboard HTML is read with sanitization off, falling back when unsupported', async () => {
  const seen = [];
  const item = { types: ['text/html'], getType: async () => ({ text: async () => html }) };
  const modern = { clipboard: { read: async options => { seen.push(options); return [item]; } } };
  assert.equal(await Clip.readHtml(modern), html);
  assert.deepEqual(plain(seen[0]), { unsanitized: ['text/html'] });
  const legacy = { clipboard: { read: async options => { if (options) throw new TypeError('no dictionary'); return [item]; } } };
  assert.equal(await Clip.readHtml(legacy), html);
});
test('Clipboard failures map to the page copy, never to a silent success', async () => {
  const denied = { clipboard: { read: async () => { throw Object.assign(new Error('blocked'), { name: 'NotAllowedError' }); } } };
  await assert.rejects(Clip.readHtml(denied), error => error.code === 'clipboard_denied');
  await assert.rejects(Clip.readHtml({}), error => error.code === 'clipboard_unavailable');
  const textOnly = { clipboard: { read: async () => [{ types: ['text/plain'], getType: async () => ({ text: async () => 'hi' }) }] } };
  await assert.rejects(Clip.readHtml(textOnly), error => error.code === 'clipboard_empty');
});
test('A stored payload is written back as text/html', async () => {
  const writes = [];
  class FakeClipboardItem { constructor(items) { this.items = items; } }
  const navigatorLike = { clipboard: { write: async items => writes.push(items) } };
  await Clip.writeHtml(navigatorLike, FakeClipboardItem, html);
  assert.equal(writes[0][0].items['text/html'].type, 'text/html');
  assert.equal(await writes[0][0].items['text/html'].text(), html);
  const rejecting = { clipboard: { write: async () => { throw Object.assign(new Error('no'), { name: 'NotAllowedError' }); } } };
  await assert.rejects(Clip.writeHtml(rejecting, FakeClipboardItem, html), error => error.code === 'clipboard_denied');
  await assert.rejects(Clip.writeHtml({}, FakeClipboardItem, html), error => error.code === 'clipboard_unavailable');
});
test('The importer page is wired to the module, its strings and the optional permission', () => {
  const page = read('figma-import.html'), controller = read('js/figma-import.js');
  const messages = JSON.parse(read('_locales/en/messages.json'));
  const manifest = JSON.parse(read('manifest.json'));
  assert.match(page, /js\/figma-clip\.js/);
  assert.match(page, /js\/figma-import\.js/);
  for (const name of ['js/figma-clip.js', 'js/figma-import.js', 'font/InterVariable.woff2']) {
    assert.ok(fs.existsSync(path.join(root, name)), name);
  }
  for (const match of controller.matchAll(/text\("([^"]+)"/g)) assert.ok(Object.hasOwn(messages, match[1]), match[1]);
  assert.deepEqual(plain(manifest.optional_permissions), ['clipboardRead']);
  assert.ok(!manifest.permissions.includes('clipboardRead'), 'reading the clipboard must stay optional');
});
test('The importer never reaches the network', () => {
  for (const source of [read('js/figma-clip.js'), read('js/figma-import.js'), read('figma-import.html')]) {
    assert.doesNotMatch(source, /fetch\s*\(|XMLHttpRequest|sendBeacon|https?:\/\/(?!www\.w3\.org)/);
  }
});
