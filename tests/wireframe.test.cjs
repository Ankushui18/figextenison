'use strict';
// Wireframe planning, rendering and copy path. Runs against the shipped files
// in a vm context with a small dependency-free DOM, so no browser is needed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..', 'extension');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

/* ----------------------------------------------------------- mini DOM ---- */

const DEFAULT_STYLE = {
  display: 'block', visibility: 'visible', opacity: '1', contentVisibility: 'visible', position: 'static',
  fontSize: '16px', fontWeight: '400', lineHeight: '24px', fontFamily: '"Helvetica Neue", Arial, sans-serif',
  textAlign: 'left', textTransform: 'none', fontStyle: 'normal', textDecorationLine: 'none', letterSpacing: 'normal',
  backgroundColor: 'rgba(0, 0, 0, 0)', borderTopStyle: 'none', borderTopWidth: '0px', borderRightWidth: '0px',
  borderBottomWidth: '0px', borderLeftWidth: '0px', borderTopLeftRadius: '0px', borderBottomRightRadius: '0px',
  borderTopColor: 'rgb(0, 0, 0)', boxShadow: 'none', backgroundImage: 'none', overflow: 'visible', overflowY: 'visible',
  color: 'rgb(17, 17, 17)'
};

class ClassList {
  constructor(owner) { this.owner = owner; }
  *[Symbol.iterator]() { return String(this.owner.className || '').split(/\s+/).filter(Boolean)[Symbol.iterator](); }
  contains(name) { return String(this.owner.className || '').split(/\s+/).includes(name); }
  toggle(name, force) {
    const names = String(this.owner.className || '').split(/\s+/).filter(Boolean).filter(entry => entry !== name);
    if (force !== false) names.push(name);
    this.owner.className = names.join(' ');
    return force !== false;
  }
}

class FakeText {
  constructor(value, rects = []) { this.nodeType = 3; this.nodeValue = value; this.rects = rects; this.parentNode = null; }
}

class FakeElement {
  constructor(tag, document) {
    this.nodeType = 1;
    this.tagName = String(tag).toUpperCase();
    this.localName = String(tag).toLowerCase();
    this.ownerDocument = document;
    this.style = {};
    this.attributes = {};
    this.children = [];
    this.childNodes = [];
    this.parentNode = null;
    this.className = '';
    this.classList = new ClassList(this);
    this.dataset = {};
    this.id = '';
    this.shadowRoot = null;
    this._listeners = new Map();
    this._rect = { left: 0, top: 0, width: 0, height: 0 };
    this.computed = null;
    this.open = false;
    this.clientWidth = 640;
    this.scrollTop = 0;
  }
  get childElementCount() { return this.children.length; }
  get isConnected() {
    let node = this;
    while (node.parentNode) node = node.parentNode;
    return node === this.ownerDocument || node?.nodeType === 9;
  }
  get textContent() {
    return this.childNodes.map(child => child.nodeType === 3 ? child.nodeValue : child.textContent).join('');
  }
  set textContent(value) {
    this.childNodes = []; this.children = [];
    if (value !== '' && value != null) this.append(new FakeText(String(value)));
  }
  setAttribute(name, value) { this.attributes[name] = String(value); if (name === 'id') this.id = String(value); }
  getAttribute(name) { return Object.hasOwn(this.attributes, name) ? this.attributes[name] : null; }
  hasAttribute(name) { return Object.hasOwn(this.attributes, name); }
  removeAttribute(name) { delete this.attributes[name]; }
  append(...nodes) {
    for (const node of nodes) {
      node.parentNode = this;
      this.childNodes.push(node);
      if (node.nodeType === 1) this.children.push(node);
    }
  }
  replaceChildren(...nodes) {
    this.childNodes = []; this.children = [];
    this.append(...nodes);
  }
  remove() {
    if (!this.parentNode) return;
    this.parentNode.childNodes = this.parentNode.childNodes.filter(node => node !== this);
    this.parentNode.children = this.parentNode.children.filter(node => node !== this);
    this.parentNode = null;
  }
  appendChild(node) { this.append(node); return node; }
  attachShadow(options) {
    const shadow = new FakeElement('#shadow-root', this.ownerDocument);
    shadow.parentNode = this;
    this._shadow = shadow;
    this.shadowRoot = options?.mode === 'open' ? shadow : null;
    return shadow;
  }
  addEventListener(type, listener) {
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push(listener);
  }
  removeEventListener(type, listener) {
    this._listeners.set(type, (this._listeners.get(type) || []).filter(entry => entry !== listener));
  }
  dispatch(type, event = {}) {
    for (const listener of this._listeners.get(type) || []) listener({ type, preventDefault() {}, stopPropagation() {}, ...event });
  }
  click() { this.dispatch('click'); }
  focus() { this.ownerDocument.activeElement = this; }
  showModal() { this.open = true; }
  close() { this.open = false; }
  getBoundingClientRect() { return this._rect; }
  querySelector(selector) {
    const match = /^\[([a-z-]+)(?:="([^"]*)")?\]$/.exec(selector);
    if (!match) return null;
    const [, name, value] = match;
    const stack = [...this.children];
    while (stack.length) {
      const node = stack.shift();
      const attribute = node.getAttribute(name);
      if (attribute != null && (value === undefined || attribute === value)) return node;
      stack.push(...node.children);
    }
    return null;
  }
  querySelectorAll(selector) {
    const results = [];
    const match = /^\[([a-z-]+)(?:="([^"]*)")?\]$/.exec(selector);
    if (!match) return results;
    const stack = [...this.children];
    while (stack.length) {
      const node = stack.shift();
      const attribute = node.getAttribute(match[1]);
      if (attribute != null && (match[2] === undefined || attribute === match[2])) results.push(node);
      stack.push(...node.children);
    }
    return results;
  }
}

