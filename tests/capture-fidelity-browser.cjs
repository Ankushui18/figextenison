'use strict';
// Real MV3 capture fidelity, keyboard selection and offscreen clipboard checks.
// Instrumentation is test-only and runs in the extension's isolated world.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const root = path.resolve(process.env.EXTENSION_ROOT || path.join(__dirname, '..', 'extension'));
const files = [
  'js/privacy.js', 'js/capture-safety.js', 'js/clipboard.js', 'js/design-system-core.js',
  'js/design-system-board.js', 'js/design-system.js', 'js/viewports.js',
  'js/wireframe-core.js', 'js/wireframe.js', 'js/capture-stability.js', 'js/html-export.js', 'js/picker-navigation.js', 'js/h2d_toolbar.js'
];
const html = `<!doctype html><html><head><meta charset="utf-8"><title>Fidelity fixture</title><link rel="icon" href="data:,"><style>
*{box-sizing:border-box}body{margin:0;padding:24px;font:16px Arial;background:#fff;color:#222}label{display:block;margin:8px 0}canvas,video{display:block;width:64px;height:64px;margin:12px 0}@keyframes capture-spin{to{transform:rotate(360deg)}}#animated{width:80px;padding:8px;background:#fef0c7;animation:capture-spin 8s linear infinite}.badge{display:inline-block;padding:12px;background:#eef4ff}.badge::before{content:"NEW";color:#175cd3;font-weight:700;margin-right:8px}.badge::after{content:"";display:inline-block;width:16px;height:16px;background-image:url("/dot.svg");background-size:contain}#keyboard-parent{width:320px;height:150px;padding:24px;margin-top:24px;background:#f2f2f2}#first-child{display:block;width:50px;height:24px;margin:0 0 20px 0}#second-child{display:block;width:85px;height:32px;margin:0;background:#dde8ff}
</style></head><body><h1>Capture fidelity</h1>
<label>Email <input id="email" type="email" value="old@example.com"></label>
<label>Notes <textarea id="notes">old notes</textarea></label>
<label><input id="check" type="checkbox" value="nonvisual-check-id"> Enabled</label>
<select id="choice"><option id="one" value="nonvisual-one">One</option><option id="two" value="nonvisual-two">Two</option></select>
<label>Password <input id="password" type="password" value="initial-secret"></label>
<canvas id="chart" width="64" height="64"></canvas><video id="movie" muted autoplay playsinline></video>
<div id="badge" class="badge">Pseudo content</div>
<div id="animated">Animated capture</div><div id="many"></div>
<section id="keyboard-parent" tabindex="-1"><button id="first-child">First</button><button id="second-child">Second</button></section>
<script>
const chart=document.querySelector('#chart'),ctx=chart.getContext('2d');ctx.fillStyle='#0d99ff';ctx.fillRect(0,0,64,64);ctx.fillStyle='#fff';ctx.fillRect(12,12,24,24);
const stream=chart.captureStream(10),video=document.querySelector('#movie');video.srcObject=stream;
document.querySelector('#email').value='current@example.com';document.querySelector('#notes').value='current notes';document.querySelector('#check').checked=true;document.querySelector('#choice').selectedIndex=1;document.querySelector('#password').value='current-secret';
const many=document.querySelector('#many');for(let index=0;index<450;index++){const span=document.createElement('span');span.textContent=' cooperative ';many.append(span);}
window.mediaReady=(async()=>{await video.play();if(video.requestVideoFrameCallback)await new Promise(resolve=>video.requestVideoFrameCallback(()=>resolve()));else await new Promise(resolve=>video.onloadeddata=resolve);})();
</script></body></html>`;
const flatten = node => [node, ...(node.childNodes || []).flatMap(flatten), ...Object.values(node.pseudoElementNodes || {}).filter(Boolean).flatMap(flatten)];
const richFromClipboard = page => page.evaluate(async () => {
  for (const item of await navigator.clipboard.read()) {
    if (item.types.includes('text/html')) return (await item.getType('text/html')).text();
  }
  return '';
});

