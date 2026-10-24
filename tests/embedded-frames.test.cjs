'use strict';
// Embedded-document capture, without a browser: the hook contract (what it
// decorates, what it leaves alone) and the model merge arithmetic. Real layout,
// cross-realm nodes and cross-origin refusals are covered by
// tests/embedded-frames-browser.cjs in Chromium.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..', 'extension');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

const SOURCE = read('js/embedded-frames.js');

function frame({ width = 390, height = 300 } = {}) {
  return {
    isConnected: true,
    getAttribute: () => null,
    getBoundingClientRect: () => ({ x: 0, y: 0, width, height }),
    contentDocument: { body: { children: [{}], textContent: 'inner' }, documentElement: {} }
  };
}

function model({ frames = 1, width = 1280 } = {}) {
  const children = [];
  for (let index = 0; index < frames; index++) {
    children.push({ nodeType: 1, tag: 'IFRAME', rect: { x: 48, y: 80 + index * 320, width: 390, height: 300 }, childNodes: [], attributes: { title: `Frame ${index}` } });
  }
  return {
    version: 2, documentTitle: 'Page', assets: { 'https://page/one.png': { blob: 'page' } }, fonts: { Page: { familyName: 'Page' } },
    root: { nodeType: 1, tag: 'HTML', rect: { x: 0, y: 0, width, height: 900 }, childNodes: [
      { nodeType: 1, tag: 'BODY', rect: { x: 0, y: 0, width, height: 900 }, childNodes: children }
    ] }
  };
}

function childModel() {
  return {
    version: 2, assets: { 'https://page/two.png': { blob: 'child' } }, fonts: { Child: { familyName: 'Child' } },
    root: { nodeType: 1, tag: 'HTML', rect: { x: 0, y: 0, width: 390, height: 300 }, childNodes: [
      { nodeType: 1, tag: 'BODY', rect: { x: 0, y: 0, width: 390, height: 300 }, childNodes: [
        { nodeType: 1, tag: 'H2', rect: { x: 20, y: 20, width: 200, height: 28 }, styles: { fontSize: '24px' }, childNodes: [] },
        { nodeType: 3, text: 'Inner heading', rect: { x: 20, y: 20, width: 200, height: 28 } }
      ] }
    ] }
  };
}

function harness({ frames = [frame()], live = true, captured = childModel() } = {}) {
  let copies = 0, captures = 0;
  const document = {
    body: { nodeType: 1 },
    documentElement: { nodeType: 1 },
    querySelectorAll: () => frames,
    implementation: { createHTMLDocument: () => ({}) },
    createElement: () => ({})
  };
  const window = { innerWidth: live ? 1280 : 800 };
  window.self = window; window.top = window;
  const context = vm.createContext({
    document, AbortSignal, AbortController, DOMException, URL, console, window,
    PageCaptureSafety: { prepareClipboard: async records => { copies++; return { records }; }, limits: {} },
    PageCaptureDesignBoard: { createCopier: helpers => { context.__helpers = helpers; return { copy() {} }; } },
    PageCaptureViewports: {
      createCapturer(helpers) {
        context.__capturerHelpers = helpers;
        return async (options) => { captures++; context.__captureOptions = options; return { capture: { type: 'snapshot', id: 'child', h2dJson: JSON.stringify(captured), previewUrl: '' } }; };
      }
    }
  });
  context.globalThis = context;
  vm.runInContext(SOURCE, context);
  const board = context.PageCaptureDesignBoard.createCopier({ capture: () => {}, serialize: () => '{}', encode: () => '' });
  return { context, document, board, copies: () => copies, captures: () => captures };
}

const record = doc => ({ type: 'snapshot', id: 'one', h2dJson: JSON.stringify(doc), previewUrl: '' });

test('The module decorates the two engine seams once and stays idempotent', () => {
  const h = harness();
  const first = h.context.PageCaptureSafety;
  assert.equal(first.__embeddedFrames, true);
  assert.equal(h.context.PageCaptureDesignBoard.__embeddedFrames, true);
  assert.ok(h.context.PageCaptureEmbedded && typeof h.context.PageCaptureEmbedded.expandRecord === 'function');
  vm.runInContext(SOURCE, h.context);
  assert.equal(h.context.PageCaptureSafety.__embeddedFrames, true);
  assert.equal(h.context.PageCaptureDesignBoard.__embeddedFrames, true);
  // The wireframe hook installs after this one and must survive being wrapped.
  assert.equal(typeof h.context.PageCaptureSafety.prepareClipboard, 'function');
});