class FakeDocument {
  constructor({ width = 1200, height = 2000 } = {}) {
    this.nodeType = 9;
    this.title = 'Fixture page';
    this.head = new FakeElement('head', this);
    this.body = new FakeElement('body', this);
    this.documentElement = new FakeElement('html', this);
    this.documentElement.parentNode = this;
    this.documentElement.append(this.head, this.body);
    this.documentElement.clientWidth = width;
    this.documentElement.scrollWidth = width;
    this.documentElement.scrollHeight = height;
    this.body.scrollWidth = width;
    this.body.scrollHeight = height;
    this.title = 'Fixture page';
    this.activeElement = null;
    this._shadow = null;
  }
  createElement(tag) {
    const node = new FakeElement(tag, this);
    if (String(tag).toLowerCase() === 'iframe') {
      const inner = new FakeDocument({ width: 320, height: 480 });
      inner.documentElement.style = {};
      inner.body.style = {};
      node.contentDocument = inner;
    }
    return node;
  }
  createElementNS(namespace, tag) { return new FakeElement(tag, this); }
  createTextNode(value) { return new FakeText(String(value)); }
  createRange() {
    return {
      node: null,
      selectNodeContents(node) { this.node = node; },
      getClientRects() { return this.node?.rects || []; },
      detach() {}
    };
  }
  querySelector() { return null; }
  addEventListener() {}
  removeEventListener() {}
}

/* ------------------------------------------------------------- harness --- */

function harness(options = {}) {
  const document = options.document || new FakeDocument();
  const writes = [];
  const clipboard = {
    async write(items) {
      writes.push(items);
      if (options.write) return options.write(items);
      return undefined;
    },
    async writeText() {}
  };
  const context = vm.createContext({
    URL, Blob, AbortController, AbortSignal, DOMException, document,
    location: { href: 'https://fixture.test/page' },
    window: { innerWidth: 1200, innerHeight: 900, scrollX: 0, scrollY: 0, addEventListener() {}, removeEventListener() {} },
    navigator: { clipboard },
    ClipboardItem: class { constructor(formats) { this.formats = formats; this.types = Object.keys(formats); } },
    getComputedStyle: element => element?.computed || DEFAULT_STYLE,
    requestAnimationFrame: callback => setTimeout(callback, 0),
    performance,
    setTimeout, clearTimeout, console
  });
  context.globalThis = context;
  vm.runInContext(read('js/design-system-core.js'), context);
  vm.runInContext(read('js/design-system-board.js'), context);
  vm.runInContext(read('js/wireframe-core.js'), context);
  vm.runInContext(read('js/wireframe.js'), context);
  return { context, document, writes, clipboard, Core: context.PageCaptureWireframeCore, Wireframe: context.PageCaptureWireframe };
}

/* Fixture helpers: every element carries a fake computed style and rect, and
 * every text node carries the client rects a Range would report. */
function pageElement(document, tag, { rect, computed = {}, children = [], text = null, textRects = null, attributes = {} } = {}) {
  const node = document.createElement(tag);
  node._rect = { left: rect[0], top: rect[1], width: rect[2], height: rect[3] };
  node.computed = { ...DEFAULT_STYLE, ...computed };
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  if (text != null) node.append(new FakeText(text, (textRects || [rect]).map(([left, top, width, height]) => ({ left, top, width, height }))));
  for (const child of children) node.append(child);
  return node;
}

