/* Canvas Capture: one switch, and what it changes for Capture design / Select element.
 *
 * No jsdom: the pieces of the DOM the switch touches are small enough to fake,
 * and faking them keeps this suite dependency-free like the rest of the repo.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..', 'extension');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

/* ------------------------------------------------------------- fake DOM -- */

function element(tag) {
  const node = {
    tagName: String(tag).toUpperCase(),
    children: [],
    parent: null,
    attrs: {},
    listeners: {},
    innerHTML: '',
    text: '',
    style: { props: {}, setProperty(key, value) { this.props[key] = value; } },
    append(...nodes) { for (const child of nodes) { child.parent = node; node.children.push(child); } },
    replaceChildren(...nodes) { node.children = []; node.append(...nodes); },
    remove() {
      if (!node.parent) return;
      const siblings = node.parent.children;
      const index = siblings.indexOf(node);
      if (index >= 0) siblings.splice(index, 1);
      node.parent = null;
    },
    setAttribute(name, value) { node.attrs[name] = String(value); },
    getAttribute(name) { return name in node.attrs ? node.attrs[name] : null; },
    hasAttribute(name) { return name in node.attrs; },
    addEventListener(type, handler) { (node.listeners[type] ||= []).push(handler); },
    dispatch(type, event = {}) { for (const handler of node.listeners[type] || []) handler({ stopPropagation() {}, preventDefault() {}, ...event }); },
    focus() { node.focused = true; },
    contains(other) { for (let cursor = other; cursor; cursor = cursor.parent) if (cursor === node) return true; return false; },
    getBoundingClientRect() { return { x: 0, y: 0, width: 24, height: 24, top: 0, right: 24, bottom: 24, left: 0 }; },
    querySelector(selector) { return node.querySelectorAll(selector)[0] || null; },
    querySelectorAll(selector) {
      const found = [];
      (function walk(current) {
        for (const child of current.children) {
          if (matches(child, selector)) found.push(child);
          walk(child);
        }
      })(node);
      return found;
    },
    attachShadow() {
      const shadow = element("shadow-root");
      shadow.host = node;
      node.shadowRoot = shadow;
      return shadow;
    }
  };
  Object.defineProperty(node, "isConnected", { get: () => Boolean(root_of(node)) });
  Object.defineProperty(node, "textContent", {
    get: () => [node.text, ...node.children.map(child => child.textContent ?? "")].join(" ").trim(),
    set: value => { node.children = []; node.text = String(value); }
  });
  return node;
}

function root_of(node) {
  let cursor = node;
  while (cursor.parent) cursor = cursor.parent;
  return cursor.documentRoot ? cursor : null;
}

