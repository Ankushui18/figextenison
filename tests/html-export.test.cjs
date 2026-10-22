'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const filename = path.resolve(__dirname, '..', 'extension/js/html-export.js');
const source = fs.readFileSync(filename, 'utf8');

function harness() {
  const context = vm.createContext({ setTimeout, clearTimeout });
  vm.runInContext(source, context);
  return context.PageCaptureHtmlExport;
}
function el(tag, options = {}) {
  return {
    nodeType: 1, tag,
    attributes: options.attrs || {}, styles: options.styles || {},
    rect: options.rect || { x: 0, y: 0, width: 100, height: 20 },
    childNodes: options.children || [],
    ...(options.pseudo ? { pseudoElementNodes: options.pseudo } : {}),
    ...(options.placeholderUrl ? { placeholderUrl: options.placeholderUrl } : {}),
    ...(options.content ? { content: options.content } : {})
  };
}
const text = value => ({ nodeType: 3, text: value });
const model = (root, assets = {}) => ({ version: 2, root, assets, fonts: {} });

test('The explicit wrapper contains sanitized inline HTML and a useful plain-text representation', async () => {
  const { project } = harness();
  const root = el('DIV', {
    attrs: { id: 'card"&<', 'aria-label': 'A "label"', onclick: 'alert(1)', style: 'color:red' },
    styles: { fontFamily: 'Inter, sans-serif', backgroundColor: 'rgb(255, 255, 255)', position: 'absolute' },
    children: [text('<Hello & goodbye>'), el('BR'), el('H1', { children: [text('Title')] })]
  });
  const result = await project(model(root), { wrapper: 'x-paper-html' });
  assert.ok(result.html.startsWith('<x-paper-html><div'));
  assert.ok(result.html.endsWith('</div></x-paper-html>'));
  assert.match(result.html, /id="card&quot;&amp;&lt;"/);
  assert.match(result.html, /aria-label="A &quot;label&quot;"/);
  assert.match(result.html, /font-family:Inter, sans-serif/);
  assert.match(result.html, /&lt;Hello &amp; goodbye&gt;/);
  assert.doesNotMatch(result.html, /onclick=|style="color:red"|figmeta|figh2d/);
  assert.match(result.text, /<Hello & goodbye>/);
  assert.match(result.text, /Title/);
  assert.equal(result.stats.nodes, 5);
});

