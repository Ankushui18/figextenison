'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'js/design-system-core.js'), 'utf8');
const context = { URL };
vm.runInNewContext(source, context);
const Core = context.PageCaptureDesignSystemCore;
const record = (styles = {}, hasText = false) => ({ hasText, styles: {
  color: 'rgb(24, 24, 24)', backgroundColor: 'rgba(0, 0, 0, 0)', outlineWidth: '0px', outlineStyle: 'none', textDecorationLine: 'none',
  borderTopWidth: '0px', borderRightWidth: '0px', borderBottomWidth: '0px', borderLeftWidth: '0px',
  borderTopStyle: 'none', borderRightStyle: 'none', borderBottomStyle: 'none', borderLeftStyle: 'none',
  fontFamily: 'Arial', fontSize: '16px', fontWeight: '400', lineHeight: '24px', letterSpacing: 'normal', fontStyle: 'normal', ...styles
} });
const build = (records = [record()], metadata = {}) => Core.buildSystem(records, { title: 'Fixture', url: 'https://example.com/page?secret=private#fragment', viewport: { width: 1280, height: 800 }, ...metadata });
const group = (system, category) => system.tokens.filter(token => token.category === category);

for (const [value, expected] of [
  ['rgb(13, 153, 255)', '#0d99ff'], ['rgba(13,153,255,1)', '#0d99ff'], ['#fff', '#ffffff'], ['#abcd', '#aabbccdd'],
  ['rgb(100% 0% 0% / 50%)', '#ff000080'], ['rgba(0,0,0,0)', null], ['transparent', null], ['currentColor', null], ['url(https://example.com)', null]
]) test(`Color normalization: ${value}`, () => assert.equal(Core.normalizeColor(value), expected));

