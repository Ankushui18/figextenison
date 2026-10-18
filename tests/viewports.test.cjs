'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const toolbar = fs.readFileSync(path.join(__dirname, '..', 'js/h2d_toolbar.js'), 'utf8');
const layoutSource = toolbar.slice(toolbar.indexOf('function __vpPosition('), toolbar.indexOf('function __vpButton('));
const settingsSource = toolbar.slice(toolbar.indexOf('var __vpKey='), toolbar.indexOf('function __vpIcon('));
const plain = value => JSON.parse(JSON.stringify(value));
const layout = vm.runInNewContext(`${layoutSource};__vpPosition`);
function settings(stored, fail = false) {
  const writes = [], reads = [], context = vm.createContext({
    window: {}, chrome: { storage: { local: {
      get: async key => { reads.push(key); if (fail) throw Error('Local storage unavailable'); return { [key]: stored }; },
      set: async value => { writes.push(plain(value)); if (fail) throw Error('Local storage unavailable'); }
    } } }
  });
  vm.runInContext(settingsSource, context); return { context, writes, reads };
}

test('Viewport panel is positioned below the visible top-docked trigger', () => {
  assert.deepEqual(plain(layout({ left: 800, width: 100, top: 24, bottom: 48 }, 212, 260, 1280, 900)), { left: 744, top: 56 });
});
test('Bottom docking flips the viewport panel above its trigger', () => {
  assert.deepEqual(plain(layout({ left: 800, width: 100, top: 852, bottom: 876 }, 212, 260, 1280, 900)), { left: 744, top: 584 });
});
test('Viewport panel clamps both horizontal edges', () => {
  assert.equal(layout({ left: 0, width: 20, top: 24, bottom: 48 }, 212, 260, 1280, 900).left, 8);
  const right = layout({ left: 1250, width: 30, top: 24, bottom: 48 }, 212, 260, 1280, 900);
  assert.equal(right.left + 212, 1272);
});
test('Short windows clamp an oversized preferred position into the visible area', () => {
  const rect = layout({ left: 140, width: 40, top: 70, bottom: 94 }, 212, 144, 320, 160);
  assert.equal(rect.top, 8); assert.ok(rect.left >= 8 && rect.left + 212 <= 312);
});
test('Even a stale off-screen anchor cannot place the panel below the window', () => {
  const rect = layout({ left: 0, width: 1280, top: 1622, bottom: 1622 }, 212, 260, 1280, 900);
  assert.ok(rect.top >= 8 && rect.top + 260 <= 892);
});
test('Negative/fractional anchors stay bounded after scrolling or toolbar animation', () => {
  for (const top of [-300.25, -1.5, 12.75, 850.5]) {
    const result = layout({ left: -20.5, width: 103.875, top, bottom: top + 24 }, 212, 260, 390, 844);
    assert.ok(Number.isFinite(result.left) && Number.isFinite(result.top));
    assert.ok(result.left >= 8 && result.left + 212 <= 382 && result.top >= 8 && result.top + 260 <= 836);
  }
});
test('Existing Browser + five viewport defaults and selections are preserved', () => {
  const { context } = settings(); const defaults = plain(context.__vpDefaults());
  assert.deepEqual(defaults.map(row => row.id), ['browser', '1600', '1440', '1024', '768', '393']);
  assert.deepEqual(defaults.filter(row => row.on).map(row => row.id), ['browser']);
});
test('Local stored sizes/selections are read, rounded and bounded without adding unknown rows', async () => {
  const h = settings([{ id: 'browser', on: false }, { id: '1600', on: true, w: 50000 }, { id: '1440', on: true, w: -100 }, { id: '1024', on: true, w: 1000.6 }, { id: 'other', on: true, w: 1 }]);
  const rows = plain(await h.context.__vpLoad());
  assert.equal(rows.length, 6); assert.equal(rows[0].on, false); assert.equal(rows[1].w, 3840); assert.equal(rows[2].w, 200); assert.equal(rows[3].w, 1001);
  assert.deepEqual(h.reads, ['pc_viewports_v1']);
});
test('Malformed/non-finite saved widths safely retain the existing defaults', async () => {
  const h = settings([{ id: '768', on: true, w: Infinity }, { id: '393', on: true, w: 'bad' }, null]);
  const rows = plain(await h.context.__vpLoad()); assert.equal(rows[4].w, 768); assert.equal(rows[5].w, 393);
  assert.deepEqual(plain(await settings({ invalid: true }).context.__vpLoad()), plain(h.context.__vpDefaults()));
});
test('Saving viewport preferences writes only the existing local storage key/schema', async () => {
  const h = settings(); await h.context.__vpLoad(); h.context.__vpState[5].on = true; h.context.__vpState[5].w = 412; await h.context.__vpSave();
  assert.equal(h.writes.length, 1); assert.deepEqual(Object.keys(h.writes[0]), ['pc_viewports_v1']);
  assert.deepEqual(h.writes[0].pc_viewports_v1[5], { id: '393', on: true, w: 412 });
});
test('Storage denial falls back to defaults and does not create an unhandled rejection', async () => {
  const h = settings(undefined, true); assert.equal((await h.context.__vpLoad()).length, 6); await h.context.__vpSave();
});
test('Responsive selection no longer invokes a temporary-window capture RPC or recursion flag', async () => {
  const h = settings(); assert.deepEqual(plain(await h.context.__vpSelected()).map(row => row.id), ['browser']);
  assert.doesNotMatch(toolbar, /H2D_CAPTURE_VIEWPORT|__pcNoViewports|__vpRace/);
  assert.match(toolbar, /PageCaptureViewports\?\.createCapturer/);
  const worker = fs.readFileSync(path.join(__dirname, '..', 'js/background.js'), 'utf8');
  assert.doesNotMatch(worker, /chrome\.windows\.create|captureViewport|H2D_CAPTURE_VIEWPORT/);
});
test('Opening is awaited, resolves live controls instead of the page-flow host and has bounded cleanup', () => {
  assert.match(toolbar, /run:\(\)=>__vpToggle\(r\(\)\)/);
  assert.doesNotMatch(toolbar, /__vpToggle\(r\(\)\.element\)/);
  assert.match(toolbar, /anchor=trigger\|\|controller\.toolbarEl/);
  assert.match(toolbar, /max-width:calc\(100vw - 16px\);max-height:calc\(100vh - 16px\)/);
  assert.match(toolbar, /cancelAnimationFrame\(pop\.raf\);pop\.abort\.abort\(\)/);
  assert.match(toolbar, /"action-run"===x\.type&&"viewports"!==x\.actionId&&__vpClose\(\)/);
});
