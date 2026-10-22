'use strict';
/* Route D: a canvas raster that is right, and no wider than it needs to be.
 * See docs/CANVAS-RESEARCH.md §5.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..', 'extension');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

function api(extra = {}) {
  const context = vm.createContext({ Blob, atob, requestAnimationFrame: undefined, ...extra });
  vm.runInContext(read('js/canvas-capture.js'), context);
  return context.PageCaptureCanvas;
}
const Canvas = api();
const plain = value => JSON.parse(JSON.stringify(value));

test('Large rasters are scaled into Figma\'s paste budget, small ones are left alone', () => {
  assert.deepEqual(plain(Canvas.fitWithin(8000, 4000)), { width: 4096, height: 2048, scale: 0.512 });
  assert.deepEqual(plain(Canvas.fitWithin(800, 600)), { width: 800, height: 600, scale: 1 });
  assert.deepEqual(plain(Canvas.fitWithin(10, 4000)), { width: 10, height: 4000, scale: 1 });
  assert.equal(Canvas.MAX_SIDE, 4096);
  for (const [width, height] of [[0, 10], [10, 0], [-5, 10], [NaN, 10], [Infinity, 10]]) {
    assert.equal(Canvas.fitWithin(width, height), null, `${width}x${height}`);
  }
});
test('A fully transparent frame is recognised as unpainted, anything else is not', () => {
  assert.equal(Canvas.isBlank(new Uint8ClampedArray(16)), true);
  assert.equal(Canvas.isBlank(new Uint8ClampedArray([0, 0, 0, 0, 0, 0, 0, 0])), true);
  assert.equal(Canvas.isBlank(new Uint8ClampedArray([0, 0, 0, 255])), false);
  assert.equal(Canvas.isBlank(new Uint8ClampedArray([0, 0, 0, 0, 255, 255, 255, 1])), false);
  assert.equal(Canvas.isBlank(null), false);
  assert.equal(Canvas.isBlank(new Uint8ClampedArray(0)), false);
});
test('The fallback screenshot is decoded without fetch()', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const bytes = Canvas.dataUrlToBytes(`data:image/png;base64,${png.toString('base64')}`);
  assert.deepEqual(Array.from(bytes), Array.from(png));
  assert.equal(Canvas.dataUrlToBytes('data:image/png,rawbytes'), null, 'non-base64 data URLs are refused');
  assert.equal(Canvas.dataUrlToBytes('data:image/png;base64,'), null);
  assert.equal(Canvas.dataUrlToBytes('http://example.com/a.png'), null);
  assert.equal(Canvas.dataUrlToBytes(null), null);
});
test('A blob is passed through untouched when no improvement is possible', async () => {
  const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/webp' });
  const canvas = { getBoundingClientRect: () => ({ x: 0, y: 0, width: 100, height: 100 }) };
  assert.equal(await Canvas.improve(canvas, blob), blob);
  assert.equal(await Canvas.improve(canvas, null), null);
});
test('Installation is a no-op without a canvas implementation and never double-wraps', () => {
  assert.equal(Canvas.install(), false, 'no HTMLCanvasElement in this context');
  const original = function toBlob(callback) { callback(null); };
  const prototype = { toBlob: original };
  const context = vm.createContext({ Blob, atob, HTMLCanvasElement: function HTMLCanvasElement() {}, requestAnimationFrame: undefined });
  context.HTMLCanvasElement.prototype = prototype;
  vm.runInContext(read('js/canvas-capture.js'), context);
  assert.notEqual(prototype.toBlob, original, 'toBlob is wrapped on injection');
  assert.equal(prototype.toBlob.__pageCaptureCanvas__, undefined);
  const wrapped = prototype.toBlob;
  assert.equal(context.PageCaptureCanvas.install(), false, 'second install is refused');
  assert.equal(prototype.toBlob, wrapped);
});
test('A missing blob still reaches the capture engine as a failure, never as a hang', async () => {
  const calls = [];
  const prototype = { toBlob(callback) { calls.push('native'); callback(null); } };
  const context = vm.createContext({ Blob, atob, HTMLCanvasElement: function HTMLCanvasElement() {}, requestAnimationFrame: undefined });
  context.HTMLCanvasElement.prototype = prototype;
  vm.runInContext(read('js/canvas-capture.js'), context);
  const canvas = Object.create(prototype);
  const received = await new Promise(resolve => prototype.toBlob.call(canvas, resolve, 'image/webp', 1));
  assert.equal(received, null);
  assert.deepEqual(calls, ['native']);
});
test('The hidden-toolbar selector matches the toolbar the engine mounts', () => {
  assert.ok(Canvas.TOOLBAR_HOST_ID.length > 0);
  assert.ok(read('js/h2d_toolbar.js').includes(`bt="${Canvas.TOOLBAR_HOST_ID}"`), 'toolbar host id drifted');
});
test('The service worker exposes a frame-0-only region raster RPC and injects the module', async () => {
  const background = read('js/background.js');
  assert.match(background, /"js\/canvas-capture\.js", "js\/figma-clip\.js", "js\/figma-native\.js", "js\/canvas-toggle\.js", "js\/h2d_toolbar\.js"/, 'the canvas module loads before the capture engine, and the native guard loads after both');
  let listener;
  const event = { addListener() {} };
  const sandbox = {
    URL, URLSearchParams, AbortController, AbortSignal, Promise, Blob, Response, Uint8Array, atob, crypto: require('node:crypto').webcrypto,
    console: { warn() {}, debug() {}, log() {}, error() {} },
    chrome: {
      runtime: { id: 'local-test-extension', getURL: name => `chrome-extension://local-test-extension/${name}`, onMessage: { addListener(fn) { listener = fn; } } },
      action: { onClicked: event }, commands: { onCommand: event }, tabs: { onUpdated: event, onRemoved: event, query: async () => [], get: async () => null, captureVisibleTab: async () => { throw new Error('not in this test'); } },
      storage: { local: { remove: async () => {}, get: async () => ({}), set: async () => {} }, session: { get: async () => ({}), set: async () => {} } },
      permissions: { contains: async () => true }, windows: { update: async () => {} }, scripting: { executeScript: async () => {} },
      extension: { isAllowedFileSchemeAccess: async () => true }
    }
  };
  const worker = vm.createContext(sandbox);
  sandbox.importScripts = (...names) => names.forEach(name => vm.runInContext(read(`js/${name}`), worker));
  vm.runInContext(background, worker);
  const send = (cmd, payload, sender) => new Promise(resolve => {
    listener({ cmd, payload }, sender, resolve);
  });
  const tab = { id: 5, windowId: 1, url: 'https://example.com/' };
  const offFrame = await send('H2D_CAPTURE_REGION_RASTER', { rect: { x: 0, y: 0, width: 10, height: 10 } }, { id: 'local-test-extension', tab, frameId: 3 });
  assert.equal(offFrame.success, false, 'an embedded frame cannot request the visible tab');
  const badRect = await send('H2D_CAPTURE_REGION_RASTER', { rect: { x: 0, y: 0, width: 1, height: 1 } }, { id: 'local-test-extension', tab, frameId: 0 });
  assert.equal(badRect.success, true);
  assert.equal(badRect.value, '', 'a degenerate rectangle returns nothing rather than throwing');
  const hugeRect = await send('H2D_CAPTURE_REGION_RASTER', { rect: { x: 0, y: 0, width: 90000, height: 10 } }, { id: 'local-test-extension', tab, frameId: 0 });
  assert.equal(hugeRect.value, '', 'an absurd rectangle is refused');
});

/* ---------------------------------------------- switch matrix (both actions) --
 * Capture design and Select element both reach a canvas through the same
 * serializer, which reads it with `toBlob`. The wrapper is action-agnostic, so
 * the switch has to hold for whichever root the walk started from; the two table
 * entries below keep that assumption visible instead of implicit.
 */

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function switchedCanvas({ blank = true, width = 800, height = 800 } = {}) {
  const sent = [];
  const toolbar = { style: { visibility: "" } };
  class FakeBitmap { constructor() { this.width = width; this.height = height; } close() {} }
  class FakeOffscreen {
    constructor(w, h) { this.width = w; this.height = h; }
    getContext() {
      const data = new Uint8ClampedArray(this.width * this.height * 4);
      if (!blank) data[3] = 255;
      return { drawImage() {}, getImageData: () => ({ data }) };
    }
    convertToBlob() { return Promise.resolve(new Blob(["smaller"], { type: "image/webp" })); }
  }
  const HTMLCanvasElement = function HTMLCanvasElement() {};
  HTMLCanvasElement.prototype = { toBlob(callback) { callback(new Blob(["original"], { type: "image/webp" })); } };
  const context = vm.createContext({
    Blob, atob, console, Promise, Uint8Array, Uint8ClampedArray, Date, JSON, Object, Math, Array, Symbol,
    createImageBitmap: async () => new FakeBitmap(),
    OffscreenCanvas: FakeOffscreen,
    requestAnimationFrame: fn => fn(),
    HTMLCanvasElement,
    document: { getElementById: () => toolbar, querySelector: () => toolbar },
    chrome: {
      runtime: {
        async sendMessage(message) {
          sent.push(message);
          return { success: true, value: `data:image/png;base64,${PNG_BYTES.toString("base64")}` };
        }
      }
    }
  });
  context.window = context; context.self = context; context.top = context;
  vm.runInContext(read('js/canvas-capture.js'), context);
  const canvas = Object.assign(Object.create(context.HTMLCanvasElement.prototype), {
    getBoundingClientRect: () => ({ x: 10, y: 20, width, height })
  });
  const read_blob = () => new Promise(resolve => {
    context.HTMLCanvasElement.prototype.toBlob.call(canvas, resolve, "image/webp", 1);
  });
  return { Canvas: context.PageCaptureCanvas, read_blob, sent, toolbar, canvas };
}

