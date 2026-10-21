'use strict';
// Wireframe as a capture setting: the transform, the Viewports option that turns
// it on, and the clipboard hook that applies it. Runs against the shipped files
// in a vm context with a small dependency-free DOM, so no browser is needed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..', 'extension');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

/* ----------------------------------------------------------- mini DOM ---- */

class FakeClassList {
  constructor(owner) { this.owner = owner; }
  contains(name) { return String(this.owner.className || '').split(/\s+/).includes(name); }
}

class FakeStyle {
  constructor() { this._values = new Map(); }
  setProperty(name, value) { this._values.set(name, value); }
  getPropertyValue(name) { return this._values.get(name) || ''; }
}

class FakeElement {
  constructor(tag, ownerDocument) {
    this.nodeType = 1;
    this.tagName = String(tag).toUpperCase();
    this.localName = String(tag).toLowerCase();
    this.ownerDocument = ownerDocument;
    this.style = new FakeStyle();
    this.attributes = {};
    this.children = [];
    this.childNodes = [];
    this.parentNode = null;
    this.className = '';
    this.classList = new FakeClassList(this);
    this.dataset = {};
    this.id = '';
    this.shadowRoot = null;
    this.type = '';
    this.checked = false;
    this.disabled = false;
    this._listeners = new Map();
  }
  get isConnected() {
    let node = this;
    while (node.parentNode) node = node.parentNode;
    return node === this.ownerDocument || node?.nodeType === 9;
  }
  get textContent() { return this.childNodes.map(child => child.nodeType === 3 ? child.nodeValue : child.textContent).join(''); }
  set textContent(value) {
    this.childNodes = []; this.children = [];
    if (value !== '' && value != null) this.append({ nodeType: 3, nodeValue: String(value), parentNode: null });
  }
  setAttribute(name, value) { this.attributes[name] = String(value); if (name === 'id') this.id = String(value); }
  getAttribute(name) { return Object.hasOwn(this.attributes, name) ? this.attributes[name] : null; }
  removeAttribute(name) { delete this.attributes[name]; }
  append(...nodes) {
    for (const node of nodes) {
      node.parentNode = this;
      this.childNodes.push(node);
      if (node.nodeType === 1) this.children.push(node);
    }
  }
  remove() {
    if (!this.parentNode) return;
    this.parentNode.childNodes = this.parentNode.childNodes.filter(node => node !== this);
    this.parentNode.children = this.parentNode.children.filter(node => node !== this);
    this.parentNode = null;
  }
  attachShadow(options) {
    const shadow = new FakeElement('#shadow-root', this.ownerDocument);
    shadow.parentNode = this;
    this.shadowRoot = shadow;
    this.shadowMode = options?.mode;
    return shadow;
  }
  addEventListener(type, listener) {
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push(listener);
  }
  dispatch(type, event = {}) {
    const payload = { type, preventDefault() {}, stopPropagation() {}, ...event };
    for (const listener of this._listeners.get(type) || []) listener(payload);
  }
  click() { this.checked = this.type === 'checkbox' ? !this.checked : this.checked; this.dispatch('click'); }
  querySelector(selector) {
    const attribute = /^\[([a-z-]+)\]$/.exec(selector);
    const className = /^\.([a-z-]+)$/.exec(selector);
    const tag = /^[a-z]+$/.test(selector) ? selector.toUpperCase() : null;
    if (!attribute && !className && !tag) return null;
    const stack = [...this.children];
    while (stack.length) {
      const node = stack.shift();
      if (attribute && node.getAttribute(attribute[1]) != null) return node;
      if (className && (node.className || '').split(/\s+/).includes(className[1])) return node;
      if (tag && node.tagName === tag) return node;
      stack.push(...node.children);
    }
    return null;
  }
  querySelectorAll(selector) {
    const attribute = /^\[([a-z-]+)\]$/.exec(selector);
    const tag = /^[a-z]+$/.test(selector) ? selector.toUpperCase() : null;
    const done = [];
    const stack = [...this.children];
    while (stack.length) {
      const node = stack.shift();
      if (attribute && node.getAttribute(attribute[1]) != null) done.push(node);
      else if (tag && node.tagName === tag) done.push(node);
      stack.push(...node.children);
    }
    return done;
  }
}

class FakeDocument {
  constructor() {
    this.nodeType = 9;
    this.documentElement = new FakeElement('html', this);
    this.documentElement.parentNode = this;
    this.head = new FakeElement('head', this);
    this.body = new FakeElement('body', this);
    this.documentElement.append(this.head, this.body);
  }
  createElement(tag) { return new FakeElement(tag, this); }
  getElementById(id) {
    const stack = [this.documentElement];
    while (stack.length) {
      const node = stack.shift();
      if (node.id === id) return node;
      stack.push(...node.children);
    }
    return null;
  }
  addEventListener() {}
}

/* ------------------------------------------------------------- harness --- */

function harness(options = {}) {
  const document = options.document || new FakeDocument();
  const stored = { ...(options.storage || {}) };
  const sets = [];
  const chrome = {
    storage: {
      local: {
        get: options.storageGet || (async key => ({ [key]: stored[key] })),
        async set(value) { sets.push(value); Object.assign(stored, value); }
      }
    }
  };
  const safetyCalls = [];
  const Safety = {
    limits: { jsonBytes: 48 * 1024 * 1024 },
    prepareClipboard: async (records, opts) => { safetyCalls.push({ records, opts }); return { size: 1, records }; },
    imageAssetSummary: records => ({ total: 3, included: 2, notEmbedded: 1 }),
    sanitizeDocument: doc => ({ changed: false, removed: 0 }),
    utf8Bytes: async () => 0,
    createSession: () => ({})
  };
  let observerCallback = null;
  const context = vm.createContext({
    document, chrome, URL, Blob, AbortController, AbortSignal, DOMException,
    console, setTimeout, clearTimeout,
    MutationObserver: class { constructor(callback) { observerCallback = callback; } observe() {} disconnect() {} },
    Image: class {}
  });
  context.globalThis = context;
  if (options.safety !== false) context.PageCaptureSafety = Safety;
  vm.runInContext(read('js/wireframe-core.js'), context);
  vm.runInContext(read('js/wireframe.js'), context);
  return {
    context, document, chrome, stored, sets, safetyCalls,
    Core: context.PageCaptureWireframeCore,
    Wireframe: context.PageCaptureWireframe,
    Safety: context.PageCaptureSafety,
    fireMutation(added) { observerCallback?.([{ addedNodes: added }]); }
  };
}

