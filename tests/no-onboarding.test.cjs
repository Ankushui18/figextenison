'use strict';
// Run with: node --test tests/*.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..', 'extension');
const load = name => fs.readFileSync(path.join(root, name), 'utf8');
const sandbox = { URLSearchParams };
vm.runInNewContext(load('js/core.js'), sandbox);
const Core = sandbox.PageCaptureCore;
const options = load('js/options.js');
const background = load('js/background.js');
const messages = JSON.parse(load('_locales/en/messages.json'));

for (const reason of [null, 'needs_permissions', 'needs_file_access', 'onboarding', 'unknown']) {
  test(`Wait for permission state before routing: ${reason}`, () => {
    assert.equal(Core.selectOptionsView({ hasCapturePermissions: null, optionsReason: reason }), 'loading');
    assert.equal(Core.selectOptionsView({ hasCapturePermissions: undefined, optionsReason: reason }), 'loading');
  });
  test(`Missing capture permissions cannot be skipped: ${reason}`, () => {
    assert.equal(Core.selectOptionsView({ hasCapturePermissions: false, optionsReason: reason }), 'permissions');
  });
}
test('Normal options page shows only permission status', () => {
  assert.equal(Core.selectOptionsView({ hasCapturePermissions: true, optionsReason: null }), 'ready');
});
test('Completed permissions route directly to resume/status', () => {
  assert.equal(Core.selectOptionsView({ hasCapturePermissions: true, optionsReason: 'needs_permissions' }), 'ready');
});
test('Local-file permission helper remains available', () => {
  assert.equal(Core.selectOptionsView({ hasCapturePermissions: true, optionsReason: 'needs_file_access' }), 'file_access');
});
test('Retired and unknown reason URLs safely fall back to status', () => {
  for (const reason of ['onboarding', 'unknown']) {
    assert.equal(Core.parseOptionsReason(`?reason=${reason}`), null);
    assert.equal(Core.selectOptionsView({ hasCapturePermissions: true, optionsReason: reason }), 'ready');
  }
});
test('Permission URLs preserve a pending capture request', () => {
  for (const reason of ['needs_permissions', 'needs_file_access']) {
    const url = Core.buildOptionsUrl('chrome-extension://test/options.html', reason, 'request-123');
    assert.equal(Core.parseOptionsReason(new URL(url).search), reason);
    assert.equal(Core.parseOptionsToolbarRequestId(new URL(url).search), 'request-123');
  }
});
test('Tutorial code, CTAs and locale entries are absent from runtime', () => {
  for (const source of [options, background, load('js/core.js'), JSON.stringify(messages)]) {
    assert.doesNotMatch(source, /onboarding|ONBOARDING_STEPS|showGetStarted|case\s*"guide"/i);
  }
});
test('All options-page local script, image and font references exist', () => {
  const source = load('options.html') + options;
  for (const match of source.matchAll(/["']((?:img|font|js)\/[^"']+\.(?:png|svg|webp|jpg|woff2|js))["']/g)) {
    assert.ok(fs.existsSync(path.join(root, match[1])), match[1]);
  }
});
test('Every direct options-page locale lookup resolves', () => {
  for (const match of options.matchAll(/text\("([^"]+)"/g)) assert.ok(Object.hasOwn(messages, match[1]), match[1]);
});
test('Permission button has a direct label, not a wizard step', () => {
  assert.equal(messages.optionsCapturePermissionsCta.message, 'Allow permissions');
});
