'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const toolbar = fs.readFileSync(path.join(__dirname, '..', 'extension/js/h2d_toolbar.js'), 'utf8');

function serializerHarness() {
  const allowed = toolbar.match(/var jc=new Set\(\[[^;]+\]\);/)[0];
  const types = toolbar.match(/var _r=new Set\(\[[^;]+\]\);/)[0];
  const fn = toolbar.slice(toolbar.indexOf('function $c(e)'), toolbar.indexOf('function yn(', toolbar.indexOf('function $c(e)')));
  class Base {
    constructor(attributes = {}) { this.attributes = Object.entries(attributes).map(([name, value]) => ({ name, value })); }
  }
  class HTMLInputElement extends Base { constructor(type = 'text', value = '', attributes = {}) { super(attributes); this.type = type; this.value = value; this.checked = false; this.indeterminate = false; } }
  class HTMLTextAreaElement extends Base { constructor(value, attributes = {}) { super(attributes); this.value = value; } }
  class HTMLOptionElement extends Base { constructor(selected, label, attributes = {}) { super(attributes); this.selected = selected; this.label = label; } }
  class HTMLSelectElement extends Base {}
  class HTMLButtonElement extends Base {}
  class HTMLImageElement extends Base {}
  class HTMLVideoElement extends Base {}
  const context = vm.createContext({ HTMLInputElement, HTMLTextAreaElement, HTMLOptionElement, HTMLSelectElement, HTMLButtonElement, HTMLImageElement, HTMLVideoElement });
  vm.runInContext(`${types}\n${allowed}\n${fn};globalThis.serializeAttributes=$c`, context);
  return { context, classes: { HTMLInputElement, HTMLTextAreaElement, HTMLOptionElement, HTMLSelectElement, HTMLButtonElement } };
}

test('Visible text-like inputs serialize their current property, not their stale HTML attribute', () => {
  const h = serializerHarness(), input = new h.classes.HTMLInputElement('email', 'current@example.com', { value: 'old@example.com', id: 'email' });
  const attributes = h.context.serializeAttributes(input);
  assert.equal(attributes.value, 'current@example.com');
  assert.equal(attributes.id, 'email');
});

test('Textareas preserve the current visible value', () => {
  const h = serializerHarness(), textarea = new h.classes.HTMLTextAreaElement('edited text', { placeholder: 'Write here' });
  assert.equal(h.context.serializeAttributes(textarea).value, 'edited text');
});

test('Checkbox and radio state includes checked and indeterminate without exposing a value ID', () => {
  const h = serializerHarness(), input = new h.classes.HTMLInputElement('checkbox', 'private-value-id', { value: 'private-value-id' });
  input.checked = true; input.indeterminate = true;
  const attributes = h.context.serializeAttributes(input);
  assert.equal(attributes.checked, 'true');
  assert.equal(attributes.indeterminate, 'true');
  assert.equal(Object.hasOwn(attributes, 'value'), false);
});

test('Select options use the live selected property and keep only visible labels', () => {
  const h = serializerHarness(), selected = new h.classes.HTMLOptionElement(true, 'Visible label', { value: 'private-option-id', selected: 'false' });
  const attributes = h.context.serializeAttributes(selected);
  assert.equal(attributes.selected, 'true');
  assert.equal(attributes.label, 'Visible label');
  assert.equal(Object.hasOwn(attributes, 'value'), false);
  const select = new h.classes.HTMLSelectElement({ value: 'private-select-id' });
  assert.equal(Object.hasOwn(h.context.serializeAttributes(select), 'value'), false);
});

test('Password values stay redacted in editable design captures', () => {
  const h = serializerHarness(), password = new h.classes.HTMLInputElement('password', 'current-secret', { value: 'old-secret' });
  assert.equal(Object.hasOwn(h.context.serializeAttributes(password), 'value'), false);
});

test('The established capture walker rasterizes canvas/video and collects both pseudo-elements', () => {
  assert.match(toolbar, /HTMLCanvasElement\?M=o\.addCanvas\(t\)/);
  assert.match(toolbar, /HTMLVideoElement&&\(M=o\.addVideo\(t\)\)/);
  assert.match(toolbar, /collectedPseudoElements\.collect\(t,T,"::before"\)/);
  assert.match(toolbar, /collectedPseudoElements\.collect\(t,T,"::after"\)/);
  assert.match(toolbar, /pseudoElementNodes:Gr/);
});

test('Transient notices retain accessible semantics and add reduced-motion-aware progress', () => {
  assert.match(toolbar, /data-toolbar-role","transient-progress/);
  assert.match(toolbar, /prefers-reduced-motion: reduce/);
  assert.match(toolbar, /o\.setAttribute\("role","status"\)/);
  assert.match(toolbar, /o\.setAttribute\("aria-live","polite"\)/);
  assert.match(toolbar, /scaleX\(0\).*scaleX\(1\)/);
});
