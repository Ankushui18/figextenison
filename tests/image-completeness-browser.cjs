'use strict';
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const root = path.resolve(process.env.EXTENSION_ROOT || path.join(__dirname, '..', 'extension'));
const html = `<!doctype html><html><head><meta charset="utf-8"><title>Image completeness fixture</title><link rel="icon" href="data:,"><style>
*{box-sizing:border-box}html,body{margin:0;font:16px/24px Arial,sans-serif;color:#222}main{padding:24px;min-height:1100px}.grid{display:grid;grid-template-columns:repeat(3,220px);gap:20px}.card{margin:0;width:220px;height:180px}.card img{display:block;width:180px;height:140px;object-fit:cover}@media(max-width:600px){.grid{grid-template-columns:repeat(2,180px)}.card{width:180px}.card img{width:160px}}
</style></head><body><main><h1>Lazy image fixture</h1><section class="grid">
<figure class="card"><img id="http-placeholder" src="/pixel.svg" data-src="/art/http-placeholder.svg" alt="Loaded one-pixel HTTP placeholder"></figure>
<figure class="card"><img id="actual-source" src="/pixel.svg" data-actualsrc="/art/actual-source.svg" alt="Alternate lazy source attribute"></figure>
<figure class="card"><img id="lazy-srcset" src="/pixel.svg" data-original-srcset="/art/srcset-120.svg 120w, /art/srcset-300.svg 300w" alt="Lazy srcset candidates"></figure>
<figure class="card"><picture><source media="(min-width:601px)" data-lazy-srcset="/art/picture-desktop.svg 1x"><source media="(max-width:600px)" data-lazy-srcset="/art/picture-phone.svg 1x"><img id="picture-source" src="/pixel.svg" alt="Responsive picture source"></picture></figure>
<figure class="card"><img id="echo-source" src="/pixel.svg" data-echo="/art/echo-source.svg" alt="Echo lazy image"></figure>
<figure class="card"><img id="missing-source" src="/pixel.svg" data-src="/art/missing.svg" alt="Unavailable image"></figure>
</section><footer>End of the full-page fixture</footer></main><script>
window.fixtureReady=Promise.all([...document.images].map(image=>image.decode().catch(()=>{})));
</script></body></html>`;
(async () => {
  const requests = [], remote = [], errors = [];
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    if (pathname === '/pixel.svg') {
      response.writeHead(200, { 'Content-Type': 'image/svg+xml' }); response.end('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1" fill="#ddd"/></svg>'); return;
    }
    if (pathname.startsWith('/art/')) {
      if (pathname.endsWith('/missing.svg')) { response.writeHead(404, { 'Content-Type': 'text/plain' }); response.end('fixture miss'); return; }
      response.writeHead(200, { 'Content-Type': 'image/svg+xml' });
      response.end(`<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320"><rect width="480" height="320" fill="#0d99ff"/><text x="20" y="80" font-size="28">${path.basename(pathname)}</text></svg>`); return;
    }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end(html);
  });
  await new Promise(resolve => server.listen(0, '0.0.0.0', resolve));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'page-capture-images-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true, viewport: { width: 1280, height: 900 },
    args: ['--no-sandbox', '--disable-extensions-except=' + root, '--load-extension=' + root]
  });
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  context.on('request', request => {
    if (!/^https?:/.test(request.url())) return;
    requests.push({ url: request.url(), type: request.resourceType(), method: request.method() });
    if (new URL(request.url()).hostname !== '127.0.0.1') remote.push(request.url());
  });
  await context.route(/^https?:/, route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  let checks = 0; const passed = message => { checks++; console.log(`PASS ${message}`); };
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const page = await context.newPage(), url = `http://127.0.0.1:${server.address().port}/images`;
    await page.goto(url); await page.evaluate(() => window.fixtureReady); await page.bringToFront();
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(url).origin });
    const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url).id, url);
    await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, func: () => {
      const test = globalThis.__imageCompletenessTest = { roots: [] }, attach = Element.prototype.attachShadow;
      Element.prototype.attachShadow = function(options) { const shadow = attach.call(this, options); test.roots.push({ host: this, root: shadow }); return shadow; };
      Object.defineProperty(globalThis, 'PageCaptureDesignBoard', { configurable: true, get: () => undefined, set(api) {
        Object.defineProperty(globalThis, 'PageCaptureDesignBoard', { value: { ...api, createCopier(helpers) { test.helpers = helpers; return api.createCopier(helpers); } } });
      } });
    } }), tabId);
    await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, files: ['js/privacy.js', 'js/capture-safety.js', 'js/clipboard.js', 'js/design-system-core.js', 'js/design-system-board.js', 'js/design-system.js'] }), tabId);
    await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, func: () => {
      const test = __imageCompletenessTest, system = globalThis.PageCaptureDesignSystem;
      test.messages = []; test.attached = false; test.attachType = typeof system?.attach;
      test.systemDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'PageCaptureDesignSystem');
      if (system?.attach) {
        const attach = system.attach.bind(system), wrapped = Object.create(system);
        Object.defineProperty(wrapped, 'attach', { configurable: true, value: (controller, ...args) => {
          test.attached = true; test.controller = controller;
          const show = controller.showTransientMessage?.bind(controller);
          if (show) controller.showTransientMessage = (message, ...rest) => { test.messages.push(String(message)); return show(message, ...rest); };
          return attach(controller, ...args);
        } });
        Object.defineProperty(globalThis, 'PageCaptureDesignSystem', { configurable: true, writable: true, value: wrapped });
      }
    } }), tabId);
    await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, files: ['js/viewports.js', 'js/capture-stability.js', 'js/html-export.js', 'js/picker-navigation.js', 'js/h2d_toolbar.js'] }), tabId);
    await page.locator('#__figma_h2d_chrome_extension_toolbar__').waitFor({ state: 'attached' });

    const isolated = (operation, args = {}) => worker.evaluate(async ({ tabId, operation, args }) => {
      const [result] = await chrome.scripting.executeScript({ target: { tabId }, args: [operation, args], func: (operation, args) => {
        const test = __imageCompletenessTest, host = document.getElementById('__figma_h2d_chrome_extension_toolbar__');
        const root = test.roots.find(entry => entry.host === host)?.root;
        const button = label => [...(root?.querySelectorAll('button') || [])].find(node => node.getAttribute('aria-label') === label || node.textContent.trim() === label);
        if (operation === 'state') { const visible = [...(root?.querySelectorAll('*') || [])].filter(node => node.tagName !== 'STYLE' && !node.children.length).map(node => node.textContent.trim()).filter(Boolean).join('\n'); return { ready: !!button('Capture design') && !button('Capture design').disabled, text: visible, messages: test.messages, attached: test.attached, attachType: test.attachType, frames: root?.querySelectorAll('[data-page-capture-viewport-frame]').length || 0 }; }
        if (operation === 'point') { const node = button(args.label); if (!node || node.disabled) return null; const rect = node.getBoundingClientRect(); return rect.width ? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } : null; }
        if (operation === 'image-source') {
          const image = document.querySelector('#http-placeholder');
          return { selected: PageCaptureViewports.imageSource(image), current: image.currentSrc, source: image.getAttribute('src'), naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight };
        }
        return null;
      } }); return result.result;
    }, { tabId, operation, args });
    const poll = async (predicate, message, timeout = 30000) => {
      const until = Date.now() + timeout;
      while (Date.now() < until) { const state = await isolated('state'); if (predicate(state)) return state; await new Promise(resolve => setTimeout(resolve, 40)); }
      throw new Error(`${message}: ${JSON.stringify(await isolated('state'))}`);
    };
    const click = async label => {
      let point, previous, stable = 0; const until = Date.now() + 5000;
      while (Date.now() < until) { point = await isolated('point', { label }); stable = point && previous && Math.abs(point.x - previous.x) < .2 && Math.abs(point.y - previous.y) < .2 ? stable + 1 : 0; if (stable >= 3) break; previous = point; await new Promise(resolve => setTimeout(resolve, 35)); }
      assert.ok(point && stable >= 3, label); await page.bringToFront(); await page.mouse.click(point.x, point.y);
    };
    const preferences = rows => worker.evaluate(async rows => chrome.storage.local.set({ pc_viewports_v1: rows }), rows);
    const captures = () => worker.evaluate(async tabId => (await chrome.storage.local.get(`figma_h2d_toolbar_captures_${tabId}`))[`figma_h2d_toolbar_captures_${tabId}`] || [], tabId);
    const sourceSnapshot = () => page.evaluate(() => ({
      scrollX, scrollY, width: innerWidth, height: innerHeight,
      images: [...document.images].map(image => ({ id: image.id, src: image.getAttribute('src'), currentSrc: image.currentSrc, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight, data: [...image.attributes].filter(attribute => attribute.name.startsWith('data-')).map(attribute => [attribute.name, attribute.value]) }))
    }));
    const before = await sourceSnapshot(), pagesBefore = context.pages().length;
    const inspect = (record, expectedPicture) => {
      const doc = JSON.parse(record.h2dJson), pending = [doc.root], nodes = [];
      while (pending.length) { const node = pending.pop(); nodes.push(node); pending.push(...(node.childNodes || [])); }
      const images = nodes.filter(node => node.tag === 'IMG'), byId = Object.fromEntries(images.map(node => [node.attributes.id, node.attributes.currentSrc]));
      const assetPaths = Object.fromEntries(Object.entries(doc.assets || {}).map(([assetUrl, asset]) => [new URL(assetUrl).pathname, !!asset.blob?.base64Blob]));
      assert.equal(images.length, 6);
      assert.ok(byId['http-placeholder'].endsWith('/art/http-placeholder.svg'), JSON.stringify(byId));
      assert.ok(byId['actual-source'].endsWith('/art/actual-source.svg'), JSON.stringify(byId));
      assert.ok(byId['lazy-srcset'].endsWith('/art/srcset-300.svg'), JSON.stringify(byId));
      assert.ok(byId['picture-source'].endsWith(expectedPicture), JSON.stringify(byId));
      assert.ok(byId['echo-source'].endsWith('/art/echo-source.svg'), JSON.stringify(byId));
      assert.ok(byId['missing-source'].endsWith('/art/missing.svg'), JSON.stringify(byId));
      for (const pathname of ['/art/http-placeholder.svg', '/art/actual-source.svg', '/art/srcset-300.svg', expectedPicture, '/art/echo-source.svg']) assert.equal(assetPaths[pathname], true, `Expected embedded asset ${pathname}`);
      assert.equal(assetPaths['/art/missing.svg'], false, 'The unavailable image must remain honestly marked as not embedded');
      return { doc, included: Object.values(assetPaths).filter(Boolean).length, notEmbedded: Object.values(assetPaths).filter(value => !value).length };
    };

    assert.equal((await isolated('image-source')).naturalWidth, 1, 'The fixture loaded an actual one-pixel HTTP placeholder');
    assert.ok((await isolated('image-source')).selected.endsWith('/art/http-placeholder.svg'), 'HTTP placeholder resolves to its explicit lazy source');
    passed('A real, loaded 1×1 HTTP placeholder is replaced by its explicit lazy URL in source selection without editing the live page');

    await preferences([{ id: 'browser', on: true }, { id: '393', w: 393, on: true }]);
    await click('Capture design');
    const deadline = Date.now() + 60000; let stored = [];
    while (Date.now() < deadline) { stored = await captures(); const state = await isolated('state'); if (stored.length === 2 && state.ready) break; await new Promise(resolve => setTimeout(resolve, 100)); }
    assert.equal(stored.length, 2, JSON.stringify(await isolated('state'))); await poll(state => state.ready, 'responsive image capture completion');
    const desktop = inspect(stored[0], '/art/picture-desktop.svg'), phone = inspect(stored[1], '/art/picture-phone.svg');
    assert.equal(desktop.included, 5); assert.equal(desktop.notEmbedded, 1);
    assert.equal(phone.included, 5); assert.equal(phone.notEmbedded, 1);
    assert.equal(desktop.doc.root.rect.width, before.width); assert.equal(phone.doc.root.rect.width, 393);
    passed('Full-page and responsive captures resolve data-actualsrc, lazy srcset, active picture media, and data-echo images while preserving the unavailable asset as a failure');

    const report = 'Images: 10 included, 2 not embedded';
    const state = await poll(value => value.messages?.some(message => message.includes(report)), 'aggregate image report after successful clipboard write', 8000);
    const message = state.messages.find(text => text.includes(report));
    assert.ok(message.includes('Copied to clipboard')); assert.ok(!message.includes('/art/')); assert.ok(!message.includes('127.0.0.1'));
    assert.equal(state.frames, 0); assert.deepEqual(await sourceSnapshot(), before, 'Live page image attributes, scroll and viewport stay unchanged');
    assert.equal(context.pages().length, pagesBefore); assert.equal((await worker.evaluate(() => chrome.windows.getAll())).length, 1);
    passed('The post-copy status gives aggregate included/not-embedded counts without image URLs, and capture opens no tab/window or mutates the live page');

    assert.deepEqual(remote, []); assert.deepEqual(errors, []); assert.ok(requests.every(request => request.method === 'GET'));
    const documentRequests = requests.filter(request => request.type === 'document');
    assert.equal(documentRequests.length, 1, 'Only the original fixture document is visited');
    console.log(`\n${checks} image completeness Chromium checks passed.`);
  } finally {
    await context.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); fs.rmSync(profile, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
