/* The experimental Figma bridge: what it mounts, when it appears, and why.
 *
 * No jsdom: the pieces of the DOM the module touches are small enough to fake,
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
    getBoundingClientRect() { return { x: 0, y: 0, width: 320, height: 200, top: 0, right: 320, bottom: 200, left: 0 }; },
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
    get: () => [node.text || "", ...node.children.map(child => child.textContent ?? child.innerHTML ?? "")].join(" ").trim(),
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
    if (!String(node.attrs.class || node.className || "").split(/\s+/).includes(name)) return false;
  }
  for (const [, name, value] of attrs.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) {
    if (!(name in node.attrs)) return false;
    if (value != null && node.attrs[name] !== value) return false;
  }
  return true;
}

function makeDocument({ canvases = [], execCommand = () => false } = {}) {
  const body = element("body");
  const documentElement = element("html");
  documentElement.append(body);
  documentElement.documentRoot = true;
  body.parent = documentElement;
  const doc = {
    body,
    documentElement,
    execCommand,
    lastHolder: null,
    createElement: tag => { const node = element(tag); if (tag === "div") doc.lastHolder = node; return node; },
    createElementNS: (_ns, tag) => element(tag),
    querySelectorAll: selector => (selector === "canvas" ? canvases : []),
    querySelector: selector => (selector === "canvas" ? canvases[0] || null : null),
    addEventListener() {}
  };
  return doc;
}

/* -------------------------------------------------------------- harness -- */

const FIXTURE_HTML = '<meta charset="utf-8"><span data-metadata="(figmeta)AAAA"></span><!--(figma)ZmlnLWtpdA==-->';

