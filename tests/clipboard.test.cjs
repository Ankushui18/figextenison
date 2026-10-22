'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..', 'extension');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));

class Item {
  constructor(formats) { this.formats = formats; this.types = Object.keys(formats); }
  async getType(type) { return this.formats[type]; }
}

function contentHarness({ directError, response = { success: true, value: true } } = {}) {
  const messages = [], direct = [];
  const context = vm.createContext({
    Blob,
    navigator: { clipboard: {
      write: async items => { direct.push(items); if (directError) throw directError; },
      writeText: async text => { direct.push(text); if (directError) throw directError; }
    } },
    chrome: { runtime: { id: 'extension-id', sendMessage: async message => { messages.push(message); return typeof response === 'function' ? response(message) : response; } } }
  });
  vm.runInContext(read('js/clipboard.js'), context);
  return { context, api: context.PageCaptureClipboard, messages, direct, directError };
}

const richItem = (html = '<b>capture</b>', text = 'capture') => new Item({
  'text/html': new Blob([html], { type: 'text/html' }),
  'text/plain': new Blob([text], { type: 'text/plain' })
});

test('Direct rich and text writes stay in the page and send no message', async () => {
  const h = contentHarness();
  assert.equal(await h.api.write([richItem()]), 'direct');
  assert.equal(await h.api.writeText('raw html'), 'direct');
  assert.equal(h.direct.length, 2);
  assert.deepEqual(h.messages, []);
});

test('A rejected rich write retries the same HTML locally through the worker', async () => {
  const h = contentHarness({ directError: new DOMException('Focus lost', 'NotAllowedError') });
  assert.equal(await h.api.write([richItem('<span data-x="1">design</span>', 'design')]), 'offscreen');
  assert.equal(h.messages.length, 1);
  assert.equal(h.messages[0].cmd, 'H2D_WRITE_CLIPBOARD');
  assert.deepEqual(plain(h.messages[0].payload), { kind: 'html', html: '<span data-x="1">design</span>', text: 'design' });
});

test('A rejected raw write retries the same text without changing it', async () => {
  const h = contentHarness({ directError: new Error('denied') });
  const source = '<html><input value="current"></html>';
  assert.equal(await h.api.writeText(source), 'offscreen');
  assert.deepEqual(plain(h.messages[0].payload), { kind: 'text', text: source });
});

test('Recovery failure preserves the original browser error', async () => {
  const original = new DOMException('Original denial', 'NotAllowedError');
  const h = contentHarness({ directError: original, response: { success: false, error: { message: 'internal' } } });
  await assert.rejects(h.api.write([richItem()]), error => error === original);
  await assert.rejects(h.api.writeText('text'), error => error === original);
});

test('Non-HTML clipboard items and malformed worker answers do not trigger a fake success', async () => {
  const original = new Error('direct failed');
  const h = contentHarness({ directError: original, response: { success: true, value: 'not-true' } });
  await assert.rejects(h.api.write([new Item({ 'text/plain': new Blob(['plain']) })]), error => error === original);
  assert.equal(h.messages.length, 0);
  await assert.rejects(h.api.write([richItem()]), error => error === original);
  assert.equal(h.messages.length, 1);
});

test('Oversized rich recovery is rejected before reading the Blob into a message', async () => {
  const h = contentHarness({ directError: new Error('direct failed') });
  const huge = { size: h.api.limits.offscreenBytes + 1, text: async () => { throw new Error('must not read'); } };
  await assert.rejects(h.api.write([new Item({ 'text/html': huge })]), /direct failed/);
  assert.deepEqual(h.messages, []);
});

test('The content writer is idempotent and contains no clipboard reads or network path', () => {
  const h = contentHarness(), first = h.api;
  vm.runInContext(read('js/clipboard.js'), h.context);
  assert.equal(h.context.PageCaptureClipboard, first);
  const source = read('js/clipboard.js');
  assert.doesNotMatch(source, /clipboard\.(?:read|readText)|\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|innerHTML\s*=/);
});