const SIMPLE = /^([a-z0-9]+)?((?:\.[\w-]+)*)((?:\[[\w-]+(?:="[^"]*")?\])*)$/i;

function matches(node, selector) {
  const match = SIMPLE.exec(selector.trim());
  if (!match) throw new Error(`unsupported selector in test fake: ${selector}`);
  const [, tag, classes, attrs] = match;
  if (tag && node.tagName !== tag.toUpperCase()) return false;
  for (const name of classes.split(".").filter(Boolean)) {
    if (!String(node.attrs.class || "").split(/\s+/).includes(name)) return false;
  }
  for (const [, name, value] of attrs.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) {
    if (!(name in node.attrs)) return false;
    if (value != null && node.attrs[name] !== value) return false;
  }
  return true;
}

/* -------------------------------------------------------------- harness -- */

function harness({ stored = {} } = {}) {
  const body = element("body");
  const documentElement = element("html");
  documentElement.documentRoot = true;
  documentElement.append(body);
  const doc = {
    body,
    documentElement,
    createElement: element,
    createElementNS: (_ns, tag) => element(tag),
    querySelectorAll: () => [],
    addEventListener() {}
  };
  const changes = [];
  const storage = {
    async get(key) { return typeof key === "string" ? { [key]: stored[key] } : { ...stored }; },
    async set(values) { Object.assign(stored, values); },
    async remove(key) { delete stored[key]; },
    onChanged: { addListener: handler => changes.push(handler) }
  };
  const calls = { commands: [], messages: [], enabling: [], layouts: 0 };
  const canvas = {
    setEnabled(value) { calls.enabling.push(value); },
    recentRaster: () => calls.raster || null
  };
  const sandbox = {
    console, setTimeout, clearInterval, setInterval, AbortController,
    MutationObserver: class { observe() {} disconnect() {} },
    innerWidth: 1440, innerHeight: 900,
    document: doc,
    PageCaptureCanvas: canvas,
    PageCaptureCore: { capturesKey: id => `figma_h2d_toolbar_captures_${id}` },
    PageCaptureDesignSystem: {
      scanPage: () => "scan",
      attach(controller) { calls.designSystemController = controller; return "attached"; }
    },
    chrome: {
      runtime: {
        id: "ext",
        async sendMessage(message) {
          calls.commands.push(message.cmd);
          if (message.cmd === "H2D_GET_TAB_ID") return { success: true, value: 7 };
          return { success: false };
        }
      },
      storage: { local: storage, onChanged: storage.onChanged },
      i18n: { getMessage: () => "" }
    }
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.top = sandbox;
  sandbox.addEventListener = () => {};
  const context = vm.createContext(sandbox);
  vm.runInContext(read("js/canvas-toggle.js"), context);
  return { Toggle: sandbox.PageCaptureCanvasToggle, doc, calls, storage, changes, stored, sandbox };
}

function makeController() {
  const shadowRoot = element("div");
  const tools = element("div");
  tools.attrs["data-toolbar-role"] = "tools";
  shadowRoot.append(tools);
  const controller = {
    shadowRoot,
    tools,
    toolbarEl: element("div"),
    element: element("div"),
    lifecycleAbort: new AbortController(),
    updateActionBarLayout() { controller.layouts++; },
    showTransientMessage(message) { controller.messages.push(message); },
    dispatchActionById(id) { controller.dispatched.push(id); },
    dispatched: [],
    layouts: 0,
    messages: []
  };
  return controller;
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const settle = async () => { for (let index = 0; index < 5; index++) await flush(); };

/* ---------------------------------------------------------------- tests -- */

test("The switch is off unless it was explicitly turned on", () => {
  const env = harness();
  assert.equal(env.Toggle.readEnabled({}), false);
  assert.equal(env.Toggle.readEnabled({ figma_h2d_canvas_capture: undefined }), false);
  assert.equal(env.Toggle.readEnabled({ figma_h2d_canvas_capture: "true" }), false, "only a real boolean counts");
  assert.equal(env.Toggle.readEnabled({ figma_h2d_canvas_capture: true }), true);
  assert.equal(env.Toggle.nextEnabled(false), true);
  assert.equal(env.Toggle.nextEnabled(true), false);
});

test("Every state the switch can show has copy, and rasters map to a plain explanation", () => {
  const env = harness();
  assert.equal(env.Toggle.labelKey(true), "canvasCaptureToggleOn");
  assert.equal(env.Toggle.labelKey(false), "canvasCaptureToggleOff");
  assert.equal(env.Toggle.statusKey(true), "canvasCaptureEnabledMessage");
  assert.equal(env.Toggle.statusKey(false), "canvasCaptureDisabledMessage");
  assert.equal(env.Toggle.rasterTextKey({ kind: "replaced" }), "canvasCaptureRasterReplaced");
  assert.equal(env.Toggle.rasterTextKey({ kind: "resized" }), "canvasCaptureRasterResized");
  assert.equal(env.Toggle.rasterTextKey({ kind: "blank" }), "canvasCaptureRasterBlank");
  assert.equal(env.Toggle.rasterTextKey(null), "");
});

test("The switch rides the same attach seam and keeps the design system working", () => {
  const env = harness();
  const controller = makeController();
  const wrapped = env.sandbox.PageCaptureDesignSystem;
  assert.equal(wrapped.scanPage(), "scan");
  assert.equal(wrapped.attach(controller, { copy: true }), "attached");
  assert.equal(env.calls.designSystemController, controller);
});

test("One switch is mounted beside the tools, off by default", async () => {
  const env = harness();
  const controller = makeController();
  env.sandbox.PageCaptureDesignSystem.attach(controller);
  await settle();
  const switches = controller.tools.querySelectorAll("[data-canvas-toggle]");
  assert.equal(switches.length, 1, "exactly one switch, no panel or importer button");
  assert.equal(switches[0].getAttribute("aria-pressed"), "false");
  assert.match(switches[0].getAttribute("aria-label"), /off/i);
  assert.equal(controller.layouts, 1);
  assert.deepEqual(env.calls.enabling, [false], "the canvas module is told the switch is off");
  assert.equal(env.stored.figma_h2d_canvas_capture, undefined, "opening a page writes no preference");
});

test("A stored ON survives a reload and reaches the canvas module", async () => {
  const env = harness({ stored: { figma_h2d_canvas_capture: true } });
  const controller = makeController();
  env.sandbox.PageCaptureDesignSystem.attach(controller);
  await settle();
  const toggle = controller.tools.querySelector("[data-canvas-toggle]");
  assert.equal(toggle.getAttribute("aria-pressed"), "true");
  assert.equal(env.calls.enabling.at(-1), true);
});

test("Clicking flips the switch, persists it and says what changes", async () => {
  const env = harness();
  const controller = makeController();
  env.sandbox.PageCaptureDesignSystem.attach(controller);
  await settle();
  const toggle = controller.tools.querySelector("[data-canvas-toggle]");
  toggle.dispatch("click");
  await settle();
  assert.equal(toggle.getAttribute("aria-pressed"), "true");
  assert.equal(env.stored.figma_h2d_canvas_capture, true);
  assert.equal(env.calls.enabling.at(-1), true, "synchronous, so a capture cannot race the write");
  assert.match(controller.messages.at(-1).message, /Canvas capture on/);

  toggle.dispatch("click");
  await settle();
  assert.equal(toggle.getAttribute("aria-pressed"), "false");
  assert.equal(env.stored.figma_h2d_canvas_capture, false);
  assert.equal(env.calls.enabling.at(-1), false);
  assert.match(controller.messages.at(-1).message, /Canvas capture off/);
});

test("Turning it off again restores the untouched behaviour", async () => {
  const env = harness({ stored: { figma_h2d_canvas_capture: true } });
  const controller = makeController();
  env.sandbox.PageCaptureDesignSystem.attach(controller);
  await settle();
  controller.tools.querySelector("[data-canvas-toggle]").dispatch("click");
  await settle();
  assert.equal(env.calls.enabling.at(-1), false);
});

test("Another tab flipping the switch is reflected here without a reload", async () => {
  const env = harness({ stored: { figma_h2d_canvas_capture: true } });
  const controller = makeController();
  env.sandbox.PageCaptureDesignSystem.attach(controller);
  await settle();
  const toggle = controller.tools.querySelector("[data-canvas-toggle]");
  for (const handler of env.changes) handler({ figma_h2d_canvas_capture: { newValue: false } }, "local");
  assert.equal(toggle.getAttribute("aria-pressed"), "false");
  assert.equal(env.calls.enabling.at(-1), false);
});

test("A capture with a raster says it is an image, and only while the switch is on", async () => {
  const key = "figma_h2d_toolbar_captures_7";
  const env = harness({ stored: { figma_h2d_canvas_capture: true } });
  const controller = makeController();
  env.sandbox.PageCaptureDesignSystem.attach(controller);
  await settle();
  env.calls.raster = { kind: "replaced", at: Date.now() };
  for (const handler of env.changes) handler({ [key]: { oldValue: [], newValue: [{ id: "a", type: "snapshot" }] } }, "local");
  assert.equal(controller.messages.length, 1);
  assert.equal(controller.messages[0].tone, "info");
  assert.doesNotMatch(controller.messages[0].message, /editable layers are here/i);
  assert.match(controller.messages[0].message, /as an image/);

  // A second record (for example from Select element) reports again.
  for (const handler of env.changes) handler({ [key]: { oldValue: [{ id: "a" }], newValue: [{ id: "b" }, { id: "a" }] } }, "local");
  assert.equal(controller.messages.length, 2);

  // Switch off: no claim about canvases at all.
  controller.tools.querySelector("[data-canvas-toggle]").dispatch("click");
  await settle();
  const before = controller.messages.length;
  for (const handler of env.changes) handler({ [key]: { oldValue: [{ id: "a" }, { id: "b" }], newValue: [{ id: "c" }, { id: "b" }, { id: "a" }] } }, "local");
  assert.equal(controller.messages.length, before, "off means silent, exactly like before the feature");
});

test("Attaching twice still mounts one switch", async () => {
  const env = harness();
  const controller = makeController();
  env.sandbox.PageCaptureDesignSystem.attach(controller);
  await settle();
  env.Toggle.attach(controller);
  await settle();
  assert.equal(controller.tools.querySelectorAll("[data-canvas-toggle]").length, 1);
});

test("Nothing is read from the clipboard and no new RPC is added", async () => {
  const env = harness({ stored: { figma_h2d_canvas_capture: true } });
  const controller = makeController();
  env.sandbox.PageCaptureDesignSystem.attach(controller);
  await settle();
  controller.tools.querySelector("[data-canvas-toggle]").dispatch("click");
  await settle();
  assert.deepEqual([...new Set(env.calls.commands)], ["H2D_GET_TAB_ID"]);
  const code = read("js/canvas-toggle.js").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(code, /navigator\.clipboard|\.clipboard\.(?:read|write|readText|writeText)/);
  assert.doesNotMatch(code, /fetch\(|XMLHttpRequest|sendBeacon/);
  const urls = Array.from(code.matchAll(/https?:\/\/[^\s"']+/g), match => match[0]);
  assert.deepEqual(urls.filter(url => url !== "http://www.w3.org/2000/svg"), [], "no remote URL is reachable from the switch");
});

/* -------------------------------------------------------------- notice -- */

test("Notice copy exists only for the two situations worth stopping for", () => {
  const env = harness();
  const plain = value => JSON.parse(JSON.stringify(value));
  assert.deepEqual(plain(env.Toggle.noticeKeys("no-native")), { title: "figmaNativeNoticeTitle", body: "figmaNativeMissing" });
  assert.deepEqual(plain(env.Toggle.noticeKeys("permission")), { title: "figmaNativeNoticeTitle", body: "figmaNativePermission" });
  assert.equal(env.Toggle.noticeKeys("native"), null);
  assert.equal(env.Toggle.noticeKeys(null), null);
});

test("A picture of the page gets a persistent notice, not a passing toast", async () => {
  const env = harness({ stored: { figma_h2d_canvas_capture: true } });
  const controller = makeController();
  env.sandbox.PageCaptureDesignSystem.attach(controller);
  await settle();
  env.Toggle.notice("no-native");
  const host = env.doc.body.children.find(child => child.id === "__figma_h2d_canvas_notice__");
  assert.ok(host, "the notice has its own host");
  assert.equal(host.getAttribute("data-h2d-ignore"), "true", "captures skip it");
  assert.ok(host.shadowRoot.textContent.includes("Canvas capture needs Figma's copy"));
  assert.ok(host.shadowRoot.textContent.includes("Ctrl/Cmd+C"), "it says exactly what to press");

  const retry = host.shadowRoot.querySelectorAll("button")[0];
  retry.dispatch("click");
  assert.deepEqual(controller.dispatched, ["capture_page"], "one click re-runs the capture");
  assert.ok(!env.doc.body.children.some(child => child.id === "__figma_h2d_canvas_notice__"), "and clears itself");
});

test("The notice can be dismissed, and dies with the switch", async () => {
  const env = harness({ stored: { figma_h2d_canvas_capture: true } });
  const controller = makeController();
  env.sandbox.PageCaptureDesignSystem.attach(controller);
  await settle();
  env.Toggle.notice("permission");
  let host = env.doc.body.children.find(child => child.id === "__figma_h2d_canvas_notice__");
  assert.ok(host.shadowRoot.textContent.includes("options page"), "the permission case names the one-time fix");
  host.shadowRoot.querySelectorAll("button")[1].dispatch("click");
  assert.ok(!env.doc.body.children.some(child => child.id === "__figma_h2d_canvas_notice__"));

  env.Toggle.notice("no-native");
  assert.ok(env.doc.body.children.some(child => child.id === "__figma_h2d_canvas_notice__"));
  controller.tools.querySelector("[data-canvas-toggle]").dispatch("click");
  await settle();
  assert.ok(!env.doc.body.children.some(child => child.id === "__figma_h2d_canvas_notice__"), "switching off removes it");
});

/* ------------------------------------------------------- capture strategy -- */

test("The canvas module is a pure passthrough until the switch is on", async () => {
  const createImageBitmap = async () => ({ width: 800, height: 600, close() {} });
  const OffscreenCanvas = class { constructor() {} getContext() { return { drawImage() {} }; } convertToBlob() { return null; } };
  const sandbox = {
    console, Promise, Symbol, Array, Object, Math, Uint8Array, Date, Blob,
    createImageBitmap, OffscreenCanvas, atob, requestAnimationFrame: fn => fn(),
    document: { getElementById: () => null, querySelector: () => null },
    chrome: { runtime: { sendMessage: async () => ({ success: false }) } }
  };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.top = sandbox;
  sandbox.HTMLCanvasElement = function HTMLCanvasElement() {};
  const original = function (callback) { callback(new Blob(["original"], { type: "image/png" })); };
  sandbox.HTMLCanvasElement.prototype = { toBlob: original };
  const context = vm.createContext(sandbox);
  vm.runInContext(read("js/canvas-capture.js"), context);
  const Canvas = sandbox.PageCaptureCanvas;

  assert.equal(Canvas.isEnabled(), false, "off by default");
  const blob = await new Promise(resolve => {
    const canvas = new sandbox.HTMLCanvasElement();
    canvas.toBlob(result => resolve(result), "image/png");
  });
  assert.equal(await blob.text(), "original", "the browser's own result, untouched");

  Canvas.setEnabled(true);
  assert.equal(Canvas.isEnabled(), true);
  assert.equal(typeof Canvas.noteRaster, "function");
});

test("The switch is injected before the toolbar and the bundle stays generated", () => {
  const list = /files:\s*\[([^\]]+)\]/.exec(read("js/background.js"))[1];
  const order = Array.from(list.matchAll(/"([^"]+)"/g), match => match[1]);
  assert.ok(order.includes("js/canvas-toggle.js"));
  assert.ok(order.indexOf("js/canvas-capture.js") < order.indexOf("js/canvas-toggle.js"));
  assert.ok(order.indexOf("js/canvas-toggle.js") < order.indexOf("js/h2d_toolbar.js"));
  assert.equal(order.includes("js/figma-bridge.js"), false, "the separate importer entry is gone from the page");
  assert.ok(order.indexOf("js/figma-clip.js") < order.indexOf("js/figma-native.js"), "the native guard reuses the tested parser");
  const toolbar = read("js/h2d_toolbar.js");
  assert.doesNotMatch(toolbar, /PageCaptureCanvasToggle|figma-bridge/, "no hand edit to the bundle");
});

test("Every string the switch shows exists in the locale file", () => {
  const messages = JSON.parse(read("_locales/en/messages.json"));
  const source = read("js/canvas-toggle.js");
  const keys = new Set(Array.from(source.matchAll(/"(canvasCapture[A-Za-z]+)"/g), match => match[1]));
  assert.ok(keys.size >= 6);
  for (const key of keys) assert.ok(messages[key], `${key} is missing from messages.json`);
  for (const stale of Object.keys(messages).filter(key => key.startsWith("figmaBridge"))) {
    assert.fail(`${stale} is left over from the removed importer panel`);
  }
});
