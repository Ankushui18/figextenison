'use strict';
// Actual extension clicks on long/scrolled pages. No fixed screen coordinates.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const root = path.resolve(process.env.EXTENSION_ROOT || path.join(__dirname, '..', 'extension'));
const artifacts = path.resolve(process.env.ARTIFACT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'page-capture-viewports-artifacts-')));
fs.mkdirSync(artifacts, { recursive: true });
const html = fs.readFileSync(path.join(__dirname, 'fixtures/viewports.html'), 'utf8');
(async () => {
  const server = http.createServer((request, response) => { response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end(html); });
  await new Promise(resolve => server.listen(0, '0.0.0.0', resolve));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'page-capture-viewports-'));
  // No context-wide viewport emulation: popup windows must use their native size.
  const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, viewport: null, args: ['--no-sandbox', '--window-size=1280,900', `--disable-extensions-except=${root}`, `--load-extension=${root}`] });
  const requests = [], remote = [], errors = [];
  context.on('request', request => { const url = new URL(request.url()); if (['http:', 'https:'].includes(url.protocol)) { requests.push({ url: request.url(), method: request.method(), body: request.postData() }); if (url.hostname !== '127.0.0.1') remote.push(request.url()); } });
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  await context.route(/^https?:/, route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort('blockedbyclient'));
  let checks = 0; const passed = message => { checks++; console.log(`PASS ${message}`); };
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const page = await context.newPage(), url = `http://127.0.0.1:${server.address().port}/long-page`;
    await page.goto(url); await page.bringToFront();
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(url).origin });
    const tabId = await worker.evaluate(async url => {
      const tab = (await chrome.tabs.query({})).find(tab => tab.url === url);
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => {
        globalThis.__viewportTestRoots = []; const original = Element.prototype.attachShadow;
        Element.prototype.attachShadow = function(options) { const root = original.call(this, options); globalThis.__viewportTestRoots.push({ host: this, root }); return root; };
      } }); return tab.id;
    }, url);
    const inject = () => worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, files: ['js/privacy.js', 'js/capture-safety.js', 'js/design-system-core.js', 'js/design-system-board.js', 'js/design-system.js', 'js/viewports.js', 'js/h2d_toolbar.js'] }), tabId);
    await inject(); await page.locator('#__figma_h2d_chrome_extension_toolbar__').waitFor({ state: 'attached' });
    const isolated = (operation, args = {}) => worker.evaluate(async ({ tabId, operation, args }) => {
      const [result] = await chrome.scripting.executeScript({ target: { tabId }, args: [operation, args], func: (operation, args) => {
        const host = document.getElementById('__figma_h2d_chrome_extension_toolbar__'), root = globalThis.__viewportTestRoots.find(entry => entry.host === host)?.root;
        const pop = document.getElementById('__pc_viewports__'), box = pop?.shadowRoot?.querySelector('.box');
        const buttons = [...(root?.querySelectorAll('button') || [])].filter(node => !node.closest('[data-exit-role]'));
        const button = label => buttons.find(node => (node.getAttribute('aria-label') || node.textContent.trim()) === label);
        if (operation === 'point') {
          const node = args.selector ? root?.querySelector(args.selector) : button(args.label);
          if (!node || node.disabled) return null;
          const rect = node.getBoundingClientRect(); return rect.width && rect.height ? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } : null;
        }
        if (operation === 'focus') { button(args.label)?.focus({ preventScroll: true }); return; }
        if (operation === 'state') return {
          toolbar: !!host, ready: !!button('Viewports') && !button('Viewports').disabled,
          host: host?.getBoundingClientRect().toJSON(), trigger: button('Viewports')?.getBoundingClientRect().toJSON(),
          popover: box?.getBoundingClientRect().toJSON(), popovers: document.querySelectorAll('#__pc_viewports__').length,
          expanded: button('Viewports')?.getAttribute('aria-expanded'), label: box?.getAttribute('aria-label'),
          focused: pop?.shadowRoot?.activeElement?.type || '', toolbarFocused: root?.activeElement?.getAttribute('aria-label'),
          background: box ? getComputedStyle(box).backgroundColor : null,
          overflow: box ? box.scrollHeight > box.clientHeight : false, width: innerWidth, height: innerHeight,
          values: [...(pop?.shadowRoot?.querySelectorAll('input[type=number]') || [])].map(input => Number(input.value)),
          selected: [...(pop?.shadowRoot?.querySelectorAll('input[type=checkbox]') || [])].map(input => input.checked),
          status: [...(root?.querySelectorAll('[role="status"]') || [])].map(node => node.textContent).join(' ')
        };
      } }); return result.result;
    }, { tabId, operation, args });
    const waitFor = async (predicate, message, timeout = 15000) => {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) { const state = await isolated('state'); if (predicate(state)) return state; await new Promise(resolve => setTimeout(resolve, 35)); }
      throw new Error(`${message}: ${JSON.stringify(await isolated('state'))}`);
    };
    const click = async label => {
      let point, previous, stable = 0; const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        point = await isolated('point', { label });
        stable = point && previous && Math.abs(point.x - previous.x) < .2 && Math.abs(point.y - previous.y) < .2 ? stable + 1 : 0;
        if (stable >= 3) break; previous = point; await new Promise(resolve => setTimeout(resolve, 35));
      }
      assert.ok(point && stable >= 3, `Settled clickable ${label}`); await page.bringToFront(); await page.mouse.click(point.x, point.y);
    };
    const open = async () => { await click('Viewports'); return waitFor(state => state.popover && state.ready && state.expanded === 'true', 'visible viewport panel'); };
    const close = async () => { await page.keyboard.press('Escape'); return waitFor(state => !state.popover && state.ready, 'close viewport panel'); };
    const inBounds = state => { const box = state.popover; assert.ok(box && box.left >= 7 && box.top >= 7 && box.right <= state.width - 7 && box.bottom <= state.height - 7, JSON.stringify(state)); };
    const settings = () => worker.evaluate(async () => (await chrome.storage.local.get('pc_viewports_v1')).pc_viewports_v1);
    const waitSettings = async predicate => { const deadline = Date.now() + 5000; while (Date.now() < deadline) { const value = await settings(); if (value && predicate(value)) return value; await new Promise(resolve => setTimeout(resolve, 30)); } throw Error('Viewport settings not saved'); };
    const snapshot = () => page.evaluate(() => { const clone = document.documentElement.cloneNode(true); clone.querySelectorAll('[data-h2d-ignore="true"]').forEach(node => node.remove()); return { html: clone.outerHTML, width: innerWidth, height: innerHeight, scrollX, scrollY, input: document.querySelector('body input').value }; });
    const rows = () => page.locator('#__pc_viewports__ .row');
    const baseline = await snapshot(), baselineRequests = requests.length;

    let state = await open();
    assert.ok(state.host.top > state.height, 'The zero-height toolbar host is below the fold: original bug condition');
    inBounds(state); assert.ok(Math.abs(state.popover.top - state.trigger.bottom - 8) < 1);
    assert.equal(state.label, 'Viewports'); assert.equal(state.background, 'rgb(44, 44, 44)'); assert.equal(state.focused, 'checkbox');
    assert.equal((await worker.evaluate(() => chrome.windows.getAll())).length, 1);
    await page.screenshot({ caret: 'initial', path: path.join(artifacts, 'viewports-long-page.png') });
    passed('A native click opens the existing dark Viewports panel below its visible trigger even when the toolbar host is below a long page');

    await click('Viewports'); await waitFor(state => !state.popover, 'toggle closed');
    await isolated('focus', { label: 'Viewports' }); await page.keyboard.press('Enter'); state = await waitFor(state => state.popover && state.ready, 'keyboard opening'); inBounds(state);
    await close(); await waitFor(state => state.toolbarFocused === 'Viewports', 'Escape focus restoration');
    state = await open(); await page.locator('body input').click(); await waitFor(state => !state.popover, 'outside click');
    assert.equal(await page.locator('body input').evaluate(node => document.activeElement === node), true);
    await page.evaluate(() => window.scrollTo(0, 0)); assert.deepEqual(await snapshot(), baseline);
    passed('Toggle, keyboard activation, Escape/focus restoration and outside clicks work without changing source DOM, values or scroll');

    await page.evaluate(() => scrollTo(0, 1000)); state = await open(); inBounds(state);
    assert.ok(Math.abs(state.popover.top - state.trigger.bottom - 8) < 1); await close(); await page.evaluate(() => scrollTo(0, 0));
    assert.equal(requests.length, baselineRequests);
    passed('Scrolling does not move the popup into page-flow coordinates or open a temporary capture window');

    await page.addStyleTag({ content: '#__pc_viewports__{display:none!important;visibility:hidden!important;font:80px serif!important}' });
    state = await open(); inBounds(state); assert.equal(state.background, 'rgb(44, 44, 44)'); await close();
    passed('The popover host reset prevents ordinary page CSS from hiding the viewport control');

    state = await open(); const last = rows().nth(5), widthInput = last.locator('input[type=number]');
    for (const [value, expected] of [['1', 200], ['5000', 3840], ['412.6', 413], ['393', 393]]) {
      await widthInput.fill(value); await widthInput.press('Tab');
      await waitSettings(value => value.find(row => row.id === '393').w === expected);
    }
    await last.locator('input[type=checkbox]').check(); await waitSettings(value => value.find(row => row.id === '393').on);
    await close(); state = await open(); assert.equal(state.values[4], 393); assert.equal(state.selected[5], true);
    await last.locator('input[type=checkbox]').uncheck(); await waitSettings(value => !value.find(row => row.id === '393').on); await close();
    passed('Native checkboxes and width edits retain the existing saved presets, clamp invalid sizes and survive closing/reopening');

    const drag = await isolated('point', { selector: '[role="toolbar"] > [data-toolbar-role="message"] > [data-toolbar-role="message"] > div:first-child' });
    assert.ok(drag); state = await isolated('state');
    await page.mouse.move(drag.x, drag.y); await page.mouse.down(); await page.mouse.move(drag.x, state.height - 35, { steps: 12 }); await page.mouse.up();
    await waitFor(state => state.ready && state.trigger.top > state.height / 2, 'bottom docking');
    state = await open(); inBounds(state); assert.ok(state.popover.bottom < state.trigger.top);
    await page.screenshot({ caret: 'initial', path: path.join(artifacts, 'viewports-bottom-docked.png') }); await close();
    passed('Bottom-docked toolbars open the Viewports panel above the actual trigger');

    for (const [width, height, name] of [[390, 844, 'mobile'], [390, 240, 'short-mobile'], [200, 180, 'very-small']]) {
      await page.setViewportSize({ width, height }); await waitFor(state => state.ready, 'responsive toolbar'); state = await open(); inBounds(state);
      if (height < 280) assert.equal(state.overflow, true, 'Short popovers scroll rather than clip');
      await page.screenshot({ caret: 'initial', path: path.join(artifacts, `viewports-${name}.png`) }); await close();
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    passed('Narrow, short and very small windows keep the viewport picker visible, bounded and scrollable');

    await open(); await click('Capture code'); await waitFor(state => !state.popover && state.ready, 'raw HTML capture closes viewport UI');
    await page.waitForFunction(async () => (await navigator.clipboard.readText()).includes('<title>Viewport fixture</title>'));
    assert.doesNotMatch(await page.evaluate(() => navigator.clipboard.readText()), /id=["']__pc_viewports__["']/);
    await open(); await click('Select element'); await waitFor(state => !state.popover && !state.ready, 'selection closes viewport UI');
    await page.keyboard.press('Escape'); await waitFor(state => state.ready, 'cancel selection');
    passed('Raw HTML/element-selection actions close the picker first; raw clipboard data contains no viewport UI host');

    await open(); await click('More tools'); await waitFor(state => !state.popover, 'More closes viewport picker');
    await page.keyboard.press('Escape'); await waitFor(state => state.ready, 'More cleanup');
    await open(); await click('Close'); await page.locator('#__figma_h2d_chrome_extension_toolbar__').waitFor({ state: 'detached' });
    assert.equal(await page.locator('#__pc_viewports__').count(), 0);
    await inject(); await page.locator('#__figma_h2d_chrome_extension_toolbar__').waitFor({ state: 'attached' }); state = await open(); assert.equal(state.popovers, 1); await close();
    passed('More, toolbar close and reinjection clean up listeners/popup state without duplicate viewport hosts');

    await open(); await rows().nth(4).locator('input[type=checkbox]').check(); await rows().nth(5).locator('input[type=checkbox]').check();
    await waitSettings(value => value.filter(row => row.on).map(row => row.id).join(',') === 'browser,768,393'); await close();
    const browserWidth = await page.evaluate(() => innerWidth), key = `figma_h2d_toolbar_captures_${tabId}`;
    const pagesBeforeCapture = context.pages().length, requestsBeforeCapture = requests.length;
    await click('Capture design');
    let captures; const deadline = Date.now() + 90000;
    while (Date.now() < deadline) { captures = await worker.evaluate(async key => (await chrome.storage.local.get(key))[key] || [], key); if (captures.length >= 3) break; await new Promise(resolve => setTimeout(resolve, 250)); }
    assert.equal(captures.length, 3, JSON.stringify(await isolated('state')));
    await waitFor(state => state.ready, 'multi-viewport completion', 15000);
    const documents = captures.map(capture => JSON.parse(capture.h2dJson)), widths = documents.map(doc => doc.root.rect.width);
    assert.equal(widths[0], browserWidth); assert.equal(widths[1], 768); assert.equal(widths[2], 393);
    fs.writeFileSync(path.join(artifacts, 'responsive-snapshots.json'), JSON.stringify(documents));
    for (const [index, marker] of [[0, 'DESKTOP'], [1, 'TABLET'], [2, 'MOBILE']]) assert.ok(JSON.stringify(documents[index]).includes(marker), `Missing ${marker} from viewport ${widths[index]}`);
    const clipboard = await page.evaluate(async () => { for (const item of await navigator.clipboard.read()) if (item.types.includes('text/html')) return (await item.getType('text/html')).text(); return ''; });
    const data = clipboard.match(/\(figh2d\)([A-Za-z0-9+/=]+)\(\/figh2d\)/); assert.ok(data);
    const snapshots = JSON.parse(Buffer.from(data[1], 'base64').toString('utf8')); assert.equal(snapshots.length, 3);
    assert.deepEqual(snapshots.map(doc => doc.root.rect.width), widths);
    assert.equal((await worker.evaluate(() => chrome.windows.getAll())).length, 1);
    assert.equal(context.pages().length, pagesBeforeCapture); assert.equal(requests.length, requestsBeforeCapture, 'No URL reload, scripts, assets or new page visits for this self-contained fixture');
    assert.equal(await page.evaluate(() => innerWidth), browserWidth); assert.equal(await page.locator('#__pc_viewports__').count(), 0);
    fs.writeFileSync(path.join(artifacts, 'viewport-capture-summary.json'), JSON.stringify({ widths, clipboardSnapshots: snapshots.length, captures: captures.length }, null, 2));
    passed('Browser/tablet/phone capture produces three responsive editable snapshots and the rich clipboard without opening a tab/window or visiting the URL');

    await click('Discard all'); await waitFor(state => state.ready, 'discard viewport tray');
    assert.equal((await worker.evaluate(async key => (await chrome.storage.local.get(key))[key] || [], key)).length, 0);
    await click('Close'); await page.locator('#__figma_h2d_chrome_extension_toolbar__').waitFor({ state: 'detached' });
    assert.deepEqual(remote, []); assert.deepEqual(errors, []); assert.ok(requests.every(request => request.method === 'GET' && request.body == null));
    passed('Viewport flows emit no external requests/uploads or uncaught page errors; no new document visits occur during responsive capture');
    console.log(`\n${checks} viewport Chromium checks passed. Artifacts: ${artifacts}`);
  } finally {
    await context.close(); await new Promise(resolve => server.close(resolve)); fs.rmSync(profile, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