test('Active content, handlers, dangerous URLs, motion and pre-existing Paper tags are removed', async () => {
  const { project } = harness();
  const root = el('FORM', {
    attrs: { action: 'https://evil.test', onsubmit: 'steal()', srcdoc: '<script>bad</script>' },
    styles: {
      animationName: 'spin', transitionDuration: '2s', content: '"unexpected"',
      backgroundImage: 'url("javascript:alert(1)")', color: 'red'
    },
    children: [
      el('SCRIPT', { children: [text('script-secret')] }),
      el('IFRAME', { children: [text('frame-secret')] }),
      el('x-paper-html', { children: [text('nested-wrapper-secret')] }),
      el('unknown-widget', { children: [text('safe custom text')] }),
      el('A', { attrs: { href: 'javascript:alert(1)', target: '_blank' }, children: [text('bad link')] }),
      el('A', { attrs: { href: 'https://example.test/?a=1&b=2', target: '_blank', rel: 'opener' }, children: [text('safe link')] })
    ]
  });
  const { html, text: plain } = await project(model(root));
  assert.ok(html.startsWith('<div'));
  assert.doesNotMatch(html, /script-secret|frame-secret|nested-wrapper-secret|javascript:|onsubmit|srcdoc|action=/i);
  assert.doesNotMatch(html, /animation-|transition-|content:/i);
  assert.doesNotMatch(html, /unknown-widget|x-paper-html/i);
  assert.match(html, /safe custom text/);
  assert.match(html, /href="https:\/\/example.test\/\?a=1&amp;b=2"/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.doesNotMatch(html, /rel="opener"/);
  assert.match(plain, /safe link/);
});

test('Form projection preserves visible state without exposing passwords, hidden values or control IDs', async () => {
  const { project } = harness();
  const root = el('DIV', { children: [
    el('INPUT', { attrs: { type: 'password', value: 'CURRENT-SECRET', placeholder: 'Password' } }),
    el('INPUT', { attrs: { type: 'hidden', value: 'HIDDEN-SECRET' } }),
    el('INPUT', { attrs: { type: 'image', value: 'PRIVATE-IMAGE-ID' } }),
    el('INPUT', { attrs: { type: 'email', value: 'current@example.com' } }),
    el('TEXTAREA', { attrs: { value: 'Current <notes>' }, children: [text('stale notes')] }),
    el('INPUT', { attrs: { type: 'checkbox', value: 'PRIVATE-CHECK-ID', checked: 'true' } }),
    el('SELECT', { children: [el('OPTION', { attrs: { selected: 'true', label: 'Visible option' }, children: [text('Visible option')] })] })
  ] });
  const { html, text: plain } = await project(model(root));
  assert.doesNotMatch(html, /CURRENT-SECRET|HIDDEN-SECRET|PRIVATE-CHECK-ID|PRIVATE-IMAGE-ID/);
  assert.match(html, /value="current@example.com"/);
  assert.match(html, /<textarea[^>]*>Current &lt;notes&gt;<\/textarea>/);
  assert.doesNotMatch(html, /stale notes/);
  assert.match(html, /checked=""/);
  assert.match(html, /selected=""/);
  assert.match(plain, /Current <notes>/);
});

test('Canvas, video and image assets become embedded raster images with their authoritative MIME', async () => {
  const { project } = harness();
  const assets = {
    'rasterized:1': { blob: { type: 'image/webp', base64Blob: 'data:application/octet-stream;base64,QUJDRA==' } },
    'https://example.test/hero.png': { blob: { type: 'image/png', base64Blob: 'data:image/png;base64,AAAA' } },
    'https://example.test/movie': { blob: { type: 'image/jpeg', base64Blob: 'data:application/octet-stream;base64,RUZH' } }
  };
  const root = el('DIV', {
    styles: { backgroundImage: 'url("https://example.test/hero.png")' },
    children: [
      el('CANVAS', { placeholderUrl: 'rasterized:1', attrs: { id: 'chart' } }),
      el('VIDEO', { placeholderUrl: 'https://example.test/movie', attrs: { currentSrc: 'https://example.test/movie' } }),
      el('IMG', { attrs: { currentSrc: 'https://example.test/hero.png', alt: 'Hero' } }),
      el('IMG', { attrs: { currentSrc: 'javascript:alert(1)', alt: 'Unsafe' } })
    ]
  });
  const { html, stats } = await project(model(root, assets));
  assert.match(html, /data:image\/webp;base64,QUJDRA==/);
  assert.match(html, /data:image\/jpeg;base64,RUZH/);
  assert.match(html, /data:image\/png;base64,AAAA/);
  assert.doesNotMatch(html, /<canvas|<video|javascript:/i);
  assert.match(html, /alt="Hero"/);
  assert.equal(stats.embeddedAssets, 3);
});

test('Materialized pseudo elements retain before/after order without injecting a second CSS content value', async () => {
  const { project } = harness();
  const pseudo = kind => el('SPAN', {
    styles: { content: `"${kind}"`, color: 'blue' }, children: [text(kind)]
  });
  const root = el('SPAN', {
    pseudo: { before: pseudo('Before'), after: pseudo('After') },
    children: [text('Middle')]
  });
  const { html } = await project(model(root));
  assert.ok(html.indexOf('Before') < html.indexOf('Middle'));
  assert.ok(html.indexOf('Middle') < html.indexOf('After'));
  assert.doesNotMatch(html, /content:/i);
});

test('Serialized SVG source strings are not treated as safe HTML', async () => {
  const { project } = harness();
  const root = el('DIV', { children: [el('SVG', {
    content: '<svg onload="alert(1)"><script>svg-secret</script><path d="M0 0"/></svg>'
  })] });
  const { html } = await project(model(root));
  assert.equal(html, '<div></div>');
  assert.doesNotMatch(html, /svg-secret|onload|<script/i);
});

test('The Paper wrapper is a configurable probe option, not a serializer assumption', async () => {
  const { project } = harness();
  const sourceModel = model(el('P', { children: [text('Probe')] }));
  assert.equal((await project(sourceModel)).html, '<p>Probe</p>');
  assert.equal((await project(sourceModel, { wrapper: false })).html, '<p>Probe</p>');
  assert.equal((await project(sourceModel, { wrapper: 'probe-wrapper' })).html, '<probe-wrapper><p>Probe</p></probe-wrapper>');
  await assert.rejects(project(sourceModel, { wrapper: 'script' }), /Invalid HTML export wrapper/);
});

test('Malformed capture models are rejected instead of being stringified into HTML', async () => {
  const { project } = harness();
  await assert.rejects(project(null), /version 2 capture model/);
  await assert.rejects(project({ version: 1, root: el('DIV') }), /version 2 capture model/);
  await assert.rejects(project({ version: 2, root: text('bad') }), /version 2 capture model/);
  await assert.rejects(project({ version: 2, root: el('DIV'), assets: [] }), /assets are invalid/);
});

test('Excessive nesting fails explicitly instead of silently truncating the fragment', async () => {
  const { project } = harness();
  let root = el('DIV', { children: [text('deep')] });
  for (let index = 0; index < 513; index++) root = el('DIV', { children: [root] });
  await assert.rejects(project(model(root)), /too deeply nested/);
});

test('Projection honors cancellation, including an abort during a cooperative yield', async () => {
  const { project } = harness();
  const immediate = new AbortController(), reason = new Error('stop now');
  immediate.abort(reason);
  await assert.rejects(project(model(el('DIV')), { signal: immediate.signal }), error => error === reason);

  const controller = new AbortController();
  const root = el('DIV', { children: Array.from({ length: 450 }, (_, index) => el('SPAN', { children: [text(`node ${index}`)] })) });
  const timer = setTimeout(() => controller.abort(new Error('cancel during projection')), 5);
  await assert.rejects(project(model(root), { signal: controller.signal }), /cancel during projection/);
  clearTimeout(timer);
});

test('A large projection yields to other page tasks without a second model traversal', async () => {
  const { project } = harness();
  const root = el('DIV', { children: Array.from({ length: 450 }, (_, index) => el('SPAN', { children: [text(`${index}`)] })) });
  let timerRan = false;
  const pending = project(model(root));
  const timer = setTimeout(() => { timerRan = true; }, 0);
  const result = await pending;
  clearTimeout(timer);
  assert.equal(timerRan, true);
  assert.equal(result.stats.nodes, 901);
  assert.match(result.html, />449</);
});

test('The standalone projector has no Chrome, network, DOM-HTML parsing or raw source injection path', () => {
  assert.doesNotMatch(source, /\bchrome\.|\bfetch\s*\(|XMLHttpRequest|innerHTML\s*=|outerHTML|DOMParser|document\./);
});

test('Paper is a separate latest-snapshot action while automatic and Copy-all Figma payloads stay on the original path', () => {
  const toolbar = fs.readFileSync(path.resolve(__dirname, '..', 'extension/js/h2d_toolbar.js'), 'utf8');
  assert.match(toolbar, /run:\(\)=>l\(e,"copy_all"\)/);
  assert.match(toolbar, /l\(\[m\],"auto",h\)/);
  assert.match(toolbar, /id:"copy_paper"/);
  assert.match(toolbar, /e\.find\(x=>"snapshot"===x\.type\)/);
  assert.match(toolbar, /sanitizeDocument\(model\)/);
  assert.match(toolbar, /PageCaptureHtmlExport\.project\(model,\{wrapper:"x-paper-html",signal:active\}\)/);
  assert.match(toolbar, /blob=htmlProjection\?projected\.blob:await globalThis\.PageCaptureSafety\.prepareClipboard/);
  assert.match(toolbar, /PageCaptureClipboard\.write\(\[new ClipboardItem/);

  const background = fs.readFileSync(path.resolve(__dirname, '..', 'extension/js/background.js'), 'utf8');
  assert.ok(background.indexOf('js/capture-stability.js') < background.indexOf('js/h2d_toolbar.js'));
  assert.ok(background.indexOf('js/html-export.js') < background.indexOf('js/h2d_toolbar.js'));
});