function harness({ canvases = [], width = 1440, height = 900, stored = {}, clipboard, execPaste } = {}) {
  const doc = makeDocument({
    canvases,
    execCommand: execPaste ? () => { doc.lastHolder.innerHTML = execPaste; return true; } : () => false
  });
  const changes = [];
  const storage = {
    async get(key) { return typeof key === "string" ? { [key]: stored[key] } : { ...stored }; },
    async set(values) { Object.assign(stored, values); },
    async remove(key) { delete stored[key]; },
    onChanged: { addListener: handler => changes.push(handler) }
  };
  const calls = { readHtml: 0, saved: [], writeHtml: [], messages: [], layouts: 0, commands: [] };
  const Clip = {
    async readHtml() {
      calls.readHtml++;
      if (typeof clipboard === "function") return clipboard();
      return FIXTURE_HTML;
    },
    record: html => ({ id: "fig-1", type: "figma-clip", html, label: "Figma copy · 1 kB" }),
    async saveClip(_storage, entry) { calls.saved.push(entry); return [entry]; },
    async readAll() { return []; },
    async removeClip() { return []; },
    async writeHtml(_navigator, _Item, html) { calls.writeHtml.push(html); }
  };
  const raster = { value: null };
  const canvas = { recentRaster: () => raster.value };

  const designSystem = {
    scanPage: () => "scan",
    attach(controller) { calls.designSystemController = controller; return "attached"; }
  };

  const sandbox = {
    console,
    setTimeout,
    clearInterval,
    setInterval,
    AbortController,
    MutationObserver: class { observe() {} disconnect() {} },
    getComputedStyle: () => ({ fontFamily: "Inter" }),
    getSelection: () => ({ selectAllChildren() {} }),
    ClipboardItem: class {},
    navigator: { clipboard: {} },
    innerWidth: width,
    innerHeight: height,
    document: doc,
    PageCaptureFigmaClip: Clip,
    PageCaptureCanvas: canvas,
    PageCaptureCore: { capturesKey: id => `figma_h2d_toolbar_captures_${id}` },
    PageCaptureDesignSystem: designSystem,
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
  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(read("js/figma-bridge.js"), context);
  return { Bridge: sandbox.PageCaptureFigmaBridge, doc, calls, storage, changes, sandbox, raster, designSystem };
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
    dispatchActionById() {},
    layouts: 0,
    messages: []
  };
  return controller;
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const settle = async () => { for (let index = 0; index < 4; index++) await flush(); };

function canvasRect(x, y, width, height) {
  return { getBoundingClientRect: () => ({ x, y, width, height, top: y, left: x, right: x + width, bottom: y + height }) };
}

/* ---------------------------------------------------------------- tests -- */

test("Coverage counts only what a canvas actually paints in the viewport", () => {
  const env = harness({ width: 1000, height: 500, canvases: [canvasRect(0, 0, 1000, 500)] });
  assert.equal(env.Bridge.canvasCoverage(env.doc, { innerWidth: 1000, innerHeight: 500 }), 1);
  const half = harness({ width: 1000, height: 500, canvases: [canvasRect(0, 0, 500, 500)] });
  assert.equal(half.Bridge.canvasCoverage(half.doc, { innerWidth: 1000, innerHeight: 500 }), 0.5);
  const outside = harness({ width: 1000, height: 500, canvases: [canvasRect(2000, 0, 500, 500)] });
  assert.equal(outside.Bridge.canvasCoverage(outside.doc, { innerWidth: 1000, innerHeight: 500 }), 0);
  assert.equal(env.Bridge.isCanvasHeavy(0.5), true);
  assert.equal(env.Bridge.isCanvasHeavy(0.49), false);
});

test("Raster notes map to an explanation, unknown notes to none", () => {
  const env = harness();
  assert.equal(env.Bridge.rasterTextKey({ kind: "replaced" }), "figmaBridgeRasterReplaced");
  assert.equal(env.Bridge.rasterTextKey({ kind: "resized" }), "figmaBridgeRasterResized");
  assert.equal(env.Bridge.rasterTextKey({ kind: "blank" }), "figmaBridgeRasterBlank");
  assert.equal(env.Bridge.rasterTextKey(null), "");
  assert.equal(env.Bridge.rasterTextKey({ kind: "surprise" }), "");
});

test("The flag is opt-out, so the branch build shows the entry by default", () => {
  const env = harness({ stored: {} });
  assert.equal(env.Bridge.isEnabled({}), true);
  assert.equal(env.Bridge.isEnabled({ figma_h2d_figma_bridge: true }), true);
  assert.equal(env.Bridge.isEnabled({ figma_h2d_figma_bridge: false }), false);
});

test("The hook wraps the design-system seam and keeps its return value", () => {
  const env = harness();
  const controller = makeController();
  const wrapped = env.sandbox.PageCaptureDesignSystem;
  assert.equal(typeof wrapped.attach, "function");
  assert.equal(wrapped.scanPage(), "scan");
  assert.equal(wrapped.attach(controller, { copy: true }), "attached");
  assert.equal(env.calls.designSystemController, controller, "the original attach still runs");
});

test("A canvas-heavy page gets one experimental entry beside the tools", async () => {
  const env = harness({ canvases: [canvasRect(0, 0, 1200, 800)] });
  const controller = makeController();
  controller.layouts = 0;
  env.sandbox.PageCaptureDesignSystem.attach(controller);
  await settle();
  const buttons = controller.tools.querySelectorAll("[data-figma-bridge]");
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].getAttribute("aria-haspopup"), "dialog");
  assert.match(buttons[0].getAttribute("aria-label"), /Figma/);
  assert.match(buttons[0].title, /Experimental/);
  assert.equal(controller.layouts, 1, "the action bar is told to re-layout");
});

test("A page without a canvas stays untouched until a capture needs a raster", async () => {
  const env = harness({ canvases: [canvasRect(0, 0, 40, 40)] });
  const controller = makeController();
  env.sandbox.PageCaptureDesignSystem.attach(controller);
  await settle();
  assert.equal(controller.tools.querySelectorAll("[data-figma-bridge]").length, 0);

  env.raster.value = { kind: "replaced", at: Date.now() };
  const key = "figma_h2d_toolbar_captures_7";
  for (const handler of env.changes) handler({ [key]: { oldValue: [], newValue: [{ id: "a", type: "snapshot" }] } }, "local");
  await settle();
  assert.equal(controller.tools.querySelectorAll("[data-figma-bridge]").length, 1, "the capture brings the entry back");
  assert.equal(controller.messages.length, 1);
  assert.equal(controller.messages[0].tone, "info");
});

