'use strict';

// Optional browser checks:
//   npm install --no-save playwright
//   npx playwright install chromium
//   node tests/browser-smoke.cjs
// Permission-denial cases mock only the relevant Chrome APIs in the options page.
// Direct capture/resume checks use the real unpacked extension and Chrome APIs.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { randomUUID } = require('node:crypto');

const root = path.resolve(process.env.EXTENSION_ROOT || path.join(__dirname, '..', 'extension'));
const tutorialText = /Pin the extension|Using the extension|Capture code or design|Ready to get started|Get started/i;

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'page-capture-smoke-'));
  const server = http.createServer((request, response) => {
    if (request.url === '/asset.svg') {
      response.writeHead(200, { 'Content-Type': 'image/svg+xml' });
      response.end('<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="#246bfe"/></svg>');
      return;
    }
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end('<!doctype html><html><head><title>Capture fixture</title></head><body style="font-family:Arial;padding:40px"><h1>Capture fixture</h1><p>Editable webpage content.</p><img src="/asset.svg" width="48" height="48" alt="Local image"><button>Example button</button></body></html>');
  });
  await new Promise(resolve => server.listen(0, '0.0.0.0', resolve));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    args: [
      '--no-sandbox',
      `--disable-extensions-except=${root}`,
      `--load-extension=${root}`
    ]
  });
  const requests = [];
  const externalAttempts = [];
  context.on('request', request => {
    const url = new URL(request.url());
    if (['http:', 'https:'].includes(url.protocol)) {
      requests.push({ url: request.url(), method: request.method(), body: request.postData() });
      if (url.hostname !== '127.0.0.1') externalAttempts.push(request.url());
    }
  });
  // Do not let test traffic reach any remote destination, even on regression.
  await context.route(/^https?:/, route => {
    if (new URL(route.request().url()).hostname !== '127.0.0.1') return route.abort('blockedbyclient');
    return route.continue();
  });
  const errors = [];
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  let checks = 0;
  const passed = name => { checks++; console.log(`PASS ${name}`); };

  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 15000 });
    const extensionId = new URL(worker.url()).host;
    const base = `chrome-extension://${extensionId}/options.html`;
    assert.ok(context.pages().every(page => !page.url().startsWith(base)));
    passed('A fresh install does not open an onboarding/options tab');

    for (const query of ['', '?reason=onboarding', '?reason=needs_permissions']) {
      const page = await context.newPage();
      await page.goto(base + query);
      await page.getByText('Capture permissions enabled', { exact: true }).waitFor();
      assert.doesNotMatch(await page.locator('body').innerText(), tutorialText);
      const closed = page.waitForEvent('close');
      await page.getByRole('button', { name: 'Close', exact: true }).click();
      await closed;
    }
    passed('Default, retired-tour and completed-permission URLs show status only');

    const permissions = await context.newPage();
    await permissions.addInitScript(() => {
      window.__capturePermissions = false;
      window.__grantCapturePermissions = false;
      chrome.permissions.contains = async () => window.__capturePermissions;
      chrome.permissions.request = async () => {
        if (window.__grantCapturePermissions) window.__capturePermissions = true;
        return window.__grantCapturePermissions;
      };
    });
    await permissions.goto(base + '?reason=needs_permissions');
    await permissions.getByText('Allow additional permissions from Chrome', { exact: true }).waitFor();
    assert.doesNotMatch(await permissions.locator('body').innerText(), tutorialText);
    await permissions.getByRole('button', { name: 'Allow permissions', exact: true }).click();
    await permissions.getByText("Access wasn't granted", { exact: true }).waitFor();
    await permissions.evaluate(() => { window.__grantCapturePermissions = true; });
    await permissions.getByRole('button', { name: 'Allow permissions', exact: true }).click();
    await permissions.getByText('Capture permissions enabled', { exact: true }).waitFor();
    await permissions.close();
    passed('Permission denial can be retried; success never enters a tutorial');

    const local = await context.newPage();
    await local.addInitScript(() => {
      chrome.extension.isAllowedFileSchemeAccess = async () => false;
    });
    await local.goto(base + '?reason=needs_file_access');
    await local.getByRole('button', { name: 'Open extension settings', exact: true }).waitFor();
    assert.doesNotMatch(await local.locator('body').innerText(), tutorialText);
    await local.getByRole('button', { name: 'Try again', exact: true }).click();
    await local.getByText("Local file access still isn't enabled", { exact: true }).waitFor();
    await local.evaluate(() => {
      chrome.extension.isAllowedFileSchemeAccess = async () => true;
    });
    const localClosed = local.waitForEvent('close');
    await local.getByRole('button', { name: 'Try again', exact: true }).click();
    await localClosed;
    passed('Local-file access help and retry remain functional');

    const fixtureUrl = `http://127.0.0.1:${server.address().port}/`;
    const fixture = await context.newPage();
    await fixture.goto(fixtureUrl);
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(fixtureUrl).origin });
    // Test-only access to the closed shadow root, without changing its mode.
    // This hook is not part of the shipped extension.
    await worker.evaluate(async tabUrl => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find(tab => tab.url === tabUrl);
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => {
        globalThis.__captureTestRoots = [];
        const original = Element.prototype.attachShadow;
        Element.prototype.attachShadow = function(options) {
          const root = original.call(this, options);
          globalThis.__captureTestRoots.push({ host: this, root });
          return root;
        };
      } });
    }, fixtureUrl);
    const requestId = randomUUID();
    const tabId = await worker.evaluate(async ({ url, requestId }) => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find(tab => tab.url === url);
      if (!tab) throw new Error('Fixture tab not found');
      await chrome.storage.session.set({
        [`figma_h2d_toolbar_request_${requestId}`]: { tabId: tab.id, source: 'action_button' }
      });
      return tab.id;
    }, { url: fixtureUrl, requestId });
    const resume = await context.newPage();
    const resumeClosed = resume.waitForEvent('close', { timeout: 15000 });
    await resume.goto(`${base}?reason=needs_permissions&request_id=${requestId}`).catch(() => {});
    await resumeClosed;
    await fixture.locator('#__figma_h2d_chrome_extension_toolbar__').waitFor({ state: 'attached' });
    assert.equal(await worker.evaluate(async requestId => {
      const key = `figma_h2d_toolbar_request_${requestId}`;
      return (await chrome.storage.session.get(key))[key] !== undefined;
    }, requestId), false);
    passed('Pending capture resumes directly and clears the completed request');

    async function clickToolbar(label) {
      const deadline = Date.now() + 6000;
      let point;
      while (Date.now() < deadline) {
        point = await worker.evaluate(async ({ tabId, label }) => {
          const [result] = await chrome.scripting.executeScript({
            target: { tabId }, args: [label], func: name => {
              const saved = globalThis.__captureTestRoots?.find(entry => entry.host.id === '__figma_h2d_chrome_extension_toolbar__');
              if (!saved || saved.root.querySelector('[data-toolbar-role="transient-message"]')) return null;
              const button = [...saved.root.querySelectorAll('button, [role="button"]')].find(node =>
                node.getAttribute('aria-label') === name || node.textContent.trim() === name);
              if (!button) return null;
              const rect = button.getBoundingClientRect();
              return rect.width && rect.height ? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } : null;
            }
          });
          return result.result;
        }, { tabId, label });
        if (point) break;
        await new Promise(resolve => setTimeout(resolve, 40));
      }
      assert.ok(point, `Toolbar button available: ${label}`);
      await fixture.bringToFront();
      await fixture.mouse.click(point.x, point.y);
    }
    const getCaptures = () => worker.evaluate(async tabId => {
      const key = `figma_h2d_toolbar_captures_${tabId}`;
      return (await chrome.storage.local.get(key))[key] || [];
    }, tabId);
    async function waitForCaptures(count) {
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        const captures = await getCaptures();
        if (captures.length === count) return captures;
        await new Promise(resolve => setTimeout(resolve, 40));
      }
      throw new Error(`Expected ${count} saved captures`);
    }
    async function waitForRichClipboard() {
      await fixture.waitForFunction(async () => {
        try {
          const items = await navigator.clipboard.read();
          const item = items.find(item => item.types.includes('text/html'));
          return !!item && (await (await item.getType('text/html')).text()).includes('figh2d');
        } catch { return false; }
      }, undefined, { timeout: 8000 });
    }

    await clickToolbar('Capture code');
    await fixture.waitForFunction(async () => {
      try { return (await navigator.clipboard.readText()).includes('<title>Capture fixture</title>'); }
      catch { return false; }
    }, undefined, { timeout: 5000 });
    assert.equal((await getCaptures()).length, 0);
    passed('Actual Capture Code click writes raw HTML to the native clipboard locally');

    await clickToolbar('Capture design');
    const captures = await waitForCaptures(1);
    assert.equal(captures[0].type, 'snapshot');
    assert.ok(captures[0].h2dJson.length > 0);
    assert.ok(captures[0].h2dJson.includes('Capture fixture'));
    assert.ok(captures[0].h2dJson.includes('base64Blob'), 'Referenced local image is embedded');
    await waitForRichClipboard();
    passed('Actual design capture saves layers and copies the local rich clipboard format');

    await clickToolbar('Copy all');
    await waitForRichClipboard();
    passed('Copy all preserves the local design clipboard format');

    await clickToolbar('Select element');
    await fixture.getByRole('heading', { name: 'Capture fixture', exact: true }).click();
    const selected = await waitForCaptures(2);
    assert.equal(selected[0].type, 'snapshot');
    assert.ok(selected[0].h2dJson.includes('Capture fixture'));
    await waitForRichClipboard();
    passed('Actual element-selection click still captures editable design data');

    const blocked = await worker.evaluate(async tabId => {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId }, func: () => chrome.runtime.sendMessage({
          cmd: 'H2D_FETCH_ASSETS', payload: { urls: ['https://api.figma.com/privacy-test.png', 'https://o123.ingest.sentry.io/privacy-test.png'] }
        })
      });
      return result.result;
    }, tabId);
    assert.equal(blocked.success, true);
    assert.ok(blocked.value.every(asset => asset.error === 'blocked'));
    passed('Real extension RPC rejects known Figma/Sentry asset destinations before fetch');

    await clickToolbar('Discard all');
    await waitForCaptures(0);
    passed('Discard all still clears captures from local storage');

    await clickToolbar('Close');
    await fixture.locator('#__figma_h2d_chrome_extension_toolbar__').waitFor({ state: 'detached' });
    passed('Close removes the injected capture toolbar');

    assert.deepEqual(externalAttempts, []);
    assert.ok(requests.every(request => request.method === 'GET' && request.body == null));
    passed('Tested capture/copy/selection/discard/close flows make no remote requests or uploads');

    assert.deepEqual(errors, []);
    passed('No uncaught page JavaScript errors');
    console.log(`\n${checks} browser smoke checks passed.`);
  } finally {
    await context.close();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(profile, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
