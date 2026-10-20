#!/usr/bin/env node
/* Build a loadable ZIP of extension/ for a GitHub release.
 * Usage: node scripts/pack.js  →  page-capture-<version>.zip
 * Requires the system `zip` binary (present on GitHub's Ubuntu runners).
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const extension = path.join(root, 'extension');
const { version } = JSON.parse(fs.readFileSync(path.join(extension, 'manifest.json'), 'utf8'));
const out = path.join(root, `page-capture-${version}.zip`);

if (!fs.existsSync(path.join(extension, 'manifest.json'))) {
  console.error('extension/manifest.json is missing; nothing to pack.');
  process.exit(1);
}

try {
  execFileSync('zip', ['--version'], { stdio: 'ignore' });
} catch {
  console.error('The `zip` binary is required (apt install zip, or use Windows: build the ZIP from extension/ manually).');
  process.exit(1);
}

fs.rmSync(out, { force: true });
// -r recurse, -X no extra attributes, -q quiet. Run inside extension/ so the
// manifest sits at the ZIP root, which is what "Load unpacked" needs.
execFileSync('zip', ['-r', '-X', '-q', out, '.'], { cwd: extension, stdio: 'inherit' });

const size = fs.statSync(out).size;
const listed = execFileSync('unzip', ['-Z1', out], { encoding: 'utf8' })
  .split('\n').filter(l => l && !l.endsWith('/'));
const required = ['manifest.json', 'background.js', 'options.html'];
for (const name of required) {
  if (!listed.includes(name) && !listed.includes(`js/${name}`)) {
    console.error(`Packed ZIP is missing ${name}`);
    process.exit(1);
  }
}
console.log(`Built ${path.basename(out)} — ${listed.length} files, ${(size / 1024).toFixed(0)} KiB, version ${version}`);