test("A raster capture marks the entry, and opening it clears the mark", async () => {
  const env = harness({ canvases: [canvasRect(0, 0, 40, 40)] });
  const controller = makeController();
  env.sandbox.PageCaptureDesignSystem.attach(controller);
  await settle();
  assert.equal(controller.tools.querySelectorAll("[data-figma-bridge]").length, 0, "nothing to mark yet");
  env.raster.value = { kind: "resized", at: Date.now() };
  for (const handler of env.changes) handler({ figma_h2d_toolbar_captures_7: { oldValue: [], newValue: [{ id: "a", type: "snapshot" }] } }, "local");
  await settle();
  const trigger = controller.tools.querySelector("[data-figma-bridge]");
  assert.equal(trigger.querySelectorAll("[data-figma-bridge-dot]").length, 1);
  trigger.dispatch("click");
  assert.equal(trigger.querySelectorAll("[data-figma-bridge-dot]").length, 0, "opening clears the mark");
});

test("Opening the entry renders an experimental panel with a local-only footer", async () => {
  const env = harness({ canvases: [canvasRect(0, 0, 1200, 800)] });
  const controller = makeController();
  env.sandbox.PageCaptureDesignSystem.attach(controller);
  await settle();
  const trigger = controller.tools.querySelector("[data-figma-bridge]");
  trigger.dispatch("click");
  assert.equal(trigger.getAttribute("aria-expanded"), "true");
  const host = env.doc.body.children.find(child => child.id === env.Bridge.HOST_ID);
  assert.ok(host, "the panel lives in its own host");
  assert.equal(host.getAttribute("data-h2d-ignore"), "true", "captures skip it");
  assert.ok(host.shadowRoot.querySelector("button.primary"));
  assert.ok(host.shadowRoot.textContent.includes("Experimental"));
  assert.ok(host.shadowRoot.textContent.includes("Stored locally only"));

  const primary = host.shadowRoot.querySelector("button.primary");
  primary.dispatch("click");
  await settle();
  assert.equal(env.calls.readHtml, 1, "one clipboard read per click");
  assert.equal(env.calls.saved.length, 1);
  assert.equal(env.calls.saved[0].type, "figma-clip");
});

test("The entry toggles closed on a second click and hides the host with it", async () => {
  const env = harness({ canvases: [canvasRect(0, 0, 1200, 800)] });
  const controller = makeController();
  env.sandbox.PageCaptureDesignSystem.attach(controller);
  await settle();
  const trigger = controller.tools.querySelector("[data-figma-bridge]");
  trigger.dispatch("click");
  assert.ok(env.doc.body.children.some(child => child.id === env.Bridge.HOST_ID));
  trigger.dispatch("click");
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  assert.ok(!env.doc.body.children.some(child => child.id === env.Bridge.HOST_ID), "the host is removed, not left empty");
});

test("Hide switches the feature off for this profile and drops the entry", async () => {
  const env = harness({ canvases: [canvasRect(0, 0, 1200, 800)] });
  const controller = makeController();
  env.sandbox.PageCaptureDesignSystem.attach(controller);
  await settle();
  controller.tools.querySelector("[data-figma-bridge]").dispatch("click");
  const host = env.doc.body.children.find(child => child.id === env.Bridge.HOST_ID);
  const hide = host.shadowRoot.querySelectorAll("button").at(-1);
  hide.dispatch("click");
  await settle();
  assert.equal(env.storage.get && (await env.storage.get("figma_h2d_figma_bridge")).figma_h2d_figma_bridge, false);
  assert.equal(controller.tools.querySelectorAll("[data-figma-bridge]").length, 0);
});

test("A refused clipboard read explains the permission instead of failing silently", async () => {
  const env = harness({
    canvases: [canvasRect(0, 0, 1200, 800)],
    clipboard: () => { throw Object.assign(new Error("denied"), { code: "clipboard_denied" }); }
  });
  const controller = makeController();
  env.sandbox.PageCaptureDesignSystem.attach(controller);
  await settle();
  controller.tools.querySelector("[data-figma-bridge]").dispatch("click");
  env.doc.body.children.find(child => child.id === env.Bridge.HOST_ID).shadowRoot.querySelector("button.primary").dispatch("click");
  await settle();
  const host = env.doc.body.children.find(child => child.id === env.Bridge.HOST_ID);
  assert.ok(host.shadowRoot.textContent.includes("Clipboard access is off"));
  assert.equal(env.calls.saved.length, 0);
});