function fixturePage(document) {
  const body = document.body;
  const headingText = pageElement(document, 'span', { rect: [40, 40, 260, 40], text: 'Welcome to the studio' });
  const header = pageElement(document, 'header', {
    rect: [0, 0, 1200, 120], computed: { backgroundColor: 'rgb(250, 250, 250)' }, children: [headingText]
  });
  const paragraphText = pageElement(document, 'span', {
    rect: [40, 180, 520, 24],
    text: 'We design calm interfaces for teams that ship.'
  });
  const paragraph = pageElement(document, 'p', { rect: [40, 170, 520, 48], children: [paragraphText] });
  const image = pageElement(document, 'img', {
    rect: [680, 170, 320, 200], attributes: { alt: 'Dashboard preview' }
  });
  const buttonText = pageElement(document, 'span', { rect: [40, 420, 96, 20], text: 'Start a project' });
  const button = pageElement(document, 'button', {
    rect: [40, 404, 168, 48],
    computed: { backgroundColor: 'rgb(13, 153, 255)', borderTopLeftRadius: '8px', borderTopWidth: '0px' },
    children: [buttonText]
  });
  const main = pageElement(document, 'main', {
    rect: [0, 120, 1200, 1000], children: [paragraph, image, button]
  });
  body.append(header, main);
  return { header, main, image, button };
}

/* ----------------------------------------------------------- core tests -- */

test('Three wireframe levels are offered with plain-language descriptions', () => {
  const { Core } = harness();
  assert.deepEqual(Array.from(Core.LEVELS.map(level => level.id)), ['low', 'medium', 'high']);
  for (const level of Core.LEVELS) {
    assert.ok(level.label.length > 0 && level.title.length > 0 && level.description.length > 12, level.id);
  }
  assert.equal(Core.normalizeOptions({}).level, 'medium');
  assert.equal(Core.normalizeOptions({ level: 'ultra' }).level, 'medium');
  assert.equal(Core.normalizeOptions({ area: 'viewport' }).area, 'viewport');
  assert.equal(Core.normalizeOptions({ area: 'full' }).area, 'page');
});

test('Colours are parsed from every serialisation Chrome produces', () => {
  const { Core } = harness();
  assert.deepEqual({ ...Core.parseColor('rgb(255, 0, 0)') }, { r: 255, g: 0, b: 0, a: 1 });
  assert.deepEqual({ ...Core.parseColor('rgba(0, 0, 0, 0.25)') }, { r: 0, g: 0, b: 0, a: 0.25 });
  assert.deepEqual({ ...Core.parseColor('#0d99ff') }, { r: 13, g: 153, b: 255, a: 1 });
  assert.deepEqual({ ...Core.parseColor('#fff') }, { r: 255, g: 255, b: 255, a: 1 });
  assert.deepEqual({ ...Core.parseColor('color(srgb 0.5 0.25 1 / 0.5)') }, { r: 127.5, g: 63.75, b: 255, a: 0.5 });
  assert.equal(Core.parseColor('transparent'), null);
  assert.equal(Core.parseColor('nonsense'), null);
  assert.equal(Core.parseColor(null), null);
});

test('Tone mapping keeps light pages light and dark sections darker', () => {
  const { Core } = harness();
  assert.equal(Core.fillTone(Core.parseColor('rgb(255, 255, 255)'), 'high'), null);
  assert.equal(Core.fillTone(Core.parseColor('rgba(0, 0, 0, 0)'), 'high'), null);
  const dark = Core.fillTone(Core.parseColor('rgb(12, 12, 12)'), 'high');
  const mid = Core.fillTone(Core.parseColor('rgb(120, 120, 120)'), 'high');
  assert.ok(dark && mid && dark < mid, `${dark} < ${mid}`);
  const lightText = Core.textTone(Core.parseColor('rgb(20, 20, 20)'), '#ffffff', 'high');
  const darkText = Core.textTone(Core.parseColor('rgb(240, 240, 240)'), '#2b2b2b', 'high');
  assert.ok(Core.contrast(Core.parseColor(lightText), Core.parseColor('#ffffff')) >= 3);
  assert.ok(Core.contrast(Core.parseColor(darkText), Core.parseColor('#2b2b2b')) >= 3);
});

test('A page without layers is refused instead of producing an empty copy', () => {
  const { Core } = harness();
  assert.throws(() => Core.validatePage(null), /no scanned page/);
  assert.throws(() => Core.validatePage({ area: { width: 0, height: 0 } }), /capture area/);
  assert.throws(() => Core.validatePage({ area: { width: 10, height: 10 }, nodes: null }), /no layers/);
  assert.throws(() => Core.validatePage({ area: { width: 9999, height: 10 }, nodes: [] }), /larger/);
});