/* A capture document shaped like the extension's version-2 snapshot model. */
function snapshot(overrides = {}) {
  const text = (text, rect, lineCount = 1) => ({ nodeType: 3, id: `t-${text.slice(0, 8)}`, text, rect, lineCount });
  const element = (tag, rect, extra = {}) => ({
    nodeType: 1, id: extra.id || `e-${tag}-${Math.random().toString(16).slice(2, 8)}`, tag,
    attributes: extra.attributes || {}, styles: { display: 'block', ...extra.styles }, rect,
    childNodes: extra.childNodes || []
  });
  const root = element('DIV', { x: 0, y: 0, width: 1200, height: 900 }, {
    id: 'root',
    styles: { backgroundColor: 'rgb(255, 255, 255)', color: 'rgb(17, 17, 17)', fontFamily: '"Brand Serif", Georgia, serif', fontSize: '16px', lineHeight: '24px' },
    computedStyles: { backgroundColor: 'rgb(234, 76, 137)', background: 'rgb(234, 76, 137) none repeat scroll 0% 0%', color: 'rgb(234, 76, 137)' },
    variableStyles: { backgroundColor: 'rgb(234, 76, 137)' },
    sourceProps: { className: 'pink' },
    pseudoElementStyles: { before: { backgroundColor: 'rgb(234, 76, 137)' } },
    childNodes: [
      element('HEADER', { x: 0, y: 0, width: 1200, height: 80 }, {
        id: 'header',
        attributes: { class: 'site-header sticky', 'aria-label': 'Primary' },
        styles: { backgroundColor: 'rgb(250, 250, 250)', borderTopWidth: '0px', color: 'rgb(17, 17, 17)', fontSize: '16px', lineHeight: '24px' },
        childNodes: [text('Northwind Studio', { x: 24, y: 24, width: 180, height: 32 })]
      }),
      element('IMG', { x: 40, y: 120, width: 320, height: 200 }, {
        id: 'hero-image',
        attributes: { src: 'https://fixture.test/hero.png', currentSrc: 'https://fixture.test/hero.png', alt: 'Dashboard preview', class: 'hero' },
        styles: { backgroundImage: 'url("https://fixture.test/hero.png")', borderTopLeftRadius: '16px' },
        placeholderUrl: 'https://fixture.test/hero.png'
      }),
      element('H1', { x: 40, y: 360, width: 520, height: 64 }, {
        id: 'heading',
        styles: { color: 'rgb(13, 153, 255)', fontFamily: '"Brand Serif", Georgia, serif', fontSize: '48px', fontWeight: '700', lineHeight: '56px', letterSpacing: '-1px', transform: 'none' },
        childNodes: [text('We make complicated products feel obvious.', { x: 40, y: 360, width: 520, height: 64 }, 2)]
      }),
      element('BUTTON', { x: 40, y: 460, width: 168, height: 48 }, {
        id: 'cta',
        attributes: { class: 'btn primary' },
        styles: { backgroundColor: 'rgb(13, 153, 255)', borderTopLeftRadius: '10px', borderTopWidth: '0px', boxShadow: 'rgba(13, 153, 255, 0.4) 0px 8px 24px 0px', color: 'rgb(255, 255, 255)', fontSize: '14px', lineHeight: '20px' },
        childNodes: [text('Start a project', { x: 56, y: 474, width: 120, height: 20 })]
      }),
      element('SVG', { x: 900, y: 40, width: 24, height: 24 }, {
        id: 'icon',
        childNodes: [element('PATH', { x: 900, y: 40, width: 24, height: 24 }, { id: 'path', styles: { fill: 'rgb(0, 0, 0)' } })]
      })
    ]
  });
  return {
    version: 2,
    documentTitle: 'Fixture page',
    root,
    documentRect: { x: 0, y: 0, width: 1200, height: 900 },
    viewportRect: { x: 0, y: 0, width: 1200, height: 900 },
    devicePixelRatio: 2,
    assets: {
      'https://fixture.test/hero.png': { blob: { base64Blob: 'data:image/png;base64,AAAA', type: 'image/png' } }
    },
    fonts: [{ family: 'Brand Serif' }],
    ...overrides
  };
}

const parse = doc => JSON.parse(JSON.stringify(doc));

/* ------------------------------------------------------------- the model - */

