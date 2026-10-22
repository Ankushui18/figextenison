/* Native-first capture on figma.com, and the guarantee that nothing else changes.
 *
 * The browser round-trip into Figma is a manual step (docs/CANVAS-RESEARCH.md).
 * Everything decidable without Figma is pinned here: what counts as a native
 * payload, when it wins, and that the write path is untouched otherwise.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..', 'extension');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

/* A real `(figma)` container: base64 of "fig-kiwi" + filler, in Figma's HTML. */
const MAGIC = Buffer.concat([Buffer.from('fig-kiwi'), Buffer.alloc(24, 7)]).toString('base64');
const NATIVE_HTML = `<meta charset="utf-8"><span data-metadata="<!--(figmeta)${Buffer.from('{"fileKey":"abc123"}').toString('base64')}(/figmeta)-->" data-buffer="<!--(figma)${MAGIC}AAAAAAA=(/figma)-->"></span>`;
const H2D_HTML = '<span data-h2d="(figh2d)"><!--(figh2d)eyJ2ZXJzaW9uIjoyfQ==(/figh2d)--></span>';
const PAGE_HTML = '<div><p>Just a web page</p></div>';

function harness({ enabled = true, hostname = 'www.figma.com', clipboardHtml = NATIVE_HTML, readError = null } = {}) {
  const calls = { read: 0, writes: [], messages: [], notices: [], hidden: 0 };
  const Clip = {
    readHtml: async () => {
      calls.read++;
      if (readError) throw readError;
      return clipboardHtml;
    },
    detect: html => (typeof html === 'string' && html.includes('(figma)') && !html.includes('(figh2d)')
      ? { bytes: 12, magic: 'fig-kiwi', metadata: {} }
      : null)
  };
  const storageData = { figma_h2d_canvas_capture: enabled };
  const listeners = [];
  const sandbox = {
    console, setTimeout, setInterval, clearInterval, AbortController, Promise, Object, Math, Date, String, JSON, Array,
    Blob, Uint8Array,
    ClipboardItem: class ClipboardItem { constructor(data) { this.data = data; this.types = Object.keys(data); } },
    location: { hostname },
    PageCaptureFigmaClip: Clip,
    PageCaptureDesignSystem: { attach: () => 'attached' },
    PageCaptureCanvasToggle: {
      notice: kind => calls.notices.push(kind),
      hideNotice: () => { calls.hidden++; }
    },
    chrome: {
      i18n: { getMessage: () => '' },
      storage: {
        local: {
          async get(key) { return typeof key === 'string' ? { [key]: storageData[key] } : { ...storageData }; }
        },
        onChanged: { addListener: handler => listeners.push(handler) }
      }
    },
    Clipboard: class Clipboard {
      async write(items) { calls.writes.push(items); }
    }
  };
  sandbox.navigator = { clipboard: new sandbox.Clipboard() };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.top = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(read('js/figma-native.js'), context);
  return { Native: sandbox.PageCaptureFigmaNative, sandbox, calls, storageData, listeners, clipboard: sandbox.navigator.clipboard };
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const settle = async () => { for (let index = 0; index < 4; index++) await flush(); };
const item = () => ({ 'text/html': new Blob([H2D_HTML], { type: 'text/html' }) });

function makeController() {
  const controller = {
    shadowRoot: { querySelector: () => null },
    toolbarEl: {},
    element: {},
    lifecycleAbort: new AbortController(),
    messages: [],
    updateActionBarLayout() {},
    showTransientMessage(message) { controller.messages.push(message); }
  };
  return controller;
}

/* ------------------------------------------------------------- decision -- */

test('A Figma scene wins only with the switch on, on figma.com', () => {
  const env = harness();
  const detect = html => env.Native.decide({ enabled: true, hostname: 'www.figma.com', clipboardHtml: html }, () => ({ bytes: 4 })).mode === 'native';
  assert.equal(detect(NATIVE_HTML), true);

  assert.equal(env.Native.decide({ enabled: false, hostname: 'www.figma.com', clipboardHtml: NATIVE_HTML }, () => ({ bytes: 4 })).reason, 'switch_off');
  assert.equal(env.Native.decide({ enabled: true, hostname: 'example.com', clipboardHtml: NATIVE_HTML }, () => ({ bytes: 4 })).reason, 'not_figma');
  assert.equal(env.Native.decide({ enabled: true, hostname: 'figma.com.evil.test', clipboardHtml: NATIVE_HTML }, () => ({ bytes: 4 })).reason, 'not_figma');
  assert.equal(env.Native.decide({ enabled: true, hostname: 'www.figma.com', clipboardHtml: '' }, () => ({ bytes: 4 })).reason, 'empty');
  assert.equal(env.Native.decide({ enabled: true, hostname: 'www.figma.com', clipboardHtml: PAGE_HTML }, () => null).mode, 'html');
});

test('Our own h2d payload and ordinary page HTML are never treated as native', () => {
  const env = harness();
  // The real parser, not a stub: this is the guarantee that our payload does not
  // get echoed back as if it were a Figma scene.
  const clipSandbox = { console, Blob, Uint8Array, atob, JSON, Math, String, Object, Date, Array, Error, RegExp, Number };
  clipSandbox.globalThis = clipSandbox;
  const clipContext = vm.createContext(clipSandbox);
  vm.runInContext(read('js/figma-clip.js'), clipContext);
  const detect = html => clipContext.PageCaptureFigmaClip.detect(html);
  assert.equal(env.Native.decide({ enabled: true, hostname: 'www.figma.com', clipboardHtml: H2D_HTML }, detect).mode, 'html');
  assert.equal(env.Native.decide({ enabled: true, hostname: 'www.figma.com', clipboardHtml: PAGE_HTML }, detect).mode, 'html');
  assert.equal(env.Native.decide({ enabled: true, hostname: 'www.figma.com', clipboardHtml: NATIVE_HTML }, detect).mode, 'native');
});

test('Only figma.com and its subdomains count', () => {
  const env = harness();
  for (const host of ['figma.com', 'www.figma.com', 'design.figma.com']) assert.equal(env.Native.isFigmaHost(host), true, host);
  for (const host of ['notfigma.com', 'figma.com.evil.test', 'example.com', '', null]) assert.equal(env.Native.isFigmaHost(host), false, String(host));
});

/* ---------------------------------------------------------------- guard -- */

test('Switch off: the write is untouched and the clipboard is never read', async () => {
  const env = harness({ enabled: false });
  env.sandbox.__h2dNativeGuard__.setEnabled(false);
  await env.clipboard.write([item()]);
  await settle();
  assert.equal(env.calls.read, 0, 'no clipboard read when the feature is off');
  assert.equal(env.calls.writes.length, 1);
  assert.deepEqual(Object.keys(env.calls.writes[0][0]), ['text/html'], 'the original payload is written');
});

test('Switch on with a Figma copy: Figma bytes are written, not our payload', async () => {
  const env = harness();
  const guard = env.sandbox.__h2dNativeGuard__;
  guard.setEnabled(true);
  await env.clipboard.write([item()]);
  await settle();
  assert.equal(env.calls.read, 1);
  assert.equal(env.calls.writes.length, 1);
  const written = await env.calls.writes[0][0].data['text/html'].text();
  assert.equal(written, NATIVE_HTML, "Figma's own bytes are preserved verbatim");
  assert.ok(guard.lastNativeAt > 0, 'the switch module can tell native won');
});

test('Switch on without a Figma copy falls back to today\'s capture', async () => {
  const env = harness({ clipboardHtml: PAGE_HTML });
  env.sandbox.__h2dNativeGuard__.setEnabled(true);
  await env.clipboard.write([item()]);
  await settle();
  assert.equal(env.calls.writes.length, 1);
  const written = await env.calls.writes[0][0]['text/html'].text();
  assert.equal(written, H2D_HTML, 'the ordinary capture still gets through');
});

test('A refused clipboard read degrades to the ordinary capture and explains once', async () => {
  const env = harness({ readError: Object.assign(new Error('denied'), { code: 'clipboard_denied' }) });
  const controller = makeController();
  const guard = env.sandbox.__h2dNativeGuard__;
  guard.setEnabled(true);
  env.Native.attach(controller);
  await env.clipboard.write([item()]);
  await env.clipboard.write([item()]);
  await settle();
  assert.equal(env.calls.writes.length, 2, 'both writes still happen');
  assert.deepEqual(env.calls.notices, ['permission'], 'the limitation is explained once, not on every capture');
  assert.equal(controller.messages.length, 0, 'no toast competes with the persistent notice');
});

test('Success and missing-copy states each explain themselves on the toolbar', async () => {
  const env = harness();
  const controller = makeController();
  const guard = env.sandbox.__h2dNativeGuard__;
  guard.setEnabled(true);
  env.Native.attach(controller);
  await env.clipboard.write([item()]);
  await settle();
  assert.equal(controller.messages.length, 1);
  assert.equal(controller.messages[0].tone, 'success');
  assert.match(controller.messages[0].message, /native copy kept/i);
  assert.deepEqual(env.calls.notices, [], 'success needs no notice');
  assert.equal(env.calls.hidden, 1, 'a stale notice is cleared when native wins');

  const second = harness({ clipboardHtml: PAGE_HTML });
  const controller2 = makeController();
  second.sandbox.__h2dNativeGuard__.setEnabled(true);
  second.Native.attach(controller2);
  await second.clipboard.write([item()]);
  await settle();
  assert.deepEqual(second.calls.notices, ['no-native'], 'a picture of the page is labelled as one');
});

test('The guard installs once and survives a second install call', () => {
  const env = harness();
  assert.equal(env.sandbox.__h2dNativeGuard__.constructor.name, 'Object');
  assert.equal(env.clipboard.__h2dNativeGuard__, true);
  const again = env.Native.install({ clipboard: env.clipboard });
  assert.equal(again, false, 'a second guard is refused');
});

test('Switching off at runtime restores the untouched write path', async () => {
  const env = harness();
  const guard = env.sandbox.__h2dNativeGuard__;
  guard.setEnabled(true);
  await env.clipboard.write([item()]);
  await settle();
  assert.equal(env.calls.read, 1);
  for (const handler of env.listeners) handler({ figma_h2d_canvas_capture: { newValue: false } }, 'local');
  assert.equal(guard.state().enabled, false);
  await env.clipboard.write([item()]);
  await settle();
  assert.equal(env.calls.read, 1, 'no further reads once off');
});

test('Without a clipboard API the guard steps aside instead of throwing', () => {
  const env = harness();
  assert.equal(env.Native.install({ clipboard: null }), false);
  assert.equal(env.Native.install({ clipboard: { } }), false, 'no write method to guard');
  assert.equal(env.Native.nativeItem('', class {}), null, 'nothing to build without a payload');
  assert.equal(env.Native.nativeItem(NATIVE_HTML, null), null, 'nothing to build without ClipboardItem');
  assert.ok(env.Native.nativeItem(NATIVE_HTML, env.sandbox.ClipboardItem), 'a real item is built when both exist');
});

/* ------------------------------------------------------------- guarantees -- */

test('No synthetic keyboard events, no network, no new RPC', () => {
  const source = read('js/figma-native.js');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(code, /KeyboardEvent|dispatchEvent|execCommand\s*\(\s*["']copy/, 'the payload must come from Figma, not from faked input');
  assert.match(code, /execCommand\("paste"\)/, 'reading the clipboard with a paste command is allowed');
  assert.doesNotMatch(code, /fetch\(|XMLHttpRequest|sendBeacon/);
  assert.doesNotMatch(code, /sendMessage/, 'no background message is needed for this');
  const urls = Array.from(code.matchAll(/https?:\/\/[^\s"']+/g), match => match[0]);
  assert.deepEqual(urls, []);
});

test('It is injected before the toolbar, after the parser it reuses', () => {
  const list = /files:\s*\[([^\]]+)\]/.exec(read('js/background.js'))[1];
  const order = Array.from(list.matchAll(/"([^"]+)"/g), match => match[1]);
  assert.ok(order.indexOf('js/figma-clip.js') < order.indexOf('js/figma-native.js'));
  assert.ok(order.indexOf('js/figma-native.js') < order.indexOf('js/h2d_toolbar.js'));
  assert.doesNotMatch(read('js/h2d_toolbar.js'), /PageCaptureFigmaNative/, 'no hand edit to the bundle');
});

test('Only one module explains a capture on figma.com', () => {
  const toggle = read('js/canvas-toggle.js');
  assert.match(toggle, /PageCaptureFigmaNative\?\.isFigmaHost/, 'the switch defers to the native module on figma.com');
});

test('Every string the native path shows exists in the locale file', () => {
  const messages = JSON.parse(read('_locales/en/messages.json'));
  const source = read('js/figma-native.js') + read('js/canvas-toggle.js');
  const keys = new Set(Array.from(source.matchAll(/"(figmaNative[A-Za-z]+)"/g), match => match[1]));
  assert.ok(keys.size >= 6, `expected the notice copy too, found ${[...keys].join(', ')}`);
  for (const key of keys) assert.ok(messages[key], `${key} is missing from messages.json`);
});
