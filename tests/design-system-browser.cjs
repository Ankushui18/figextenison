'use strict';
// Real Chromium extension checks. Run like tests/browser-smoke.cjs.
// Closed-root recording is test-only, in the extension's isolated world.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { randomUUID } = require('node:crypto');
const root = path.resolve(process.env.EXTENSION_ROOT || path.join(__dirname, '..'));
const artifacts = path.resolve(process.env.ARTIFACT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'page-capture-generator-artifacts-')));
fs.mkdirSync(artifacts, { recursive: true });
const fixtureHtml = fs.readFileSync(path.join(__dirname, 'fixtures/design-system.html'), 'utf8');

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'page-capture-generator-'));
  const server = http.createServer((request, response) => { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end(fixtureHtml); });
  await new Promise(resolve => server.listen(0, '0.0.0.0', resolve));
  const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, acceptDownloads: true, viewport: { width: 1280, height: 900 }, args: ['--no-sandbox', `--disable-extensions-except=${root}`, `--load-extension=${root}`] });
  const requests = [], remote = [], errors = [];
  context.on('request', request => {
    const url = new URL(request.url());
    if (['http:', 'https:'].includes(url.protocol)) { requests.push(request.url()); if (url.hostname !== '127.0.0.1') remote.push(request.url()); }
  });
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
    await worker.evaluate(async tabId => {
      await chrome.scripting.executeScript({ target: { tabId }, func: () => {
        globalThis.__designTestRoots = [];
        const original = Element.prototype.attachShadow;
        Element.prototype.attachShadow = function(options) { const root = original.call(this, options); globalThis.__designTestRoots.push({ host: this, root }); return root; };
      } });
    }, tabId);
    const requestId = randomUUID();
    await worker.evaluate(async ({ tabId, requestId }) => chrome.storage.session.set({ [`figma_h2d_toolbar_request_${requestId}`]: { tabId, source: 'action_button' } }), { tabId, requestId });
    const resume = await context.newPage();
    const resumeClosed = resume.waitForEvent('close', { timeout: 15000 });
    await resume.goto(`chrome-extension://${extensionId}/options.html?reason=needs_permissions&request_id=${requestId}`).catch(() => {});
    await resumeClosed;
    await fixture.locator('#__figma_h2d_chrome_extension_toolbar__').waitFor({ state: 'attached' });
    const isolated = (operation, args = {}) => worker.evaluate(async ({ tabId, operation, args }) => {
      const [result] = await chrome.scripting.executeScript({ target: { tabId }, args: [operation, args], func: (operation, args) => {
        const entry = globalThis.__designTestRoots?.find(entry => entry.host.id === (args.toolbar ? '__figma_h2d_chrome_extension_toolbar__' : '__page_capture_design_system__') && entry.host.isConnected);
        const root = entry?.root;
        if (operation === 'point') {
          const node = args.selector ? root?.querySelector(args.selector) : [...(root?.querySelectorAll('button') || [])].find(node => node.getAttribute('aria-label') === args.label || node.textContent.trim() === args.label);
          if (!node || node.disabled) return null;
          node.scrollIntoView({ block: 'nearest', inline: 'nearest' });
          const rect = node.getBoundingClientRect();
          return rect.width && rect.height ? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } : null;
        }
        if (operation === 'state') {
          const dialog = root?.querySelector('dialog');
          const rect = dialog?.getBoundingClientRect(), menuRect = root?.querySelector('[role="menu"]')?.getBoundingClientRect();
          const pane = root?.querySelector('[data-review-panel]'), ratio = root?.querySelector('[data-contrast-ratio]');
          const extras = {
            reviewMode: pane?.dataset.reviewPanel || '', reviewText: pane?.textContent || '',
            reviewPairs: [...(root?.querySelectorAll('[data-review-pair]') || [])].map(node => node.dataset.reviewPair.split(' ')),
            contrastRatio: ratio ? Number(ratio.dataset.contrastRatio) : null,
            contrastForeground: root?.querySelector('[aria-label="Text token"]')?.value,
            contrastBackground: root?.querySelector('[aria-label="Background token"]')?.value,
            backgroundOptions: [...(root?.querySelector('[aria-label="Background token"]')?.options || [])].map(option => option.value),
            swapDisabled: root?.querySelector('[aria-label="Swap contrast colors"]')?.disabled,
            previewFont: root?.querySelector('.inspector-type') ? getComputedStyle(root.querySelector('.inspector-type')).fontFamily : '',
            previewSize: root?.querySelector('.inspector-type')?.style.fontSize,
            largeChecker: !!root?.querySelector('.review-pane .preview.large.checker .color-fill'),
            activeFocusKey: root?.activeElement?.dataset.focusKey, listTop: root?.querySelector('.list')?.scrollTop,
            canonicalOptions: [...(root?.querySelector('[aria-label="Canonical token to keep"]')?.options || [])].map(option => option.value),
            horizontalOverflow: root?.querySelector('.workspace') ? root.querySelector('.workspace').scrollWidth > root.querySelector('.workspace').clientWidth + 1 : false
          };
          return { ...extras, exists: !!entry, open: !!dialog?.open, menu: !!root?.querySelector('[role="menu"]'), menuTop: menuRect?.top, menuBottom: menuRect?.bottom, ready: !!root?.querySelector('[data-export-kind]'), rows: [...(root?.querySelectorAll('.row') || [])].map(row => ({ id: row.dataset.tokenId, name: row.querySelector('[data-token-name]').value, value: row.querySelector('.value').textContent, included: !row.classList.contains('excluded'), uses: parseInt(row.querySelector('.evidence span').textContent, 10) })), exportsDisabled: !!root?.querySelector('[data-export-kind="json"]')?.disabled, status: root?.querySelector('[data-generator-status]')?.textContent, width: rect?.width, right: rect?.right, bottom: rect?.bottom, height: rect?.height, listHeight: root?.querySelector('[data-token-list]')?.getBoundingClientRect().height, scope: root?.querySelector('[aria-label="Analysis scope"]')?.value, pageWidth: innerWidth, pageHeight: innerHeight, background: dialog ? getComputedStyle(dialog).backgroundColor : null, fontSize: dialog ? getComputedStyle(dialog).fontSize : null };
        }
        if (operation === 'select') { const select = root.querySelector(args.selector); if (args.focus) select.focus({ preventScroll: true }); select.value = args.value; select.dispatchEvent(new Event('change', { bubbles: true })); return true; }
        if (operation === 'toolbar-styles') return [...root.querySelectorAll('button')].filter(node => ['Capture code', 'Capture design', 'Select element'].includes(node.getAttribute('aria-label') || node.textContent.trim())).map(node => { const css = getComputedStyle(node); return { label: node.getAttribute('aria-label') || node.textContent.trim(), height: css.height, font: css.font, color: css.color, background: css.backgroundColor, radius: css.borderRadius }; });
        if (operation === 'more-count') return root?.querySelectorAll('[data-design-system-more]').length || 0;
        if (operation === 'scan') return globalThis.PageCaptureDesignSystem.scanPage(document, { scope: args.scope || 'rendered' });
        if (operation === 'cancel-scan') { const abort = new AbortController(); abort.abort(); return globalThis.PageCaptureDesignSystem.scanPage(document, { signal: abort.signal }).then(() => 'not-cancelled', error => error.name); }
        return null;
      } });
      return result.result;
    }, { tabId, operation, args });
    const waitFor = async (predicate, message) => {
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) { const state = await isolated('state'); if (predicate(state)) return state; await new Promise(resolve => setTimeout(resolve, 30)); }
      throw new Error(`Timed out: ${message}`);
    };
    const click = async (label, options = {}) => {
      const deadline = Date.now() + 10000; let point;
      while (Date.now() < deadline) { point = await isolated('point', { label, ...options }); if (point) break; await new Promise(resolve => setTimeout(resolve, 30)); }
      assert.ok(point, `Clickable control: ${label || options.selector}`);
      await fixture.bringToFront(); await fixture.mouse.click(point.x, point.y);
    };
    const type = async (selector, value) => { await click('', { selector }); await fixture.keyboard.press('Control+A'); await fixture.keyboard.insertText(value); };
    const open = async () => { await click('More tools', { toolbar: true }); await click('', { selector: '[role="menuitem"]' }); return waitFor(state => state.ready, 'token analysis'); };
    const download = async kind => {
      const pending = fixture.waitForEvent('download', { timeout: 10000 });
      await click('', { selector: `[data-export-kind="${kind}"]` });
      const file = await pending; const saved = path.join(artifacts, file.suggestedFilename()); await file.saveAs(saved);
      return { text: fs.readFileSync(saved, 'utf8'), path: saved, name: file.suggestedFilename() };
    };
    const pageSnapshot = () => fixture.evaluate(() => {
      const clone = document.documentElement.cloneNode(true); clone.querySelectorAll('[data-h2d-ignore="true"]').forEach(node => node.remove());
      return { html: clone.outerHTML, width: innerWidth, height: innerHeight, scrollX, scrollY, value: document.querySelector('input').value, cardWidth: document.querySelector('.card').getBoundingClientRect().width };
    });
    const before = await pageSnapshot();
    const primaryStyles = await isolated('toolbar-styles', { toolbar: true });
    assert.equal(primaryStyles.length, 3);
    const baselineRequests = requests.length;
    await fixture.screenshot({ caret: 'initial', path: path.join(artifacts, 'toolbar-desktop.png') });
    passed('Optional More control retains all three established capture actions');

    await click('More tools', { toolbar: true });
    let state = await waitFor(state => state.menu, 'More menu');
    await fixture.screenshot({ caret: 'initial', path: path.join(artifacts, 'more-desktop.png') });
    await fixture.keyboard.press('Escape');
    await waitFor(state => !state.exists, 'menu cleanup');
    passed('More menu opens and Escape removes its host cleanly');

    state = await open();
    assert.equal(state.background, 'rgb(44, 44, 44)'); assert.equal(state.fontSize, '12px');
    assert.equal(state.pageWidth, before.width); assert.equal(state.pageHeight, before.height);
    assert.ok(state.rows.some(row => row.name === 'brand-primary' && row.value === '#7c3aed'));
    assert.ok(state.rows.some(row => row.value === '#ca8a04'), 'Visible descendant of visibility:hidden parent is scanned');
    assert.ok(!state.rows.some(row => row.value === '#ff12ab'), 'Hidden content is not scanned');
    assert.ok(!state.rows.some(row => row.value === '#0d99ff'), 'Extension blue is not scanned');
    assert.ok(state.rows.find(row => row.value === '#000000')?.uses <= 2, 'HTML default SVG fill does not inflate the real ink color');
    assert.ok(state.rows.some(row => row.value === '#1e40af'), 'Actual SVG shape fill is still observed');
    await fixture.screenshot({ caret: 'initial', path: path.join(artifacts, 'generator-desktop.png') });
    passed('Local scanner excludes its own UI/hidden content and uses the existing dark design');

    const initial = JSON.parse((await download('json')).text);
    assert.equal(Object.keys(initial.tokens).length, 6);
    assert.equal(initial.source.url, fixtureUrl.split('?')[0]);
    const privateStrings = ['do-not-export-this-secret', 'private-api-key', 'Never export this private page sentence', 'private-input-should-not-export', '?secret=', '#private'];
    for (const value of privateStrings) assert.ok(!JSON.stringify(initial).includes(value), `No private payload: ${value}`);
    passed('Real JSON download contains six token categories but no raw text, input values or unrelated variables');

    const originalBrand = state.rows.find(row => row.name === 'brand-primary');
    const alternateBrand = state.rows.find(row => row.name === 'brand-secondary');
    const black = state.rows.find(row => row.value === '#000000');
    const white = state.rows.find(row => row.value === '#ffffff');
    const alpha = state.rows.find(row => row.value === '#00000080');
    const modern = state.rows.find(row => row.value.startsWith('oklch('));
    assert.ok(originalBrand && alternateBrand && black && white && alpha && modern);
    await click(`Preview ${alpha.id}`);
    state = await isolated('state');
    assert.equal(state.reviewMode, 'preview'); assert.equal(state.largeChecker, true);
    assert.match(state.reviewText, /50\.2% opacity/);
    await fixture.screenshot({ caret: 'initial', path: path.join(artifacts, 'preview-color.png') });
    await click('Close token preview');
    passed('Larger color preview reveals alpha over a checkerboard without changing the token');

    for (const label of ['Typography', 'Spacing', 'Radii', 'Shadows', 'Borders']) {
      await click('', { selector: `.nav button[aria-label^="${label},"]` });
      const row = (await isolated('state')).rows[0]; assert.ok(row);
      await click(`Preview ${row.id}`); state = await isolated('state');
      assert.equal(state.reviewMode, 'preview'); assert.ok(state.reviewText.includes(row.name));
      if (label === 'Typography') {
        assert.match(state.previewFont, /system-ui/); assert.ok(parseFloat(state.previewSize) <= 48);
        assert.match(state.reviewText, /font files are not loaded/);
        await fixture.screenshot({ caret: 'initial', path: path.join(artifacts, 'preview-type.png') });
      }
      await click('Close token preview');
    }
    await click('', { selector: '.nav button[aria-label^="Colors,"]' });
    passed('All six categories have inspectable previews; typography stays scaled and system-font only');

    await click('Check color contrast');
    await isolated('select', { selector: '[aria-label="Text token"]', value: black.id, focus: true });
    await isolated('select', { selector: '[aria-label="Background token"]', value: white.id, focus: true });
    state = await isolated('state');
    assert.equal(state.contrastRatio, 21); assert.match(state.reviewText, /AA normal · 4\.5:1 · Meets/);
    assert.equal(state.activeFocusKey, 'contrast-background');
    await fixture.screenshot({ caret: 'initial', path: path.join(artifacts, 'contrast-desktop.png') });
    await click('Swap contrast colors'); state = await isolated('state');
    assert.equal(state.contrastRatio, 21); assert.equal(state.contrastForeground, white.id); assert.equal(state.contrastBackground, black.id);
    passed('Contrast checker calculates 21:1, reports text thresholds, swaps colors and restores selector focus');

    await isolated('select', { selector: '[aria-label="Text token"]', value: alpha.id, focus: true });
    await isolated('select', { selector: '[aria-label="Background token"]', value: white.id, focus: true });
    state = await isolated('state');
    assert.ok(state.contrastRatio > 3 && state.contrastRatio < 4.5); assert.equal(state.swapDisabled, true);
    assert.match(state.reviewText, /Text opacity is composited/);
    assert.ok(!state.backgroundOptions.includes(alpha.id) && !state.backgroundOptions.includes(modern.id));
    await isolated('select', { selector: '[aria-label="Text token"]', value: modern.id, focus: true });
    state = await isolated('state'); assert.equal(state.contrastRatio, null); assert.match(state.reviewText, /Other color spaces are preserved/);
    await click('Close color contrast');
    assert.deepEqual(JSON.parse((await download('json')).text), initial);
    passed('Alpha foregrounds composite correctly; translucent backgrounds and unsupported color spaces are never guessed');

    const point = await isolated('point', { selector: `.row[data-token-id="${originalBrand.id}"] input[type="checkbox"]` });
    const scrollBefore = (await isolated('state')).listTop;
    await fixture.mouse.click(point.x, point.y); state = await isolated('state');
    assert.ok(Math.abs(state.listTop - scrollBefore) < 1); assert.equal(state.activeFocusKey, `select-${originalBrand.id}`);
    await click('', { selector: `.row[data-token-id="${originalBrand.id}"] input[type="checkbox"]` });
    passed('Review rerenders preserve list scrolling and keyboard focus instead of jumping to the top');

    await click('Review similar values'); state = await isolated('state');
    const suggestion = state.reviewPairs.find(ids => ids.includes(originalBrand.id) && ids.includes(alternateBrand.id));
    assert.ok(suggestion); assert.match(state.reviewText, /Nothing changes until you confirm/);
    await fixture.screenshot({ caret: 'initial', path: path.join(artifacts, 'similar-desktop.png') });
    assert.deepEqual(JSON.parse((await download('json')).text), initial);
    await click('', { selector: `[data-review-pair="${suggestion.join(' ')}"]` });
    state = await isolated('state'); assert.equal(state.canonicalOptions.length, 2); assert.equal(state.activeFocusKey, 'canonical-token');
    assert.deepEqual(JSON.parse((await download('json')).text), initial);
    await click('Cancel');
    assert.deepEqual(JSON.parse((await download('json')).text), initial);
    passed('Similar suggestions only select a review pair; opening or cancelling never auto-merges or changes exports');

    await click('Review similar values');
    await click('', { selector: `[data-review-pair="${suggestion.join(' ')}"]` });
    await isolated('select', { selector: '[aria-label="Canonical token to keep"]', value: originalBrand.id });
    await click('Merge tokens');
    const suggestedMerge = JSON.parse((await download('json')).text);
    assert.equal(suggestedMerge.tokens.colors['brand-primary'].$value, '#7c3aed');
    assert.equal(suggestedMerge.tokens.colors['brand-primary'].$extensions.pageCapture.observations.length, 2);
    assert.ok(!Object.hasOwn(suggestedMerge.tokens.colors, 'brand-secondary'));
    await click(`Exclude ${white.id}`); await click('Check color contrast'); state = await isolated('state');
    assert.ok(!state.backgroundOptions.includes(white.id)); assert.notEqual(state.contrastBackground, white.id);
    passed('Only an explicit canonical merge changes values; excluded colors disappear from contrast choices');

    await isolated('select', { selector: '[aria-label="Text token"]', value: black.id, focus: true });
    await fixture.setViewportSize({ width: 390, height: 844 }); state = await isolated('state');
    assert.ok(state.width <= 366 && state.bottom <= 844 && state.listHeight >= 132 && !state.horizontalOverflow);
    await fixture.screenshot({ caret: 'initial', path: path.join(artifacts, 'contrast-mobile.png') });
    await fixture.setViewportSize({ width: 390, height: 480 });
    await download('css'); state = await isolated('state');
    assert.ok(state.bottom <= 480 && state.listHeight >= 132 && !state.horizontalOverflow);
    await fixture.setViewportSize({ width: 1280, height: 900 });
    await click('Close color contrast');
    await click('Reanalyze page'); await click('Reanalyze');
    state = await waitFor(state => state.ready && state.rows.some(row => row.name === 'brand-secondary'), 'clean analysis after polish checks');
    passed('New review panes stay usable on narrow/short screens and reanalysis resets only on confirmation');

    const brand = state.rows.find(row => row.name === 'brand-primary');
    await type(`[data-token-name="${brand.id}"]`, 'Invalid name!');
    state = await isolated('state'); assert.equal(state.exportsDisabled, true);
    await type(`[data-token-name="${brand.id}"]`, 'brand-custom');
    state = await isolated('state'); assert.equal(state.exportsDisabled, false);
    await click(`Preview ${brand.id}`); await type(`[data-token-name="${brand.id}"]`, 'brand-live-preview');
    assert.match((await isolated('state')).reviewText, /brand-live-preview/);
    await type(`[data-token-name="${brand.id}"]`, 'brand-custom'); await click('Close token preview');
    await click('Check color contrast'); await type(`[data-token-name="${brand.id}"]`, 'brand-live-contrast');
    assert.match((await isolated('state')).reviewText, /brand-live-contrast/);
    await type(`[data-token-name="${brand.id}"]`, 'brand-custom'); await click('Close color contrast');
    await type('[aria-label="Search tokens"]', 'brand-custom');
    state = await isolated('state'); assert.equal(state.rows.length, 1);
    await type('[aria-label="Search tokens"]', '');
    state = await isolated('state');
    passed('Native name editing validates exports, and searching filters only the review list');

    const excluded = state.rows.find(row => row.id !== brand.id && row.value !== '#12b886');
    await click(`Exclude ${excluded.id}`);
    const excludedJson = JSON.parse((await download('json')).text);
    assert.ok(!Object.hasOwn(excludedJson.tokens.colors, excluded.name));
    passed('Excluding a token removes it from actual exports');

    const other = (await isolated('state')).rows.find(row => row.id !== brand.id && row.included);
    await click('', { selector: `.row[data-token-id="${brand.id}"] input[type="checkbox"]` });
    await click('', { selector: `.row[data-token-id="${other.id}"] input[type="checkbox"]` });
    await click('Merge (2)');
    await isolated('select', { selector: '[aria-label="Canonical token to keep"]', value: brand.id });
    await click('Merge tokens');
    const merged = JSON.parse((await download('json')).text);
    assert.ok(merged.tokens.colors['brand-custom']);
    assert.equal(merged.tokens.colors['brand-custom'].$value, '#7c3aed');
    assert.equal(merged.tokens.colors['brand-custom'].$extensions.pageCapture.observations.length, 2);
    assert.equal(merged.tokens.colors['brand-custom'].$extensions.pageCapture.merged, true);
    assert.equal(merged.tokens.colors['brand-custom'].$extensions.pageCapture.nameOrigin, 'user');
    passed('Explicit merge keeps the selected name/value and original evidence in downloaded JSON');

    const css = await download('css'), html = await download('html');
    assert.match(css.text, /--brand-custom: #7c3aed/);
    assert.match(html.text, /<h3>brand-custom<\/h3>/);
    for (const value of privateStrings) assert.ok(!css.text.includes(value) && !html.text.includes(value));
    assert.doesNotMatch(html.text, /<script|<link|<img|@import|@font-face/i);
    passed('CSS and standalone style-guide downloads preserve edits without remote dependencies');

    const capturesKey = `figma_h2d_toolbar_captures_${tabId}`;
    await fixture.keyboard.press('Control+Enter');
    assert.equal(await worker.evaluate(async key => ((await chrome.storage.local.get(key))[key] || []).length, capturesKey), 0);
    assert.equal((await isolated('state')).open, true);
    passed('Capture hotkey cannot run while the modal is open');

    await click('Reanalyze page');
    await click('Cancel');
    assert.ok((await isolated('state')).rows.some(row => row.name === 'brand-custom'));
    await isolated('select', { selector: '[aria-label="Analysis scope"]', value: 'viewport' });
    await click('Reanalyze');
    await waitFor(state => state.ready && state.rows.some(row => row.name === 'brand-primary'), 'viewport reanalysis');
    const scoped = JSON.parse((await download('json')).text);
    assert.equal(scoped.source.scope, 'viewport');
    assert.ok(scoped.source.elements < initial.source.elements);
    assert.ok(!Object.values(scoped.tokens.colors).some(token => token.$value === '#b91c1c'));
    passed('Reanalysis needs confirmation; viewport scope omits below-screen styles and replaces edits');

    await fixture.setViewportSize({ width: 390, height: 844 });
    state = await isolated('state');
    assert.ok(state.width <= 366 && state.right <= 390 && state.bottom <= 844, JSON.stringify(state));
    await fixture.screenshot({ caret: 'initial', path: path.join(artifacts, 'generator-mobile.png') });
    await fixture.setViewportSize({ width: 390, height: 480 });
    state = await isolated('state'); assert.ok(state.listHeight >= 100 && state.bottom <= 480, 'Short narrow windows retain a usable review list');
    await download('css');
    await fixture.setViewportSize({ width: 1280, height: 400 });
    state = await isolated('state'); assert.ok(state.listHeight >= 180 && state.bottom <= 400, 'Short desktop windows retain a usable review list');
    await click('Close design system');
    await waitFor(state => !state.exists, 'dialog cleanup');
    await fixture.setViewportSize({ width: 1280, height: 900 });
    assert.deepEqual(await pageSnapshot(), before);
    assert.deepEqual(await isolated('toolbar-styles', { toolbar: true }), primaryStyles);
    passed('Narrow layout stays in bounds; closing restores focus without altering website DOM/layout');

    // Inspect cancellation directly and exercise cancel during a larger interactive rescan.
    assert.equal(await isolated('cancel-scan'), 'AbortError');
    await fixture.evaluate(() => { const group = document.createElement('div'); group.id = 'large-fixture'; for (let index = 0; index < 4200; index++) { const child = document.createElement('div'); child.textContent = 'Fixture'; child.style.padding = '2px'; group.append(child); } document.body.append(group); });
    await open(); await isolated('select', { selector: '[aria-label="Analysis scope"]', value: 'rendered' }); await click('Reanalyze');
    assert.equal((await isolated('state')).ready, false, 'Analysis is still running when cancelled');
    await click('Close design system');
    await waitFor(state => !state.exists, 'cancel running analysis');
    const limited = await isolated('scan');
    assert.equal(limited.source.truncated, true); assert.ok(limited.source.elements <= 4000);
    assert.ok(limited.warnings.some(warning => warning.includes('4,000')));
    await fixture.evaluate(() => document.getElementById('large-fixture').remove());
    await open();
    assert.equal((await isolated('state')).open, true);
    assert.equal((await isolated('state')).scope, 'viewport', 'Cancelled scope changes revert to the last analyzed scope');
    await fixture.keyboard.press('Escape'); await waitFor(state => !state.exists, 'Escape after cancellation');
    passed('Aborted scans reject cleanly, 4,000-element bounds report truncation, and the modal reopens safely');

    const drag = await isolated('point', { toolbar: true, selector: '[role="toolbar"] > [data-toolbar-role="message"] > [data-toolbar-role="message"] > div:first-child' });
    assert.ok(drag, 'Existing brand segment is draggable');
    await fixture.mouse.move(drag.x, drag.y); await fixture.mouse.down();
    await fixture.mouse.move(drag.x, 855, { steps: 12 }); await fixture.mouse.up();
    let bottomPoint, previousDockPoint, stableDock = 0; const dockDeadline = Date.now() + 4000, dockHeight = await fixture.evaluate(() => innerHeight);
    while (Date.now() < dockDeadline) { bottomPoint = await isolated('point', { toolbar: true, label: 'More tools' }); stableDock = bottomPoint && bottomPoint.y > dockHeight - 70 && bottomPoint.y < dockHeight - 8 && previousDockPoint && Math.abs(bottomPoint.y - previousDockPoint.y) < .25 ? stableDock + 1 : 0; if (stableDock >= 3) break; previousDockPoint = bottomPoint; await new Promise(resolve => setTimeout(resolve, 30)); }
    assert.ok(stableDock >= 3, `Existing toolbar settles at the bottom: ${JSON.stringify(bottomPoint)}`);
    await click('More tools', { toolbar: true });
    state = await waitFor(state => state.menu, 'bottom-docked menu');
    assert.ok(state.menuTop >= 8 && state.menuBottom < bottomPoint.y - 12, JSON.stringify(state));
    await fixture.screenshot({ caret: 'initial', path: path.join(artifacts, 'more-bottom.png') });
    await click('', { selector: '[role="menuitem"]' }); await waitFor(state => state.ready, 'bottom-docked generator');
    await click('Close design system'); await waitFor(state => !state.exists, 'bottom-docked cleanup');
    passed('Bottom-docked toolbar opens More above itself and retains generator access');

    await click('Capture code', { toolbar: true });
    await fixture.waitForFunction(async () => { try { const value = await navigator.clipboard.readText(); return value.includes('<title>Workspace UI</title>') && !value.includes('__page_capture_design_system__'); } catch { return false; } }, undefined, { timeout: 6000 });
    passed('Existing raw-HTML clipboard action still works after generator use and excludes its removed UI');

    await click('Close', { toolbar: true });
    await fixture.locator('#__figma_h2d_chrome_extension_toolbar__').waitFor({ state: 'detached' });
    assert.equal((await isolated('state')).exists, false);
    const nextId = randomUUID();
    await worker.evaluate(async ({ tabId, requestId }) => chrome.storage.session.set({ [`figma_h2d_toolbar_request_${requestId}`]: { tabId, source: 'action_button' } }), { tabId, requestId: nextId });
    const reopen = await context.newPage(); const reopenedClosed = reopen.waitForEvent('close', { timeout: 15000 });
    await reopen.goto(`chrome-extension://${extensionId}/options.html?reason=needs_permissions&request_id=${nextId}`).catch(() => {}); await reopenedClosed;
    await fixture.locator('#__figma_h2d_chrome_extension_toolbar__').waitFor({ state: 'attached' });
    assert.equal(await isolated('more-count', { toolbar: true }), 1);
    await open();
    await worker.evaluate(async tabId => chrome.tabs.sendMessage(tabId, { type: 'FIGMA_H2D_TOOLBAR_COMMAND', command: 'capture_code' }, { frameId: 0 }), tabId);
    await waitFor(state => !state.exists, 'background-command cleanup');
    await fixture.waitForFunction(async () => { const value = await navigator.clipboard.readText(); return value.includes('<title>Workspace UI</title>') && !value.includes('__page_capture_design_system__'); }, undefined, { timeout: 6000 });
    passed('A capture command closes the generator synchronously before reading raw HTML');
    await click('Close', { toolbar: true });
    await fixture.locator('#__figma_h2d_chrome_extension_toolbar__').waitFor({ state: 'detached' });
    passed('Toolbar disposal/reinjection leaves no generator host or duplicate More control');

    // Open exported guide in a real page: restrictive CSP and no external subresources.
    const guide = await context.newPage(); await guide.goto(`file://${html.path}`);
    await guide.getByRole('heading', { name: 'Workspace UI', exact: true }).waitFor();
    assert.equal(await guide.locator('script,link,img,iframe').count(), 0);
    await guide.close();
    assert.equal(requests.length, baselineRequests);
    assert.deepEqual(remote, []); assert.deepEqual(errors, []);
    passed('Generator/exports make zero HTTP requests or uncaught page errors in tested flows');

    console.log(`\n${checks} generator browser checks passed. Artifacts: ${artifacts}`);
  } finally {
    await context.close(); await new Promise(resolve => server.close(resolve)); fs.rmSync(profile, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