test('Records without readable frames are passed through untouched', async () => {
  const empty = harness({ frames: [] });
  const doc = model();
  const input = [record(doc), { type: 'mhtml', id: 'two', mhtml: { root: true } }];
  const output = (await empty.context.PageCaptureSafety.prepareClipboard(input, {})).records;
  assert.equal(output.length, 2);
  assert.equal(output[0].h2dJson, input[0].h2dJson);
  assert.equal(empty.captures(), 0);
  assert.equal(empty.copies(), 1);
});

test('A capture that is not this live document is never given the page frames', async () => {
  const h = harness({ live: false });
  const doc = model({ width: 393 });
  const output = await h.context.PageCaptureEmbedded.expandRecord(record(doc), {});
  assert.equal(output.h2dJson, JSON.stringify(doc));
  assert.equal(h.captures(), 0);
  const elementCapture = model();
  elementCapture.root = { ...elementCapture.root, rect: { x: 200, y: 100, width: 400, height: 300 } };
  assert.equal((await h.context.PageCaptureEmbedded.expandRecord(record(elementCapture), {})).h2dJson, JSON.stringify(elementCapture));
  assert.equal(h.captures(), 0);
});

test('A readable frame is captured, moved into the frame box, and merged without losing the page assets', async () => {
  const h = harness();
  const doc = model();
  const output = await h.context.PageCaptureEmbedded.expandRecord(record(doc), {});
  const merged = JSON.parse(output.h2dJson);
  assert.equal(h.captures(), 1);

  const frameNode = merged.root.childNodes[0].childNodes[0];
  assert.equal(frameNode.tag, 'IFRAME');
  assert.equal(frameNode.childNodes.length, 1, 'the frame now has content');
  const childRoot = frameNode.childNodes[0];
  assert.deepEqual(childRoot.rect, { x: 48, y: 80, width: 390, height: 300 }, 'the child document starts at the frame origin');
  const heading = childRoot.childNodes[0].childNodes[0];
  assert.deepEqual(heading.rect, { x: 68, y: 100, width: 200, height: 28 }, 'nested nodes keep their relative layout');
  assert.equal(heading.styles.fontSize, '24px', 'nested nodes keep their computed styles');

  assert.deepEqual(Object.keys(merged.assets).sort(), ['https://page/one.png', 'https://page/two.png']);
  assert.deepEqual(Object.keys(merged.fonts).sort(), ['Child', 'Page']);
  assert.equal(merged.root.rect.width, 1280, 'the page root is unchanged');
  assert.equal(doc.root.childNodes[0].childNodes[0].childNodes.length, 0, 'the original record was not mutated in place');
});

test('The capturer receives the frame size and a parent-realm source facade', async () => {
  const h = harness({ frames: [frame({ width: 390, height: 628 })] });
  await h.context.PageCaptureEmbedded.expandRecord(record(model()), {});
  const options = h.context.__captureOptions;
  assert.equal(options.width, 390);
  assert.equal(options.height, 628);
  assert.equal(options.mount, h.document.body);
  // The facade hands over the parent's implementation so imported nodes belong to
  // this realm and the engine's instanceof checks keep working.
  assert.equal(options.source.implementation, h.document.implementation);
  assert.equal(options.source.implementation.createHTMLDocument, h.document.implementation.createHTMLDocument);
  assert.ok(h.context.__capturerHelpers.createId().startsWith('embedded-frame-'));
});

test('A frame that fails to rebuild leaves the original record intact', async () => {
  const h = harness();
  h.context.PageCaptureViewports.createCapturer = () => async () => { throw new Error('copy failed'); };
  const doc = model();
  const output = await h.context.PageCaptureEmbedded.expandRecord(record(doc), {});
  assert.equal(output.h2dJson, JSON.stringify(doc));
});

test('The module is local-only: no network, storage, clipboard reads or markup injection', () => {
  assert.doesNotMatch(SOURCE, /\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|chrome\.|clipboard\.(?:read|readText)|innerHTML\s*=|srcdoc/);
  assert.doesNotMatch(SOURCE, /\bimportScripts\b|\beval\s*\(|new Function/);
  assert.match(read('js/background.js'), /"js\/wireframe\.js", "js\/embedded-frames\.js", "js\/h2d_toolbar\.js"/);
  assert.match(SOURCE, /window\.self !== window\.top/, 'embedded frames never rebuild themselves');
});