test('Nested pages keep relative geometry and layer names stay unique', () => {
  const { Core } = harness();
  const plan = Core.buildPlan({
    area: { width: 800, height: 600 },
    nodes: [
      { kind: 'box', parent: -1, x: 0, y: 0, w: 800, h: 600, name: 'Section', painted: true },
      { kind: 'box', parent: 0, x: 40, y: 40, w: 720, h: 200, name: 'Card', painted: true },
      { kind: 'box', parent: 0, x: 40, y: 280, w: 720, h: 200, name: 'Card', painted: true }
    ]
  }, { level: 'medium' });
  assert.equal(plan.root.children.length, 1);
  const section = plan.root.children[0];
  assert.deepEqual({ x: section.x, y: section.y, w: section.w, h: section.h }, { x: 0, y: 0, w: 800, h: 600 });
  assert.equal(section.children.length, 2);
  assert.deepEqual({ x: section.children[0].x, y: section.children[0].y }, { x: 40, y: 40 });
  assert.deepEqual({ x: section.children[1].x, y: section.children[1].y }, { x: 40, y: 280 });
  assert.deepEqual(Array.from(section.children, block => block.name), ['Card', 'Card 2']);
  assert.equal(plan.stats.blocks, 3);
});

test('Content outside a clipping parent is dropped, not floated outside it', () => {
  const { Core } = harness();
  const plan = Core.buildPlan({
    area: { width: 400, height: 400 },
    nodes: [
      { kind: 'box', parent: -1, x: 0, y: 0, w: 400, h: 200, name: 'Scroller', painted: true, clip: true },
      { kind: 'box', parent: 0, x: 0, y: 900, w: 400, h: 100, name: 'Hidden row', painted: true }
    ]
  }, { level: 'medium' });
  assert.equal(plan.root.children.length, 1);
  assert.equal(plan.root.children[0].children.length, 0);
  assert.equal(plan.stats.skipped, 1);
});

test('Low keeps structure: text becomes bars, nothing editable is invented', () => {
  const { Core } = harness();
  const plan = Core.buildPlan({
    area: { width: 600, height: 400 },
    nodes: [
      { kind: 'text', parent: -1, x: 20, y: 20, w: 300, h: 48, text: 'A headline over two lines', name: 'Heading', color: 'rgb(0, 0, 0)', font: { size: 24, weight: 700, lineHeight: 24 } }
    ]
  }, { level: 'low' });
  const block = plan.root.children[0];
  assert.equal(block.text, null);
  assert.equal(block.bars.length, 2);
  for (const bar of block.bars) {
    assert.ok(bar.w <= block.w && bar.h >= 4 && bar.color.startsWith('#'));
  }
  assert.equal(plan.stats.bars, 2);
  assert.equal(plan.stats.textLayers, 1);
});

test('Medium uses real text in a neutral font and caps radii', () => {
  const { Core } = harness();
  const plan = Core.buildPlan({
    area: { width: 600, height: 400 },
    nodes: [
      { kind: 'box', parent: -1, x: 0, y: 0, w: 600, h: 200, name: 'Card', painted: true, radius: 40, background: 'rgb(245, 245, 245)' },
      { kind: 'text', parent: 0, x: 20, y: 20, w: 200, h: 24, text: 'Card title', name: 'Heading · Card title', color: 'rgb(0, 0, 0)', font: { size: 22, weight: 700, lineHeight: 26, family: '"Brand Serif", Georgia, serif' } }
    ]
  }, { level: 'medium' });
  const card = plan.root.children[0];
  assert.equal(card.radius, 6);
  const text = card.children[0].text;
  assert.equal(text.value, 'Card title');
  assert.equal(text.family, Core.NEUTRAL_FONT);
  assert.equal(text.size, 22);
  assert.equal(text.weight, 700);
});

test('High keeps the page font, radii and a greyed-out shadow', () => {
  const { Core } = harness();
  const plan = Core.buildPlan({
    area: { width: 600, height: 400 },
    nodes: [
      {
        kind: 'box', parent: -1, x: 0, y: 0, w: 600, h: 200, name: 'Card', painted: true, radius: 24,
        shadow: 'rgba(13, 153, 255, 0.4) 0px 8px 24px 0px', background: 'rgb(255, 255, 255)'
      },
      { kind: 'text', parent: 0, x: 20, y: 20, w: 200, h: 24, text: 'Card title', name: 'Heading · Card title', color: 'rgb(20, 20, 20)', font: { size: 22, weight: 600, lineHeight: 26, family: '"Brand Serif", Georgia, serif', spacing: 0.5 } }
    ]
  }, { level: 'high' });
  const card = plan.root.children[0];
  assert.equal(card.radius, 24);
  assert.match(card.shadow, /rgba\(0, 0, 0, 0\.12\) 0px 8px 24px 0px/);
  const text = card.children[0].text;
  assert.match(text.family, /Brand Serif/);
  assert.equal(text.spacing, 0.5);
});

