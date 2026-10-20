#!/usr/bin/env node
/* Repository hygiene: version handshake, layout, docs links, quoted test counts.
 * Runs before the unit tests in CI so documentation cannot drift silently.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const failures = [];
const note = message => console.log(`  ok  ${message}`);
const fail = message => { failures.push(message); console.log(`  FAIL ${message}`); };
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const exists = file => fs.existsSync(path.join(root, file));

console.log('\nVersion handshake');
const manifest = JSON.parse(read('extension/manifest.json'));
const pkg = JSON.parse(read('package.json'));
const changelog = read('CHANGELOG.md');
const changelogVersion = (changelog.match(/^##\s+(\d+\.\d+\.\d+)/m) || [])[1];
[['extension/manifest.json', manifest.version], ['package.json', pkg.version], ['CHANGELOG.md', changelogVersion]]
  .forEach(([name, version]) => version === manifest.version ? note(`${name} → ${version}`) : fail(`${name} version ${version} != manifest ${manifest.version}`));
if (manifest.manifest_version !== 3) fail(`manifest_version is ${manifest.manifest_version}, expected 3`);

console.log('\nRepository layout');
const RUNTIME = ['manifest.json', 'options.html', 'icon16.png', 'icon32.png', 'icon48.png', 'icon128.png', 'js', 'font', 'img', '_locales'];
RUNTIME.forEach(name => exists(`extension/${name}`) ? note(`extension/${name}`) : fail(`missing extension/${name}`));
RUNTIME.forEach(name => exists(name) ? fail(`${name} must not exist at the repository root (it is runtime, keep it in extension/)`) : note(`root has no ${name}`));
if (!manifest.background?.service_worker?.startsWith('js/')) fail('service worker path should be relative to extension/');
const injected = (read('extension/js/background.js').match(/files:\s*\[([^\]]+)\]/) || [])[1] || '';
[...injected.matchAll(/"([^"]+)"/g)].map(m => m[1]).forEach(rel => exists(`extension/${rel}`) ? note(`injected ${rel}`) : fail(`injected file missing: extension/${rel}`));
JSON.stringify(manifest).match(/"(?:js|img|font)\/[^"]+"/g)?.map(s => s.slice(1, -1)).forEach(rel => exists(`extension/${rel}`) ? undefined : fail(`manifest references missing file: extension/${rel}`));

console.log('\nDocs links');
const docs = ['README.md', 'CONTRIBUTING.md', 'CHANGELOG.md', 'PRIVACY.md', 'SECURITY.md', ...fs.readdirSync(path.join(root, 'docs')).filter(f => f.endsWith('.md')).map(f => `docs/${f}`)];
let linkCount = 0;
for (const file of docs) {
  const text = read(file);
  for (const match of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = match[1];
    if (/^(?:https?:|mailto:|#)/.test(target)) continue;
    linkCount++;
    const clean = target.split('#')[0];
    if (!clean) continue;
    const resolved = path.resolve(path.dirname(path.join(root, file)), clean);
    if (!fs.existsSync(resolved)) fail(`${file}: broken link ${target}`);
  }
  for (const match of text.matchAll(/<img[^>]+src="([^"]+)"/g)) {
    if (/^(?:https?:)?\/\//.test(match[1])) continue; // badges and other remote images
    linkCount++;
    const resolved = path.resolve(path.dirname(path.join(root, file)), match[1]);
    if (!fs.existsSync(resolved)) fail(`${file}: broken image ${match[1]}`);
  }
}
note(`${linkCount} relative links and images checked`);

console.log('\nQuoted test counts');
const testFiles = fs.readdirSync(path.join(root, 'tests')).filter(f => f.endsWith('.test.cjs')).map(f => path.join(root, 'tests', f));
let output = '';
try {
  output = execFileSync(process.execPath, ['--test', ...testFiles], { cwd: root, encoding: 'utf8' });
} catch (error) {
  output = `${error.stdout || ''}${error.stderr || ''}`;
}
const actual = Number((output.match(/^# pass (\d+)/m) || [])[1]);
if (!Number.isFinite(actual) || actual === 0) {
  fail('could not determine the number of passing checks');
} else {
  note(`suite reports ${actual} passing checks`);
  for (const file of ['README.md', 'docs/TESTING.md', 'CONTRIBUTING.md']) {
    for (const match of read(file).matchAll(/(\d+)\s+(?:dependency-free )?checks/g)) {
      const quoted = Number(match[1]);
      if (quoted !== actual) fail(`${file}: quotes ${quoted} checks but the suite reports ${actual}`);
    }
  }
}

if (failures.length) {
  console.error(`\n${failures.length} repository check(s) failed.\n`);
  process.exit(1);
}
console.log('\nAll repository checks passed.\n');