test('Figma rich and raw payload formats are locked independently of the HTML export path', async () => {
  class FixedDate extends Date {
    constructor() { super('2026-01-02T03:04:05.000Z'); }
  }
  const context = vm.createContext({ URL, Blob, Date: FixedDate, setTimeout, clearTimeout });
  for (const name of ['js/privacy.js', 'js/capture-safety.js']) vm.runInContext(read(name), context);
  const node = (tag, children = []) => ({
    nodeType: 1, tag, attributes: {}, styles: {},
    rect: { x: 0, y: 0, width: 200, height: 24 }, childNodes: children
  });
  const record = {
    type: 'snapshot', id: 'saved',
    h2dJson: JSON.stringify({ version: 2, root: node('HTML', [node('BODY')]), assets: {}, fonts: {} }),
    previewUrl: 'data:,'
  };
  const blob = await context.PageCaptureSafety.prepareClipboard([record], {
    encode: async text => Buffer.from(text, 'utf8').toString('base64')
  });
  const html = await blob.text();
  assert.equal(crypto.createHash('sha256').update(html).digest('hex'),
    '6763bed87a476ce5fd8ae649bb28f7f9e17698d7b4b780a9a82f4880e21b685e');
  assert.match(html, /^\<span data-metadata="<!--\(figmeta\)/);
  assert.match(html, /<span data-h2d="<!--\(figh2d\)/);
  assert.doesNotMatch(html, /x-paper-html|<!doctype html>/i);

  const raw = '<!doctype html><html><body><input value="from-attribute"></body></html>';
  const toolbar = read('js/h2d_toolbar.js');
  assert.match(toolbar, /document\.documentElement\.outerHTML/);
  assert.match(toolbar, /let html=document\.documentElement\.outerHTML;await globalThis\.PageCaptureClipboard\.writeText\(html\)/);
  const writer = contentHarness();
  assert.equal(await writer.api.writeText(raw), 'direct');
  assert.equal(writer.direct[0], raw);
});

function offscreenHarness({ directError, execResult = true } = {}) {
  let listener;
  const writes = [], legacy = [], fields = [];
  const field = () => {
    const value = {
      style: {}, value: '', removed: false,
      setAttribute() {}, focus() {}, select() {},
      remove() { this.removed = true; }
    };
    fields.push(value); return value;
  };
  const document = {
    body: { append(node) { node.parentNode = this; } },
    createElement: field,
    addEventListener(type, fn) { if (type === 'copy') this.copyListener = fn; },
    removeEventListener(type) { if (type === 'copy') this.copyListener = null; },
    execCommand(command) {
      assert.equal(command, 'copy');
      this.copyListener?.({ clipboardData: { setData(type, value) { legacy.push([type, value]); } }, preventDefault() { legacy.push(['preventDefault', '']); } });
      return execResult;
    }
  };
  const context = vm.createContext({
    Blob, ClipboardItem: Item, document,
    navigator: { clipboard: {
      write: async items => { writes.push(items); if (directError) throw directError; },
      writeText: async text => { writes.push(text); if (directError) throw directError; }
    } },
    chrome: { runtime: {
      id: 'extension-id', getURL: name => `chrome-extension://extension-id/${name}`,
      onMessage: { addListener(fn) { listener = fn; } }
    } }
  });
  vm.runInContext(read('js/offscreen.js'), context);
  const sender = { id: 'extension-id', url: 'chrome-extension://extension-id/js/background.js' };
  const send = (message, from = sender) => new Promise(resolve => listener(message, from, resolve));
  return { context, send, sender, writes, legacy, fields, document };
}

test('The offscreen document writes rich HTML directly when Chromium allows it', async () => {
  const h = offscreenHarness();
  const response = await h.send({ cmd: 'H2D_OFFSCREEN_WRITE', payload: { kind: 'html', html: '<b>design</b>', text: 'design' } }, h.sender);
  assert.deepEqual(plain(response), { success: true, value: 'offscreen-async' });
  assert.equal(h.writes.length, 1);
  assert.equal(await h.writes[0][0].formats['text/html'].text(), '<b>design</b>');
  assert.deepEqual(h.legacy, []);
});

test('Offscreen async denial falls back to a copy event without parsing captured HTML', async () => {
  const h = offscreenHarness({ directError: new Error('unfocused') });
  const html = '<img src=x onerror=doNotRun()>private & text';
  const response = await h.send({ cmd: 'H2D_OFFSCREEN_WRITE', payload: { kind: 'html', html, text: 'visible text' } }, h.sender);
  assert.deepEqual(plain(response), { success: true, value: 'offscreen-legacy' });
  assert.ok(h.legacy.some(([type, value]) => type === 'text/html' && value === html));
  assert.ok(h.legacy.some(([type, value]) => type === 'text/plain' && value === 'visible text'));
  assert.equal(h.fields.length, 1);
  assert.equal(h.fields[0].removed, true);
  assert.equal(h.document.copyListener, null);
});

test('Offscreen text writes and their legacy fallback preserve exact text', async () => {
  const direct = offscreenHarness();
  assert.equal((await direct.send({ cmd: 'H2D_OFFSCREEN_WRITE', payload: { kind: 'text', text: '<html>raw</html>' } }, direct.sender)).success, true);
  assert.equal(direct.writes[0], '<html>raw</html>');
  const legacy = offscreenHarness({ directError: new Error('denied') });
  assert.equal((await legacy.send({ cmd: 'H2D_OFFSCREEN_WRITE', payload: { kind: 'text', text: '<html>raw</html>' } }, legacy.sender)).value, 'offscreen-legacy');
  assert.ok(legacy.legacy.some(([type, value]) => type === 'text/plain' && value === '<html>raw</html>'));
});

test('Foreign, page, malformed and failed offscreen writes never report success', async () => {
  const h = offscreenHarness({ execResult: false, directError: new Error('denied') });
  const message = { cmd: 'H2D_OFFSCREEN_WRITE', payload: { kind: 'text', text: 'data' } };
  assert.deepEqual(plain(await h.send(message, { ...h.sender, id: 'other-extension' })), { success: false });
  assert.deepEqual(plain(await h.send(message, { ...h.sender, tab: { id: 1 } })), { success: false });
  assert.deepEqual(plain(await h.send({ cmd: 'H2D_OFFSCREEN_WRITE', payload: { kind: 'html', html: 'missing text' } }, h.sender)), { success: false });
  assert.deepEqual(plain(await h.send(message, h.sender)), { success: false });
  assert.equal(h.fields.at(-1).removed, true);
});

test('Offscreen runtime has no HTML injection, network, storage or clipboard-read path', () => {
  const source = read('js/offscreen.js');
  assert.doesNotMatch(source, /innerHTML\s*=|outerHTML\s*=|\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|chrome\.storage|clipboard\.(?:read|readText)/);
});

function workerHarness() {
  let listener;
  const sent = [], offscreen = { has: false, creates: [], closes: 0 };
  const event = { addListener() {} };
  const context = vm.createContext({
    URL, URLSearchParams, AbortController, AbortSignal, Promise, Blob, Response, Uint8Array, atob,
    crypto: require('node:crypto').webcrypto,
    chrome: {
      runtime: {
        id: 'extension-id', getURL: name => `chrome-extension://extension-id/${name}`,
        sendMessage: async message => { sent.push(message); return { success: true, value: 'offscreen-async' }; },
        onMessage: { addListener(fn) { listener = fn; } }
      },
      offscreen: {
        hasDocument: async () => offscreen.has,
        createDocument: async options => { offscreen.creates.push(options); offscreen.has = true; },
        closeDocument: async () => { offscreen.has = false; offscreen.closes++; }
      },
      action: { onClicked: event }, commands: { onCommand: event }, tabs: { onUpdated: event, onRemoved: event },
      storage: { local: { remove: async () => {} } }
    }
  });
  context.importScripts = (...names) => names.forEach(name => vm.runInContext(read(`js/${name}`), context));
  vm.runInContext(read('js/background.js'), context);
  return {
    context, sent, offscreen,
    send: (cmd, payload, sender = { id: 'extension-id', tab: { id: 1 }, frameId: 0 }) => new Promise(resolve => listener({ cmd, payload }, sender, resolve))
  };
}

test('Worker accepts only top-frame, bounded clipboard jobs and closes the offscreen document', async () => {
  const h = workerHarness();
  const result = await h.send('H2D_WRITE_CLIPBOARD', { kind: 'html', html: '<b>x</b>', text: 'x' });
  assert.deepEqual(plain(result), { success: true, value: true });
  assert.equal(h.offscreen.creates.length, 1);
  assert.equal(h.offscreen.creates[0].url, 'offscreen.html');
  assert.deepEqual(Array.from(h.offscreen.creates[0].reasons), ['CLIPBOARD']);
  assert.equal(h.offscreen.closes, 1);
  assert.equal(h.sent[0].cmd, 'H2D_OFFSCREEN_WRITE');
});

test('Worker rejects foreign, iframe and malformed clipboard jobs before creating a document', async () => {
  const h = workerHarness();
  for (const [payload, sender] of [
    [{ kind: 'text', text: 'x' }, { id: 'other', tab: { id: 1 }, frameId: 0 }],
    [{ kind: 'text', text: 'x' }, { id: 'extension-id', tab: { id: 1 }, frameId: 2 }],
    [{ kind: 'html', html: 'x' }, { id: 'extension-id', tab: { id: 1 }, frameId: 0 }],
    [{ kind: 'text', text: 'x' }, { id: 'extension-id', frameId: 0 }]
  ]) {
    assert.equal((await h.send('H2D_WRITE_CLIPBOARD', payload, sender)).success, false);
  }
  assert.equal(h.offscreen.creates.length, 0);
  assert.equal(h.sent.length, 0);
});
