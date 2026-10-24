'use strict';
// Embedded documents: a page may show its design inside same-origin iframes
// (exported boards, dashboard cards, embedded editors). The engine captures the
// frame element and stops, so the copy used to paste as four empty boxes.
//
// This suite loads the real capture engine into a page and drives the real
// "Capture design" button. The toolbar's extension plumbing (service worker,
// chrome.* APIs) is replaced by a small shim: everything under test here — the
// engine's serialization, the embedded-frames hook, the copy pipeline — is the
// shipped code. No chrome.* message could change the outcome, so no extension
// install is needed.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const root = path.resolve(process.env.EXTENSION_ROOT || path.join(__dirname, '..', 'extension'));
const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/embedded-frames.html'), 'utf8');
const INNER = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Inner page</title></head>
<body style="margin:0;background:#fff;font-family:Arial"><div style="padding:20px">
<h2>Inner card B</h2><p>Served same-origin frame content</p></div></body></html>`;
// Order matches js/background.js. The embedded-frames module installs after the
// wireframe hook so a wireframe copy still receives the real frame content.
const FILES = ['js/privacy.js', 'js/capture-safety.js', 'js/design-system-core.js', 'js/design-system-board.js',
  'js/design-system.js', 'js/viewports.js', 'js/wireframe-core.js', 'js/wireframe.js', 'js/embedded-frames.js', 'js/h2d_toolbar.js'];

const walk = node => [node, ...(node.childNodes || []).flatMap(walk)];
const textOf = doc => walk(doc.root).filter(node => node.nodeType === 3).map(node => node.text).join(' ');

(async () => {
  let clips = 0;
  const server = http.createServer((request, response) => {
    const html = request.url === '/inner' ? INNER
      : request.url === '/cross' ? '<!DOCTYPE html><html><body><h2>Cross origin frame</h2></body></html>'
        : fixture.replace('__CROSS_ORIGIN__', `http://localhost:${server.address().port}/cross`);
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(html);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({
    ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chromium' }),
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader']
  });
  const errors = [];
  let checks = 0;
  const passed = name => { checks++; console.log(`PASS ${name}`); };
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on('pageerror', error => errors.push(error.message));
    // Same seams the extension relies on: closed shadow roots are recorded so the
    // real toolbar buttons can be clicked, and the local capture APIs are stubbed.
    await page.addInitScript(() => {
      const roots = (window.__shadowRoots = []);
      const attach = Element.prototype.attachShadow;
      Element.prototype.attachShadow = function (options) { const shadow = attach.call(this, options); roots.push(shadow); return shadow; };
      const store = {};
      window.__clipboard = null;
      window.chrome = {
        i18n: { getMessage: () => '' },
        runtime: {
          id: 'embedded-frames-test',
          sendMessage: async message => ({ success: true, value: message?.cmd === 'H2D_CAPTURE_VISIBLE_TAB' ? '' : [] }),
          onMessage: { addListener() {}, removeListener() {} }
        },
        storage: { local: {
          get: async keys => (typeof keys === 'string' ? (keys in store ? { [keys]: store[keys] } : {}) : { ...store }),
          set: async values => { Object.assign(store, values); },
          remove: async keys => { for (const key of [].concat(keys)) delete store[key]; }
        } }
      };
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
        write: async items => {
          for (const item of items) if (item.types.includes('text/html')) window.__clipboard = await (await item.getType('text/html')).text();
        },
        read: async () => []
      } });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'load' });
    for (const file of FILES) await page.addScriptTag({ path: path.join(root, file) });

    const clickCapture = () => page.evaluate(() => {
      const host = document.getElementById('__figma_h2d_chrome_extension_toolbar__');
      const shadow = window.__shadowRoots.find(candidate => candidate.host === host);
      const button = [...shadow.querySelectorAll('button')].find(node => /Capture design/i.test(node.textContent || ''));
      button.click();
      return !!button;
    });
    const readDocuments = async () => {
      const until = Date.now() + 30000;
      while (Date.now() < until) {
        const html = await page.evaluate(() => window.__clipboard);
        const match = html && html.match(/\(figh2d\)([A-Za-z0-9+/=]+)\(\/figh2d\)/);
        if (match) return JSON.parse(Buffer.from(match[1], 'base64').toString('utf8'));
        await new Promise(resolve => setTimeout(resolve, 60));
      }
      throw new Error('The rich clipboard payload was never written');
    };

    assert.ok(await clickCapture(), 'Capture design button exists');
    const [doc] = await readDocuments();
    clips++;

    const frames = walk(doc.root).filter(node => String(node.tag).toUpperCase() === 'IFRAME');
    assert.equal(frames.length, 3, 'all three frames are in the model');
    const [srcdoc, sameOrigin, crossOrigin] = frames;
    assert.ok(srcdoc.rect.width === 390 && Math.abs(srcdoc.rect.height - 300) < 1, 'the first frame keeps its box');
    passed('The captured model still contains the page and all three frame elements at their real sizes');

    assert.equal(srcdoc.childNodes.length, 1, 'the srcdoc frame has captured content');
    assert.match(textOf(doc), /Inner card A/);
    assert.match(textOf(doc), /Srcdoc frame content/);
    passed('A same-origin srcdoc frame is rebuilt: its heading and paragraph are real editable text, not an empty box');

    assert.equal(sameOrigin.childNodes.length, 1, 'the served frame has captured content');
    assert.match(textOf(doc), /Inner card B/);
    assert.match(textOf(doc), /Served same-origin frame content/);
    const nested = walk(sameOrigin).find(node => node.tag === 'H2');
    assert.ok(nested && nested.rect.x >= sameOrigin.rect.x && nested.rect.y >= sameOrigin.rect.y, 'nested nodes land inside the frame');
    assert.ok(nested.rect.x <= sameOrigin.rect.x + sameOrigin.rect.width, 'nested nodes stay inside the frame width');
    assert.ok(parseFloat(nested.styles.fontSize) > 15, 'nested nodes keep their own computed styles');
    passed('A served same-origin frame is rebuilt at the frame origin with its own styles, so inner text sits inside the frame box');

    assert.equal(crossOrigin.childNodes.length, 0, 'a frame this page cannot read stays empty');
    assert.match(textOf(doc), /Embedded frames fixture/, 'the outer page is untouched');
    assert.ok(!/Cross origin frame/.test(textOf(doc)), 'unreadable frames are never guessed at');
    passed('A cross-origin frame the page cannot read is left exactly as the engine produced it, without failing the copy');

    assert.deepEqual(errors, []);
    passed('The capture and its frame rebuild run without uncaught page errors');
    console.log(`\n${checks} embedded-frame Chromium checks passed (${clips} clipboard write)`);
  } finally {
    await browser.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
