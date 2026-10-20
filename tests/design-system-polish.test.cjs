'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = { URL };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../extension/js/design-system-core.js'), 'utf8'), context);
const Core = context.PageCaptureDesignSystemCore;
const plain = value => JSON.parse(JSON.stringify(value));
const model = (category, values) => ({ tokens: values.map((value, index) => ({ id: `${category}-${index + 1}`, category, value, name: `token-${index + 1}`, included: true })) });
const type = changes => ({ fontFamily: 'Arial, sans-serif', fontSize: '16px', fontWeight: '400', lineHeight: '24px', letterSpacing: 'normal', fontStyle: 'normal', ...changes });
const near = (category, values, limit) => Core.suggestSimilar(model(category, values), category, limit);

for (const [value, expected] of [
  ['#fff', { r: 1, g: 1, b: 1, a: 1 }], ['#0000', { r: 0, g: 0, b: 0, a: 0 }],
  ['rgb(255 0 0 / 50%)', { r: 1, g: 0, b: 0, a: .5 }], ['rgba(0, 0, 0, .25)', { r: 0, g: 0, b: 0, a: .25 }],
  ['rgb(100% 0% 100%)', { r: 1, g: 0, b: 1, a: 1 }], ['transparent', { r: 0, g: 0, b: 0, a: 0 }]
]) test(`Explicit sRGB parser: ${value}`, () => assert.deepEqual(plain(Core.parseSrgb(value)), expected));

