# Testing

Two layers: a dependency-free Node suite that runs anywhere, and Chromium suites
that drive the real extension with Playwright.

## Node suite (always run this)

```bash
npm test          # node --test tests/*.test.cjs
```

**361 checks, 0 dependencies, ~3 seconds.** No install step, no browser.

| File | Covers |
|---|---|
| `tests/privacy.test.cjs` | blocked hosts/private ranges, GET-only recovery, RPC allowlist, permissions/CSP, removed leftovers |
| `tests/capture-safety.test.cjs` | redaction, legacy-record migration, copy failure paths, UTF-8 budgets, cancellation |
| `tests/clipboard.test.cjs` | direct writes, bounded offscreen recovery, worker/offscreen sender checks, exact rich/text payloads, no-read/no-network guards |
| `tests/picker-navigation.test.cjs` | parent, child and sibling traversal, ignored UI, open shadow roots and slots |
| `tests/capture-fidelity.test.cjs` | live form-state serialization, password redaction, canvas/video/pseudo hooks, accessible reduced-motion notices |
| `tests/capture-stability.test.cjs` | transition/infinite-animation freeze and rollback, open shadow roots, adopted stylesheets, cancellation/errors, single-walk yielding |
| `tests/html-export.test.cjs` | sanitized Paper/HTML projection, form/media/pseudo handling, wrapper options, malformed input, cancellation, yielding, Figma action isolation |
| `tests/fullpage.test.cjs` | full-page root expansion, scroll-area rebasing, lazy-image candidates, asset batches |
| `tests/viewports.test.cjs` | picker placement, cleanup, no temporary-window RPC, persisted presets |
| `tests/viewports-responsive.test.cjs` | responsive copy construction, CSSOM/shadow handling, cancellation |
| `tests/design-system.test.cjs` | token extraction, renames, merges, exclusions, duplicates |
| `tests/design-system-polish.test.cjs` | preview scaling, color normalization, typography metrics |
| `tests/design-system-board.test.cjs` | board layout, clipboard payload shape, limits, manifest version |
| `tests/wireframe.test.cjs` | the wireframe transform (levels, tones, bars, placeholders, hidden content, scrims/lids, section surfaces, geometry/text bounds, fonts, assets, a bounded-work regression), the Viewports option and its saved choice (late storage, missing pipeline, re-attach, truncation hint, build stamp, miss reporting), the clipboard hook (pass-through, multi-width, failures, idempotence), injection order |
| `tests/no-onboarding.test.cjs` | no wizard/onboarding, every locale key resolves |

These tests load the shipped files directly (`extension/js/*.js`) into a `vm`
context, so they fail when the runtime drifts from the documented behaviour.

## Repository checks

```bash
npm run check
```

Fails when:

- `extension/manifest.json`, `package.json` and the top of `CHANGELOG.md`
  disagree on the version;
- a runtime file is missing from `extension/`, or a stray runtime file appears at
  the root;
- a relative link or image in `README.md` / `docs/*.md` does not exist;
- the test count quoted in `README.md` or this file is stale;
- `extension/` references a file that is not in the repository.

`npm run verify` runs `check` + `test`.

## Browser suites (optional)

They need Playwright and a Chromium build:

```bash
npm install --no-save --package-lock=false playwright
npx playwright install chromium
# Linux may also need: npx playwright install-deps chromium

npm run test:browser
```

Run them **sequentially** — they use real focus, real clipboard reads and, in one
case, real timer behaviour. `EXTENSION_ROOT` points a suite at a packaged copy;
`ARTIFACT_DIR` collects screenshots and summaries.

| Suite | Focus |
|---|---|
| `browser-smoke.cjs` | injection, toolbar mount, permission hand-off |
| `design-system-browser.cjs` | generator panel, review tools, native clipboard |
| `design-system-board-browser.cjs` | board copy, clipboard decoding |
| `viewports-browser.cjs` | opening, docking, keyboard, real 1280/768/393px output |
| `viewports-responsive-browser.cjs` | exact two-screen output, source state preservation |
| `fullpage-browser.cjs` | 100%-height root, lazy gallery, source preservation |
| `scrollarea-browser.cjs` | 813px document vs 2,518px scroller |
| `scrollarea-child-browser.cjs` | clicking a card inside the scroller |
| `image-completeness-browser.cjs` | included vs not-embedded asset reporting |
| `capture-safety-browser.cjs` | redaction, denied copy, manual retry, cancellation |
| `capture-fidelity-browser.cjs` | live form state, canvas/video pixels, pseudo-elements, animation restore, real phase feedback, keyboard picking, real offscreen Figma/Paper/raw recovery and toast progress |

Known flake: `viewports-browser.cjs` can time out while opening the 200px-wide
panel or waiting for toolbar teardown. The captured logic is unaffected; re-run
it isolated before treating it as a regression.

## Destination paste verification

Browser clipboard readback proves what Chromium accepted, not what a destination
did with it. Figma paste remains a manual verification step. Paper additionally
requires the plain/wrapped × flow/absolute matrix and an actual Paper paste in
[docs/PAPER-EXPORT.md](PAPER-EXPORT.md). Until those results are recorded, Paper
compatibility and the `<x-paper-html>` wrapper requirement are unverified.

## CI

`.github/workflows/ci.yml` runs on every push and pull request:

- `check` + `test` on Node 22 (fast, no browser);
- the eleven browser suites on Ubuntu with Playwright Chromium;
- on a `v*` tag, a release job that builds `page-capture-<version>.zip` from
  `extension/` and attaches it to the GitHub release.

## Fixtures

`tests/fixtures/*.html` are tiny local pages served on `127.0.0.1` by the suites
that need them. They are deliberately built to break things: a 100%-height root,
a 2,518px nested scroller, nine responsive breakpoints, a 30-image lazy gallery.
Suites record remote requests and fail if any leave localhost.

## Adding a test

Pick the closest file from the table above, reproduce the bug there first, then
fix it. Browser-level bugs (focus, clipboard, real layout) belong in the matching
`*-browser.cjs`.