test('Media becomes a labelled placeholder, never an image', () => {
  const { Core } = harness();
  const plan = Core.buildPlan({
    area: { width: 600, height: 400 },
    nodes: [
      { kind: 'media', parent: -1, x: 20, y: 20, w: 320, h: 200, name: 'Image', label: 'Dashboard preview', radius: 12 },
      { kind: 'media', parent: -1, x: 400, y: 20, w: 24, h: 24, name: 'Icon', label: 'Icon', icon: true },
      { kind: 'media', parent: -1, x: 400, y: 80, w: 40, h: 40, name: 'Avatar', label: 'Avatar', avatar: true }
    ]
  }, { level: 'medium' });
  const [image, icon, avatar] = plan.root.children;
  assert.equal(image.marks, 'plus');
  assert.equal(image.label, 'Dashboard preview');
  assert.equal(icon.marks, null);
  assert.equal(icon.label, null);
  assert.equal(avatar.radius, 9999);
  assert.equal(avatar.label, null);
  assert.equal(plan.stats.placeholders, 3);
});

test('A plan is deterministic and reports its own limits', () => {
  const { Core } = harness();
  const page = {
    area: { width: 800, height: 600 },
    nodes: Array.from({ length: 60 }, (_, index) => ({
      kind: 'box', parent: -1, x: index, y: index, w: 40, h: 40, name: 'Cell', painted: true
    }))
  };
  const first = Core.buildPlan(page, { level: 'medium' });
  const second = Core.buildPlan(page, { level: 'medium' });
  assert.deepEqual(JSON.parse(JSON.stringify(first)), JSON.parse(JSON.stringify(second)));
  assert.equal(first.stats.blocks, 60);
  const summary = Core.summarize(first);
  assert.equal(summary.blocks, 60);
  assert.equal(summary.level, 'medium');
  assert.equal(summary.width, 800);
  assert.equal(summary.truncated, false);
});

test('Links keep an underline and gradient surfaces keep a light tone', () => {
  const { Core } = harness();
  const plan = Core.buildPlan({
    area: { width: 600, height: 400 },
    nodes: [
      { kind: 'box', parent: -1, x: 0, y: 0, w: 600, h: 200, name: 'Hero', gradient: true, painted: true },
      { kind: 'text', parent: 0, x: 20, y: 20, w: 160, h: 24, text: 'Read the story', name: 'Text', link: true, color: 'rgb(13, 153, 255)', font: { size: 14, weight: 500, lineHeight: 24, decoration: 'none' } }
    ]
  }, { level: 'medium' });
  const hero = plan.root.children[0];
  assert.equal(hero.fill, '#f3f3f3');
  assert.equal(hero.children[0].text.decoration, 'underline');
  const plain = Core.buildPlan({
    area: { width: 200, height: 100 },
    nodes: [{ kind: 'text', parent: -1, x: 0, y: 0, w: 120, h: 20, text: 'Body', name: 'Text', font: { size: 14, weight: 400, lineHeight: 20, decoration: 'none' } }]
  }, { level: 'medium' });
  assert.equal(plain.root.children[0].text.decoration, 'none');
});

/* -------------------------------------------------------------- scanning - */

test('Scanning measures the page without mutating it', () => {
  const document = new FakeDocument();
  fixturePage(document);
  const { Wireframe } = harness({ document });
  const before = JSON.stringify(document.body.childNodes.map(node => node.tagName || node.nodeType));
  const page = Wireframe.scanPage({ area: 'page' });
  assert.equal(page.mode, 'page');
  assert.equal(page.area.width, 1200);
  assert.equal(page.area.height, 2000);
  assert.ok(page.nodes.some(node => node.kind === 'text' && node.text.includes('Welcome')));
  assert.ok(page.nodes.some(node => node.kind === 'media' && node.label === 'Dashboard preview'));
  assert.ok(page.nodes.some(node => node.kind === 'control'));
  assert.ok(page.nodes.every(node => Number.isFinite(node.x) && Number.isFinite(node.y)));
  assert.equal(JSON.stringify(document.body.childNodes.map(node => node.tagName || node.nodeType)), before);
});

test('Viewport scanning clips to the visible area', () => {
  const document = new FakeDocument();
  fixturePage(document);
  document.documentElement.clientWidth = 1200;
  const { Wireframe, context } = harness({ document });
  context.window.innerWidth = 1200;
  context.window.innerHeight = 300;
  const page = Wireframe.scanPage({ area: 'viewport' });
  assert.equal(page.mode, 'viewport');
  assert.equal(page.area.height, 300);
  assert.ok(page.nodes.every(node => node.y < 300));
});

test('Scrolled-out content stays out of the board even when the scroller is not kept', () => {
  const document = new FakeDocument();
  // A wrapper exactly covering the page is dropped, but its overflow must still
  // clip: the child below the fold is not visible and must not become a layer.
  const hidden = pageElement(document, 'div', { rect: [0, 0, 1200, 400], text: null });
  const scroller = pageElement(document, 'div', {
    rect: [0, 0, 1200, 400],
    computed: { overflowY: 'auto', overflow: 'auto' },
    children: [
      pageElement(document, 'p', { rect: [0, 420, 400, 24], text: 'Row below the fold' })
    ]
  });
  document.body.append(scroller, hidden);
  const { Wireframe } = harness({ document });
  const page = Wireframe.scanPage({ area: 'page' });
  assert.equal(page.nodes.some(node => node.text === 'Row below the fold'), false);
  assert.equal(page.nodes.filter(node => node.kind === 'text').length, 0);
});

