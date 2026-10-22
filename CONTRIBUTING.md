# Contributing

Thanks for helping. The most valuable contribution is a **reproduction**: a page
(or fixture) where a capture is wrong, with a screenshot of what you got.

## Reporting a bug

Use **Issues → New issue → Bug report**. The template asks for:

- extension version (from `chrome://extensions`) and Chrome version;
- which action: Capture design, Select element, Capture scroll area,
  Capture code, Viewports, or a Design System copy;
- whether it fails in a normal tab, an embedded frame, or a `file://` page;
- a screenshot, and a minimal fixture if the page is public.

## Before you start

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — which file owns what, load
  order, the message protocol, and where to make a change.
- [docs/FAQ.md](docs/FAQ.md) — behaviour that is a browser limitation rather
  than a bug.
- [PRIVACY.md](PRIVACY.md) — the rules the tests enforce.

## Development

```bash
git clone https://github.com/Ankushui18/figextenison.git
cd figextenison
npm test          # 353 dependency-free checks, no install step
npm run check     # version/docs/link hygiene
npm run verify    # test + check (what CI runs)
```

Load the extension: `chrome://extensions` → **Developer mode** →
**Load unpacked** → select the **`extension/`** folder (the one containing
`manifest.json`). After editing a file, click **Reload** on the card and refresh
the page you are testing.

Browser suites (optional, need Playwright + Chromium):

```bash
npm install --no-save --package-lock=false playwright
npx playwright install chromium
npm run test:browser          # all suites, sequentially
```

## Rules of thumb

- **`extension/` holds only what Chrome loads.** Docs, tests, scripts and CI stay
  at the root. `npm run check` fails if a runtime file ends up outside it.
- **No build step and no dependencies.** `extension/js/*.js` is what ships; it
  must run as-is. There is no bundler, no transpiler and no framework. The one
  bundled file (`h2d_toolbar.js`) is already minified — edit it carefully and
  keep `node --check` passing.
- **Keep the declared permissions.** Adding a permission, host permission or CSP
  exception needs a very good reason and a privacy review in `PRIVACY.md`.
- **No new network path.** Assets may only be read with the existing
  `H2D_FETCH_ASSETS` flow under the current policy. Never add an upload.
- **Only an explicit user action writes the clipboard.** No automatic copy on load.
- **Sanitize anything that came from the page** before it reaches panel DOM, and
  keep `PageCaptureSafety` in the loop.
- **Be honest in the UI.** If a result is partial, says so (e.g. "12 included,
  1 not embedded").
- **Changing capture output?** Add or extend a fixture and a check first, so the
  behaviour stays fixed.
- **Changing storage or the snapshot shape?** Old records must keep working;
  there are migration checks in `tests/capture-safety.test.cjs`.

## Where to add a test

| Change | Test file |
|---|---|
| Full-page framing, lazy images, asset batches | `tests/fullpage.test.cjs` |
| Scroll-area expansion | `tests/fullpage.test.cjs`, `tests/scrollarea-browser.cjs` |
| Privacy/redaction, copy failures, budgets | `tests/capture-safety.test.cjs` |
| Viewport presets, responsive copies | `tests/viewports.test.cjs`, `tests/viewports-responsive.test.cjs` |
| Design tokens, review/merge/exclude | `tests/design-system.test.cjs`, `tests/design-system-polish.test.cjs` |
| Editable board + clipboard payload | `tests/design-system-board.test.cjs` |
| Privacy policy, permissions, RPC allowlist | `tests/privacy.test.cjs` |
| No onboarding, locale coverage | `tests/no-onboarding.test.cjs` |

## Releasing

1. Update `CHANGELOG.md` and bump `version` in **both** `extension/manifest.json`
   and `package.json`.
2. Run `npm run verify`.
3. `npm run pack` → produces `page-capture-<version>.zip` from `extension/`.
4. Commit, tag `v1.x.y`, push the tag. CI builds and attaches the ZIP to the
   GitHub release.