test('Three wireframe levels exist with plain-language descriptions', () => {
  const { Core } = harness();
  assert.deepEqual(Array.from(Core.LEVELS, level => level.id), ['low', 'medium', 'high']);
  for (const level of Core.LEVELS) {
    assert.ok(level.label.length > 0 && level.title.length > 0 && level.description.length > 12, level.id);
  }
  assert.equal(Core.normalizeOptions({}).level, 'medium');
  assert.equal(Core.normalizeOptions({ level: 'ultra' }).level, 'medium');
  assert.deepEqual({ ...Core.normalizeSettings({ on: true, level: 'high' }) }, { on: true, level: 'high' });
  assert.deepEqual({ ...Core.normalizeSettings({ on: 'yes', level: 'nope' }) }, { on: false, level: 'medium' });
  assert.deepEqual({ ...Core.normalizeSettings(null) }, { on: false, level: 'medium' });
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

test('Tone mapping keeps light surfaces light and enforces readable text', () => {
  const { Core } = harness();
  assert.match(Core.fillTone(Core.parseColor('rgb(255, 255, 255)'), 'high'), /^#f[a-f0-9]{5}$/, 'near-white keeps the lightest tone');
  assert.equal(Core.fillTone(Core.parseColor('rgba(0, 0, 0, 0)'), 'high'), null);
  const dark = Core.fillTone(Core.parseColor('rgb(12, 12, 12)'), 'high');
  const mid = Core.fillTone(Core.parseColor('rgb(120, 120, 120)'), 'high');
  assert.ok(dark && mid && dark < mid, `${dark} < ${mid}`);
  const onPaper = Core.textTone(Core.parseColor('rgb(240, 240, 240)'), '#ffffff', 'high');
  assert.ok(Core.contrast(Core.parseColor(onPaper), Core.parseColor('#ffffff')) >= 3);
  const onDark = Core.textTone(Core.parseColor('rgb(20, 20, 20)'), '#2b2b2b', 'high');
  assert.ok(Core.contrast(Core.parseColor(onDark), Core.parseColor('#2b2b2b')) >= 3);
});

test('A capture that is not a version-2 snapshot is refused, not guessed', () => {
  const { Core } = harness();
  assert.throws(() => Core.transformDocument(null), /no capture/);
  assert.throws(() => Core.transformDocument({ version: 1, root: { nodeType: 1 } }), /version|cannot be rebuilt/);
  assert.throws(() => Core.transformDocument({ version: 2, root: { nodeType: 3 } }), /cannot be rebuilt/);
  assert.throws(() => Core.transformDocument({ version: 2, root: { nodeType: 1, rect: { width: 0, height: 0 } } }), /no layout/);
});

/* -------------------------------------------------------------- levels --- */

test('Low keeps structure: text becomes bars and nothing is editable type', () => {
  const { Core } = harness();
  const doc = snapshot();
  const before = parse(doc);
  const { document: result, stats, level } = Core.transformDocument(doc, { level: 'low' });
  assert.equal(level, 'low');
  const heading = result.root.childNodes.find(node => node.id === 'heading');
  assert.equal(heading.childNodes.length, 2, 'two lines -> two bars');
  assert.equal(heading.childNodes.every(node => node.nodeType === 1), true);
  assert.equal(heading.childNodes.some(node => node.text != null), false);
  for (const bar of heading.childNodes) {
    assert.match(bar.styles.backgroundColor, /^#[0-9a-f]{6}$/);
    assert.equal(bar.styles.borderRadius, '2px');
    assert.ok(bar.rect.width <= before.root.childNodes.find(node => node.id === 'heading').rect.width);
  }
  assert.ok(stats.bars >= 3, 'header text, heading lines and button label all became bars');
  assert.equal(result.root.childNodes.some(node => node.id === 'heading' && node.childNodes.some(child => child.text)), false);
});

test('Medium uses real text in a neutral face and caps radii', () => {
  const { Core } = harness();
  const { document: result } = Core.transformDocument(snapshot(), { level: 'medium' });
  const heading = result.root.childNodes.find(node => node.id === 'heading');
  assert.equal(heading.childNodes[0].text, 'We make complicated products feel obvious.');
  assert.equal(heading.styles.fontFamily, Core.NEUTRAL_FONT);
  assert.equal(heading.styles.letterSpacing, 'normal');
  const cta = result.root.childNodes.find(node => node.id === 'cta');
  assert.equal(cta.styles.borderTopLeftRadius, '6px');
  assert.equal(cta.styles.boxShadow, undefined, 'shadows are dropped at medium');
  assert.match(cta.styles.backgroundColor, /^#[0-9a-f]{6}$/);
});

test('High keeps the page type stack, radii and a greyscaled shadow', () => {
  const { Core } = harness();
  const { document: result } = Core.transformDocument(snapshot(), { level: 'high' });
  const heading = result.root.childNodes.find(node => node.id === 'heading');
  assert.match(heading.styles.fontFamily, /Brand Serif/);
  assert.notEqual(heading.styles.letterSpacing, 'normal');
  const cta = result.root.childNodes.find(node => node.id === 'cta');
  assert.equal(cta.styles.borderTopLeftRadius, '10px');
  assert.match(cta.styles.boxShadow, /rgba\(0, 0, 0, 0\.12\) 0px 8px 24px 0px/);
  const header = result.root.childNodes.find(node => node.id === 'header');
  assert.match(header.styles.backgroundColor, /^#[0-9a-f]{6}$/);
  assert.notEqual(header.styles.backgroundColor, 'rgb(250, 250, 250)');
});

/* ------------------------------------------------------------- assets ---- */

test('A wireframe carries no page assets, image URLs or inline styles', () => {
  const { Core } = harness();
  for (const level of ['low', 'medium', 'high']) {
    const { document: result } = Core.transformDocument(snapshot(), { level });
    assert.equal(Object.keys(result.assets).length, 0, `${level}: no assets`);
    const serialized = JSON.stringify(result);
    assert.doesNotMatch(serialized, /https?:\/\/fixture\.test/, `${level}: no page URL survives`);
    assert.doesNotMatch(serialized, /base64,AAAA/, `${level}: no embedded image`);
    if (level === 'high') assert.match(serialized, /Brand Serif/, 'high keeps the page type stack');
    else assert.doesNotMatch(serialized, /Brand Serif/, `${level}: neutral type only`);
  }
});

test('Images become labelled vector placeholders at every level', () => {
  const { Core } = harness();
  const medium = Core.transformDocument(snapshot(), { level: 'medium' }).document;
  const image = medium.root.childNodes.find(node => node.id === 'hero-image');
  assert.equal(image.childNodes.length, 1);
  assert.equal(image.childNodes[0].nodeType, 3);
  assert.equal(image.childNodes[0].text, 'Dashboard preview', 'alt text becomes the label');
  assert.equal(image.placeholderUrl, undefined);
  assert.equal(image.attributes.src, undefined);
  assert.equal(image.attributes.currentsrc, undefined);
  assert.equal(image.attributes.alt, 'Dashboard preview', 'alt is kept for naming');
  assert.match(image.styles.backgroundColor, /^#[0-9a-f]{6}$/);

  const low = Core.transformDocument(snapshot(), { level: 'low' }).document;
  const lowImage = low.root.childNodes.find(node => node.id === 'hero-image');
  assert.equal(lowImage.childNodes.length, 0, 'low keeps a plain box');
  assert.equal(lowImage.styles.borderTopLeftRadius, '4px');
});

test('Inline SVG artwork collapses to a single icon box', () => {
  const { Core } = harness();
  const { document: result } = Core.transformDocument(snapshot(), { level: 'high' });
  const icon = result.root.childNodes.find(node => node.id === 'icon');
  assert.equal(icon.childNodes.length, 0);
  assert.equal(icon.styles.borderTopLeftRadius, '4px', 'the artwork is now a rounded box');
  assert.equal(icon.styles.borderTopWidth, '1px');
  assert.equal(result.root.childNodes.some(node => node.tag === 'PATH'), false);
});

/* --------------------------------------------------- colour invariants --- */

// Walk the emitted JSON and collect every colour literal, so one test can enforce
// "a wireframe contains no hue at all" for arbitrary pages.
function coloursIn(value, found = []) {
  if (typeof value === 'string') {
    for (const match of value.matchAll(/rgba?\([^)]+\)|#[0-9a-f]{3,8}\b/gi)) found.push(match[0]);
  } else if (Array.isArray(value)) {
    for (const entry of value) coloursIn(entry, found);
  } else if (value && typeof value === 'object') {
    for (const entry of Object.values(value)) coloursIn(entry, found);
  }
  return found;
}
const isGrey = colour => {
  if (colour.startsWith('#')) {
    const hex = colour.slice(1);
    const expand = hex.length === 3 || hex.length === 4 ? Array.from(hex).map(char => char + char) : hex.match(/../g);
    return expand[0].toLowerCase() === expand[1].toLowerCase() && expand[1].toLowerCase() === expand[2].toLowerCase();
  }
  const [r, g, b] = (colour.match(/[\d.]+/g) || []).map(Number);
  return Math.abs(r - g) < 1 && Math.abs(g - b) < 1;
};

test('A wireframe contains no hue anywhere, at any level', () => {
  const { Core } = harness();
  const page = snapshot();
  // Dribbble-like: brand pink everywhere a colour can hide, including the
  // secondary style channels and the exotic colour properties.
  const drizzle = (value) => {
    for (const node of [value.root, ...value.root.childNodes]) {
      node.styles = { ...node.styles, caretColor: 'rgb(234, 76, 137)', columnRuleColor: 'rgb(255, 0, 0)', accentColor: 'rgb(0, 128, 255)', textDecorationColor: 'rgb(234, 76, 137)' };
      node.computedStyles = { backgroundColor: 'rgb(234, 76, 137)', background: 'rgb(234, 76, 137) none repeat', borderTopColor: 'rgb(255,0,0)' };
    }
    return value;
  };
  for (const level of ['low', 'medium', 'high']) {
    const { document: result } = Core.transformDocument(drizzle(JSON.parse(JSON.stringify(page))), { level });
    const colours = coloursIn(JSON.parse(JSON.stringify(result)));
    assert.ok(colours.length > 0, `${level}: expected tones in the output`);
    const offending = Array.from(new Set(colours)).filter(colour => !isGrey(colour));
    assert.deepEqual(offending, [], `${level}: every colour must be grey`);
    const serialized = JSON.stringify(result);
    assert.doesNotMatch(serialized, /url\(|https?:\/\/|data:image|<svg/i, `${level}: no asset reference may survive`);
  }
});

test('A faint overlay stays light instead of becoming a dark slab', () => {
  const { Core } = harness();
  const doc = snapshot();
  doc.root.childNodes = [{
    nodeType: 1, id: 'overlay', tag: 'DIV', attributes: {}, rect: { x: 0, y: 0, width: 300, height: 200 },
    styles: { backgroundColor: 'rgba(0, 0, 0, 0.06)', borderTopWidth: '0px' }, childNodes: []
  }];
  for (const level of ['low', 'medium', 'high']) {
    const { document: result } = Core.transformDocument(doc, { level });
    const fill = result.root.childNodes[0].styles.backgroundColor;
    const parsed = Core.parseColor(fill);
    assert.ok(Core.luminance(parsed) > 0.8, `${level}: ${fill} should stay near-white, not a dark block`);
  }
});

test('Brand colour is reduced by luminance, not kept for its hue', () => {
  const { Core } = harness();
  const doc = snapshot();
  doc.root.childNodes = [
    { nodeType: 1, id: 'pink', tag: 'DIV', attributes: {}, rect: { x: 0, y: 0, width: 300, height: 200 }, styles: { backgroundColor: 'rgb(234, 76, 137)' }, childNodes: [] },
    { nodeType: 1, id: 'red', tag: 'DIV', attributes: {}, rect: { x: 0, y: 220, width: 300, height: 200 }, styles: { backgroundColor: 'rgb(255, 0, 0)' }, childNodes: [] },
    { nodeType: 1, id: 'blue', tag: 'DIV', attributes: {}, rect: { x: 0, y: 440, width: 300, height: 200 }, styles: { backgroundColor: 'rgb(0, 0, 255)' }, childNodes: [] }
  ];
  const { document: result } = Core.transformDocument(doc, { level: 'medium' });
  const tones = Array.from(result.root.childNodes, node => node.styles.backgroundColor);
  assert.equal(tones.every(isGrey), true, tones.join(', '));
  // Dark blue is darker than Dribbble pink, so the greys keep that relationship
  // even though the hues are gone.
  const [pink, , blue] = tones.map(tone => Core.luminance(Core.parseColor(tone)));
  assert.ok(pink > blue, `pink ${pink} should read lighter than blue ${blue}`);
});

test('Text on a dark band is inked light, so the label survives', () => {
  const { Core } = harness();
  const doc = snapshot();
  doc.root.childNodes = [{
    nodeType: 1, id: 'band', tag: 'DIV', attributes: {}, rect: { x: 0, y: 0, width: 600, height: 160 },
    styles: { backgroundColor: 'rgb(13, 13, 13)', color: 'rgb(13, 13, 13)' },
    childNodes: [{ nodeType: 3, id: 'band-text', text: 'They untangled a dashboard in six weeks.', rect: { x: 20, y: 60, width: 400, height: 24 } }]
  }];
  for (const level of ['low', 'medium', 'high']) {
    const { document: result } = Core.transformDocument(doc, { level });
    const band = result.root.childNodes[0];
    // Readability is relative: Low flattens the band to a light tone, Medium keeps it
    // dark. What matters is that the ink keeps a readable contrast in both cases.
    const ink = Core.luminance(Core.parseColor(band.styles.color));
    const surface = Core.luminance(Core.parseColor(band.styles.backgroundColor));
    const ratio = Core.contrast(Core.parseColor(band.styles.color), Core.parseColor(band.styles.backgroundColor));
    assert.ok(ratio >= 3, `${level}: ink ${band.styles.color} on ${band.styles.backgroundColor} is ${ratio.toFixed(2)}:1`);
    assert.ok(surface < 0.5 ? ink > 0.5 : ink < 0.5, `${level}: ink must sit opposite its surface (ink ${ink}, surface ${surface})`);
  }
});

test('A faint veil over a painted sibling is dropped, a lone tint is kept', () => {
  const { Core } = harness();
  const card = {
    nodeType: 1, id: 'card', tag: 'DIV', attributes: {}, rect: { x: 0, y: 0, width: 300, height: 200 },
    styles: { backgroundImage: 'url(https://cdn.example/thumb.jpg)', backgroundSize: 'cover' }, childNodes: []
  };
  const veil = {
    nodeType: 1, id: 'veil', tag: 'DIV', attributes: {}, rect: { x: 8, y: 8, width: 284, height: 184 },
    styles: { backgroundColor: 'rgba(0, 0, 0, 0.05)' }, childNodes: []
  };
  const doc = snapshot();
  doc.root.childNodes = [card, veil];
  const { document: withVeil } = Core.transformDocument(doc, { level: 'medium' });
  const ids = Array.from(withVeil.root.childNodes, node => node.id);
  assert.equal(ids.includes('veil'), false, `veil must not ship: ${ids.join(', ')}`);
  assert.equal(ids.includes('card'), true);

  // The same fill on its own is a section tint and must be re-toned, not removed.
  doc.root.childNodes = [{ ...veil }];
  const { document: alone } = Core.transformDocument(doc, { level: 'medium' });
  assert.equal(alone.root.childNodes.length, 1);
  assert.ok(Core.luminance(Core.parseColor(alone.root.childNodes[0].styles.backgroundColor)) > 0.8);
});

test('Secondary style channels are not shipped to the destination', () => {
  const { Core } = harness();
  const { document: result } = Core.transformDocument(snapshot(), { level: 'medium' });
  const node = result.root.childNodes[0];
  for (const key of ['computedStyles', 'variableStyles', 'sourceProps', 'pseudoElementStyles', 'pseudoElementNodes', 'placeholderUrl', 'content', 'scrollRect']) {
    assert.equal(Object.hasOwn(node, key), false, `${key} must be dropped`);
  }
  assert.deepEqual(Array.from(Object.keys(result.root), key => key).sort(), ['attributes', 'childNodes', 'id', 'nodeType', 'rect', 'styles', 'tag']);
});

/* -------------------------------------------------------- determinism ---- */

test('The same capture and level always produce the same wireframe', () => {
  const { Core } = harness();
  const first = Core.transformDocument(snapshot(), { level: 'medium' }).document;
  const second = Core.transformDocument(snapshot(), { level: 'medium' }).document;
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.deepEqual(parse(first.wireframe), { level: 'medium' });
});

test('Very large captures stop at the node budget and say so', () => {
  const { Core } = harness();
  const doc = snapshot();
  const children = [];
  for (let index = 0; index < Core.LIMITS.nodes + 50; index++) {
    children.push({ nodeType: 1, id: `n-${index}`, tag: 'DIV', attributes: {}, styles: {}, rect: { x: 0, y: index, width: 40, height: 20 }, childNodes: [] });
  }
  doc.root.childNodes = children;
  const result = Core.transformDocument(doc, { level: 'low' });
  assert.equal(result.stats.truncated, true);
  assert.ok(result.document.root.childNodes.length <= Core.LIMITS.nodes);
});

/* -------------------------------------------------------------- settings - */

test('The setting is off by default and persists through chrome.storage', async () => {
  const { Wireframe, stored, sets } = harness();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(Wireframe.settings.on, false);
  assert.equal(Wireframe.settings.level, 'medium');
  assert.equal(sets.length, 0, 'nothing is written until the user chooses');

  const env = harness();
  const host = buildPopoverHost(env.document);
  env.Wireframe.decoratePopover(host);
  const section = host.shadowRoot.querySelector('[data-wireframe-section]');
  assert.ok(section, 'section mounted');
  const checkbox = section.querySelector('input');
  checkbox.checked = true;
  checkbox.dispatch('change');
  assert.equal(env.Wireframe.settings.on, true);
  assert.equal(env.stored.pc_wireframe_v1.on, true);
  assert.equal(env.sets.at(-1).pc_wireframe_v1.on, true);
});

/* ---------------------------------------------------------- popover UI --- */

function buildPopoverHost(document) {
  const host = document.createElement('div');
  host.id = '__pc_viewports__';
  const shadow = host.attachShadow({ mode: 'open' });
  const box = document.createElement('div');
  box.className = 'box';
  const heading = document.createElement('h4');
  heading.textContent = 'Viewports';
  box.append(heading);
  shadow.append(box);
  document.documentElement.append(host);
  return host;
}

test('Wireframe appears in the Viewports popover as a checkbox with three levels', () => {
  const env = harness();
  const host = buildPopoverHost(env.document);
  env.fireMutation([host]);
  const section = host.shadowRoot.querySelector('[data-wireframe-section]');
  assert.ok(section, 'the option is injected into the existing popover');
  assert.equal(section.getAttribute('role'), 'group');
  assert.equal(section.getAttribute('aria-label'), 'Wireframe');
  const checkbox = section.querySelector('input');
  assert.equal(checkbox.type, 'checkbox');
  assert.equal(checkbox.getAttribute('aria-label'), 'Copy as wireframe');
  assert.equal(checkbox.checked, false);
  const buttons = section.querySelectorAll('button');
  assert.deepEqual(Array.from(buttons, button => button.dataset.level), ['low', 'medium', 'high']);
  assert.equal(buttons.every(button => button.disabled), true, 'levels are disabled while off');
  assert.match(section.textContent, /Capture design/);
});

test('Choosing a level turns the setting on and updates the hint', () => {
  const env = harness();
  const host = buildPopoverHost(env.document);
  env.Wireframe.decoratePopover(host);
  const section = host.shadowRoot.querySelector('[data-wireframe-section]');
  const [low, medium, high] = section.querySelectorAll('button');
  high.dispatch('click');
  assert.equal(env.Wireframe.settings.on, true);
  assert.equal(env.Wireframe.settings.level, 'high');
  assert.equal(high.getAttribute('aria-pressed'), 'true');
  assert.equal(low.getAttribute('aria-pressed'), 'false');
  assert.equal(section.querySelector('input').checked, true);
  assert.match(section.textContent, /Detail/);
  assert.equal(env.stored.pc_wireframe_v1.level, 'high');
  assert.equal(section.querySelectorAll('button').every(button => button.disabled), false);
});

test('The popover is decorated once, even after repeated opens', () => {
  const env = harness();
  const host = buildPopoverHost(env.document);
  env.Wireframe.decoratePopover(host);
  env.Wireframe.decoratePopover(host);
  env.fireMutation([host, host]);
  const sections = host.shadowRoot.querySelectorAll('[data-wireframe-section]');
  assert.equal(sections.length, 1);
  assert.equal(host.shadowRoot.querySelectorAll('[data-wireframe-style]').length, 1);
});

test('A stored choice is restored when the popover opens', async () => {
  const env = harness({ storage: { pc_wireframe_v1: { on: true, level: 'low' } } });
  await new Promise(resolve => setTimeout(resolve, 0));
  const host = buildPopoverHost(env.document);
  env.Wireframe.decoratePopover(host);
  const section = host.shadowRoot.querySelector('[data-wireframe-section]');
  assert.equal(section.querySelector('input').checked, true);
  assert.equal(section.querySelectorAll('button')[0].getAttribute('aria-pressed'), 'true');
  assert.equal(section.getAttribute('data-state'), 'on');
});

/* ------------------------------------------------------------ copy hook -- */

test('Installing the hook keeps every other PageCaptureSafety function', () => {
  const env = harness();
  assert.equal(env.Safety.__wireframe, true);
  assert.equal(typeof env.Safety.sanitizeDocument, 'function');
  assert.equal(typeof env.Safety.createSession, 'function');
  assert.deepEqual(env.Safety.limits, env.Safety.limits);
  assert.equal(Object.isFrozen(env.Safety), true);
  assert.equal(env.Wireframe.install(), true, 'installing twice is a no-op');
});

test('While off, copying is completely untouched', async () => {
  const env = harness();
  const records = [{ type: 'snapshot', id: 'a', h2dJson: JSON.stringify(snapshot()) }];
  await env.Safety.prepareClipboard(records, {});
  assert.equal(env.safetyCalls.length, 1);
  assert.equal(env.safetyCalls[0].records[0].h2dJson, records[0].h2dJson);
  assert.deepEqual({ ...env.Safety.imageAssetSummary(records) }, { total: 3, included: 2, notEmbedded: 1 });
});

test('While on, the same copy action writes wireframe layers', async () => {
  const env = harness();
  const host = buildPopoverHost(env.document);
  env.Wireframe.decoratePopover(host);
  host.shadowRoot.querySelector('[data-wireframe-section]').querySelectorAll('button')[1].dispatch('click');
  assert.equal(env.Wireframe.settings.on, true);

  const original = { type: 'snapshot', id: 'a', previewUrl: 'data:image/png;base64,ZZ', h2dJson: JSON.stringify(snapshot()) };
  await env.Safety.prepareClipboard([original], { signal: undefined });
  const transformed = env.safetyCalls.at(-1).records[0];
  const doc = JSON.parse(transformed.h2dJson);
  assert.equal(doc.wireframe.level, 'medium');
  assert.equal(Object.keys(doc.assets).length, 0);
  assert.equal(transformed.previewUrl, 'data:image/png;base64,ZZ', 'the tray record is preserved');
  assert.equal(transformed.id, 'a');
  assert.equal(original.h2dJson.includes('fixture.test'), true, 'the stored capture is not mutated');
  assert.equal(env.Wireframe.lastTransformed(), 1);
});

test('Every checked width becomes its own wireframe in one copy', async () => {
  const env = harness({ storage: { pc_wireframe_v1: { on: true, level: 'high' } } });
  await new Promise(resolve => setTimeout(resolve, 0));
  const records = [
    { type: 'snapshot', id: '1600', h2dJson: JSON.stringify(snapshot()) },
    { type: 'snapshot', id: '393', h2dJson: JSON.stringify(snapshot()) }
  ];
  await env.Safety.prepareClipboard(records, {});
  const written = env.safetyCalls.at(-1).records;
  assert.equal(written.length, 2);
  assert.deepEqual(Array.from(written, record => JSON.parse(record.h2dJson).wireframe.level), ['high', 'high']);
});

test('Code captures pass through unchanged and never fail the copy', async () => {
  const env = harness({ storage: { pc_wireframe_v1: { on: true, level: 'low' } } });
  await new Promise(resolve => setTimeout(resolve, 0));
  const mhtml = { type: 'mhtml', id: 'code', mhtml: { html: '<p>raw</p>' } };
  const broken = { type: 'snapshot', id: 'broken', h2dJson: '{not json' };
  await env.Safety.prepareClipboard([mhtml, broken], {});
  const written = env.safetyCalls.at(-1).records;
  assert.equal(written[0], mhtml);
  assert.equal(written[1], broken, 'an unreadable record is copied as-is');
});

test('A wireframe copy does not claim to have embedded page images', async () => {
  const env = harness({ storage: { pc_wireframe_v1: { on: true, level: 'medium' } } });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual({ ...env.Safety.imageAssetSummary([{ type: 'snapshot', h2dJson: JSON.stringify(snapshot()) }]) }, { total: 0, included: 0, notEmbedded: 0 });
});

test('The transform survives being applied twice (Copy all after a wireframe copy)', async () => {
  const env = harness({ storage: { pc_wireframe_v1: { on: true, level: 'medium' } } });
  await new Promise(resolve => setTimeout(resolve, 0));
  const once = env.Wireframe.transformRecords([{ type: 'snapshot', id: 'a', h2dJson: JSON.stringify(snapshot()) }]);
  const twice = env.Wireframe.transformRecords(once);
  const a = JSON.parse(once[0].h2dJson), b = JSON.parse(twice[0].h2dJson);
  assert.equal(a.root.rect.width, b.root.rect.width);
  assert.equal(JSON.stringify(a).length, JSON.stringify(b).length);
  assert.equal(Object.keys(b.assets).length, 0);
});

/* -------------------------------------------------- real copy pipeline --- */

// Exercises the shipped capture-safety.js, so the wrapper is proven against the
// real encoder rather than a stub: the clipboard HTML must decode to a version-2
// wireframe with no assets and no page URLs.
async function realPipeline(settings) {
  const stored = { pc_wireframe_v1: settings };
  const chrome = { storage: { local: { async get(key) { return { [key]: stored[key] }; }, async set(value) { Object.assign(stored, value); } } } };
  const document = {
    documentElement: { appendChild() {} }, getElementById() { return null; },
    createElement() { return { style: {}, setAttribute() {}, append() {}, addEventListener() {} }; }
  };
  const context = vm.createContext({
    chrome, document, Blob, TextEncoder, crypto, AbortSignal, AbortController, DOMException,
    setTimeout, clearTimeout, console, MutationObserver: class { observe() {} disconnect() {} }
  });
  context.globalThis = context;
  for (const file of ['js/capture-safety.js', 'js/wireframe-core.js', 'js/wireframe.js']) {
    vm.runInContext(read(file), context);
  }
  await new Promise(resolve => setTimeout(resolve, 10));
  return context;
}

test('The real clipboard pipeline copies a wireframe that contains no page URLs', async () => {
  const context = await realPipeline({ on: true, level: 'medium' });
  const doc = snapshot();
  const records = [{ type: 'snapshot', id: 'r1', previewUrl: '', h2dJson: JSON.stringify(doc) }];
  const encode = async text => Buffer.from(text, 'utf8').toString('base64');
  const blob = await context.PageCaptureSafety.prepareClipboard(records, { encode, signal: new AbortController().signal });
  const html = await blob.text();
  const payload = /<span data-h2d="<!--\(figh2d\)([^()]+)\(\/figh2d\)-->"><\/span>/.exec(html)[1];
  const decoded = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
  assert.equal(decoded[0].version, 2);
  assert.equal(decoded[0].type, 'snapshot');
  assert.equal(decoded[0].wireframe.level, 'medium');
  assert.equal(Object.keys(decoded[0].assets).length, 0);
  assert.equal(html.includes('fixture.test'), false, 'no page URL in the clipboard payload');
  assert.equal(html.includes('base64,AAAA'), false, 'no image data in the clipboard payload');
  assert.doesNotMatch(html, /Brand Serif/, 'medium uses a neutral face');
});

test('With the option off the very same call copies the untouched capture', async () => {
  const context = await realPipeline({ on: false, level: 'high' });
  const doc = snapshot();
  const records = [{ type: 'snapshot', id: 'r1', previewUrl: '', h2dJson: JSON.stringify(doc) }];
  const encode = async text => Buffer.from(text, 'utf8').toString('base64');
  const blob = await context.PageCaptureSafety.prepareClipboard(records, { encode, signal: new AbortController().signal });
  const html = await blob.text();
  const payload = /<span data-h2d="<!--\(figh2d\)([^()]+)\(\/figh2d\)-->"><\/span>/.exec(html)[1];
  const decoded = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'))[0];
  assert.equal(Object.keys(decoded.assets).length, 1, 'images are still embedded when the option is off');
  assert.equal(decoded.wireframe, undefined);
  assert.match(JSON.stringify(decoded), /Brand Serif/);
});

/* --------------------------------------------- hidden, hidden text, bounds - */

test('Content the page hides is not pasted as visible boxes', () => {
  const { Core } = harness();
  const doc = snapshot();
  doc.root.childNodes = [
    { nodeType: 1, id: 'menu', tag: 'DIV', attributes: {}, rect: { x: 0, y: 0, width: 300, height: 200 }, styles: { display: 'none' }, childNodes: [
      { nodeType: 3, id: 'menu-text', text: 'Secret unreleased draft', rect: { x: 10, y: 10, width: 200, height: 20 } }
    ] },
    { nodeType: 1, id: 'faded', tag: 'DIV', attributes: {}, rect: { x: 0, y: 220, width: 300, height: 200 }, styles: { opacity: '0' }, childNodes: [
      { nodeType: 3, id: 'faded-text', text: 'faded out', rect: { x: 10, y: 230, width: 200, height: 20 } }
    ] },
    { nodeType: 1, id: 'screen-reader', tag: 'SPAN', attributes: {}, rect: { x: 0, y: 440, width: 300, height: 20 }, styles: { visibility: 'hidden' }, childNodes: [
      { nodeType: 3, id: 'sr-text', text: 'Only for assistive tech', rect: { x: 10, y: 440, width: 200, height: 20 } }
    ] },
    { nodeType: 1, id: 'skipped', tag: 'DIV', attributes: {}, rect: { x: 0, y: 480, width: 300, height: 200 }, styles: { contentVisibility: 'hidden' }, childNodes: [
      { nodeType: 3, id: 'skipped-text', text: 'content-visibility', rect: { x: 10, y: 490, width: 200, height: 20 } }
    ] },
    { nodeType: 1, id: 'visible', tag: 'DIV', attributes: {}, rect: { x: 0, y: 700, width: 300, height: 100 }, styles: {}, childNodes: [
      { nodeType: 3, id: 'visible-text', text: 'everything else', rect: { x: 10, y: 710, width: 200, height: 20 } }
    ] }
  ];
  for (const level of ['low', 'medium', 'high']) {
    const { document: result, stats } = Core.transformDocument(JSON.parse(JSON.stringify(doc)), { level });
    const serialized = JSON.stringify(result);
    for (const hidden of ['Secret unreleased draft', 'faded out', 'Only for assistive tech', 'content-visibility']) {
      assert.equal(serialized.includes(hidden), false, `${level}: hidden copy must not ship (${hidden})`);
    }
    const ids = [];
    const stack = [result.root];
    while (stack.length) { const node = stack.pop(); ids.push(node.id); stack.push(...(node.childNodes || [])); }
    assert.equal(ids.includes('menu'), false, `${level}: display:none subtree is dropped`);
    assert.equal(ids.includes('faded'), false, `${level}: opacity:0 subtree is dropped`);
    assert.equal(ids.includes('screen-reader'), false, `${level}: visibility:hidden subtree is dropped`);
    // content-visibility:hidden still paints its own box, so the box stays.
    assert.equal(ids.includes('skipped'), true, `${level}: the box survives`);
    assert.equal(ids.includes('skipped-text'), false, `${level}: its contents do not`);
    // Low replaces copy with bars, so only Medium/High still carry the characters.
    if (level === 'low') assert.ok(ids.includes('visible') && stats.bars > 0, 'low: the visible block still ships, as bars');
    else assert.equal(serialized.includes('everything else'), true, `${level}: visible copy is kept`);
    assert.ok(stats.hidden >= 3, `${level}: hidden subtrees are counted`);
  }
});

test('A zero-area wrapper is not a layer, but its children still are', () => {
  const { Core } = harness();
  const doc = snapshot();
  doc.root.childNodes = [
    { nodeType: 1, id: 'contents', tag: 'DIV', attributes: {}, rect: { x: 0, y: 0, width: 0, height: 0 }, styles: { display: 'contents' }, childNodes: [
      { nodeType: 1, id: 'child', tag: 'DIV', attributes: {}, rect: { x: 0, y: 0, width: 200, height: 100 },
        styles: { backgroundColor: 'rgb(234, 76, 137)' }, childNodes: [] }
    ] },
    { nodeType: 1, id: 'collapsed', tag: 'DIV', attributes: {}, rect: { x: 0, y: 200, width: 0, height: 0 }, styles: {}, childNodes: [] }
  ];
  const { document: result, stats } = Core.transformDocument(doc, { level: 'medium' });
  const ids = Array.from(result.root.childNodes, node => node.id);
  assert.deepEqual(ids, ['child'], `only the child is a layer: ${ids.join(', ')}`);
  assert.equal(result.root.childNodes[0].rect.width, 200);
  assert.ok(stats.flattened >= 1);
});

test('Text is bounded and stripped of characters a clipboard cannot carry', () => {
  const { Core } = harness();
  const doc = snapshot();
  const huge = 'a'.repeat(Core.LIMITS.textLength + 5000);
  doc.root.childNodes = [{
    nodeType: 1, id: 'pre', tag: 'PRE', attributes: {}, rect: { x: 0, y: 0, width: 800, height: 400 }, styles: {},
    childNodes: [{ nodeType: 3, id: 'pre-text', text: `${huge}\u0000\u001f\ud800end`, rect: { x: 0, y: 0, width: 800, height: 400 }, lineCount: 1 }]
  }];
  const { document: result } = Core.transformDocument(doc, { level: 'medium' });
  const node = result.root.childNodes[0].childNodes[0];
  assert.equal(node.nodeType, 3);
  assert.ok(node.text.length <= Core.LIMITS.textLength, `bounded: ${node.text.length}`);
  assert.ok(node.text.startsWith('aaaa'), 'the visible part is kept');
  assert.doesNotMatch(node.text, /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/, 'no control characters');
  assert.doesNotMatch(node.text, /[\ud800-\udbff](?![\udc00-\udfff])/, 'no lone surrogates');
  assert.equal(JSON.parse(JSON.stringify(result.root.childNodes[0].childNodes[0])).text, node.text, 'survives a JSON round trip');
});

test('Impossible geometry is clamped instead of pasted off-canvas', () => {
  const { Core } = harness();
  const doc = snapshot();
  doc.root.childNodes = [
    { nodeType: 1, id: 'escaped', tag: 'DIV', attributes: {}, rect: { x: 1e12, y: -1e12, width: 1e12, height: 1e12 }, styles: {}, childNodes: [] },
    { nodeType: 1, id: 'broken', tag: 'DIV', attributes: {}, rect: { x: NaN, y: Infinity, width: -40, height: 'nope' }, styles: {}, childNodes: [] }
  ];
  const { document: result } = Core.transformDocument(doc, { level: 'medium' });
  const [escaped, broken] = result.root.childNodes;
  assert.deepEqual(parse(escaped.rect), { x: Core.LIMITS.span, y: -Core.LIMITS.span, width: Core.LIMITS.size, height: Core.LIMITS.size });
  assert.equal(broken, undefined, 'a node with no usable geometry is dropped, not pasted at 0,0');
  assert.match(JSON.stringify(result), /^[^]*$/, 'serialises cleanly');
  assert.doesNotMatch(JSON.stringify(result), /null|NaN|Infinity/);
});

test('Layer ids and font families are bounded, and a font URL never ships', () => {
  const { Core } = harness();
  const doc = snapshot({ fonts: { 'Brand Serif': { url: 'https://fixture.test/brand.woff2', family: 'Brand Serif' } } });
  doc.root.childNodes = [{ nodeType: 1, id: 'z'.repeat(300), tag: 'DIV', attributes: {}, rect: { x: 0, y: 0, width: 100, height: 100 }, styles: {}, childNodes: [] }];
  const high = Core.transformDocument(doc, { level: 'high' }).document;
  assert.equal(high.root.childNodes[0].id.length, Core.LIMITS.nameLength);
  assert.deepEqual(parse(high.fonts), { 'Brand Serif': { family: 'Brand Serif' } });
  assert.doesNotMatch(JSON.stringify(high), /fixture\.test|woff2/, 'no font file URL');
  for (const level of ['low', 'medium']) {
    assert.deepEqual(parse(Core.transformDocument(doc, { level }).document.fonts), {}, `${level}: no font list at all`);
  }
});

test('The capture handed in is left exactly as it was', () => {
  const { Core } = harness();
  const doc = snapshot();
  const before = JSON.stringify(doc);
  const first = Core.transformDocument(doc, { level: 'medium' }).document;
  assert.equal(JSON.stringify(doc), before, 'the source document is not edited');
  assert.notEqual(doc.root, first.root, 'the wireframe is a new tree');
  // Rebuilding the same object twice must not drift: a second pass over our own
  // tones used to shift a Medium surface from #a8a8a8 to #d2d2d2.
  const second = Core.transformDocument(doc, { level: 'medium' }).document;
  assert.equal(JSON.stringify(first), JSON.stringify(second));
});

test('The popover names the build it is running, so a stale ZIP is visible', () => {
  const env = harness();
  // The stamp in the source must match the manifest that ships beside it: a ZIP
  // built from older files shows an older line, which is the point.
  const manifest = JSON.parse(read('manifest.json'));
  assert.equal(env.Core.BUILD.version, manifest.version);
  assert.equal(env.Wireframe.build, manifest.version);

  const host = buildPopoverHost(env.document);
  env.Wireframe.decoratePopover(host);
  const section = host.shadowRoot.querySelector('[data-wireframe-section]');
  const hint = () => section.querySelector('.hint').textContent;
  assert.match(hint(), new RegExp(`Wireframe v${manifest.version} · hook live`));
  assert.equal(section.getAttribute('data-state'), 'off');
});

test('A copy that produced the real page is reported as a miss, not as success', async () => {
  const env = harness({ storage: { pc_wireframe_v1: { on: true, level: 'medium' } } });
  const host = buildPopoverHost(env.document);
  env.Wireframe.decoratePopover(host);
  await new Promise(resolve => setTimeout(resolve, 0));
  const section = host.shadowRoot.querySelector('[data-wireframe-section]');
  const hint = () => section.querySelector('.hint').textContent;

  // A successful copy reports what it rebuilt and keeps the normal hint.
  await env.Safety.prepareClipboard([{ type: 'snapshot', id: 'a', h2dJson: JSON.stringify(snapshot()) }], {});
  assert.deepEqual({ ...env.Wireframe.wasApplied() }, { transformed: 1, snapshots: 1 });
  assert.equal(env.Wireframe.notApplied(), false);
  assert.match(hint(), /Last copy rebuilt 1 of 1/);
  assert.equal(section.getAttribute('data-state'), 'on');

  // Nothing rebuildable: the option is on, the payload is the page. That must be
  // called out, and it must survive the next popover open.
  await env.Safety.prepareClipboard([{ type: 'snapshot', id: 'b', h2dJson: '{not json' }], {});
  assert.deepEqual({ ...env.Wireframe.wasApplied() }, { transformed: 0, snapshots: 1 });
  assert.equal(env.Wireframe.notApplied(), true);
  assert.match(hint(), /was the real page, not a wireframe/);
  assert.match(hint(), /0 of 1/);
  assert.equal(section.getAttribute('data-state'), 'miss');

  // A later good copy clears the warning again.
  await env.Safety.prepareClipboard([{ type: 'snapshot', id: 'c', h2dJson: JSON.stringify(snapshot()) }], {});
  assert.equal(env.Wireframe.notApplied(), false);
  assert.doesNotMatch(hint(), /was the real page/);
});

test('With the option off no copy is ever reported as rebuilt', async () => {
  const env = harness({ storage: { pc_wireframe_v1: { on: false, level: 'medium' } } });
  await new Promise(resolve => setTimeout(resolve, 0));
  await env.Safety.prepareClipboard([{ type: 'snapshot', id: 'a', h2dJson: JSON.stringify(snapshot()) }], {});
  assert.equal(env.Wireframe.wasApplied(), null);
  assert.equal(env.Wireframe.notApplied(), false);
  const written = env.safetyCalls.at(-1).records[0];
  assert.equal(written.wireframe, undefined, 'the real capture is copied untouched');
});

/* --------------------------------------------------------------- wiring -- */

test('Wireframe is injected before the toolbar, with no extra toolbar hook', () => {
  const background = read('js/background.js');
  const list = /files:\s*\[([^\]]+)\]/.exec(background)[1];
  const order = Array.from(list.matchAll(/"([^"]+)"/g), match => match[1]);
  assert.ok(order.includes('js/wireframe-core.js') && order.includes('js/wireframe.js'));
  assert.ok(order.indexOf('js/wireframe-core.js') < order.indexOf('js/wireframe.js'));
  assert.ok(order.indexOf('js/wireframe.js') < order.indexOf('js/h2d_toolbar.js'));
  assert.ok(order.indexOf('js/capture-safety.js') < order.indexOf('js/wireframe.js'));
  const toolbar = read('js/h2d_toolbar.js');
  assert.doesNotMatch(toolbar, /PageCaptureWireframe/);
  const designSystem = read('js/design-system.js');
  assert.doesNotMatch(designSystem, /Wireframe|wireframe/);
  const manifest = JSON.parse(read('manifest.json'));
  assert.deepEqual(manifest.permissions, ['storage', 'tabs', 'unlimitedStorage', 'scripting', 'clipboardWrite']);
});

test('A choice made while storage is still loading is not overwritten', async () => {
  let resolveStorage;
  const pending = new Promise(resolve => { resolveStorage = resolve; });
  const env = harness({ storageGet: () => pending });
  const host = buildPopoverHost(env.document);
  env.Wireframe.decoratePopover(host);
  const section = host.shadowRoot.querySelector('[data-wireframe-section]');
  assert.ok(section, 'decorated without waiting for storage');
  const checkbox = section.querySelector('input');
  checkbox.checked = true;
  checkbox.dispatch('change');
  assert.equal(env.Wireframe.isEnabled(), true, 'the tick applies immediately');
  resolveStorage({ pc_wireframe_v1: { on: false, level: 'low' } });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(env.Wireframe.isEnabled(), true, 'late storage must not undo a newer choice');
  assert.equal(env.Wireframe.settings.level, 'medium');
  assert.equal(checkbox.checked, true);
  assert.equal(env.sets.length, 1, 'the choice was persisted once');
});

test('A build without the copy pipeline says so instead of doing nothing', async () => {
  const env = harness({ safety: false });
  const host = buildPopoverHost(env.document);
  env.Wireframe.decoratePopover(host);
  const section = host.shadowRoot.querySelector('[data-wireframe-section]');
  const checkbox = section.querySelector('input');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(env.Wireframe.isAvailable(), false);
  assert.equal(checkbox.disabled, true);
  assert.match(section.textContent, /Unavailable/);
  assert.equal(Array.from(section.querySelectorAll('button')).every(button => button.disabled), true);
});

test('The option re-attaches when the popover is rebuilt', () => {
  const env = harness();
  const host = buildPopoverHost(env.document);
  env.fireMutation([host]);
  assert.ok(host.shadowRoot.querySelector('[data-wireframe-section]'));
  // The Viewports popover is rebuilt from scratch on reopen: our section is gone.
  const section = host.shadowRoot.querySelector('[data-wireframe-section]');
  section.remove();
  assert.equal(host.shadowRoot.querySelector('[data-wireframe-section]'), null);
  env.fireMutation([]);
  assert.ok(host.shadowRoot.querySelector('[data-wireframe-section]'), 'the section comes back without a new host');
});

test('A truncated rebuild is reported in the popover, not passed off as complete', async () => {
  const env = harness({ storage: { pc_wireframe_v1: { on: true, level: 'low' } } });
  const host = buildPopoverHost(env.document);
  env.Wireframe.decoratePopover(host);
  await new Promise(resolve => setTimeout(resolve, 0));
  const hint = host.shadowRoot.querySelector('[data-wireframe-section]').querySelector('.hint');
  assert.doesNotMatch(hint.textContent, /layer limit/);

  const doc = snapshot();
  doc.root.childNodes = [];
  for (let index = 0; index < env.Core.LIMITS.nodes + 10; index++) {
    doc.root.childNodes.push({ nodeType: 1, id: `n-${index}`, tag: 'DIV', attributes: {}, rect: { x: 0, y: index, width: 40, height: 20 }, styles: {}, childNodes: [] });
  }
  env.Wireframe.transformRecords([{ type: 'snapshot', id: 'big', h2dJson: JSON.stringify(doc) }]);
  assert.equal(env.Wireframe.lastTruncated(), true);
  assert.match(hint.textContent, /layer limit/, 'the user is told the copy stopped');

  env.Wireframe.transformRecords([{ type: 'snapshot', id: 'small', h2dJson: JSON.stringify(snapshot()) }]);
  assert.equal(env.Wireframe.lastTruncated(), false);
  assert.doesNotMatch(hint.textContent, /layer limit/);
});

test('A copy that had to fall back does not claim to be image-free', async () => {
  const env = harness({ storage: { pc_wireframe_v1: { on: true, level: 'medium' } } });
  await new Promise(resolve => setTimeout(resolve, 0));
  const records = [
    { type: 'snapshot', id: 'ok', h2dJson: JSON.stringify(snapshot()) },
    { type: 'snapshot', id: 'broken', h2dJson: '{not json' }
  ];
  env.Wireframe.transformRecords(records);
  assert.equal(env.Wireframe.lastTransformed(), 1);
  assert.equal(env.Wireframe.lastFailed(), 1);
  // The real page went through untouched, images and all, so the summary must not
  // claim zero embedded images.
  assert.deepEqual({ ...env.Safety.imageAssetSummary(records) }, { total: 3, included: 2, notEmbedded: 1 });
  env.Wireframe.transformRecords([{ type: 'snapshot', id: 'ok', h2dJson: JSON.stringify(snapshot()) }]);
  assert.deepEqual({ ...env.Safety.imageAssetSummary(records) }, { total: 0, included: 0, notEmbedded: 0 });
});

test('The wireframe runtime stays local and never fetches a page asset', () => {
  const source = read('js/wireframe-core.js') + read('js/wireframe.js');
  assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon/);
  assert.doesNotMatch(source, /clipboard\.(?:read|readText|write)/);
  assert.doesNotMatch(source, /chrome\.(?:runtime|tabs|scripting)/);
  assert.match(source, /chrome\.storage\.local/);
});