test('Exactly matching colors deduplicate, near colors remain separate', () => {
  const system = build([record({ color: 'rgb(255,255,255)' }), record({ color: '#fff' }), record({ color: '#fefefe' })]);
  assert.equal(group(system, 'colors').length, 2);
  assert.equal(group(system, 'colors').find(token => token.value === '#ffffff').count, 2);
});
test('Existing matching CSS variable supplies a name, not an invented semantic role', () => {
  const system = build([record({ color: '#7c3aed' })], { variables: [{ name: '--brand-primary', value: '#7c3aed' }] });
  assert.equal(group(system, 'colors')[0].name, 'brand-primary');
  const fallback = build([record({ color: '#123456' })]);
  assert.equal(group(fallback, 'colors')[0].name, 'color-01');
});
test('Only style-linked CSS variables are retained; unrelated secrets are not exported', () => {
  const system = build([record()], { variables: [{ name: '--private-api-key', value: 'top-secret' }] });
  assert.ok(!Core.toJson(system).includes('top-secret'));
  assert.ok(!Core.toJson(system).includes('private-api-key'));
});
test('Spacing excludes zero/auto and keeps observed negative margins', () => {
  const system = build([record({ marginTop: '-4px', marginLeft: 'auto', paddingTop: '0px', gap: 'normal', rowGap: '16px' })]);
  assert.deepEqual(Array.from(group(system, 'spacing').map(token => token.value)).sort(), ['-4px', '16px']);
});
test('Percentage and elliptical radii are supported', () => {
  const system = build([record({ borderTopLeftRadius: '50%', borderTopRightRadius: '8px 16px', borderBottomLeftRadius: '0px' })]);
  assert.equal(group(system, 'radii').length, 2);
});
test('Typography is a composite of observed styles, not webpage text', () => {
  const system = build([record({ fontSize: '24px', fontWeight: '700' }, true), record({ fontSize: '96px' }, false)]);
  assert.equal(group(system, 'typography').length, 1);
  assert.equal(group(system, 'typography')[0].value.fontSize, '24px');
});
test('Border colors are not counted when their border is invisible', () => {
  const system = build([record({ borderTopWidth: '0px', borderTopStyle: 'none', borderTopColor: 'rgb(255,0,0)' })]);
  assert.ok(!group(system, 'colors').some(token => token.value === '#ff0000'));
});
test('Visible border and shadow tokens are extracted', () => {
  const system = build([record({ borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: '#dddddd', boxShadow: 'rgba(0, 0, 0, 0.1) 0px 4px 12px 0px' })]);
  assert.equal(group(system, 'borders').length, 1);
  assert.equal(group(system, 'shadows').length, 1);
});
test('URL metadata omits credentials, query and fragment', () => {
  assert.equal(Core.sourceUrl('https://user:password@example.com/path?token=secret#private'), 'https://example.com/path');
  assert.equal(Core.sourceUrl('file:///home/person/private/page.html'), 'file:///page.html');
  assert.equal(Core.sourceUrl('javascript:alert(1)'), '');
});
test('Excluded tokens are absent from all exports', () => {
  const system = build([record({ color: '#abcdef', paddingTop: '16px' })]);
  const excluded = group(system, 'spacing')[0]; excluded.included = false;
  assert.ok(!Core.toJson(system).includes(excluded.name));
  assert.ok(!Core.toCss(system).includes(`--${excluded.name}:`));
  assert.ok(!Core.toHtml(system).includes(`<h3>${excluded.name}</h3>`));
});
test('Invalid and duplicate names prevent export', () => {
  const system = build([record({ color: '#abcdef', paddingTop: '16px' })]);
  system.tokens[0].name = 'invalid name!';
  assert.throws(() => Core.toJson(system), /lowercase/);
  system.tokens[0].name = system.tokens[1].name;
  assert.ok(Core.validate(system).some(error => error.includes('Duplicate')));
});
test('Typography expanded CSS names also participate in collision validation', () => {
  const system = build([record({ color: '#abcdef', paddingTop: '16px' }, true)]);
  group(system, 'typography')[0].name = 'body';
  group(system, 'spacing')[0].name = 'body-font-size';
  assert.ok(Core.validate(system).some(error => error.includes('Duplicate')));
});
test('Merging is explicit, immutable, same-category and preserves observations', () => {
  const system = build([record({ color: '#abcdef' }), record({ color: '#abcdee' })]);
  const tokens = group(system, 'colors');
  const merged = Core.mergeTokens(system, tokens.map(token => token.id), tokens[0].id);
  assert.equal(group(system, 'colors').length, 2);
  assert.equal(group(merged, 'colors').length, 1);
  assert.equal(merged.tokens[0].value, tokens[0].value);
  assert.equal(merged.tokens[0].observations.length, 2);
  assert.equal(merged.tokens[0].count, 2);
});
test('Cross-category merge is rejected', () => {
  const system = build([record({ paddingTop: '16px' })]);
  assert.throws(() => Core.mergeTokens(system, system.tokens.map(token => token.id), system.tokens[0].id), /same category/);
});
test('CSS output expands typography without external font URLs', () => {
  const system = build([record({}, true)]);
  const css = Core.toCss(system);
  assert.match(css, /--type-01-font-family: Arial/);
  assert.match(css, /--type-01-font-size: 16px/);
  assert.doesNotMatch(css, /\[object Object\]|@import|url\(/);
});
test('Style guide is self-contained, escaped and denies network resources', () => {
  const system = build([record()], { title: '</title><script>alert(1)</script>' });
  const html = Core.toHtml(system);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script|<link|<img|<iframe|@import|@font-face/i);
  assert.match(html, /default-src 'none'/);
  assert.ok(!html.includes('?secret='));
});
test('Unsafe CSS fragments cannot enter observed typography or shadows', () => {
  const system = build([record({ fontFamily: 'Arial; } @import url(https://evil.example)', boxShadow: 'url(https://evil.example)' }, true)]);
  assert.equal(group(system, 'typography').length, 0);
  assert.equal(group(system, 'shadows').length, 0);
});
test('Token caps are explicit and produce a warning', () => {
  const system = build(Array.from({ length: 90 }, (_, index) => record({ color: `rgb(${index}, 0, 0)` })));
  assert.equal(group(system, 'colors').length, 80);
  assert.ok(system.warnings.some(warning => warning.includes('80')));
});
test('Core initialization is idempotent on repeated toolbar injection', () => {
  const first = context.PageCaptureDesignSystemCore;
  vm.runInNewContext(source, context);
  assert.equal(context.PageCaptureDesignSystemCore, first);
});
test('Capture engine changes are limited to the optional bridge, opt-in no-scrollbar-mutation flag and the 1.7 Viewports addition', () => {
  const toolbar = fs.readFileSync(path.join(root, 'js/h2d_toolbar.js'), 'utf8');
  const hook = ',globalThis.PageCaptureDesignSystem?.attach(d,globalThis.PageCaptureDesignBoard?.createCopier({capture:Sn,serialize:zr,encode:Ir}))';
  const flag = 'scrollbarManager:n.skipScrollbarHiding?{hide(){},show(){}}:new ft({analyticsTimer:L=>o("sb",L)})';
  assert.equal(toolbar.split(hook).length - 1, 1);
  assert.equal(toolbar.split(flag).length - 1, 1);
  const original = toolbar.replace(hook, '').replace(flag, 'scrollbarManager:new ft({analyticsTimer:L=>o("sb",L)})');
  const hash = crypto.createHash('sha256').update(original).digest('hex');
  assert.equal(hash, 'eec7b04a9d6670305928adb5236084e4269ba16393af96738586f5d2c270fd47');
});
test('Scanner/review modules have no network or clipboard APIs; permissions are unchanged', () => {
  const ui = fs.readFileSync(path.join(root, 'js/design-system.js'), 'utf8');
  assert.doesNotMatch(ui + source, /\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|clipboard\.(?:write|read)/);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest.permissions, ['storage', 'tabs', 'unlimitedStorage', 'scripting', 'clipboardWrite']);
});