test("Without clipboard permission the paste command is still tried once", async () => {
  const env = harness({
    canvases: [canvasRect(0, 0, 1200, 800)],
    clipboard: () => { throw Object.assign(new Error("denied"), { code: "clipboard_denied" }); },
    execPaste: FIXTURE_HTML
  });
  const controller = makeController();
  env.sandbox.PageCaptureDesignSystem.attach(controller);
  await settle();
  controller.tools.querySelector("[data-figma-bridge]").dispatch("click");
  env.doc.body.children.find(child => child.id === env.Bridge.HOST_ID).shadowRoot.querySelector("button.primary").dispatch("click");
  await settle();
  assert.equal(env.calls.saved.length, 1, "the paste fallback recovered the payload");
  assert.equal(env.calls.saved[0].html, FIXTURE_HTML);
});

test("Attaching twice still mounts one entry", async () => {
  const env = harness({ canvases: [canvasRect(0, 0, 1200, 800)] });
  const controller = makeController();
  env.sandbox.PageCaptureDesignSystem.attach(controller);
  await settle();
  env.Bridge.attach(controller);
  await settle();
  assert.equal(controller.tools.querySelectorAll("[data-figma-bridge]").length, 1);
});

test("Disabling the flag removes the entry and writes no copy", async () => {
  const env = harness({ canvases: [canvasRect(0, 0, 1200, 800)], stored: { figma_h2d_figma_bridge: false } });
  const controller = makeController();
  env.sandbox.PageCaptureDesignSystem.attach(controller);
  await settle();
  assert.equal(controller.tools.querySelectorAll("[data-figma-bridge]").length, 0);
  assert.deepEqual(env.calls.commands, [], "nothing is even asked of the background page");
});

/* -------------------------------------------------------------- wiring -- */

test("The bridge loads before the toolbar and the generated bundle stays untouched", () => {
  const list = /files:\s*\[([^\]]+)\]/.exec(read("js/background.js"))[1];
  const order = Array.from(list.matchAll(/"([^"]+)"/g), match => match[1]);
  for (const file of ["js/figma-clip.js", "js/figma-bridge.js"]) assert.ok(order.includes(file), `${file} is injected`);
  assert.ok(order.indexOf("js/design-system.js") < order.indexOf("js/figma-bridge.js"), "the seam exists first");
  assert.ok(order.indexOf("js/figma-clip.js") < order.indexOf("js/figma-bridge.js"));
  assert.ok(order.indexOf("js/figma-bridge.js") < order.indexOf("js/h2d_toolbar.js"));
  assert.doesNotMatch(read("js/h2d_toolbar.js"), /PageCaptureFigmaBridge/, "no hand edit to the bundle");
  assert.doesNotMatch(read("js/h2d_toolbar.js"), /figma-bridge/);
});

test("The bridge adds no page-level RPC of its own", () => {
  const background = read("js/background.js");
  const commands = /const handlers = Object\.freeze\(\{([\s\S]*?)\n\}\);/.exec(background)[1];
  const names = Array.from(commands.matchAll(/^\s{2}([A-Z0-9_]+):/gm), match => match[1]);
  assert.deepEqual(names, [
    "H2D_GET_TAB_ID", "H2D_OPEN_TOOLBAR", "H2D_CAPTURE_VISIBLE_TAB", "H2D_CAPTURE_ELEMENT_PREVIEW",
    "H2D_CAPTURE_REGION_RASTER", "H2D_FETCH_ASSETS", "H2D_TOOLBAR_CLOSED"
  ]);
  const bridge = read("js/figma-bridge.js");
  const sent = Array.from(bridge.matchAll(/cmd:\s*"(H2D_[A-Z0-9_]+)"/g), match => match[1]);
  assert.deepEqual(sent, ["H2D_GET_TAB_ID"], "the bridge only asks which tab it is in");
});

test("Every string the bridge shows exists in the locale file", () => {
  const messages = JSON.parse(read("_locales/en/messages.json"));
  const bridge = read("js/figma-bridge.js");
  const keys = new Set(Array.from(bridge.matchAll(/"(figmaBridge[A-Za-z]+)"/g), match => match[1]));
  assert.ok(keys.size >= 10, "the bridge has its own copy");
  for (const key of keys) assert.ok(messages[key], `${key} is missing from messages.json`);
  for (const key of ["figmaBridgeExperimental", "figmaBridgeImport", "figmaBridgeTitle"]) assert.ok(keys.has(key));
});
