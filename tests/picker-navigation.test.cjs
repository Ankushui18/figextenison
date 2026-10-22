'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..', 'extension');
const source = fs.readFileSync(path.join(root, 'js/picker-navigation.js'), 'utf8');
const context = vm.createContext({});
vm.runInContext(source, context);
const Navigation = context.PageCapturePickerNavigation;

function tree() {
  const make = (name, parent = null) => ({
    name, nodeType: 1, parentElement: parent, children: [], nextElementSibling: null,
    getRootNode() { return { host: this.shadowHost || null }; }
  });
  const append = (parent, ...children) => {
    children.forEach((child, index) => {
      child.parentElement = parent;
      child.nextElementSibling = children[index + 1] || null;
      parent.children.push(child);
    });
    return children;
  };
  const root = make('root'), first = make('first'), second = make('second'), ignored = make('ignored');
  append(root, first, ignored, second);
  const grandchild = make('grandchild'); append(first, grandchild);
  return { root, first, second, ignored, grandchild, make, append };
}

test('Arrow-down navigation chooses the first selectable child', () => {
  const h = tree();
  assert.equal(Navigation.childOrSibling(h.first).name, 'grandchild');
});

test('A leaf moves to its next sibling and skips ignored extension UI', () => {
  const h = tree();
  assert.equal(Navigation.childOrSibling(h.grandchild, element => element === h.ignored), null, 'a grandchild has no sibling at this level');
  assert.equal(Navigation.childOrSibling(h.first, element => element === h.ignored).name, 'grandchild');
  assert.equal(Navigation.childOrSibling(h.grandchild, () => false), null);
  h.grandchild.nextElementSibling = h.ignored;
  h.ignored.nextElementSibling = h.second;
  assert.equal(Navigation.childOrSibling(h.grandchild, element => element === h.ignored).name, 'second');
});

test('An ignored subtree is never entered to find a selectable descendant', () => {
  const h = tree();
  h.first.shadowRoot = { children: [h.ignored] };
  h.ignored.parentElement = null;
  assert.equal(Navigation.childOrSibling(h.first, element => element === h.ignored).name, 'second');
});

test('Open shadow-root children and slot assignments are valid keyboard destinations', () => {
  const h = tree(), shadowChild = h.make('shadow-child');
  h.first.shadowRoot = { children: [shadowChild] };
  assert.equal(Navigation.childOrSibling(h.first).name, 'shadow-child');
  const slot = h.make('slot'), assigned = h.make('assigned');
  slot.assignedElements = () => [assigned];
  assert.equal(Navigation.childOrSibling(slot).name, 'assigned');
});

test('Arrow-up navigation crosses a shadow boundary and skips ignored hosts', () => {
  const h = tree(), host = h.make('host'), child = h.make('shadow-child');
  child.parentElement = null;
  child.getRootNode = () => ({ host });
  assert.equal(Navigation.parent(child).name, 'host');
  const outer = h.make('outer'); host.parentElement = outer;
  assert.equal(Navigation.parent(child, element => element === host).name, 'outer');
});

test('Traversal is bounded at the end of the current sibling group', () => {
  const h = tree();
  assert.equal(Navigation.childOrSibling(h.second), null);
  assert.equal(Navigation.parent(h.root), null);
  assert.equal(Navigation.childOrSibling(null), null);
});

test('The existing picker uses the helper and retains confirm/cancel keyboard handling', () => {
  const toolbar = fs.readFileSync(path.join(root, 'js/h2d_toolbar.js'), 'utf8');
  assert.match(toolbar, /PageCapturePickerNavigation\.parent/);
  assert.match(toolbar, /PageCapturePickerNavigation\.childOrSibling/);
  assert.match(toolbar, /"Enter"===t\.key/);
  assert.match(toolbar, /"Escape"===t\.key/);
});