(async () => {
  const server = http.createServer((request, response) => {
    if (request.url === '/dot.svg') {
      response.writeHead(200, { 'Content-Type': 'image/svg+xml' });
      response.end('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="8" fill="#f79009"/></svg>');
      return;
    }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end(html);
  });
  await new Promise(resolve => server.listen(0, '0.0.0.0', resolve));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'page-capture-fidelity-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true, viewport: { width: 1280, height: 900 },
    args: ['--no-sandbox', `--disable-extensions-except=${root}`, `--load-extension=${root}`]
  });
  const remote = [], errors = [];
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  context.on('request', request => { if (/^https?:/.test(request.url()) && new URL(request.url()).hostname !== '127.0.0.1') remote.push(request.url()); });
  await context.route(/^https?:/, route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  let checks = 0; const passed = text => { checks++; console.log(`PASS ${text}`); };
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const page = await context.newPage(), url = `http://127.0.0.1:${server.address().port}/fidelity`;
    await page.goto(url); await page.evaluate(() => window.mediaReady); await page.bringToFront();
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(url).origin });
    const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url).id, url);
    await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, func: () => {
      const state = globalThis.__fidelityTest = { roots: [], denyDirect: false, denyRecovery: false, directAttempts: 0, animationCalls: [] };
      const sendMessage = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = (...args) => state.denyRecovery && args[0]?.cmd === 'H2D_WRITE_CLIPBOARD'
        ? Promise.resolve({ success: false, error: { message: 'Test recovery denial' } }) : sendMessage(...args);
      const pause = Animation.prototype.pause, play = Animation.prototype.play;
      Animation.prototype.pause = function() { state.animationCalls.push('pause'); return pause.call(this); };
      Animation.prototype.play = function() { state.animationCalls.push('play'); return play.call(this); };
      const attach = Element.prototype.attachShadow;
      Element.prototype.attachShadow = function(options) { const root = attach.call(this, options); state.roots.push({ host: this, root }); return root; };
      const write = navigator.clipboard.write.bind(navigator.clipboard), writeText = navigator.clipboard.writeText.bind(navigator.clipboard);
      navigator.clipboard.write = async items => { state.directAttempts++; if (state.denyDirect) throw new DOMException('Test direct focus denial', 'NotAllowedError'); return write(items); };
      navigator.clipboard.writeText = async text => { state.directAttempts++; if (state.denyDirect) throw new DOMException('Test direct focus denial', 'NotAllowedError'); return writeText(text); };
    } }), tabId);
    await worker.evaluate(async ({ tabId, files }) => chrome.scripting.executeScript({ target: { tabId }, files }), { tabId, files });
    await page.locator('#__figma_h2d_chrome_extension_toolbar__').waitFor({ state: 'attached' });

    const isolated = (operation, args = {}) => worker.evaluate(async ({ tabId, operation, args }) => {
      const [result] = await chrome.scripting.executeScript({ target: { tabId }, args: [operation, args], func: (operation, args) => {
        const test = __fidelityTest, host = document.getElementById('__figma_h2d_chrome_extension_toolbar__'), root = test.roots.find(entry => entry.host === host)?.root;
        const button = label => [...(root?.querySelectorAll('button') || [])].find(node => node.getAttribute('aria-label') === label || node.textContent.trim() === label);
        if (operation === 'point') { const node = button(args.label); if (!node || node.disabled) return null; const r = node.getBoundingClientRect(); return r.width ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; }
        if (operation === 'state') return {
          ready: !!button('Capture design') && !button('Capture design').disabled,
          tooltip: root?.querySelector('[data-toolbar-role="selection-tooltip"]')?.textContent || '',
          message: root?.querySelector('[data-toolbar-role="transient-message"]')?.textContent || '',
          text: root?.querySelector('[role="toolbar"]')?.innerText || '',
          progress: !!root?.querySelector('[data-toolbar-role="transient-progress"]'),
          attempts: test.directAttempts,
          progressMessages: test.progressMessages || []
        };
        if (operation === 'deny') { test.denyDirect = args.value; return; }
        if (operation === 'recovery') { test.denyRecovery = args.value; return; }
        if (operation === 'observe') {
          test.progressMessages = []; let previous = '';
          const collect = () => { const value = [...root.querySelectorAll('[data-toolbar-role="message"]')].map(node => node.textContent).join(' '); if (value && value !== previous) { previous = value; test.progressMessages.push(value); } };
          test.progressObserver = new MutationObserver(collect); test.progressObserver.observe(root, { subtree: true, childList: true, characterData: true }); collect(); return;
        }
        if (operation === 'motion') return {
          calls: [...test.animationCalls],
          states: document.querySelector('#animated').getAnimations().map(animation => animation.playState)
        };
      } }); return result.result;
    }, { tabId, operation, args });
    const poll = async (predicate, message, timeout = 20000) => {
      const until = Date.now() + timeout;
      while (Date.now() < until) { const state = await isolated('state'); if (predicate(state)) return state; await new Promise(resolve => setTimeout(resolve, 40)); }
      throw new Error(`${message}: ${JSON.stringify(await isolated('state'))}`);
    };
    const click = async label => {
      let point, previous, stable = 0; const until = Date.now() + 6000;
      while (Date.now() < until) { point = await isolated('point', { label }); stable = point && previous && Math.abs(point.x - previous.x) < .2 && Math.abs(point.y - previous.y) < .2 ? stable + 1 : 0; if (stable >= 3) break; previous = point; await new Promise(resolve => setTimeout(resolve, 35)); }
      assert.ok(point && stable >= 3, label); await page.bringToFront(); await page.mouse.click(point.x, point.y);
    };
    const key = `figma_h2d_toolbar_captures_${tabId}`;
    const captures = () => worker.evaluate(async key => (await chrome.storage.local.get(key))[key] || [], key);
    const waitCaptures = async count => {
      const until = Date.now() + 30000;
      while (Date.now() < until) { const saved = await captures(); if (saved.length === count) return saved; await new Promise(resolve => setTimeout(resolve, 50)); }
      throw new Error(`Expected ${count} captures`);
    };

    await isolated('observe');
    await click('Capture design');
    const stored = await waitCaptures(1); await poll(state => state.ready && /Copied to clipboard/.test(state.message), 'initial capture');
    const progressed = await isolated('state');
    assert.ok(progressed.progressMessages.some(message => message.includes('Capturing page layout')));
    passed('Accessible busy text reports the actual serializer layout phase during a yielding capture');

    const doc = JSON.parse(stored[0].h2dJson), nodes = flatten(doc.root);
    const byId = id => nodes.find(node => node.attributes?.id === id);
    assert.equal(byId('email').attributes.value, 'current@example.com');
    assert.equal(byId('notes').attributes.value, 'current notes');
    assert.equal(byId('check').attributes.checked, 'true');
    assert.equal(byId('two').attributes.selected, 'true');
    assert.equal(byId('one').attributes.selected, 'false');
    assert.equal(Object.hasOwn(byId('password').attributes, 'value'), false);
    passed('Editable capture preserves current form state and selected options while retaining password redaction');

    const motion = await isolated('motion');
    assert.ok(motion.calls.includes('pause') && motion.calls.includes('play'));
    assert.ok(motion.states.every(state => state === 'running'));
    passed('Capture pauses running page animation and resumes it after serialization');

    for (const id of ['chart', 'movie']) {
      const node = byId(id); assert.ok(node?.placeholderUrl, `${id} has a raster placeholder`);
      const asset = doc.assets[node.placeholderUrl];
      assert.ok(asset?.blob?.base64Blob?.length > 100, `${id} contains encoded pixels`);
      assert.match(asset.blob.type, /^image\//);
    }
    assert.equal(await page.evaluate(() => document.querySelector('#movie').paused), false);
    passed('Canvas and live video frames become embedded image assets without pausing the source video');

    const before = nodes.find(node => node.id?.endsWith('::before')), after = nodes.find(node => node.id?.endsWith('::after'));
    assert.ok(before && JSON.stringify(before).includes('NEW'));
    assert.ok(after?.styles?.backgroundImage?.includes('dot.svg'));
    assert.ok(Object.keys(doc.assets).some(key => key.endsWith('/dot.svg')));
    passed('Before/after pseudo content, decoration and referenced artwork survive in the editable model');

    await isolated('deny', { value: true });
    const beforePaper = await isolated('state');
    await click('Copy for Paper');
    await poll(state => state.ready && /Paper HTML copied/.test(state.message) && state.attempts > beforePaper.attempts, 'offscreen Paper recovery');
    const paper = await richFromClipboard(page);
    assert.ok(paper.startsWith('<x-paper-html>'));
    assert.match(paper, /current@example.com/);
    assert.match(paper, /NEW/);
    assert.match(paper, /data:image\//);
    assert.doesNotMatch(paper, /current-secret|figh2d|figmeta|<script|onerror=/i);
    assert.match(await page.evaluate(() => navigator.clipboard.readText()), /Capture fidelity/);
    passed('Paper HTML uses a separate sanitized payload and recovers through the real offscreen writer');

    await isolated('recovery', { value: true });
    await click('Copy for Paper');
    const failedPaper = await poll(state => state.ready && /Paper HTML copy failed/.test(state.text), 'Paper failure cleanup');
    assert.doesNotMatch(failedPaper.message, /Paper HTML copied/);
    await isolated('recovery', { value: false });
    passed('A rejected Paper write reports its own error and releases the copy session for the next action');

    const beforeRecovery = await isolated('state');
    await click('Copy all');
    const recovered = await poll(state => state.ready && /Copied to clipboard/.test(state.message) && state.attempts > beforeRecovery.attempts, 'offscreen rich recovery');
    assert.equal(recovered.progress, true);
    const rich = await richFromClipboard(page); assert.ok(rich.includes('(figh2d)'));
    passed('A rejected direct rich write recovers through the real MV3 offscreen document and shows accessible progress feedback');

    await click('Capture code');
    await poll(state => state.ready && /Code copied to clipboard/.test(state.text), 'offscreen raw recovery');
    await page.waitForFunction(async () => (await navigator.clipboard.readText()).includes('<title>Fidelity fixture</title>'));
    passed('Raw Capture code also recovers after a direct clipboard denial without changing its outerHTML contract');

    await isolated('deny', { value: false });
    await click('Select element');
    const rect = await page.locator('#keyboard-parent').boundingBox();
    await page.mouse.move(rect.x + 6, rect.y + 6); await page.locator('#keyboard-parent').focus();
    await page.keyboard.press('ArrowDown'); await poll(state => state.tooltip.includes('first-child'), 'first child keyboard selection');
    await page.keyboard.press('ArrowDown'); await poll(state => state.tooltip.includes('second-child'), 'next sibling keyboard selection');
    await page.keyboard.press('Enter');
    const selected = await waitCaptures(2); await poll(state => state.ready, 'keyboard capture completion');
    assert.equal(JSON.parse(selected[0].h2dJson).root.attributes.id, 'second-child');
    passed('Arrow Down reaches the first child and then the next sibling; Enter captures the exact keyboard selection');

    assert.deepEqual(remote, []); assert.deepEqual(errors, []);
    passed('Fidelity and recovery flows produce no remote requests or uncaught page errors');
    console.log(`\n${checks} capture-fidelity Chromium checks passed.`);
  } finally {
    await context.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    fs.rmSync(profile, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
