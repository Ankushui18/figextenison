'use strict';
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const root = path.resolve(process.env.EXTENSION_ROOT || path.join(__dirname, '..', 'extension'));
const html = fs.readFileSync(path.join(__dirname, 'fixtures/scrollarea.html'), 'utf8');
(async () => {
  const errors = [], remote = [];
  const server = http.createServer((_request, response) => { response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end(html); });
  await new Promise(resolve => server.listen(0, '0.0.0.0', resolve));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'page-capture-scrollarea-'));
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, viewport: { width: 1280, height: 813 }, args: ['--no-sandbox', '--disable-extensions-except=' + root, '--load-extension=' + root] });
    context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
    context.on('request', request => { if (/^https?:/.test(request.url()) && new URL(request.url()).hostname !== '127.0.0.1') remote.push(request.url()); });
    await context.route(/^https?:/, route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const page = await context.newPage(), url = `http://127.0.0.1:${server.address().port}/dashboard`;
    await page.goto(url); await page.bringToFront();
    const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url).id, url);
    await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, func: () => {
      const test = globalThis.__scrollAreaTest = { roots: [] }, attach = Element.prototype.attachShadow;
      Element.prototype.attachShadow = function(options) { const shadow = attach.call(this, options); test.roots.push({ host: this, root: shadow }); return shadow; };
      Object.defineProperty(globalThis, 'PageCaptureDesignBoard', { configurable: true, get: () => undefined, set(api) {
        Object.defineProperty(globalThis, 'PageCaptureDesignBoard', { value: { ...api, createCopier(helpers) { test.helpers = helpers; return api.createCopier(helpers); } } });
      } });
    } }), tabId);
    await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, files: ['js/privacy.js', 'js/capture-safety.js', 'js/design-system-core.js', 'js/design-system-board.js', 'js/design-system.js', 'js/viewports.js', 'js/h2d_toolbar.js'] }), tabId);
    await page.locator('#__figma_h2d_chrome_extension_toolbar__').waitFor({ state: 'attached' });
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(url).origin });
    const toolbarButtons = await worker.evaluate(async tabId => {
      const [row] = await chrome.scripting.executeScript({ target: { tabId }, func: () => {
        const root = __scrollAreaTest.roots.find(item => item.host.id === '__figma_h2d_chrome_extension_toolbar__')?.root;
        return root ? [...root.querySelectorAll('button,[role="button"]')].map(button => ({ label: button.getAttribute('aria-label'), text: button.textContent.trim(), rect: button.getBoundingClientRect().toJSON() })) : [];
      } }); return row.result;
    }, tabId);
    const scrollButton = toolbarButtons.find(button => button.label === 'Capture scroll area');
    assert.ok(scrollButton, 'The explicit scroll-area action is available in the current capture toolbar');
    const result = (name, scrollTop = 0, fullArea = false) => worker.evaluate(async ({ tabId, name, scrollTop, fullArea }) => {
      const [row] = await chrome.scripting.executeScript({ target: { tabId }, args: [name, scrollTop, fullArea], func: async (name, scrollTop, fullArea) => {
        const test = __scrollAreaTest, scroller = document.querySelector('#app'); scroller.scrollTop = scrollTop;
        const target = name === 'document' ? document : scroller;
        const capture = await test.helpers.capture(target, { timeoutSignal: AbortSignal.timeout(10000), extractCssVariables: false, captureSourceProps: false, captureScrollArea: fullArea });
        const doc = capture.document, nodes = [], pending = [doc.root];
        while (pending.length) { const node = pending.pop(); nodes.push(node); pending.push(...(node.childNodes || [])); }
        const find = id => nodes.find(node => node.attributes?.id === id);
        const app = find('app'), first = find('entry-1'), last = find('internal-end');
        return { root: doc.root.rect, documentRect: doc.documentRect, viewportRect: doc.viewportRect, topScrollRect: doc.scrollRect || null, app: app && { rect: app.rect, scrollRect: app.scrollRect || null, styles: app.styles }, first: first && first.rect, last: last && { rect: last.rect, text: last.childNodes?.map(child => child.text).join('') }, elements: nodes.filter(node => node.tag === 'ARTICLE').length, width: innerWidth, sourceScrollTop: scroller.scrollTop };
      } }); return row.result;
    }, { tabId, name, scrollTop, fullArea });
    const snapshot = () => page.evaluate(() => ({ html: document.documentElement.outerHTML, scrollX, scrollY, appTop: document.querySelector('#app').scrollTop, width: innerWidth, height: innerHeight }));
    const before = await snapshot();
    const documentCapture = await result('document');
    assert.deepEqual(await snapshot(), before, 'Document capture leaves the page unchanged');
    const regionAtTop = await result('region', 0);
    assert.deepEqual(await snapshot(), before, 'Top-of-region capture leaves the page unchanged');
    const fullAreaTop = await result('region', 0, true);
    assert.deepEqual(await snapshot(), before, 'Full-area model expansion leaves the live page unchanged');
    await page.evaluate(() => { document.querySelector('#app').scrollTop = 560; });
    const beforeScrolled = await snapshot();
    const regionScrolled = await result('region', 560);
    assert.deepEqual(await snapshot(), beforeScrolled, 'Scrolled-region capture preserves the original live scroll position');
    const fullAreaScrolled = await result('region', 560, true);
    assert.deepEqual(await snapshot(), beforeScrolled, 'Scrolled full-area capture preserves the original live scroll position');
    assert.equal(documentCapture.root.height, 813);
    assert.equal(documentCapture.documentRect.height, 813);
    assert.ok(documentCapture.last && documentCapture.last.rect.y + documentCapture.last.rect.height > documentCapture.root.height);
    assert.equal(regionAtTop.root.height, 813);
    assert.ok(regionAtTop.documentRect.height > regionAtTop.root.height, 'The internal element has more scroll content than its captured viewport root');
    assert.ok(regionAtTop.last.rect.y + regionAtTop.last.rect.height > regionAtTop.root.height);
    assert.ok(regionScrolled.app.scrollRect, 'A nonzero internal scroll offset is recorded on the scroller node');
    assert.ok(regionScrolled.last.rect.y + regionScrolled.last.rect.height > regionScrolled.root.height);
    assert.equal(fullAreaTop.root.height, fullAreaTop.documentRect.height);
    assert.equal(fullAreaTop.root.width, fullAreaTop.width, 'Full-area expansion preserves the current responsive width');
    assert.ok(fullAreaTop.first.y >= 0 && fullAreaTop.last.rect.y + fullAreaTop.last.rect.height <= fullAreaTop.root.height);
    assert.equal(fullAreaScrolled.first.y, fullAreaTop.first.y, 'Scrolled input is rebased to the top of the full content');
    assert.equal(fullAreaScrolled.last.rect.y, fullAreaTop.last.rect.y, 'The final section retains its full-content position from any internal scroll offset');
    assert.equal(fullAreaScrolled.app.scrollRect.y, fullAreaScrolled.root.y, 'The serialized scroll metadata is normalized without touching the source element');
    await page.setViewportSize({ width: 393, height: 813 });
    const buttons393 = await worker.evaluate(async tabId => { const [row] = await chrome.scripting.executeScript({ target: { tabId }, func: () => { const root = __scrollAreaTest.roots.find(item => item.host.id === '__figma_h2d_chrome_extension_toolbar__')?.root; return root ? [...root.querySelectorAll('button,[role="button"]')].map(button => ({ label: button.getAttribute('aria-label'), rect: button.getBoundingClientRect().toJSON() })) : []; } }); return row.result; }, tabId);
    assert.ok(buttons393.some(button => button.label === 'Capture scroll area' && button.rect.width > 0), 'The new action remains available and accessible at a narrow viewport');
    const before393 = await snapshot();
    const fullArea393 = await result('region', 560, true);
    assert.deepEqual(await snapshot(), before393, 'Narrow responsive capture preserves the live scroller state');
    assert.equal(fullArea393.root.width, 393);
    assert.equal(fullArea393.viewportRect.width, 393);
    assert.equal(fullArea393.root.height, 2518);
    assert.ok(fullArea393.last.rect.y + fullArea393.last.rect.height <= fullArea393.root.y + fullArea393.root.height);
    await page.setViewportSize({ width: 1280, height: 813 });
    await page.evaluate(() => { document.querySelector('#app').scrollTop = 560; });
    await page.waitForTimeout(100);
    const liveScrollButton = await worker.evaluate(async tabId => { const [row] = await chrome.scripting.executeScript({ target: { tabId }, func: () => { const root = __scrollAreaTest.roots.find(item => item.host.id === '__figma_h2d_chrome_extension_toolbar__')?.root; const button = [...(root?.querySelectorAll('button,[role="button"]') || [])].find(node => node.getAttribute('aria-label') === 'Capture scroll area'); return button?.getBoundingClientRect().toJSON() || null; } }); return row.result; }, tabId);
    assert.ok(liveScrollButton?.width > 0, 'Scroll-area action is visible after restoring the desktop viewport');
    const pagesBeforeToolbarCapture = context.pages().length;
    const beforeToolbarCapture = await snapshot();
    await page.mouse.click(liveScrollButton.x + liveScrollButton.width / 2, liveScrollButton.y + liveScrollButton.height / 2);
    const selectionReady = Date.now() + 3000;
    let toolbarText = '';
    while (Date.now() < selectionReady) {
      toolbarText = await worker.evaluate(async tabId => { const [row] = await chrome.scripting.executeScript({ target: { tabId }, func: () => __scrollAreaTest.roots.find(item => item.host.id === '__figma_h2d_chrome_extension_toolbar__')?.root.textContent || '' }); return row.result; }, tabId);
      if (toolbarText.includes('Select a scroll area')) break;
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    assert.ok(toolbarText.includes('Select a scroll area'), 'The explicit action opens scroll-area selection mode');
    await page.mouse.move(100, 32); // Highlight a card at scrollTop 560 and select it directly.
    // No arrow keys: a card inside the scroller must resolve to its nearest scrollable ancestor.
    await page.keyboard.press('Enter');
    let saved = [];
    const captureDeadline = Date.now() + 12000;
    while (Date.now() < captureDeadline) {
      saved = await worker.evaluate(async tabId => { const key = `figma_h2d_toolbar_captures_${tabId}`; return (await chrome.storage.local.get(key))[key] || []; }, tabId);
      if (saved.length) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    if (!saved.length) {
      const debugState = await worker.evaluate(async tabId => { const [row] = await chrome.scripting.executeScript({ target: { tabId }, func: () => { const root = __scrollAreaTest.roots.find(item => item.host.id === '__figma_h2d_chrome_extension_toolbar__')?.root; return { text: root?.textContent, appScrollTop: document.querySelector('#app').scrollTop, dimensions: { scrollHeight: document.querySelector('#app').scrollHeight, clientHeight: document.querySelector('#app').clientHeight, overflowY: getComputedStyle(document.querySelector('#app')).overflowY } }; } }); return row.result; }, tabId);
      console.log('DEBUG failed toolbar capture', JSON.stringify(debugState));
    }
    assert.equal(saved.length, 1, 'Selecting a child inside the scroller creates one capture of the whole scroll area');
    const savedDocument = JSON.parse(saved[0].h2dJson), savedNodes = [], savedPending = [savedDocument.root];
    while (savedPending.length) { const node = savedPending.pop(); savedNodes.push(node); savedPending.push(...(node.childNodes || [])); }
    const savedFirst = savedNodes.find(node => node.attributes?.id === 'entry-1');
    const savedFooter = savedNodes.find(node => node.attributes?.id === 'internal-end');
    assert.ok(savedFirst && savedFooter, 'The toolbar-captured area contains both its first and final sections');
    assert.equal(savedDocument.root.rect.height, 2518);
    assert.equal(savedDocument.root.rect.width, 1280);
    assert.ok(savedFirst.rect.y >= savedDocument.root.rect.y);
    assert.ok(savedFooter.rect.y + savedFooter.rect.height <= savedDocument.root.rect.y + savedDocument.root.rect.height);
    assert.deepEqual(await snapshot(), beforeToolbarCapture, 'The actual toolbar capture does not change source DOM, viewport or internal scroll position');
    assert.equal(context.pages().length, pagesBeforeToolbarCapture, 'The capture creates no new tab or page');
    assert.deepEqual(remote, []); assert.deepEqual(errors, []);
    console.log(JSON.stringify({ viewport: { width: before.width, height: before.height }, document: { rootHeight: documentCapture.root.height, documentHeight: documentCapture.documentRect.height, finalY: documentCapture.last.rect.y }, selectedScrollAreaTop: { rootHeight: regionAtTop.root.height, reportedHeight: regionAtTop.documentRect.height, appHeight: regionAtTop.app.rect.height, finalY: regionAtTop.last.rect.y }, fullAreaTop: { root: fullAreaTop.root, firstY: fullAreaTop.first.y, finalY: fullAreaTop.last.rect.y }, fullAreaScrolled: { root: fullAreaScrolled.root, firstY: fullAreaScrolled.first.y, finalY: fullAreaScrolled.last.rect.y, scrollRect: fullAreaScrolled.app.scrollRect }, fullArea393: { root: fullArea393.root, viewportWidth: fullArea393.viewportRect.width, finalY: fullArea393.last.rect.y }, toolbarCapture: { root: savedDocument.root.rect, finalY: savedFooter.rect.y }, sourceUnchanged: true, remoteRequests: 0 }, null, 2));
    console.log('\nPASS (child selection) Explicit toolbar action includes the full selected scroll area at top and after scrolling, preserves width, and leaves the source unchanged.');
  } finally { if (context) await context.close(); server.closeAllConnections(); if (server.listening) await new Promise(resolve => server.close(resolve)); fs.rmSync(profile, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