test('Fixed bars are anchored to the top of a full-page wireframe', () => {
  const document = new FakeDocument();
  document.body.append(pageElement(document, 'nav', {
    rect: [0, 640, 1200, 60],
    computed: { position: 'fixed', backgroundColor: 'rgb(30, 30, 30)' }
  }));
  const { Wireframe, context } = harness({ document });
  context.window.scrollY = 640;
  const scrolled = Wireframe.scanPage({ area: 'page' });
  assert.equal(scrolled.nodes[0].y, 0);
  const viewport = Wireframe.scanPage({ area: 'viewport' });
  assert.equal(viewport.nodes[0].y, 640);
});

test('Open shadow roots are scanned like ordinary children', () => {
  const document = new FakeDocument();
  const host = pageElement(document, 'div', { rect: [0, 0, 600, 200] });
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.append(pageElement(document, 'p', { rect: [10, 10, 300, 24], text: 'Inside the shadow root' }));
  document.body.append(host);
  const { Wireframe } = harness({ document });
  const page = Wireframe.scanPage({ area: 'page' });
  assert.ok(page.nodes.some(node => node.text === 'Inside the shadow root'));
});

test('A page above the block budget reports itself as truncated', () => {
  const { Core } = harness();
  const nodes = Array.from({ length: Core.LIMITS.blocks + 40 }, (_, index) => ({
    kind: 'box', parent: -1, x: index % 100, y: Math.floor(index / 100), w: 20, h: 20, name: 'Cell', painted: true
  }));
  const plan = Core.buildPlan({ area: { width: 800, height: 600 }, nodes }, { level: 'low' });
  assert.equal(plan.stats.blocks, Core.LIMITS.blocks);
  assert.equal(plan.stats.truncated, true);
  assert.equal(Core.summarize(plan).truncated, true);
});

/* -------------------------------------------------------------- render --- */

test('Rendering builds absolutely positioned, uniquely named layers', () => {
  const { Core, context } = harness();
  const plan = Core.buildPlan({
    area: { width: 640, height: 480 },
    nodes: [
      { kind: 'box', parent: -1, x: 0, y: 0, w: 640, h: 96, name: 'Header', painted: true, background: 'rgb(245, 245, 245)' },
      { kind: 'box', parent: 0, x: 24, y: 24, w: 200, h: 48, name: 'Card', painted: true, radius: 8 },
      { kind: 'text', parent: 1, x: 32, y: 36, w: 120, h: 24, text: 'Hello', name: 'Heading', color: 'rgb(0, 0, 0)', font: { size: 16, weight: 600, lineHeight: 24 } },
      { kind: 'media', parent: 0, x: 400, y: 24, w: 200, h: 120, name: 'Image', label: 'Chart' }
    ]
  }, { level: 'high' });
  const board = context.PageCaptureWireframe.renderPlan(plan, context.document);
  assert.equal(board.style.width, '640px');
  assert.equal(board.style.height, '480px');
  assert.equal(board.children.length, 1);
  const header = board.children[0];
  assert.equal(header.id, 'header');
  assert.equal(header.style.position, 'absolute');
  const card = header.children[0];
  const text = card.children[0];
  assert.equal(text.style.position, 'absolute');
  assert.equal(text.style.left, '8px');
  assert.equal(text.style.top, '12px');
  assert.equal(text.textContent, 'Hello');
  assert.equal(text.style.fontWeight, '600');
  const media = header.children[1];
  assert.equal(media.children.length, 3); // two placeholder marks + label
  assert.equal(media.children[2].textContent, 'Chart');
  const ids = [board, ...board.children, ...header.children, ...card.children, ...text.children, ...media.children].map(node => node.id).filter(Boolean);
  assert.equal(new Set(ids).size, ids.length);
});

