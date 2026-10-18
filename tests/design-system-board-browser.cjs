'use strict';
// Real extension / native rich clipboard tests. Live Figma itself is not mocked
// or claimed as tested. Instrumentation below is isolated-world and test-only.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { randomUUID } = require('node:crypto');
const root = path.resolve(process.env.EXTENSION_ROOT || path.join(__dirname, '..'));
const artifacts = path.resolve(process.env.ARTIFACT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'page-capture-board-artifacts-')));
fs.mkdirSync(artifacts, { recursive: true });
const fixtureHtml = fs.readFileSync(path.join(__dirname, 'fixtures/design-system.html'), 'utf8');
const flatten = node => [node, ...(node.childNodes || []).flatMap(flatten)];
const decode = html => {
  const read = marker => {
    const found = html.match(new RegExp(`\\(${marker}\\)([A-Za-z0-9+/=]+)\\(/${marker}\\)`));
    assert.ok(found, `${marker} marker survives the native rich clipboard`);
    return JSON.parse(Buffer.from(found[1], 'base64').toString('utf8'));
  };
  return { meta: read('figmeta'), snapshots: read('figh2d') };
};

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'page-capture-board-'));
  const server = http.createServer((request, response) => {
    const headers = { 'Content-Type': 'text/html' };
    if (request.url.startsWith('/strict')) headers['Content-Security-Policy'] = "default-src 'none'; style-src 'none'; img-src data:; frame-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'";
    response.writeHead(200, headers); response.end(fixtureHtml);
  });
  await new Promise(resolve => server.listen(0, '0.0.0.0', resolve));
  const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, acceptDownloads: true, viewport: { width: 1280, height: 900 }, args: ['--no-sandbox', `--disable-extensions-except=${root}`, `--load-extension=${root}`] });
  const remote = [], requests = [], errors = [];
  context.on('request', request => { const url = new URL(request.url()); if (['http:', 'https:'].includes(url.protocol)) { requests.push(request.url()); if (url.hostname !== '127.0.0.1') remote.push(request.url()); } });
  await context.route(/^https?:/, route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort('blockedbyclient'));
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  let checks = 0;
  const passed = name => { checks++; console.log(`PASS ${name}`); };
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const extensionId = new URL(worker.url()).host;
    const fixture = await context.newPage();
    const fixtureUrl = `http://127.0.0.1:${server.address().port}/fixture?secret=do-not-export#private`;
    await fixture.goto(fixtureUrl);
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(fixtureUrl).origin });
    const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url).id, fixtureUrl);
    const instrument = () => worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, func: () => {
      globalThis.__boardRoots = [];
      const original = Element.prototype.attachShadow;
      Element.prototype.attachShadow = function(options) { const root = original.call(this, options); globalThis.__boardRoots.push({ host: this, root }); return root; };
      const state = globalThis.__boardTest = { mode: 'normal', calls: 0, nativeWrites: 0, captures: 0, captureFinished: false, mutations: [], release: null };
      let api;
      Object.defineProperty(globalThis, 'PageCaptureDesignBoard', { configurable: true, get: () => api, set(value) {
        api = { ...value, createCopier(helpers) {
          state.helpers = helpers;
          const wait = signal => new Promise((resolve, reject) => {
            const abort = () => { state.release = null; reject(signal.reason); };
            signal.addEventListener('abort', abort, { once: true });
            state.release = () => { signal.removeEventListener('abort', abort); state.release = null; resolve(); };
          });
          return value.createCopier({
            ...helpers,
            capture: async (element, options) => {
              state.captures++; state.captureFinished = false;
              const rect = element.getBoundingClientRect();
              state.scope = { id: element.id, foreignDocument: element.ownerDocument !== document, sameRealm: element instanceof Element, privateRoot: element.getRootNode() instanceof ShadowRoot && element.getRootNode().mode === 'closed', publicBoard: !!element.ownerDocument.querySelector('main'), sheets: element.ownerDocument.styleSheets.length, x: rect.x, y: rect.y, width: rect.width, height: rect.height, forbidden: element.querySelectorAll('script,link,img,svg,canvas,video,input,a').length };
              state.options = Object.fromEntries(['extractCssVariables', 'captureSourceProps', 'skipRemoteAssetSerialization', 'skipScrollbarHiding', 'assertLayoutValid'].map(key => [key, options[key]]));
              state.boardHtml = element.outerHTML;
              if (state.mode === 'capture-fail') throw new Error('Test capture failure');
              if (state.mode === 'hold-before') await wait(options.timeoutSignal);
              const result = await helpers.capture(element, options); state.captureFinished = true;
              if (state.mode === 'hold-after') await wait(options.timeoutSignal);
              return result;
            },
            serialize: async (...args) => { if (state.mode === 'serialize-fail') throw new Error('Test serialization failure'); return helpers.serialize(...args); },
            encode: async value => { if (state.mode === 'encode-fail') throw new Error('Test encoding failure'); return helpers.encode(value); }
          });
        } };
      } });
      const write = navigator.clipboard.write.bind(navigator.clipboard);
      navigator.clipboard.write = async items => {
        state.calls++;
        if (state.mode === 'deny') throw new DOMException('Test denial', 'NotAllowedError');
        if (state.mode === 'write-hold') await new Promise(resolve => { state.release = () => { state.release = null; resolve(); }; });
        await write(items); state.nativeWrites++;
      };
    } }), tabId);
    await instrument();
    const launch = async () => {
      const requestId = randomUUID();
      await worker.evaluate(async ({ tabId, requestId }) => chrome.storage.session.set({ [`figma_h2d_toolbar_request_${requestId}`]: { tabId } }), { tabId, requestId });
      const options = await context.newPage(), closed = options.waitForEvent('close', { timeout: 15000 });
      await options.goto(`chrome-extension://${extensionId}/options.html?reason=needs_permissions&request_id=${requestId}`).catch(() => {}); await closed;
      await fixture.locator('#__figma_h2d_chrome_extension_toolbar__').waitFor({ state: 'attached' });
    };
    await launch();
    const isolated = (operation, args = {}) => worker.evaluate(async ({ tabId, operation, args }) => {
      const [result] = await chrome.scripting.executeScript({ target: { tabId }, args: [operation, args], func: async (operation, args) => {
        const entry = globalThis.__boardRoots?.find(entry => entry.host.id === (args.toolbar ? '__figma_h2d_chrome_extension_toolbar__' : '__page_capture_design_system__') && entry.host.isConnected);
        const root = entry?.root, test = globalThis.__boardTest;
        if (operation === 'point') {
          const node = args.selector ? root?.querySelector(args.selector) : [...(root?.querySelectorAll('button') || [])].find(node => node.getAttribute('aria-label') === args.label || node.textContent.trim() === args.label);
          if (!node || node.disabled) return null;
          node.scrollIntoView({ block: 'nearest', inline: 'nearest' }); const rect = node.getBoundingClientRect();
          return rect.width && rect.height ? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } : null;
        }
        if (operation === 'state') {
          const dialog = root?.querySelector('dialog'), rect = dialog?.getBoundingClientRect();
          return {
            exists: !!entry, open: !!dialog?.open, ready: !!root?.querySelector('[data-export-kind]'),
            status: root?.querySelector('[data-generator-status]')?.textContent || '', statusError: !!root?.querySelector('[data-generator-status].error'),
            busy: dialog?.getAttribute('aria-busy') === 'true', frames: root?.querySelectorAll('[data-design-system-board-frame]').length || 0,
            copyDisabled: root?.querySelector('[data-copy-design-system]')?.disabled, cancelDisabled: root?.querySelector('[data-cancel-board-copy]')?.disabled,
            downloadsDisabled: [...(root?.querySelectorAll('[data-export-kind]') || [])].every(node => node.disabled),
            editableControls: root?.querySelectorAll('dialog input:enabled,dialog select:enabled').length || 0,
            active: root?.activeElement?.dataset.focusKey, width: rect?.width, right: rect?.right, bottom: rect?.bottom,
            horizontalOverflow: dialog ? dialog.scrollWidth > dialog.clientWidth + 1 : false,
            rows: [...(root?.querySelectorAll('.row') || [])].map(row => ({ id: row.dataset.tokenId, name: row.querySelector('[data-token-name]').value, value: row.querySelector('.value').textContent, included: !row.classList.contains('excluded') })),
            calls: test.calls, nativeWrites: test.nativeWrites, captures: test.captures, captureFinished: test.captureFinished, scope: test.scope, captureOptions: test.options,
            mutations: test.mutations, release: typeof test.release === 'function'
          };
        }
        if (operation === 'select') { const select = root.querySelector(args.selector); select.value = args.value; select.dispatchEvent(new Event('change', { bubbles: true })); return; }
        if (operation === 'mode') { test.mode = args.mode; test.captureFinished = false; return; }
        if (operation === 'release') { test.release?.(); return; }
        if (operation === 'board-html') return test.boardHtml;
        if (operation === 'source-watch') {
          test.observer?.disconnect(); test.mutations = [];
          test.observer = new MutationObserver(records => {
            for (const record of records) {
              if (record.target instanceof Element && record.target.closest('[data-h2d-ignore="true"]')) continue;
              const changed = [...record.addedNodes, ...record.removedNodes];
              if (record.type === 'childList' && changed.length && changed.every(node => node instanceof Element && node.getAttribute('data-h2d-ignore') === 'true')) continue;
              test.mutations.push({ type: record.type, tag: record.target.nodeName, attribute: record.attributeName });
            }
          });
          test.observer.observe(document.documentElement, { attributes: true, characterData: true, childList: true, subtree: true }); return;
        }
        if (operation === 'large-copy') {
          const Core = globalThis.PageCaptureDesignSystemCore;
          const styles = Array.from({ length: 80 }, (_, i) => ({ hasText: true, styles: {
            color: `rgb(${i + 1}, 80, 160)`, backgroundColor: 'transparent', fontFamily: 'Arial', fontSize: `${14 + i / 4}px`, fontWeight: '400', fontStyle: 'normal', lineHeight: '30px', letterSpacing: 'normal',
            paddingTop: `${i + 1}px`, borderTopLeftRadius: `${i + 1}px`, boxShadow: `rgba(0,0,0,.2) 0px ${i + 1}px 12px 0px`, borderTopWidth: `${i + 1}px`, borderTopStyle: 'solid', borderTopColor: '#445566'
          } }));
          const model = Core.buildSystem(styles, { title: 'Maximum board fixture', url: 'https://example.com/system?secret=private', viewport: { width: 1440, height: 900 } });
          const counts = Object.fromEntries(Core.categories.map(category => [category.id, model.tokens.filter(token => token.category === category.id).length]));
          const copied = await globalThis.PageCaptureDesignBoard.createCopier(test.helpers)(model, { mount: root });
          return { counts, copied };
        }
      } }); return result.result;
    }, { tabId, operation, args });
    const waitFor = async (predicate, message, timeout = 18000) => {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) { const state = await isolated('state'); if (predicate(state)) return state; await new Promise(resolve => setTimeout(resolve, 30)); }
      throw new Error(`Timed out: ${message}; ${JSON.stringify(await isolated('state'))}`);
    };
    const click = async (label, args = {}) => {
      const point = await isolated('point', { label, ...args }); assert.ok(point, `Clickable: ${label || args.selector}`);
      await fixture.bringToFront(); await fixture.mouse.click(point.x, point.y);
    };
    const type = async (selector, value) => { await click('', { selector }); await fixture.keyboard.press('Control+A'); await fixture.keyboard.insertText(value); };
    const open = async () => { await click('More tools', { toolbar: true }); await click('', { selector: '[role="menuitem"]' }); return waitFor(state => state.ready, 'analysis'); };
    const copied = async () => { await click('Copy design system'); return waitFor(state => !state.busy && /tokens copied as an editable board/.test(state.status), 'native board copy'); };
    const clipboard = () => fixture.evaluate(async () => { for (const item of await navigator.clipboard.read()) if (item.types.includes('text/html')) return (await item.getType('text/html')).text(); return ''; });
    const seed = text => fixture.evaluate(text => navigator.clipboard.writeText(text), text);
    const json = async () => {
      const pending = fixture.waitForEvent('download'); await click('', { selector: '[data-export-kind="json"]' });
      const file = await pending, saved = path.join(artifacts, `review-${Date.now()}.json`); await file.saveAs(saved); return JSON.parse(fs.readFileSync(saved, 'utf8'));
    };
    const sourceSnapshot = () => fixture.evaluate(() => {
      const clone = document.documentElement.cloneNode(true); clone.querySelectorAll('[data-h2d-ignore="true"]').forEach(node => node.remove());
      const card = document.querySelector('.card').getBoundingClientRect();
      return { html: clone.outerHTML, width: innerWidth, height: innerHeight, scrollX, scrollY, input: document.querySelector('input').value, sheets: document.adoptedStyleSheets.length, card: { x: card.x, y: card.y, width: card.width, height: card.height } };
    });

    let state = await open(); assert.equal(state.copyDisabled, false);
    await fixture.screenshot({ caret: 'initial', path: path.join(artifacts, 'copy-desktop.png') });
    const model = await json(), sourceBefore = await sourceSnapshot(), baselineRequests = requests.length;
    await isolated('source-watch'); await seed('BEFORE_BOARD');
    state = await copied();
    const html = await clipboard(), payload = decode(html), doc = payload.snapshots[0], nodes = flatten(doc.root);
    fs.writeFileSync(path.join(artifacts, 'native-board-clipboard.html'), html);
    fs.writeFileSync(path.join(artifacts, 'native-board-snapshot.json'), JSON.stringify(payload, null, 2));
    assert.equal(payload.snapshots.length, 1); assert.equal(doc.version, 2); assert.equal(doc.type, 'snapshot');
    assert.equal(doc.root.tag, 'MAIN'); assert.equal(doc.root.attributes.id, 'design-system');
    assert.equal(doc.root.rect.width, 1120); assert.ok(doc.root.rect.height > 800);
    assert.equal(doc.root.rect.x, 0); assert.equal(doc.root.rect.y, 0);
    assert.equal(doc.documentTitle, 'Workspace UI — Design system'); assert.deepEqual(doc.assets, {});
    assert.ok(nodes.filter(node => node.nodeType === 3).length > 100);
    assert.ok(nodes.some(node => node.text === 'Aa Bb 0123'));
    assert.ok(nodes.some(node => node.styles?.boxShadow));
    assert.ok(!nodes.some(node => ['IMG', 'CANVAS', 'SVG', 'IFRAME'].includes(node.tag)));
    const tokenNames = Object.values(model.tokens).flatMap(group => Object.keys(group));
    assert.deepEqual(nodes.filter(node => node.tag === 'ARTICLE').map(node => node.attributes.id).sort(), tokenNames.map(name => `token-${name}`).sort());
    assert.equal(payload.meta.dataType, 'h2d'); assert.equal(payload.meta.source, 'chrome-extension'); assert.ok(Date.parse(payload.meta.capturedAtIso));
    assert.equal(state.frames, 0); assert.equal(state.active, 'copy-design-system');
    passed('A real click writes native figmeta/figh2d HTML containing one complete editable six-category board, not a screenshot');

    assert.equal(state.scope.foreignDocument, true); assert.equal(state.scope.sameRealm, true); assert.equal(state.scope.privateRoot, true); assert.equal(state.scope.publicBoard, false); assert.equal(state.scope.sheets, 0); assert.equal(state.scope.forbidden, 0);
    assert.deepEqual(state.captureOptions, { extractCssVariables: false, captureSourceProps: false, skipRemoteAssetSerialization: true, skipScrollbarHiding: true, assertLayoutValid: false });
    const data = JSON.stringify(doc);
    for (const secret of ['do-not-export-this-secret', 'private-api-key', 'Never export this private page sentence', 'private-input-should-not-export', '?secret=', '#private', '__page_capture_design_system__', 'variableStyles', 'sourceProps']) assert.ok(!data.includes(secret), `No private/source/binding data: ${secret}`);
    assert.deepEqual(await sourceSnapshot(), sourceBefore); assert.deepEqual(state.mutations, []);
    assert.equal(requests.length, baselineRequests); assert.deepEqual(await json(), model);
    const capturesKey = `figma_h2d_toolbar_captures_${tabId}`;
    assert.equal(await worker.evaluate(async key => ((await chrome.storage.local.get(key))[key] || []).length, capturesKey), 0);
    passed('Copy captures only isolated reviewed-token DOM, with no source mutations, asset requests, variable bindings, model changes or tray items');

    const boardHtml = await isolated('board-html');
    const guide = await context.newPage();
    await guide.setContent(`<html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"></head><body style="margin:0;background:#202020">${boardHtml}</body></html>`);
    await guide.setViewportSize({ width: 1120, height: 900 });
    await guide.screenshot({ caret: 'initial', fullPage: true, path: path.join(artifacts, 'editable-board.png') }); await guide.close(); await fixture.bringToFront();
    passed('The decoded board retains positive full-height layout, real text and individual swatch/effect/card shapes');

    const brand = state.rows.find(row => row.name === 'brand-primary'), alternate = state.rows.find(row => row.name === 'brand-secondary'), excluded = state.rows.find(row => row.value === '#b91c1c');
    assert.ok(brand && alternate && excluded);
    await type(`[data-token-name="${brand.id}"]`, 'Invalid Name'); state = await isolated('state'); assert.equal(state.copyDisabled, true); assert.equal(state.downloadsDisabled, true);
    await type(`[data-token-name="${brand.id}"]`, 'brand-board');
    await click('', { selector: `.row[data-token-id="${excluded.id}"] button.include` });
    await click('', { selector: `.row[data-token-id="${brand.id}"] input[type="checkbox"]` });
    await click('', { selector: `.row[data-token-id="${alternate.id}"] input[type="checkbox"]` }); await click('Merge (2)');
    await isolated('select', { selector: '[aria-label="Canonical token to keep"]', value: brand.id }); await click('Merge tokens');
    await type('[aria-label="Search tokens"]', 'brand-board');
    const reviewed = await json(); state = await copied();
    const reviewedHtml = await clipboard(), reviewedDoc = decode(reviewedHtml).snapshots[0], reviewedNodes = flatten(reviewedDoc.root);
    const expectedNames = Object.values(reviewed.tokens).flatMap(group => Object.keys(group));
    assert.deepEqual(reviewedNodes.filter(node => node.tag === 'ARTICLE').map(node => node.attributes.id).sort(), expectedNames.map(name => `token-${name}`).sort());
    assert.ok(reviewedNodes.some(node => node.text === 'brand-board')); assert.ok(!reviewedNodes.some(node => node.text === '#b91c1c' || node.text === '#7c3aee'));
    assert.equal(reviewedNodes.filter(node => node.tag === 'SECTION').length, 6); assert.deepEqual(await json(), reviewed);
    passed('Copy respects rename/exclude/canonical merges and validation, but ignores row selection, active category and search filters');

    await isolated('mode', { mode: 'hold-before' }); const callsBeforeCancel = state.calls;
    await click('Copy design system'); state = await waitFor(state => state.busy && state.frames === 1 && state.release, 'preparing board');
    assert.equal(state.copyDisabled, true); assert.equal(state.downloadsDisabled, true); assert.equal(state.editableControls, 0); assert.equal(state.cancelDisabled, false);
    await click('', { selector: '[data-cancel-board-copy]' }); state = await waitFor(state => !state.busy, 'cancel preparation');
    assert.equal(state.frames, 0); assert.equal(state.calls, callsBeforeCancel); assert.match(state.status, /cancelled/); assert.equal(await clipboard(), reviewedHtml);
    passed('Preparation has a real cancel action, disables conflicting edits/repeat copies, cleans up immediately and leaves clipboard intact');

    await isolated('mode', { mode: 'hold-after' }); await click('Copy design system');
    await waitFor(state => state.busy && state.captureFinished && state.release, 'captured board awaiting serialization');
    await fixture.keyboard.press('Escape'); state = await waitFor(state => !state.exists, 'Escape cancellation');
    assert.equal(state.calls, callsBeforeCancel); assert.equal(await clipboard(), reviewedHtml);
    await open(); assert.ok((await isolated('state')).rows.some(row => row.name === 'brand-board'));
    passed('Escape aborts a real in-progress snapshot without a late clipboard overwrite; the completed token review survives reopening');

    await isolated('mode', { mode: 'hold-before' }); await click('Copy design system'); await waitFor(state => state.busy && state.release, 'preempted board preparation');
    await worker.evaluate(async tabId => chrome.tabs.sendMessage(tabId, { type: 'FIGMA_H2D_TOOLBAR_COMMAND', command: 'capture_code' }, { frameId: 0 }), tabId);
    await waitFor(state => !state.exists, 'capture command preemption');
    await fixture.waitForFunction(async () => (await navigator.clipboard.readText()).includes('<title>Workspace UI</title>'));
    const raw = await fixture.evaluate(() => navigator.clipboard.readText()); assert.ok(!raw.includes('__page_capture_design_system__'));
    assert.equal((await isolated('state')).calls, callsBeforeCancel);
    await isolated('mode', { mode: 'normal' }); await open();
    passed('An existing capture command aborts board preparation before copying raw HTML, with no temporary board/UI leak or delayed overwrite');

    await seed('KEEP_IF_DENIED'); await isolated('mode', { mode: 'deny' }); await click('Copy design system');
    state = await waitFor(state => !state.busy && state.statusError, 'clipboard denial');
    assert.match(state.status, /Clipboard write failed/); assert.equal(state.copyDisabled, false); assert.equal(state.frames, 0);
    assert.equal(await fixture.evaluate(() => navigator.clipboard.readText()), 'KEEP_IF_DENIED');
    passed('Clipboard denial is an error, not a success claim; the old clipboard survives and the panel is usable again');

    for (const mode of ['capture-fail', 'serialize-fail', 'encode-fail']) {
      await isolated('mode', { mode }); const calls = (await isolated('state')).calls;
      await click('Copy design system'); state = await waitFor(state => !state.busy && state.statusError, mode);
      assert.equal(state.frames, 0); assert.equal(state.calls, calls); assert.equal(state.copyDisabled, false);
      assert.equal(await fixture.evaluate(() => navigator.clipboard.readText()), 'KEEP_IF_DENIED');
    }
    passed('Capture/serialization/encoding failures clean up without a clipboard write and allow retry');

    await isolated('mode', { mode: 'hold-before' }); await click('Copy design system');
    state = await waitFor(state => !state.busy && state.statusError, 'real 12-second preparation timeout', 18000);
    assert.match(state.status, /timed out/); assert.equal(state.frames, 0); assert.equal(await fixture.evaluate(() => navigator.clipboard.readText()), 'KEEP_IF_DENIED');
    passed('The real preparation deadline aborts an unresponsive operation and removes its isolated frame');

    await isolated('mode', { mode: 'write-hold' }); await click('Copy design system');
    state = await waitFor(state => state.busy && state.release && /Writing design-system/.test(state.status), 'final native write phase');
    assert.equal(state.cancelDisabled, true); assert.equal(state.frames, 0); assert.equal(state.copyDisabled, true);
    await isolated('release'); state = await waitFor(state => !state.busy && /tokens copied/.test(state.status), 'final native write');
    assert.equal(state.copyDisabled, false); await isolated('mode', { mode: 'normal' });
    passed('Preparation resources are removed before native writing; final-phase cancellation is disabled because browser clipboard writes are not revocable');

    for (const [width, height, name] of [[390, 844, 'mobile'], [390, 480, 'mobile-short'], [1280, 400, 'desktop-short']]) {
      await fixture.setViewportSize({ width, height }); state = await copied();
      assert.ok(state.right <= width && state.bottom <= height && !state.horizontalOverflow, JSON.stringify(state));
      assert.equal(decode(await clipboard()).snapshots[0].root.rect.width, 1120);
      await fixture.screenshot({ caret: 'initial', path: path.join(artifacts, `copy-${name}.png`) });
    }
    await fixture.setViewportSize({ width: 1280, height: 900 });
    passed('Desktop, narrow and short layouts retain reachable copy controls without resizing the website; pasted board width stays consistent');

    const large = await isolated('large-copy'); assert.deepEqual(Object.values(large.counts), [80, 80, 80, 80, 80, 80]); assert.equal(large.copied.count, 480);
    const largeDoc = decode(await clipboard()).snapshots[0], largeNodes = flatten(largeDoc.root);
    assert.equal(largeNodes.filter(node => node.tag === 'ARTICLE').length, 480); assert.equal(largeNodes.filter(node => node.tag === 'SECTION').length, 6);
    assert.ok(largeDoc.root.rect.height > 10000); assert.equal(Object.keys(largeDoc.assets).length, 0); assert.deepEqual(await json(), reviewed);
    passed('The maximum 480-token board is copied as one full-height editable snapshot with no dropped cards or source-model changes');

    await click('Close design system'); await click('Close', { toolbar: true });
    await fixture.locator('#__figma_h2d_chrome_extension_toolbar__').waitFor({ state: 'detached' });
    assert.deepEqual(await sourceSnapshot(), sourceBefore); assert.deepEqual((await isolated('state')).mutations, []);
    assert.equal(requests.length, baselineRequests);
    await fixture.goto(`http://127.0.0.1:${server.address().port}/strict`); await instrument(); await launch(); await open();
    const strictBefore = await sourceSnapshot(), strictRequests = requests.length;
    await isolated('source-watch'); state = await copied();
    const strictDoc = decode(await clipboard()).snapshots[0]; assert.equal(strictDoc.root.rect.width, 1120); assert.ok(strictDoc.root.rect.height > 0);
    assert.equal(state.scope.foreignDocument, true); assert.equal(state.scope.sheets, 0); assert.equal(state.frames, 0);
    assert.deepEqual(await sourceSnapshot(), strictBefore); assert.deepEqual(state.mutations, []); assert.equal(requests.length, strictRequests);
    await fixture.screenshot({ caret: 'initial', path: path.join(artifacts, 'copy-strict-csp.png') });
    passed('A strict-CSP page (including frame-src/style-src none) still supports isolated editable-board copying without source writes or subresource requests');

    await click('Close design system'); await click('Close', { toolbar: true });
    await fixture.locator('#__figma_h2d_chrome_extension_toolbar__').waitFor({ state: 'detached' });
    assert.deepEqual(remote, []); assert.deepEqual(errors, []);
    passed('Closing/reinjecting releases all temporary UI; tested board flows make zero external requests or uncaught page errors');
    console.log(`\n${checks} editable-board Chromium checks passed. Artifacts: ${artifacts}`);
  } finally {
    await context.close(); await new Promise(resolve => server.close(resolve)); fs.rmSync(profile, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
