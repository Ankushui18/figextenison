'use strict';
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const root = path.resolve(process.env.EXTENSION_ROOT || path.join(__dirname, '..'));
const artifacts = path.resolve(process.env.ARTIFACT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'page-capture-safety-artifacts-')));
fs.mkdirSync(artifacts, { recursive: true });
const html = `<!doctype html><html><head><meta charset="utf-8"><title>Safety and stability fixture</title><link rel="icon" href="data:,"><style>html{height:100%}body{margin:0;padding:30px;font:16px Arial;min-height:1600px}.invisible{display:none}img{display:block;margin:20px 0}label{display:block;margin:10px 0}</style></head><body><h1>Visual capture</h1><input id="csrf" type="hidden" value="SAFETY_HIDDEN_TOKEN"><input id="css-hidden" class="invisible" value="SAFETY_CSS_SECRET"><textarea class="invisible">SAFETY_TEXTAREA_SECRET</textarea><select class="invisible"><option>SAFETY_OPTION_SECRET</option></select><label>Visible email <input id="visible" value="visible@example.com"></label><label>Password <input id="password" type="password" value="SAFETY_PASSWORD_SECRET"></label><label><input type="checkbox" value="NONVISUAL_CHECKBOX_SECRET" checked> Current state</label><img id="art" src="/art.svg" width="160" height="120"><select><option value="NONVISUAL_OPTION_TOKEN" selected>Visible option</option></select><button value="NONVISUAL_BUTTON_TOKEN">Visible action</button><p>Editable text stays visible.</p></body></html>`;
const artwork = '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120"><rect width="160" height="120" fill="#2375dd"/><text x="10" y="40" fill="white">Artwork</text></svg>';
const legacySecret = 'SAFETY_OLD_SAVED_SECRET';
const legacyDocument = { version: 2, root: { nodeType: 1, tag: 'HTML', rect: { x: 0, y: 0, width: 1280, height: 1000 }, attributes: {}, styles: {}, childNodes: [
  { nodeType: 1, tag: 'INPUT', rect: { x: 0, y: 0, width: 0, height: 0 }, attributes: { type: 'hidden', value: legacySecret }, styles: { display: 'none' }, childNodes: [] },
  { nodeType: 1, tag: 'P', rect: { x: 10, y: 10, width: 200, height: 20 }, attributes: {}, styles: {}, childNodes: [{ nodeType: 3, text: 'Saved visible work', rect: { x: 10, y: 10, width: 200, height: 20 } }] }
] }, documentRect: { x: 0, y: 0, width: 1280, height: 1000 }, viewportRect: { x: 0, y: 0, width: 1280, height: 900 }, assets: {}, fonts: {} };
(async () => {
  const server = http.createServer((request, response) => { response.writeHead(200, { 'Content-Type': request.url === '/art.svg' ? 'image/svg+xml' : 'text/html; charset=utf-8' }); response.end(request.url === '/art.svg' ? artwork : html); });
  await new Promise(resolve => server.listen(0, '0.0.0.0', resolve));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'page-capture-safety-'));
  const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, viewport: null, args: ['--no-sandbox', '--window-size=1280,900', `--disable-extensions-except=${root}`, `--load-extension=${root}`] });
  const remote = [], errors = [], requests = [];
  context.on('request', request => { if (/^https?:/.test(request.url())) { requests.push({ url: request.url(), type: request.resourceType(), method: request.method() }); if (new URL(request.url()).hostname !== '127.0.0.1') remote.push(request.url()); } });
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  await context.route(/^https?:/, route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  let checks = 0; const passed = text => { checks++; console.log(`PASS ${text}`); };
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker'), page = await context.newPage(), url = `http://127.0.0.1:${server.address().port}/fixture`;
    await page.goto(url); await page.bringToFront(); await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(url).origin });
    const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url).id, url), key = `figma_h2d_toolbar_captures_${tabId}`;
    await worker.evaluate(async ({ key, doc }) => chrome.storage.local.set({ [key]: [{ type: 'snapshot', id: 'legacy-record', h2dJson: JSON.stringify(doc), previewUrl: '' }] }), { key, doc: legacyDocument });
    await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, func: () => {
      const t = globalThis.__safetyTest = { roots: [], mode: 'normal', writes: 0, nativeWrites: 0, prepCalls: 0, encoded: 0, release: null, activeFetch: false };
      const attach = Element.prototype.attachShadow;
      Element.prototype.attachShadow = function(options) { const root = attach.call(this, options); t.roots.push({ host: this, root }); return root; };
      Object.defineProperty(globalThis, 'PageCaptureSafety', { configurable: true, get: () => undefined, set(api) {
        t.api = api;
        Object.defineProperty(globalThis, 'PageCaptureSafety', { value: { ...api, createSession: () => { t.session = api.createSession(); return t.session; }, prepareClipboard: async (records, options) => {
          t.prepCalls++;
          if (t.mode === 'hold-prep') await api.wait(new Promise(resolve => { t.release = resolve; }), options.signal);
          const encode = options.encode;
          return api.prepareClipboard(records, { ...options, limits: t.mode === 'budget' ? { jsonBytes: 64, htmlBytes: 1024 } : options.limits, encode: async text => { t.encoded++; if (t.mode === 'bad-encode') throw new Error('DO_NOT_SHOW_PRIVATE_DIAGNOSTIC'); return encode(text); } });
        } } });
      } });
      Object.defineProperty(globalThis, 'PageCaptureDesignBoard', { configurable: true, get: () => undefined, set(api) { Object.defineProperty(globalThis, 'PageCaptureDesignBoard', { value: { ...api, createCopier(helpers) { t.helpers = helpers; return api.createCopier(helpers); } } }); } });
      Object.defineProperty(globalThis, 'PageCaptureDesignSystem', { configurable: true, get: () => undefined, set(api) { Object.defineProperty(globalThis, 'PageCaptureDesignSystem', { value: { ...api, attach(controller, ...args) { t.controller = controller; return api.attach(controller, ...args); } } }); } });
      const write = navigator.clipboard.write.bind(navigator.clipboard);
      navigator.clipboard.write = async items => {
        t.writes++;
        if (t.mode === 'deny') throw new DOMException('Clipboard denied in fixture', 'NotAllowedError');
        if (t.mode === 'hold-write') await new Promise(resolve => { t.release = resolve; });
        await write(items); t.nativeWrites++;
      };
      const fetch = globalThis.fetch.bind(globalThis);
      globalThis.fetch = (url, options) => {
        if (t.mode === 'hold-fetch' && String(url).endsWith('/art.svg')) return new Promise((resolve, reject) => {
          t.activeFetch = true; t.fetchSignal = options.signal; t.release = () => resolve(new Response('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120"/>', { headers: { 'Content-Type': 'image/svg+xml' } }));
          options.signal.addEventListener('abort', () => { t.activeFetch = false; reject(options.signal.reason); }, { once: true });
        });
        return fetch(url, options);
      };
    } }), tabId);
    const inject = () => worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, files: ['js/privacy.js', 'js/capture-safety.js', 'js/design-system-core.js', 'js/design-system-board.js', 'js/design-system.js', 'js/viewports.js', 'js/h2d_toolbar.js'] }), tabId);
    await inject(); await page.locator('#__figma_h2d_chrome_extension_toolbar__').waitFor({ state: 'attached' });
    const isolated = (operation, args = {}) => worker.evaluate(async ({ tabId, operation, args }) => {
      const [result] = await chrome.scripting.executeScript({ target: { tabId }, args: [operation, args], func: async (operation, args) => {
        const t = __safetyTest, host = document.getElementById('__figma_h2d_chrome_extension_toolbar__'), root = t.roots.find(entry => entry.host === host)?.root;
        const button = label => [...(root?.querySelectorAll('button') || [])].filter(node => !node.closest('[data-exit-role]')).find(node => node.getAttribute('aria-label') === label || node.textContent.trim() === label);
        if (operation === 'point') { const node = button(args.label); if (!node || node.disabled) return null; const r = node.getBoundingClientRect(); return r.width ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; }
        if (operation === 'mode') { t.mode = args.mode; return; }
        if (operation === 'release') { t.release?.(); t.release = null; return; }
        if (operation === 'dispose') { t.controller.destroy(); return; }
        if (operation === 'state') return { exists: !!host, ready: !!button('Capture design') && !button('Capture design').disabled, cancel: !!button('Cancel'), text: root?.querySelector('[role="toolbar"]')?.innerText || '', writes: t.writes, nativeWrites: t.nativeWrites, encoded: t.encoded, prepCalls: t.prepCalls, fetchActive: t.activeFetch, fetchAborted: !!t.fetchSignal?.aborted, frames: root?.querySelectorAll('iframe').length || 0, phase: t.session?.phase(), active: t.session?.isActive() };
        if (operation === 'worker-start') {
          t.workerAbort = new AbortController(); t.workerResult = null;
          t.workerPromise = t.api.requestAssets(['https://example.com/fixture.svg'], t.workerAbort.signal, async payload => { const result = await chrome.runtime.sendMessage({ cmd: 'H2D_FETCH_ASSETS', payload }); if (!result.success) throw new Error('Worker failure'); return result.value; }).then(() => { t.workerResult = 'success'; }, error => { t.workerResult = error.name; }); return;
        }
        if (operation === 'worker-abort') { t.workerAbort.abort(); await t.workerPromise; return t.workerResult; }
      } }); return result.result;
    }, { tabId, operation, args });
    const poll = async (predicate, message, timeout = 15000) => {
      const until = Date.now() + timeout;
      while (Date.now() < until) { const state = await isolated('state'); if (predicate(state)) return state; await new Promise(resolve => setTimeout(resolve, 35)); }
      throw new Error(`${message}: ${JSON.stringify(await isolated('state'))}`);
    };
    const click = async label => {
      let point, previous, stable = 0; const until = Date.now() + 5000;
      while (Date.now() < until) { point = await isolated('point', { label }); stable = point && previous && Math.abs(point.x - previous.x) < .2 && Math.abs(point.y - previous.y) < .2 ? stable + 1 : 0; if (stable >= 3) break; previous = point; await new Promise(resolve => setTimeout(resolve, 35)); }
      assert.ok(point && stable >= 3, label); await page.bringToFront(); await page.mouse.click(point.x, point.y);
    };
    const captures = () => worker.evaluate(async key => (await chrome.storage.local.get(key))[key] || [], key);
    const seed = text => page.evaluate(text => navigator.clipboard.writeText(text), text);
    const clipboard = async expected => {
      const until = Date.now() + 10000;
      while (Date.now() < until) {
        const html = await page.evaluate(async () => { for (const item of await navigator.clipboard.read()) if (item.types.includes('text/html')) return (await item.getType('text/html')).text(); return ''; });
        const match = html.match(/\(figh2d\)([A-Za-z0-9+/=]+)\(\/figh2d\)/);
        if (match) { const docs = JSON.parse(Buffer.from(match[1], 'base64').toString('utf8')); if (docs.length === expected) return { html, docs }; }
        await new Promise(resolve => setTimeout(resolve, 40));
      }
      await page.screenshot({ path: path.join(artifacts, 'clipboard-stalled.png'), caret: 'initial' }); throw Error('Native rich clipboard not ready: ' + JSON.stringify({ state: await isolated('state'), point: await isolated('point', { label: 'Copy all' }), viewport: await page.evaluate(() => ({ width: innerWidth, height: innerHeight })) }));
    };
    const source = () => page.evaluate(() => { const clone = document.implementation.createHTMLDocument('').importNode(document.documentElement, true); clone.querySelectorAll('[data-h2d-ignore="true"]').forEach(node => node.remove()); return { html: clone.outerHTML, width: innerWidth, height: innerHeight, scrollX, scrollY, visible: document.querySelector('#visible').value, hidden: document.querySelector('#csrf').value, password: document.querySelector('#password').value, loading: document.querySelector('img').getAttribute('loading'), decoding: document.querySelector('img').getAttribute('decoding') }; });
    const baseline = await source(), pagesBefore = context.pages().length, documentsBefore = requests.filter(request => request.type === 'document').length;
    let stored = await captures(); assert.equal(stored.length, 1); assert.equal(stored[0].id, 'legacy-record'); assert.ok(!stored[0].h2dJson.includes(legacySecret)); assert.ok(stored[0].h2dJson.includes('Saved visible work'));
    await click('Copy all'); await poll(state => state.ready, 'copy migrated record'); let rich = await clipboard(1); assert.ok(!JSON.stringify(rich.docs).includes(legacySecret));
    passed('Older saved snapshots are sanitized on load and copied without hidden tokens while IDs, previews and visible work are retained');
    await click('Discard all');
    await isolated('mode', { mode: 'deny' }); await seed('KEEP_ON_DENIAL'); const beforeDenial = await isolated('state'); await click('Capture design'); let state = await poll(state => state.ready && /Capture saved, but copying failed/.test(state.text), 'automatic denial feedback');
    stored = await captures(); assert.equal(stored.length, 1); const serialized = stored[0].h2dJson;
    for (const secret of ['SAFETY_HIDDEN_TOKEN', 'SAFETY_CSS_SECRET', 'SAFETY_TEXTAREA_SECRET', 'SAFETY_OPTION_SECRET', 'SAFETY_PASSWORD_SECRET', 'NONVISUAL_CHECKBOX_SECRET', 'NONVISUAL_OPTION_TOKEN', 'NONVISUAL_BUTTON_TOKEN']) assert.ok(!serialized.includes(secret), secret);
    assert.ok(serialized.includes('visible@example.com')); assert.ok(serialized.includes('Visible option')); assert.ok(serialized.includes('Visible action')); const visualNodes = []; const visit = node => { visualNodes.push(node); (node.childNodes || []).forEach(visit); }; visit(JSON.parse(serialized).root); assert.equal(visualNodes.find(node => node.tag === 'INPUT' && node.attributes?.type === 'checkbox').attributes.checked, 'true'); assert.equal(visualNodes.find(node => node.tag === 'OPTION' && node.attributes?.label === 'Visible option').attributes.selected, 'true'); assert.equal(state.writes, beforeDenial.writes + 1); assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'KEEP_ON_DENIAL'); assert.deepEqual(await source(), baseline);
    passed('Native capture excludes hidden/CSS-hidden/textarea/select/password values, preserves visible input state and source DOM, and clearly reports a denied automatic copy');
    await isolated('mode', { mode: 'normal' }); await click('Copy all'); await poll(state => state.ready, 'manual retry'); rich = await clipboard(1); assert.ok(JSON.stringify(rich.docs).includes('visible@example.com')); assert.ok(!JSON.stringify(rich.docs).includes('SAFETY_HIDDEN_TOKEN')); assert.ok(rich.html.includes('(figmeta)'));
    passed('The existing Copy all action successfully retries a failed automatic copy with the unchanged editable rich clipboard format');
    await click('Discard all'); await isolated('mode', { mode: 'budget' }); await seed('KEEP_ON_BUDGET'); const beforeBudget = await isolated('state'); await click('Capture design'); state = await poll(state => state.ready && /too large/.test(state.text), 'snapshot size budget');
    assert.equal((await captures()).length, 1); assert.equal(state.writes, beforeBudget.writes); assert.equal(state.encoded, beforeBudget.encoded); assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'KEEP_ON_BUDGET');
    passed('All-snapshot size limits stop copying before base64/native writes, show recovery advice, retain the capture and leave the old clipboard intact');
    await isolated('mode', { mode: 'normal' }); await click('Copy all'); await poll(state => state.ready, 'copy after budget retry'); await clipboard(1);
    passed('A budget failure does not corrupt saved captures or prevent a later eligible copy');
    await click('Discard all'); await isolated('mode', { mode: 'bad-encode' }); const beforeBad = await isolated('state'); await click('Capture design'); state = await poll(state => state.ready && /preparing the clipboard failed/.test(state.text), 'encoding feedback'); assert.ok(!state.text.includes('DO_NOT_SHOW_PRIVATE_DIAGNOSTIC')); assert.equal(state.writes, beforeBad.writes); assert.equal((await captures()).length, 1);
    passed('Encoding failures display privacy-safe actionable feedback without echoing source/error contents or losing the capture');
    await click('Discard all'); await isolated('mode', { mode: 'hold-fetch' }); const beforeCancel = await isolated('state'); await click('Capture design'); await poll(state => state.fetchActive && state.cancel, 'asset download'); await click('Cancel'); state = await poll(state => state.ready && state.fetchAborted, 'asset cancellation', 3000);
    assert.equal(state.writes, beforeCancel.writes); assert.equal((await captures()).length, 0); assert.deepEqual(await source(), baseline); await isolated('release');
    passed('Native Cancel aborts the active asset fetch promptly, returns controls, saves no unfinished capture and preserves the source');
    await isolated('mode', { mode: 'hold-prep' }); await seed('KEEP_ON_PREP_CANCEL'); const beforePrep = await isolated('state'); await click('Capture design'); await poll(state => state.cancel && /Preparing clipboard/.test(state.text), 'clipboard preparation'); await click('Cancel'); await poll(state => state.ready, 'preparation cancellation', 3000); await isolated('release');
    assert.equal((await captures()).length, 1); assert.equal((await isolated('state')).writes, beforePrep.writes); assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'KEEP_ON_PREP_CANCEL');
    passed('Cancelling clipboard preparation keeps the already completed capture, prevents a late write and preserves the previous clipboard');
    await click('Discard all'); await isolated('mode', { mode: 'hold-write' }); await seed('KEEP_UNTIL_WRITE_COMPLETES'); const beforeWrite = await isolated('state'); await click('Capture design'); state = await poll(state => /Copying to clipboard/.test(state.text) && state.writes > beforeWrite.writes, 'native writing phase'); assert.equal(state.cancel, false);
    await worker.evaluate(async tabId => { await chrome.tabs.sendMessage(tabId, { type: 'FIGMA_H2D_TOOLBAR_COMMAND', command: 'capture_code' }); await chrome.tabs.sendMessage(tabId, { type: 'FIGMA_H2D_TOOLBAR_COMMAND', command: 'select_element' }); }, tabId);
    assert.equal((await isolated('state')).writes, beforeWrite.writes + 1); assert.equal((await captures()).length, 1); assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'KEEP_UNTIL_WRITE_COMPLETES');
    await isolated('mode', { mode: 'normal' }); await isolated('release'); await poll(state => state.ready, 'write completion'); await clipboard(1);
    passed('An in-flight native write has no misleading Cancel control; conflicting raw/selection commands cannot start another job or overwrite its phase');
    for (const width of [600, 390]) {
      await page.setViewportSize({ width, height: baseline.height }); await poll(state => state.ready, 'narrow controls');
      await isolated('mode', { mode: 'deny' }); await click('Copy all'); await poll(state => state.ready && /Copying failed/.test(state.text), 'narrow error feedback');
      const point = await isolated('point', { label: 'Copy all' }); assert.ok(point && point.x >= 8 && point.x <= width - 8, `Reachable retry at ${width}px`);
      await isolated('mode', { mode: 'normal' }); await click('Copy all'); await poll(state => state.ready, 'narrow retry'); await clipboard(1);
    }
    await page.setViewportSize({ width: baseline.width, height: baseline.height }); await poll(state => state.ready, 'desktop controls restored');
    passed('Long copy/size errors preserve reachable Copy all controls at desktop, 600px and 390px widths; full feedback remains available to assistive text/tooltip');
    await click('Discard all'); await click('Capture code'); await poll(state => state.ready, 'raw HTML'); await page.waitForFunction(async () => (await navigator.clipboard.readText()).includes('SAFETY_HIDDEN_TOKEN')); const raw = await page.evaluate(() => navigator.clipboard.readText()); assert.ok(raw.includes('SAFETY_PASSWORD_SECRET')); assert.ok(raw.includes('<html')); assert.deepEqual(await source(), baseline);
    passed('Explicit Capture code remains raw HTML including original form values; privacy filtering does not mutate or silently clean that advanced mode');
    await isolated('mode', { mode: 'deny' }); await click('Capture design'); await poll(state => state.ready && /copying failed/.test(state.text), 'copy failure after raw capture');
    await new Promise(resolve => setTimeout(resolve, 3100)); state = await isolated('state'); assert.match(state.text, /copying failed/);
    passed('A stale raw-code success timer cannot erase a newer capture/copy error');
    await click('Discard all'); await isolated('mode', { mode: 'hold-fetch' }); const beforeDispose = await isolated('state'); await click('Capture design'); await poll(state => state.fetchActive, 'capture before disposal'); await isolated('dispose'); await page.locator('#__figma_h2d_chrome_extension_toolbar__').waitFor({ state: 'detached' });
    state = await isolated('state'); assert.equal(state.fetchAborted, true); assert.equal(state.writes, beforeDispose.writes); assert.equal((await captures()).length, 0); assert.deepEqual(await source(), baseline); await isolated('mode', { mode: 'normal' }); await inject(); await page.locator('#__figma_h2d_chrome_extension_toolbar__').waitFor({ state: 'attached' }); await poll(state => state.ready, 'reinjection');
    passed('Controller disposal aborts owned work and releases listeners; reinjection starts cleanly without a late capture, write or duplicate toolbar');
    await worker.evaluate(() => {
      globalThis.__workerSafety = { fetch: globalThis.fetch, signals: [], calls: 0 };
      globalThis.fetch = (_url, options) => { __workerSafety.calls++; __workerSafety.signals.push(options.signal); return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })); };
    });
    await isolated('worker-start');
    const workerUntil = Date.now() + 5000; let calls = 0;
    while (Date.now() < workerUntil) { calls = await worker.evaluate(() => __workerSafety.calls); if (calls) break; await new Promise(resolve => setTimeout(resolve, 25)); }
    assert.equal(calls, 1); assert.equal(await isolated('worker-abort'), 'AbortError');
    await worker.evaluate(async () => { for (const signal of __workerSafety.signals) if (!signal.aborted) throw Error('Worker fetch was not aborted'); globalThis.fetch = __workerSafety.fetch; });
    passed('Real content-script → worker RPC cancellation aborts the sender-bound recovery fetch using the existing command, without loosening CSP or permissions');
    assert.equal(context.pages().length, pagesBefore); assert.equal((await worker.evaluate(() => chrome.windows.getAll())).length, 1); assert.equal(requests.filter(request => request.type === 'document').length, documentsBefore); assert.deepEqual(remote, []); assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(artifacts, 'safety-summary.json'), JSON.stringify({ privacy: true, legacyMigration: true, copyFailureFeedback: true, downloadAbort: true, budgetBeforeEncoding: true, rawHtmlUnchanged: true, captureTabsCreated: 0, externalRequests: 0, checks: checks + 1 }, null, 2));
    passed('All safety flows keep the current local design/workflow, with no new capture tabs/windows, document visits, external requests/uploads or uncaught page errors');
    console.log(`\n${checks} capture-safety Chromium checks passed. Artifacts: ${artifacts}`);
  } finally { await context.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); fs.rmSync(profile, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
