#!/usr/bin/env node
/* Run the Chromium suites one at a time, keep going after a failure, and make
 * failures readable where logs are not: as a GitHub annotation and as a step
 * summary. Locally it behaves like a plain sequential runner.
 *
 * Usage: npm run test:browser            (all suites)
 *        npm run test:browser -- viewports   (only suites matching a substring)
 */
'use strict';
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const SUITES = [
  'browser-smoke.cjs',
  'design-system-browser.cjs',
  'design-system-board-browser.cjs',
  'viewports-browser.cjs',
  'viewports-responsive-browser.cjs',
  'fullpage-browser.cjs',
  'scrollarea-browser.cjs',
  'scrollarea-child-browser.cjs',
  'image-completeness-browser.cjs',
  'capture-safety-browser.cjs',
  'capture-fidelity-browser.cjs'
];

const filter = process.argv[2];
const selected = filter ? SUITES.filter(name => name.includes(filter)) : SUITES;
if (!selected.length) {
  console.error(`No suite matches "${filter}". Known suites: ${SUITES.join(', ')}`);
  process.exit(2);
}

const inActions = process.env.GITHUB_ACTIONS === 'true';
const results = [];

const escape = value => String(value)
  .replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

for (const suite of selected) {
  const started = Date.now();
  console.log(`\n──────── ${suite} ────────`);
  const run = spawnSync(process.execPath, [path.join('tests', suite)], {
    cwd: root,
    encoding: 'utf8',
    env: process.env,
    timeout: 5 * 60 * 1000
  });
  const stdout = run.stdout || '';
  const stderr = run.stderr || '';
  process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
  const ok = run.status === 0;
  results.push({ suite, ok, seconds: ((Date.now() - started) / 1000).toFixed(1) });

  if (!ok) {
    // The last meaningful lines are what actually explains the failure.
    const detail = `${stderr}\n${stdout}`.trim().split('\n').filter(line => line.trim()).slice(-12).join(' | ');
    const reason = run.signal ? `killed by ${run.signal} after ${results.at(-1).seconds}s` : `exit ${run.status}`;
    // GitHub turns these into annotations, which stay readable even when the
    // raw job log is unavailable.
    console.log(`::error title=${escape(suite)} (${escape(reason)})::${escape(detail.slice(-1000) || 'no output')}`);
  }
}

const failed = results.filter(row => !row.ok);
const lines = results.map(row => `| ${row.ok ? '✅ pass' : '❌ fail'} | ${row.suite} | ${row.seconds}s |`);
const summary = [
  '### Browser suites',
  '',
  '| Result | Suite | Time |',
  '|---|---|---|',
  ...lines,
  '',
  `${results.length - failed.length}/${results.length} suites passed.`
].join('\n');
console.log(`\n${summary}\n`);

if (process.env.GITHUB_STEP_SUMMARY) {
  try { fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`); } catch { /* summary is best-effort */ }
}
if (process.env.ARTIFACT_DIR) {
  try {
    fs.mkdirSync(process.env.ARTIFACT_DIR, { recursive: true });
    fs.writeFileSync(path.join(process.env.ARTIFACT_DIR, 'browser-suites.json'), JSON.stringify(results, null, 2));
  } catch { /* artifacts are best-effort */ }
}

process.exit(failed.length ? 1 : 0);