test('sRGB parser preserves 8-bit alpha exactly', () => assert.equal(Core.parseSrgb('#abcdef80').a, 128 / 255));
for (const value of ['rgb(1,,2,3)', 'rgb(1 2 3 /)', 'rgb(1 2 / 30%)', 'rgb(1, 2, 3 / .5)', 'rgb(1 2 3 .5)', 'rgb(NaN 0 0)', 'oklch(.7 .18 145)', 'color(display-p3 1 0 0)', 'url(https://example.com)', '#12345']) {
  test(`Review parser does not guess unsupported/malformed color: ${value}`, () => assert.equal(Core.parseSrgb(value), null));
}
test('Black/white contrast is 21:1 and passes all text thresholds', () => {
  const result = Core.colorContrast('#000000', '#ffffff');
  assert.equal(result.ratio, 21);
  assert.ok(result.aaNormal && result.aaLarge && result.aaaNormal && result.aaaLarge);
  assert.equal(Core.colorLuminance('#000'), 0); assert.equal(Core.colorLuminance('#fff'), 1);
});
test('Identical color contrast is 1:1 and fails all text thresholds', () => {
  const result = Core.colorContrast('#7c3aed', '#7c3aed');
  assert.equal(result.ratio, 1); assert.ok(!result.aaNormal && !result.aaLarge && !result.aaaNormal && !result.aaaLarge);
});
test('Normal-text AA threshold uses unrounded values', () => {
  const below = Core.colorContrast('#777777', '#fff'), above = Core.colorContrast('#767676', '#fff');
  assert.ok(Math.abs(below.ratio - 4.478089453577214) < 1e-10);
  assert.equal(below.aaNormal, false); assert.equal(above.aaNormal, true);
});
test('Large-text AA and normal-text AAA have independent thresholds', () => {
  assert.equal(Core.colorContrast('#949494', '#fff').aaLarge, true);
  assert.equal(Core.colorContrast('#959595', '#fff').aaLarge, false);
  assert.equal(Core.colorContrast('#595959', '#fff').aaaNormal, true);
  assert.equal(Core.colorContrast('#5a5a5a', '#fff').aaaNormal, false);
});
test('Translucent foreground is composited over the explicit opaque background', () => {
  const result = Core.colorContrast('rgba(0,0,0,.5)', '#fff');
  assert.ok(Math.abs(result.ratio - 3.976653024912438) < 1e-10);
  assert.equal(result.aaNormal, false); assert.equal(result.aaLarge, true);
  assert.equal(Core.colorContrast('transparent', '#fff').ratio, 1);
});
test('Translucent backgrounds and wide-gamut colors have no guessed contrast', () => {
  assert.equal(Core.colorContrast('#000', '#ffffff80'), null);
  assert.equal(Core.colorContrast('#000', 'transparent'), null);
  assert.equal(Core.colorContrast('oklch(.7 .18 145)', '#fff'), null);
  assert.equal(Core.colorLuminance('#ffffff80'), null);
});
test('Opaque contrast is symmetric and bounded for a deterministic palette', () => {
  for (let index = 0; index < 50; index++) {
    const color = `#${((index * 197729) % 16777216).toString(16).padStart(6, '0')}`;
    const a = Core.colorContrast(color, '#fff'), b = Core.colorContrast('#fff', color);
    assert.ok(a.ratio >= 1 && a.ratio <= 21);
    assert.equal(a.ratio, b.ratio);
  }
});
test('Similar colors produce a review suggestion, distinct colors do not', () => {
  const pairs = near('colors', ['#7c3aed', '#7c3aee', '#ff0000']);
  assert.equal(pairs.length, 1); assert.deepEqual(plain(pairs[0].ids), ['colors-1', 'colors-2']);
  assert.ok(pairs[0].score >= 0 && pairs[0].score <= 1);
});
test('Color suggestions consider opacity and do not approximate modern spaces', () => {
  assert.equal(near('colors', ['#00000080', '#00000082']).length, 1);
  assert.equal(near('colors', ['#00000080', '#000000ff']).length, 0);
  assert.equal(near('colors', ['oklch(.7 .18 145)', 'oklch(.701 .18 145)']).length, 0);
});
test('Spacing suggestions are conservative and respect direction and scale', () => {
  assert.equal(near('spacing', ['16px', '17px']).length, 1);
  assert.equal(near('spacing', ['8px', '16px']).length, 0);
  assert.equal(near('spacing', ['-16px', '-17px']).length, 1);
  assert.equal(near('spacing', ['-16px', '16px']).length, 0);
});
test('Radius suggestions respect units and elliptical dimensions', () => {
  assert.equal(near('radii', ['49%', '50%']).length, 1);
  assert.equal(near('radii', ['8px 16px', '9px 17px']).length, 1);
  assert.equal(near('radii', ['8px', '9%']).length, 0);
  assert.equal(near('radii', ['8px', '8px 9px']).length, 0);
});
test('Typography suggestions require matching family, weight, style and tracking', () => {
  assert.equal(near('typography', [type(), type({ fontSize: '17px' })]).length, 1);
  assert.equal(near('typography', [type(), type({ lineHeight: '25px' })]).length, 1);
  for (const changes of [{ fontFamily: 'Other face' }, { fontWeight: '700' }, { fontStyle: 'italic' }, { letterSpacing: '1px' }, { fontSize: '24px' }]) {
    assert.equal(near('typography', [type(), type(changes)]).length, 0);
  }
});
test('Border suggestions never conflate different line styles or obvious stroke scales', () => {
  const first = { width: '1px', style: 'solid', color: '#abcdef' };
  assert.equal(near('borders', [first, { ...first, color: '#abcdee' }]).length, 1);
  assert.equal(near('borders', [first, { ...first, width: '1.2px' }]).length, 1);
  assert.equal(near('borders', [first, { ...first, width: '2px' }]).length, 0);
  assert.equal(near('borders', [first, { ...first, style: 'dashed' }]).length, 0);
});
test('Shadow suggestions keep geometry fixed and compare only close paint/opacity', () => {
  const first = 'rgba(0, 0, 0, 0.1) 0px 4px 12px 0px';
  assert.equal(near('shadows', [first, 'rgba(0, 0, 0, 0.12) 0px 4px 12px 0px']).length, 1);
  assert.equal(near('shadows', [first, 'rgba(0, 0, 0, 0.12) 0px 4px 16px 0px']).length, 0);
  assert.equal(near('shadows', [first, 'inset rgba(0, 0, 0, 0.12) 0px 4px 12px 0px']).length, 0);
});
test('Suggestions ignore exclusions and other categories, and never mutate the model', () => {
  const system = model('colors', ['#7c3aed', '#7c3aee', '#7c3aef']); system.tokens[1].included = false;
  system.tokens.push({ id: 'space-1', category: 'spacing', value: '16px', included: true });
  const before = JSON.stringify(system); const pairs = Core.suggestSimilar(system, 'colors');
  assert.equal(JSON.stringify(system), before); assert.equal(pairs.length, 1);
  assert.deepEqual(plain(pairs[0].ids), ['colors-1', 'colors-3']);
});
test('Suggestions are deterministic, capped and do not propose exact duplicates', () => {
  const system = model('colors', Array.from({ length: 80 }, (_, index) => `#0000${index.toString(16).padStart(2, '0')}`));
  const first = Core.suggestSimilar(system, 'colors', 100);
  assert.equal(first.length, 20); assert.deepEqual(plain(first), plain(Core.suggestSimilar(system, 'colors', 100)));
  assert.equal(Core.suggestSimilar(system, 'colors', 0).length, 0);
  assert.equal(Core.suggestSimilar(system, 'unknown').length, 0);
  assert.equal(near('spacing', ['16px', '16px']).length, 0);
});
test('Typography previews scale safely, retain metrics, and never apply extracted fonts', () => {
  const presentation = Core.typographyPreview(type({ fontFamily: 'Website Face', fontSize: '200px', lineHeight: '400px', fontWeight: '1300', letterSpacing: '100px' }));
  assert.equal(presentation.fontSize, '48px'); assert.equal(presentation.lineHeight, '1.8');
  assert.equal(presentation.fontWeight, '1000'); assert.equal(presentation.letterSpacing, '4px');
  assert.equal(Object.hasOwn(presentation, 'fontFamily'), false);
  assert.equal(Core.typographyPreview(type({ fontSize: '1px', fontStyle: 'bad; }', fontWeight: 'bad' })).fontSize, '10px');
  assert.equal(Core.typographyPreview(type({ fontStyle: 'bad; }' })).fontStyle, 'normal');
});
test('HTML style-guide previews use checkerboards and scaled system-font specimens', () => {
  const record = { hasText: true, styles: { ...type({ fontSize: '200px' }), color: '#00000080', backgroundColor: '#ffffff' } };
  const system = Core.buildSystem([record], { title: 'Preview fixture', url: 'https://example.com' });
  const before = Core.toJson(system); Core.suggestSimilar(system, 'colors'); Core.colorContrast('#000', '#fff');
  assert.equal(Core.toJson(system), before);
  const html = Core.toHtml(system);
  assert.match(html, /conic-gradient/); assert.match(html, /font-size:48px/); assert.match(html, /Aa 123/);
  assert.match(html, /font-family:system-ui,sans-serif/);
  assert.doesNotMatch(html, /<script|<link|@font-face|@import/i);
});