test('Border variable matching normalizes computed RGB values', () => {
  const system = build([record({ borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: '#dddddd' })], { variables: [{ name: '--border-card', value: '1px solid rgb(221, 221, 221)' }] });
  assert.equal(group(system, 'borders')[0].name, 'border-card');
});
test('Excluded invalid names do not block other tokens; an empty export does', () => {
  const system = build([record({ paddingTop: '16px' })]);
  system.tokens[0].name = 'Invalid name'; system.tokens[0].included = false;
  assert.equal(Core.validate(system).length, 0);
  system.tokens.forEach(token => { token.included = false; });
  assert.match(Core.validate(system)[0], /at least one/);
});
test('Duplicate review names are rejected even across composite categories', () => {
  const system = build([record({}, true)]);
  group(system, 'colors')[0].name = 'body'; group(system, 'typography')[0].name = 'body';
  assert.ok(Core.validate(system).some(error => error === 'Duplicate token name: body'));
});
test('Merge retains all matching source variable aliases and original counts', () => {
  const system = build([record({ color: '#abcdef' }), record({ color: '#abcdef' }), record({ color: '#abcdee' })], { variables: [{ name: '--brand-a', value: '#abcdef' }, { name: '--brand-b', value: '#abcdee' }] });
  const selected = group(system, 'colors'); const result = Core.mergeTokens(system, selected.map(token => token.id), selected[0].id);
  const exported = JSON.parse(Core.toJson(result)).tokens.colors[selected[0].name].$extensions.pageCapture;
  assert.equal(exported.uses, 3);
  assert.deepEqual(exported.cssVariables.sort(), ['--brand-a', '--brand-b']);
  assert.deepEqual(exported.observations.map(observation => observation.count).sort(), [1, 2]);
});
