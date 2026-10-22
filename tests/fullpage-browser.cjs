'use strict';
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const root = path.resolve(process.env.EXTENSION_ROOT || path.join(__dirname, '..', 'extension'));
const artifacts = path.resolve(process.env.ARTIFACT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'page-capture-fullpage-artifacts-')));
fs.mkdirSync(artifacts, { recursive: true });
const html = fs.readFileSync(path.join(__dirname, 'fixtures/fullpage.html'), 'utf8');
(async () => {
  const requests = [], remote = [], errors = [], invalid = [];
  const server = http.createServer((request, response) => {
    if (request.url.startsWith('/art/')) {
      if (/[{}]|%7b|%7d/i.test(request.url)) { invalid.push(request.url); response.writeHead(404); response.end(); return; }
      const id = Number(request.url.match(/art\/(\d+)/)?.[1]) || 1;
      response.writeHead(200, { 'Content-Type': 'image/svg+xml' });
      response.end(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="hsl(${id * 20} 70% 55%)"/><text x="20" y="60" font-size="40">Artwork ${id}</text></svg>`); return;
    }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end(html);
  });
  await new Promise(resolve => server.listen(0, '0.0.0.0', resolve));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'page-capture-fullpage-'));
  const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, viewport: null, args: ['--no-sandbox', '--window-size=1280,900', `--disable-extensions-except=${root}`, `--load-extension=${root}`] });
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  context.on('request', request => { if (/^https?:/.test(request.url())) { requests.push({ url: request.url(), type: request.resourceType(), method: request.method() }); if (new URL(request.url()).hostname !== '127.0.0.1') remote.push(request.url()); } });
  await context.route(/^https?:/, route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  let checks = 0; const passed = text => { checks++; console.log(`PASS ${text}`); };
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker'), page = await context.newPage(), url = `http://127.0.0.1:${server.address().port}/gallery`;
    await page.goto(url); await page.bringToFront(); await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(url).origin });
    const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url).id, url);
    await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, func: () => {
      const test = globalThis.__fullTest = { roots: [] }, attach = Element.prototype.attachShadow;
      Element.prototype.attachShadow = function(options) { const root = attach.call(this, options); test.roots.push({ host: this, root }); return root; };
      Object.defineProperty(globalThis, 'PageCaptureDesignBoard', { configurable: true, get: () => undefined, set(api) {
        Object.defineProperty(globalThis, 'PageCaptureDesignBoard', { value: { ...api, createCopier(helpers) { test.helpers = helpers; return api.createCopier(helpers); } } });
      } });
    } }), tabId);
    await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, files: ['js/privacy.js', 'js/capture-safety.js', 'js/clipboard.js', 'js/design-system-core.js', 'js/design-system-board.js', 'js/design-system.js', 'js/viewports.js', 'js/capture-stability.js', 'js/html-export.js', 'js/picker-navigation.js', 'js/h2d_toolbar.js'] }), tabId);
    await page.locator('#__figma_h2d_chrome_extension_toolbar__').waitFor({ state: 'attached' });
    const isolated = (operation, args = {}) => worker.evaluate(async ({ tabId, operation, args }) => {
      const [result] = await chrome.scripting.executeScript({ target: { tabId }, args: [operation, args], func: async (operation, args) => {
        const test = __fullTest, host = document.getElementById('__figma_h2d_chrome_extension_toolbar__'), root = test.roots.find(entry => entry.host === host).root;
        const button = label => [...root.querySelectorAll('button')].find(node => node.getAttribute('aria-label') === label || node.textContent.trim() === label);
        if (operation === 'state') return { ready: !!button('Capture design') && !button('Capture design').disabled, frames: root.querySelectorAll('[data-page-capture-viewport-frame]').length, text: root.querySelector('[role="toolbar"]')?.innerText };
        if (operation === 'point') { const node = button(args.label); if (!node || node.disabled) return null; const rect = node.getBoundingClientRect(); return rect.width ? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } : null; }
        if (operation === 'capture') {
          const result = await test.helpers.capture(args.section ? document.querySelector('#card-24') : document, { timeoutSignal: AbortSignal.timeout(10000), extractCssVariables: false });
          return { ...result.document, assets: Object.fromEntries([...result.document.assets].map(([url, asset]) => [url, { blob: !!asset.blob, error: asset.error }])) };
        }
        if (operation === 'hold-images') {
          test.decode = HTMLImageElement.prototype.decode;
          HTMLImageElement.prototype.decode = () => new Promise(() => {}); return;
        }
        if (operation === 'restore-images') { HTMLImageElement.prototype.decode = test.decode; return; }
        if (operation === 'recovery') {
          const send = chrome.runtime.sendMessage.bind(chrome.runtime), sizes = [];
          chrome.runtime.sendMessage = (...args) => {
            const message = typeof args[0] === 'object' ? args[0] : args[1];
            if (message?.cmd !== 'H2D_FETCH_ASSETS') return send(...args);
            const urls = message.payload.urls; sizes.push(urls.length);
            if (urls.length > 64) return Promise.resolve({ success: false, error: { message: 'Invalid asset request' } });
            return Promise.resolve({ success: true, value: urls.map(url => ({ url, blob: { type: 'image/svg+xml', base64Blob: 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>') } })) });
          };
          try {
            const assets = new Map(Array.from({ length: 130 }, (_, i) => [`https://example.com/${i}.svg`, { url: `https://example.com/${i}.svg`, blob: null, error: 'Test initial CORS failure' }]));
            const serialized = await test.helpers.serialize({ version: 2, root: { nodeType: 1, tag: 'DIV', rect: { x: 0, y: 0, width: 100, height: 100 }, childNodes: [] }, assets, fonts: {} }, new AbortController().signal);
            const doc = JSON.parse(serialized); return { sizes, recovered: Object.values(doc.assets).filter(asset => !!asset.blob).length };
          } finally { chrome.runtime.sendMessage = send; }
        }
      } }); return result.result;
    }, { tabId, operation, args });
    const poll = async (predicate, message, timeout = 20000) => {
      const until = Date.now() + timeout;
      while (Date.now() < until) { const state = await isolated('state'); if (predicate(state)) return state; await new Promise(resolve => setTimeout(resolve, 35)); }
      throw new Error(`${message}: ${JSON.stringify(await isolated('state'))}`);
    };
    const click = async label => {
      let point, previous, stable = 0; const until = Date.now() + 5000;
      while (Date.now() < until) { point = await isolated('point', { label }); stable = point && previous && Math.abs(point.x - previous.x) < .2 && Math.abs(point.y - previous.y) < .2 ? stable + 1 : 0; if (stable >= 3) break; previous = point; await new Promise(resolve => setTimeout(resolve, 35)); }
      assert.ok(point && stable >= 3, label); await page.bringToFront(); await page.mouse.click(point.x, point.y);
    };
    const preferences = rows => worker.evaluate(async rows => chrome.storage.local.set({ pc_viewports_v1: rows }), rows);
    const captures = () => worker.evaluate(async tabId => (await chrome.storage.local.get(`figma_h2d_toolbar_captures_${tabId}`))[`figma_h2d_toolbar_captures_${tabId}`] || [], tabId);
    const source = () => page.evaluate(() => { const doc = document.implementation.createHTMLDocument(''), copy = doc.importNode(document.documentElement, true); copy.querySelectorAll('[data-h2d-ignore="true"]').forEach(node => node.remove()); return { html: copy.outerHTML, width: innerWidth, height: innerHeight, scrollX, scrollY, input: document.querySelector('input').value, loaded: [...document.querySelectorAll('.card img')].filter(image => image.dataset.loaded).length }; });
    const walk = root => [root, ...(root.childNodes || []).flatMap(walk)];
    const check = (doc, imageCount) => {
      const nodes = walk(doc.root), images = nodes.filter(node => node.tag === 'IMG'), footer = nodes.find(node => node.attributes?.id === 'end');
      assert.equal(images.length, imageCount); assert.ok(images.every(node => node.attributes.currentSrc.includes('/art/') && !/[{}]|%7b|%7d/i.test(node.attributes.currentSrc)));
      assert.equal(doc.root.rect.height, doc.documentRect.height); assert.ok(doc.root.rect.height > doc.viewportRect.height * 3);
      assert.ok(footer && footer.rect.y - doc.root.rect.y + footer.rect.height <= doc.root.rect.height + 1, 'The final section fits inside the pasted page root');
      assert.equal(Object.values(doc.assets).filter(asset => !!asset.blob).length, imageCount);
    };
    const readClipboard = async expectedCount => {
      const until = Date.now() + 10000;
      while (Date.now() < until) {
        const html = await page.evaluate(async () => { for (const item of await navigator.clipboard.read()) if (item.types.includes('text/html')) return (await item.getType('text/html')).text(); return ''; });
        const match = html.match(/\(figh2d\)([A-Za-z0-9+/=]+)\(\/figh2d\)/); if (match) { const docs = JSON.parse(Buffer.from(match[1], 'base64').toString('utf8')); if (docs.length === expectedCount && docs.every(doc => walk(doc.root).filter(node => node.tag === 'IMG').length === 30)) return docs; }
        await new Promise(resolve => setTimeout(resolve, 40));
      }
      throw Error('Rich clipboard not ready');
    };
    const before = await source(), pagesBefore = context.pages().length, documentsBefore = requests.filter(request => request.type === 'document').length;
    assert.ok(before.loaded < 30, 'Only viewport-near images were loaded by the page');
    await preferences([{ id: 'browser', on: true }]); await click('Capture design'); await poll(state => state.ready, 'Browser full-page capture');
    let stored = await captures(); assert.equal(stored.length, 1); let doc = JSON.parse(stored[0].h2dJson); check(doc, 30);
    assert.deepEqual(await source(), before); assert.equal((await readClipboard(1)).length, 1);
    passed('Browser Capture design embeds all 30 lazy gallery images and includes the final section inside a full-height editable root, not a viewport-height clipped frame');
    await click('Discard all');
    await preferences([{ id: 'browser', on: true }, { id: '393', w: 393, on: true }]); await click('Capture design'); await poll(state => state.ready, 'Browser + phone full pages');
    stored = await captures(); assert.equal(stored.length, 2); const docs = stored.map(cap => JSON.parse(cap.h2dJson)); docs.forEach(doc => check(doc, 30)); assert.equal(docs[1].root.rect.width, 393); assert.ok(docs[1].root.rect.height > docs[0].root.rect.height);
    const clipboard = await readClipboard(2); assert.equal(clipboard.length, 2); clipboard.forEach(doc => check(doc, 30)); assert.deepEqual(await source(), before); assert.equal((await isolated('state')).frames, 0);
    passed('Both original-size and phone-size full-page snapshots keep every image/section and reach the native rich clipboard without changing the source page');
    assert.equal(context.pages().length, pagesBefore); assert.equal((await worker.evaluate(() => chrome.windows.getAll())).length, 1); assert.equal(requests.filter(request => request.type === 'document').length, documentsBefore); assert.deepEqual(invalid, []);
    passed('Full-page preparation makes only real asset GETs: no unresolved template requests, tab/window creation, document visits, source scrolling or source resizing');

    await page.locator('#card-24').scrollIntoViewIfNeeded(); await page.waitForFunction(() => document.querySelector('#card-24 img').dataset.loaded === 'true');
    const scrolled = await source(); doc = await isolated('capture'); check(doc, 30); assert.deepEqual(await source(), scrolled);
    passed('Capturing from a scrolled position preserves that position and still gives the whole page enough height to contain its footer');
    const section = await isolated('capture', { section: true }); const sectionImages = walk(section.root).filter(node => node.tag === 'IMG');
    assert.equal(sectionImages.length, 1); assert.ok(sectionImages[0].attributes.currentSrc.includes('/art/24.svg')); assert.ok(section.root.rect.height < 500); assert.ok(section.root.rect.height < doc.root.rect.height);
    passed('The existing selected-section path stays section-sized, preserves its loaded image, and is not expanded into a full page');
    assert.deepEqual(await isolated('recovery'), { sizes: [64, 64, 2], recovered: 130 });
    passed('The real serializer recovers 130 failed images using bounded 64/64/2 RPC batches rather than losing every image to one oversized request');

    await click('Discard all'); await preferences([{ id: 'browser', on: true }]); const cancelledBefore = await source(); await isolated('hold-images');
    await click('Capture design'); await poll(state => !state.ready, 'waiting for image decode'); await click('Cancel'); await poll(state => state.ready, 'cancel pending image decode', 3000); await isolated('restore-images');
    assert.equal((await captures()).length, 0); assert.deepEqual(await source(), cancelledBefore);
    passed('Cancel interrupts a never-settling image decode and restores loading/decoding attributes instead of leaving the capture job pending');
    assert.deepEqual(remote, []); assert.deepEqual(errors, []); assert.ok(requests.every(request => request.method === 'GET'));
    fs.writeFileSync(path.join(artifacts, 'fullpage-summary.json'), JSON.stringify({ browserHeight: docs[0].root.rect.height, phoneHeight: docs[1].root.rect.height, imagesPerPage: 30, clipboardPages: 2, newTabs: 0, newWindows: 0, liveSourceUnchanged: true, liveDribbbleVerified: false }, null, 2));
    passed('Full-page/section/cancel tests produce no remote requests, uploads or uncaught page errors');
    console.log(`\n${checks} full-page Chromium checks passed. Artifacts: ${artifacts}`);
  } finally { await context.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); fs.rmSync(profile, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