test('Low rendering draws bars instead of text layers', () => {
  const { Core, context } = harness();
  const plan = Core.buildPlan({
    area: { width: 400, height: 200 },
    nodes: [{ kind: 'text', parent: -1, x: 10, y: 10, w: 200, h: 48, text: 'Two lines of copy', name: 'Text', font: { size: 16, weight: 400, lineHeight: 24 } }]
  }, { level: 'low' });
  const board = context.PageCaptureWireframe.renderPlan(plan, context.document);
  const block = board.children[0];
  assert.equal(block.textContent, '');
  assert.equal(block.children.length, 2);
  assert.ok(block.children.every(bar => /^#/.test(bar.style.backgroundColor)));
});

/* ---------------------------------------------------------------- copy --- */

function fakeHelpers(overrides = {}) {
  const calls = [];
  return {
    calls,
    capture: async (element, options) => {
      calls.push(['capture', element, options]);
      if (overrides.capture) return overrides.capture(element, options);
      return {
        document: {
          version: 2, nodeType: 1,
          root: { nodeType: 1, rect: { x: 0, y: 0, width: parseFloat(element.style.width), height: parseFloat(element.style.height) } },
          assets: new Map(), documentTitle: 'fixture'
        }
      };
    },
    serialize: async snapshot => { calls.push(['serialize']); return JSON.stringify(snapshot); },
    encode: async text => { calls.push(['encode']); return Buffer.from(String(text), 'utf8').toString('base64'); }
  };
}

test('Copying writes one rich clipboard payload and cleans up its frame', async () => {
  const { Core, Wireframe, context, writes } = harness();
  const mount = context.document.createElement('div');
  context.document.body.append(mount);
  const plan = Core.buildPlan({
    area: { width: 800, height: 600 },
    nodes: [
      { kind: 'box', parent: -1, x: 0, y: 0, w: 800, h: 120, name: 'Header', painted: true },
      { kind: 'text', parent: 0, x: 24, y: 24, w: 200, h: 32, text: 'Wireframe copy', name: 'Heading', color: 'rgb(0, 0, 0)', font: { size: 20, weight: 600, lineHeight: 32 } }
    ]
  }, { level: 'medium' });
  const helpers = fakeHelpers();
  const result = await Wireframe.copyPlan(plan, helpers, { mount, signal: new AbortController().signal });
  assert.equal(result.summary.blocks, 2);
  assert.equal(writes.length, 1);
  const item = writes[0][0];
  assert.deepEqual(item.types, ['text/html']);
  const html = await item.formats['text/html'].text();
  assert.match(html, /\(figh2d\)/);
  assert.match(html, /\(figmeta\)/);
  assert.doesNotMatch(html, /https?:\/\/[^\s"]+\.(?:png|jpg|svg)/i);
  const encoded = /\(figh2d\)([^()]+)\(\/figh2d\)/.exec(html)[1];
  const decoded = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
  assert.match(decoded[0].documentTitle, /Wireframe \(medium\)/);
  assert.equal(decoded[0].root.rect.width, 800);
  assert.equal(mount.children.length, 0, 'temporary frame removed');
  const captureOptions = helpers.calls.find(call => call[0] === 'capture')[2];
  assert.equal(captureOptions.skipRemoteAssetSerialization, true);
  assert.equal(captureOptions.assertLayoutValid, false);
});

test('A failed clipboard write reports an error and still cleans up', async () => {
  const { Core, Wireframe, context } = harness({ write: async () => { throw new Error('denied'); } });
  const mount = context.document.createElement('div');
  context.document.body.append(mount);
  const plan = Core.buildPlan({
    area: { width: 400, height: 300 },
    nodes: [{ kind: 'box', parent: -1, x: 0, y: 0, w: 400, h: 40, name: 'Bar', painted: true }]
  }, { level: 'medium' });
  await assert.rejects(Wireframe.copyPlan(plan, fakeHelpers(), { mount }), /denied/);
  assert.equal(mount.children.length, 0);
});

test('A board with unexpected assets is refused before it reaches the clipboard', async () => {
  const { Core, Wireframe, context, writes } = harness();
  const mount = context.document.createElement('div');
  context.document.body.append(mount);
  const plan = Core.buildPlan({
    area: { width: 400, height: 300 },
    nodes: [{ kind: 'box', parent: -1, x: 0, y: 0, w: 400, h: 40, name: 'Bar', painted: true }]
  }, { level: 'medium' });
  const helpers = fakeHelpers({
    capture: () => ({ document: { version: 2, nodeType: 1, root: { nodeType: 1, rect: { width: 400, height: 40 } }, assets: new Map([['a', 'b']]) } })
  });
  await assert.rejects(Wireframe.copyPlan(plan, helpers, { mount }), /unexpected assets/);
  assert.equal(writes.length, 0);
  assert.equal(mount.children.length, 0);
});

test('Cancelling preparation aborts the copy without writing', async () => {
  const { Core, Wireframe, context, writes } = harness();
  const mount = context.document.createElement('div');
  context.document.body.append(mount);
  const plan = Core.buildPlan({
    area: { width: 400, height: 300 },
    nodes: [{ kind: 'box', parent: -1, x: 0, y: 0, w: 400, h: 40, name: 'Bar', painted: true }]
  }, { level: 'medium' });
  const abort = new AbortController();
  const pending = Wireframe.copyPlan(plan, fakeHelpers(), { mount, signal: abort.signal });
  abort.abort();
  await assert.rejects(pending, error => error.name === 'AbortError' || /Cancel/.test(error.message));
  assert.equal(writes.length, 0);
});

/* ---------------------------------------------------------------- panel -- */

function fakeController() {
  const lifecycle = new AbortController();
  const messages = [];
  return {
    lifecycleAbort: lifecycle, messages,
    config: { onEvent: null },
    toolbarEl: { style: {} },
    focus() {},
    showTransientMessage(message) { messages.push(message); }
  };
}

test('The panel only attaches with working capture helpers', () => {
  const { Wireframe } = harness();
  const controller = fakeController();
  Wireframe.attach(controller, {});
  Wireframe.attach(controller, { capture() {}, serialize() {} });
  Wireframe.openPanel();
  assert.equal(controller.lifecycleAbort.signal.aborted, false);
  assert.equal(Wireframe.openPanel(), undefined);
});

test('Opening the panel scans the page, previews it and copies from the button', async () => {
  const document = new FakeDocument();
  fixturePage(document);
  const { Wireframe, context, writes } = harness({ document });
  const controller = fakeController();
  Wireframe.attach(controller, fakeHelpers());
  Wireframe.openPanel();
  await new Promise(resolve => setTimeout(resolve, 60));

  const host = document.body.children.find(node => node.id === '__page_capture_wireframe__');
  assert.ok(host, 'panel host mounted');
  assert.equal(host.getAttribute('data-h2d-ignore'), 'true');
  const shadow = host._shadow;
  const dialog = shadow.children.find(node => node.tagName === 'DIALOG');
  assert.ok(dialog?.open, 'dialog is modal');
  assert.equal(dialog.getAttribute('aria-busy'), 'false');
  const preview = shadow.querySelector('[data-wireframe-frame]');
  assert.ok(preview, 'preview frame rendered');
  const copy = shadow.querySelector('[data-focus="copy"]');
  assert.equal(copy.getAttribute('disabled') ?? null, null);
  copy.click();
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(writes.length, 1);
  assert.match(controller.messages.join(' '), /Wireframe copied/);
  assert.equal(shadow.querySelector('[data-wireframe-frame]') !== null, true, 'preview stays mounted');

  controller.lifecycleAbort.abort();
  assert.equal(document.body.children.some(node => node.id === '__page_capture_wireframe__'), false);
});

test('The panel explains an unavailable rich clipboard instead of throwing', async () => {
  const document = new FakeDocument();
  fixturePage(document);
  const { Wireframe, context } = harness({ document });
  context.navigator.clipboard = {};
  const controller = fakeController();
  Wireframe.attach(controller, fakeHelpers());
  Wireframe.openPanel();
  await new Promise(resolve => setTimeout(resolve, 60));
  const shadow = document.body.children.find(node => node.id === '__page_capture_wireframe__')._shadow;
  shadow.querySelector('[data-focus="copy"]').click();
  await new Promise(resolve => setTimeout(resolve, 60));
  const dialog = shadow.children.find(node => node.tagName === 'DIALOG');
  const footer = dialog.children[0].children.find(node => node.tagName === 'FOOTER');
  const status = footer.children.find(node => String(node.className).includes('status'));
  assert.match(status.textContent, /rich clipboard is unavailable/);
  assert.equal(status.className.includes('error'), true);
});

/* ------------------------------------------------------- shipped wiring -- */

test('Both wireframe files are injected before the toolbar and attached once', () => {
  const background = read('js/background.js');
  const injected = /files:\s*\[([^\]]+)\]/.exec(background)[1];
  const order = [...injected.matchAll(/"([^"]+)"/g)].map(match => match[1]);
  assert.ok(order.includes('js/wireframe-core.js'));
  assert.ok(order.includes('js/wireframe.js'));
  assert.ok(order.indexOf('js/wireframe-core.js') < order.indexOf('js/wireframe.js'));
  assert.ok(order.indexOf('js/wireframe.js') < order.indexOf('js/h2d_toolbar.js'));
  const toolbar = read('js/h2d_toolbar.js');
  assert.equal((toolbar.match(/PageCaptureWireframe\?\.attach\(/g) || []).length, 1);
  const menu = read('js/design-system.js');
  assert.match(menu, /PageCaptureWireframe/);
  assert.match(menu, /Copy as wireframe/);
});

test('Wireframe runtime stays local and never fetches a page asset', () => {
  const source = read('js/wireframe-core.js') + read('js/wireframe.js');
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /XMLHttpRequest|createObjectURL|chrome\.(?:runtime|storage|tabs)/);
  assert.doesNotMatch(source, /srcdoc|\.src\s*=/);
  assert.match(source, /sandbox",\s*"allow-same-origin"/);
  assert.match(source, /default-src 'none'/);
});