for (const action of ['capture_page', 'select_element']) {
  test(`Canvas Capture OFF leaves ${action} byte-identical to the pre-canvas behaviour`, async () => {
    const env = switchedCanvas({ blank: true });
    assert.equal(env.Canvas.isEnabled(), false);
    const blob = await env.read_blob();
    assert.equal(await blob.text(), "original", "the browser's own pixels, not a replacement");
    assert.equal(env.sent.length, 0, "no screenshot is requested behind the user's back");
    assert.equal(env.Canvas.recentRaster(), null, "and nothing is recorded to explain");
  });

  test(`Canvas Capture ON recovers a blank WebGL frame for ${action}`, async () => {
    const env = switchedCanvas({ blank: true });
    env.Canvas.setEnabled(true);
    const blob = await env.read_blob();
    assert.deepEqual(Array.from(new Uint8Array(await blob.arrayBuffer())), Array.from(PNG_BYTES));
    assert.equal(env.sent.length, 1);
    assert.equal(env.sent[0].cmd, "H2D_CAPTURE_REGION_RASTER");
    assert.deepEqual(plain(env.sent[0].payload.rect), { x: 10, y: 20, width: 800, height: 800 }, "cropped to the canvas, not the page");
    assert.equal(env.toolbar.style.visibility, "", "the toolbar is restored after the screenshot");
    assert.equal(env.Canvas.recentRaster().kind, "replaced");
  });
}

test("Canvas Capture ON scales an oversized canvas and records that it did", async () => {
  const env = switchedCanvas({ blank: false, width: 9000, height: 4500 });
  env.Canvas.setEnabled(true);
  const blob = await env.read_blob();
  assert.equal(await blob.text(), "smaller");
  assert.equal(env.sent.length, 0, "a painted canvas is not re-screenshotted");
  const note = env.Canvas.recentRaster();
  assert.equal(note.kind, "resized");
  assert.deepEqual({ ...note.from }, { width: 9000, height: 4500 });
  assert.deepEqual({ ...note.to }, { width: 4096, height: 2048 });
});

test("Canvas Capture ON leaves a painted, in-budget canvas alone", async () => {
  const env = switchedCanvas({ blank: false, width: 640, height: 480 });
  env.Canvas.setEnabled(true);
  const blob = await env.read_blob();
  assert.equal(await blob.text(), "original");
  assert.equal(env.sent.length, 0);
  assert.equal(env.Canvas.recentRaster(), null, "nothing to explain");
});
