'use strict';
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const root = path.resolve(process.env.EXTENSION_ROOT || path.join(__dirname, '..', 'extension'));
const artifacts = path.resolve(process.env.ARTIFACT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'page-capture-responsive-artifacts-')));
fs.mkdirSync(artifacts, { recursive: true });
const boot = `window.boots=(window.boots||0)+1;window.resizes=0;addEventListener('resize',()=>window.resizes++);document.querySelector('#live').value='unsaved-live';document.querySelector('#check').checked=true;document.querySelector('#select').value='b';document.querySelector('#state').textContent='SPA current state';let dynamic=document.createElement('style');dynamic.nonce='fixture';document.head.append(dynamic);dynamic.sheet.insertRule('#state{color:rgb(7, 8, 9)}');let sheet=new CSSStyleSheet;sheet.replaceSync('.adopted{border:3px solid rgb(40, 50, 60)}');document.adoptedStyleSheets=[sheet];window.builds=0;customElements.define('responsive-card',class extends HTMLElement{constructor(){super();window.builds++;let r=this.attachShadow({mode:'open'}),s=document.createElement('style'),p=document.createElement('p');s.nonce='fixture';s.textContent=':host{display:block}p::after{content:" SHADOW_DESKTOP"}@media(max-width:900px){p::after{content:" SHADOW_TABLET"}}@media(max-width:500px){p::after{content:" SHADOW_PHONE"}}';p.textContent='Open shadow';r.append(s,p)}});let c=document.querySelector('canvas');c.getContext('2d').fillRect(0,0,30,20);`;
const style = `*{box-sizing:border-box}body{font:16px/24px Arial;margin:0;padding:24px;min-height:1400px;background:#fafafa}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}.card{padding:16px;background:#ddeeff}.marker::after{content:" DESKTOP"}@media(max-width:900px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.marker::after{content:" TABLET"}}@media(max-width:500px){.grid{grid-template-columns:1fr}.marker::after{content:" PHONE"}}input,select{font:16px Arial}iframe{width:150px;height:40px}`;
(async () => {
  const cross = http.createServer((request, response) => { response.writeHead(200, { 'Content-Type': 'text/css' }); response.end('#state.cross{color:rgb(11,22,33)}@media(max-width:500px){#state.cross{color:rgb(33,22,11)}}'); });
  await new Promise(resolve => cross.listen(0, '0.0.0.0', resolve));
  const crossUrl = `http://127.0.0.1:${cross.address().port}/cross.css`;
  const server = http.createServer((request, response) => {
    if (request.url === '/boot.js') { response.writeHead(200, { 'Content-Type': 'text/javascript' }); response.end(boot); return; }
    if (request.url === '/embed') { response.end('<!doctype html><title>Embedded fixture</title>Existing embed'); return; }
    const strict = request.url.startsWith('/strict');
    const headers = { 'Content-Type': 'text/html; charset=utf-8' };
    if (strict) headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self'; style-src 'nonce-fixture'; img-src 'self' data:; frame-src 'none'; connect-src 'none'; object-src 'none'";
    response.writeHead(200, headers);
    response.end(`<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"><title>Current responsive app</title><style nonce="fixture">${style}</style>${strict ? '' : `<link rel="stylesheet" href="${crossUrl}">`}<script src="/boot.js" defer></script></head><body><h1>Current app</h1><p class="marker">Responsive</p><p id="state" class="adopted cross">Initial server state</p><label>Live <input id="live" value="server-value"></label><input id="check" type="checkbox"><select id="select"><option value="a">First</option><option value="b">Current choice</option></select><div class="grid"><div class="card" id="one">One</div><div class="card" id="two">Two</div><div class="card" id="three">Three</div></div><responsive-card></responsive-card><canvas width="30" height="20"></canvas>${strict ? '' : '<iframe src="/embed" title="Existing embed"></iframe>'}</body></html>`);
  });
  await new Promise(resolve => server.listen(0, '0.0.0.0', resolve));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'page-capture-responsive-'));
  const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, viewport: null, args: ['--no-sandbox', '--window-size=1280,900', `--disable-extensions-except=${root}`, `--load-extension=${root}`] });
  const requests = [], errors = [], remote = [], newPages = [];
  context.on('request', request => { if (/^https?:/.test(request.url())) { const record = { url: request.url(), type: request.resourceType(), method: request.method() }; requests.push(record); if (new URL(record.url).hostname !== '127.0.0.1') remote.push(record); } });
  context.on('page', page => { newPages.push(page); page.on('pageerror', error => errors.push(error.message)); });
  await context.route(/^https?:/, route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  let checks = 0; const passed = message => { checks++; console.log(`PASS ${message}`); };
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const page = await context.newPage(), base = `http://127.0.0.1:${server.address().port}`;
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
    const prepare = async suffix => {
      await page.goto(base + suffix); await page.bringToFront();
      const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url).id, base + suffix);
      await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, func: () => {
        const test = globalThis.__responsiveTest = { roots: [], mode: 'normal', captures: 0, samples: [], result: null };
        const attach = Element.prototype.attachShadow;
        Element.prototype.attachShadow = function(options) { const root = attach.call(this, options); test.roots.push({ host: this, root }); return root; };
        const timeout = globalThis.setTimeout.bind(globalThis);
        globalThis.setTimeout = (fn, ms, ...args) => timeout(fn, test.mode === 'timeout' && ms === 20000 ? 30 : ms, ...args);
        Object.defineProperty(globalThis, 'PageCaptureViewports', { configurable: true, get: () => undefined, set(api) {
          test.api = api;
          Object.defineProperty(globalThis, 'PageCaptureViewports', { configurable: true, value: { ...api, createCapturer(helpers) {
            test.helpers = helpers;
            return api.createCapturer({ ...helpers, capture: async (element, options) => {
              test.captures++;
              test.samples.push({ width: element.ownerDocument.defaultView.innerWidth, parentRealm: element instanceof Element, scripts: element.querySelectorAll('script').length, ignored: element.querySelectorAll('[data-h2d-ignore="true"]').length, compatMode: element.ownerDocument.compatMode, actualRoot: element.getBoundingClientRect().width });
              if (test.mode === 'hold') await new Promise((_, reject) => options.timeoutSignal.addEventListener('abort', () => reject(options.timeoutSignal.reason), { once: true }));
              if (test.mode === 'capture-fail') throw new Error('Test responsive failure');
              return helpers.capture(element, options);
            }, serialize: async (...args) => { if (test.mode === 'serialize-fail') throw new Error('Test responsive serialization failure'); return helpers.serialize(...args); } });
          } } });
        } });
      } }), tabId);
      await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, files: ['js/privacy.js', 'js/capture-safety.js', 'js/clipboard.js', 'js/design-system-core.js', 'js/design-system-board.js', 'js/design-system.js', 'js/viewports.js', 'js/capture-stability.js', 'js/html-export.js', 'js/picker-navigation.js', 'js/h2d_toolbar.js'] }), tabId);
      await page.locator('#__figma_h2d_chrome_extension_toolbar__').waitFor({ state: 'attached' });
      return tabId;
    };
    let tabId = await prepare('/app');
    const isolated = (operation, args = {}) => worker.evaluate(async ({ tabId, operation, args }) => {
      const [result] = await chrome.scripting.executeScript({ target: { tabId }, args: [operation, args], func: (operation, args) => {
        const t = globalThis.__responsiveTest, host = document.getElementById('__figma_h2d_chrome_extension_toolbar__'), root = t.roots.find(entry => entry.host === host)?.root;
        const buttons = [...root.querySelectorAll('button')], button = label => buttons.find(node => node.getAttribute('aria-label') === label || node.textContent.trim() === label);
        if (operation === 'point') { const node = button(args.label); if (!node || node.disabled) return null; const r = node.getBoundingClientRect(); return r.width ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; }
        if (operation === 'mode') { t.mode = args.mode; return; }
        if (operation === 'abort') { t.abort.abort(); return; }
        if (operation === 'direct') {
          t.abort = new AbortController(); t.result = null;
          t.pending = globalThis.PageCaptureViewports.createCapturer(t.helpers)({ width: 393, height: 900, signal: t.abort.signal, mount: root }).then(value => { t.result = { ok: true, value }; }, error => { t.result = { ok: false, name: error.name, message: error.message }; }); return;
        }
        if (operation === 'state') return { frames: root.querySelectorAll('[data-page-capture-viewport-frame]').length, captures: t.captures, samples: t.samples, result: t.result, ready: !!button('Capture design') && !button('Capture design').disabled, status: [...root.querySelectorAll('[role="status"],[role="alert"]')].map(node => node.textContent).join(' '), text: root.querySelector('[role="toolbar"]')?.innerText };
      } }); return result.result;
    }, { tabId, operation, args });
    const poll = async (predicate, message, timeout = 25000) => {
      const until = Date.now() + timeout;
      while (Date.now() < until) { const state = await isolated('state'); if (predicate(state)) return state; await new Promise(resolve => setTimeout(resolve, 35)); }
      throw new Error(`${message}: ${JSON.stringify(await isolated('state'))}`);
    };
    const click = async label => {
      let previous, point, stable = 0; const until = Date.now() + 5000;
      while (Date.now() < until) { point = await isolated('point', { label }); stable = point && previous && Math.abs(point.x - previous.x) < .2 && Math.abs(point.y - previous.y) < .2 ? stable + 1 : 0; if (stable >= 3) break; previous = point; await new Promise(resolve => setTimeout(resolve, 35)); }
      assert.ok(point && stable >= 3, label); await page.bringToFront(); await page.mouse.click(point.x, point.y);
    };
    const captures = () => worker.evaluate(async tabId => (await chrome.storage.local.get(`figma_h2d_toolbar_captures_${tabId}`))[`figma_h2d_toolbar_captures_${tabId}`] || [], tabId);
    const preferences = rows => worker.evaluate(async rows => chrome.storage.local.set({ pc_viewports_v1: rows }), rows);
    const source = () => page.evaluate(() => { const clone = document.implementation.createHTMLDocument('').importNode(document.documentElement, true); clone.querySelectorAll('[data-h2d-ignore="true"]').forEach(node => node.remove()); return { html: clone.outerHTML, width: innerWidth, height: innerHeight, scrollX, scrollY, value: document.querySelector('#live').value, checked: document.querySelector('#check').checked, selected: document.querySelector('#select').value, boots: window.boots, builds: window.builds, resizes: window.resizes, sheets: document.adoptedStyleSheets.length }; });
    const decode = async () => {
      const until = Date.now() + 10000; let html = '', data;
      while (Date.now() < until) {
        html = await page.evaluate(async () => { for (const item of await navigator.clipboard.read()) if (item.types.includes('text/html')) return (await item.getType('text/html')).text(); return ''; });
        data = html.match(/\(figh2d\)([A-Za-z0-9+/=]+)\(\/figh2d\)/);
        if (data) return JSON.parse(Buffer.from(data[1], 'base64').toString('utf8'));
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      fs.writeFileSync(path.join(artifacts, 'unexpected-clipboard.html'), html); assert.fail('Native rich clipboard was not ready');
    };
    const walk = node => [node, ...(node.childNodes || []).flatMap(walk), ...Object.values(node.pseudoElementNodes || {}).flatMap(walk)];
    const byId = (doc, id) => walk(doc.root).find(node => node.attributes?.id === id);
    const run = async widths => {
      await preferences([{ id: 'browser', on: false }, ...widths.map(w => ({ id: String(w), on: true, w }))]);
      await click('Capture design'); await poll(state => state.ready, 'responsive capture');
      return (await captures()).slice(0, widths.length).map(cap => JSON.parse(cap.h2dJson));
    };
    const before = await source(), navigationCount = requests.filter(request => request.type === 'document').length, pagesBefore = newPages.length;
    let docs = await run([1600, 393]); assert.equal(docs.length, 2); assert.deepEqual(docs.map(doc => doc.root.rect.width), [1600, 393]);
    assert.ok(JSON.stringify(docs[0]).includes('DESKTOP')); assert.ok(JSON.stringify(docs[1]).includes('PHONE')); assert.ok(JSON.stringify(docs[1]).includes('SHADOW_PHONE'));
    assert.ok(byId(docs[0], 'two').rect.x > byId(docs[0], 'one').rect.x); assert.ok(byId(docs[1], 'two').rect.y > byId(docs[1], 'one').rect.y);
    assert.deepEqual((await decode()).map(doc => doc.root.rect.width), [1600, 393]);
    assert.equal(newPages.length, pagesBefore); assert.equal(requests.filter(request => request.type === 'document').length, navigationCount); assert.equal((await worker.evaluate(() => chrome.windows.getAll())).length, 1);
    passed('Exactly two selected responsive designs, including a width larger than the actual browser, reach the native clipboard without any new tab/window or document visit');
    assert.deepEqual(await source(), before);
    for (const doc of docs) { assert.equal(byId(doc, 'live').attributes.value, 'unsaved-live'); assert.equal(byId(doc, 'check').attributes.checked, 'true'); assert.ok(JSON.stringify(doc).includes('SPA current state')); assert.equal(byId(doc, 'state').styles.borderTopWidth, '3px'); }
    const samples = (await isolated('state')).samples; assert.ok(samples.every(sample => sample.parentRealm && sample.scripts === 0 && sample.ignored === 0 && sample.compatMode === 'CSS1Compat'));
    assert.equal((await source()).builds, 1); assert.equal(requests.filter(request => request.url.endsWith('/boot.js')).length, 1);
    passed('Current SPA/form/checkbox state, dynamic CSSOM styles, adopted sheets and open shadow roots are copied without rerunning app scripts/custom constructors or changing the source');
    assert.equal(byId(docs[0], 'state').styles.color, 'rgb(11, 22, 33)'); assert.equal(byId(docs[1], 'state').styles.color, 'rgb(33, 22, 11)');
    assert.equal(requests.filter(request => request.url.endsWith('/embed')).length, 1);
    passed('CSSOM-unreadable cross-origin stylesheet links keep their cascade/media behavior; existing embedded document URLs are never reloaded');

    await page.evaluate(() => { scrollTo(0, 150); document.querySelector('#live').focus({ preventScroll: true }); });
    const stable = await source();
    await isolated('direct'); let state = await poll(state => state.result, 'direct responsive capture'); assert.equal(state.result.ok, true); assert.equal(state.frames, 0); assert.deepEqual(await source(), stable);
    assert.equal(await page.locator('#live').evaluate(node => document.activeElement === node), true);
    passed('The isolated responsive-only path preserves live source DOM, scroll, focus and viewport and leaves no frame behind');

    for (const mode of ['capture-fail', 'serialize-fail', 'timeout']) {
      await isolated('mode', { mode }); await isolated('direct'); state = await poll(state => state.result, mode); assert.equal(state.result.ok, false); assert.equal(state.frames, 0); assert.deepEqual(await source(), stable);
    }
    passed('Capture/serialization failures and preparation timeout remove temporary frames and report real errors instead of polling a worker for 60 seconds');
    await isolated('mode', { mode: 'hold' }); const started = (await isolated('state')).captures; await isolated('direct'); await poll(state => state.frames === 1 && state.captures > started, 'held responsive preparation'); await isolated('abort'); state = await poll(state => state.result, 'responsive cancellation'); assert.equal(state.result.ok, false); assert.equal(state.result.name, 'AbortError'); assert.equal(state.frames, 0); assert.deepEqual(await source(), stable);
    passed('Cancelling responsive preparation aborts immediately and removes the isolated frame without source changes');

    await click('Discard all'); await isolated('mode', { mode: 'capture-fail' });
    await preferences([{ id: 'browser', on: true }, { id: '393', on: true, w: 393 }]); await page.evaluate(() => navigator.clipboard.writeText('KEEP_ON_PARTIAL_FAILURE')); await click('Capture design');
    state = await poll(state => state.ready && /Could not capture 393px/.test(state.text), 'partial capture error'); assert.equal((await captures()).length, 1); assert.equal(state.frames, 0); assert.match(state.text, /Earlier captures were kept/);
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'KEEP_ON_PARTIAL_FAILURE');
    await isolated('mode', { mode: 'normal' }); await click('Copy all'); assert.equal((await decode()).length, 1);
    passed('An extra-width failure keeps the working original 1.6-style Browser capture and clipboard intact, reports the failed width, and allows manual Copy');
    await click('Discard all'); await isolated('mode', { mode: 'hold' }); await preferences([{ id: 'browser', on: false }, { id: '393', on: true, w: 393 }]);
    await click('Capture design'); await poll(state => state.frames === 1, 'native responsive capture in progress'); await click('Cancel'); state = await poll(state => state.ready && state.frames === 0, 'native Cancel'); assert.equal((await captures()).length, 0);
    passed('Native Capture design → Cancel cleans the in-page renderer without creating a window or partial tray record');

    tabId = await prepare('/strict'); const strictBefore = await source(), strictNavs = requests.filter(request => request.type === 'document').length;
    docs = await run([768, 393]); assert.equal(docs.length, 2); assert.deepEqual(docs.map(doc => doc.root.rect.width), [768, 393]); assert.ok(JSON.stringify(docs[0]).includes('SHADOW_TABLET')); assert.ok(JSON.stringify(docs[1]).includes('SHADOW_PHONE')); assert.deepEqual(await source(), strictBefore); assert.equal(requests.filter(request => request.type === 'document').length, strictNavs);
    passed('Strict script/style/frame/connect CSP supports standards-mode responsive CSS and shadow pseudo-elements without URL navigation or source mutation');
    assert.deepEqual(remote, []); assert.deepEqual(errors, []); assert.ok(requests.every(request => request.method === 'GET'));
    fs.writeFileSync(path.join(artifacts, 'responsive-summary.json'), JSON.stringify({ widths: docs.map(doc => doc.root.rect.width), sourceUnchanged: true, newCaptureTabs: 0, newCaptureWindows: 0, appScriptReruns: 0, checks: checks + 1 }, null, 2));
    passed('All responsive flows use only expected stylesheet/asset GETs, no remote attempts/uploads or uncaught page errors');
    console.log(`\n${checks} in-page responsive Chromium checks passed. Artifacts: ${artifacts}`);
  } finally { await context.close(); await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => cross.close(resolve))]); fs.rmSync(profile, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
