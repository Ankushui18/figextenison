# Changelog

All notable changes are listed here. Versions follow `MAJOR.MINOR.PATCH`; the
manifest version in `extension/manifest.json`, `package.json` and the newest
entry below must always match (`npm run check` enforces it).

## 1.7.9 — repository cleanup

### Changed

- **Runtime moved into `extension/`.** Only the files Chrome loads live there, so
  **Load unpacked** now points at `extension/` and "ignore everything else" is
  the default. Load order is documented in `docs/ARCHITECTURE.md`.
- Documentation rebuilt: new `README.md` with install, screenshots, repository
  map and known limits; new `docs/` set (architecture, FAQ, testing,
  screenshots, GitHub setup); `PRIVACY-AUDIT.md` moved to
  `docs/PRIVACY-AUDIT.md`.
- Added `LICENSE` (MIT), `PRIVACY.md`, `SECURITY.md`, `CONTRIBUTING.md`,
  `CHANGELOG.md`, GitHub issue/PR templates and a CI workflow.
- Added `npm` scripts: `test`, `check`, `verify`, `pack`, `test:browser`.

### Removed

- `js/vendor.js` and `js/vendor.js.LICENSE.txt` — an unused webpack bundle that
  carried a Figma/Sentry/redux client stack. Nothing referenced it, and it was
  the only place with a `chrome.runtime.getURL()` reference to a missing asset.
- `js/background.js.LICENSE.txt`, `font/MaterialIcons.woff2`,
  `font/InterVariable-Italic.woff2` — unreferenced. 859,784 bytes in total.
- Fixed the one failing suite that already asserted those files were gone.

### Unchanged

Capture behaviour, permissions, host permissions, extension CSP, locale strings,
storage keys and the six local RPCs.

## 1.7.8 — scroll area accepts any point inside the scroller

- **Capture scroll area** now resolves the clicked element to its nearest
  vertically scrollable ancestor instead of rejecting clicks on cards or text
  inside the region. The page itself is never chosen; a selection with no
  scrollable ancestor still reports "Select an element with vertical overflow."
- Added `tests/scrollarea-child-browser.cjs` for direct-child selection.

## 1.7.7 — dead code and a distinct scroll-area icon

- Removed an unreferenced helper and error class from the toolbar bundle, two
  unused icons and two unused locale strings.
- **Capture scroll area** has its own icon instead of sharing the pointer icon.

## 1.7.6 — explicit internal scroll-area capture

- New **Capture scroll area** action for one vertically scrollable element
  (`overflow-y: auto | scroll | overlay`, content taller than the box).
- Only the selected region's **serialized capture model** is expanded to its
  full scroll height; descendants are rebased when the region is already
  scrolled, and the captured width stays at the current responsive width.
- The live page is not scrolled, resized or navigated; no new tab or window.
- Fixture: 813px viewport, 2,518px scroller — document capture stays 813px, the
  explicit action produces a 2,518px root at scrollTop 0 and 560.

## 1.7.5 — lazy-image completeness and asset reporting

- A loaded 1×1 **HTTP** image is treated as a placeholder when the page also
  supplies an explicit lazy target; a genuinely loaded image still wins.
- Recognises more lazy metadata (`data-actualsrc`, `data-lazy`, `data-url`,
  `data-image-src`, `data-hi-res-src`, `data-echo`, `data-flickity-lazyload`,
  `data-cfsrc`) and more lazy `srcset` variants, including active `<picture>`
  sources. Candidate URLs still pass the URL/privacy checks.
- The success notice reports aggregate image assets **included** versus **not
  embedded** — counts only, no URLs, page text or raw errors.

## 1.7.4 — privacy, copy feedback, cancellation and size limits

- Hidden/non-rendered inputs, textareas and selects are omitted; password values
  and non-visual control value IDs are excluded while visible labels and states
  remain. Older saved captures are sanitized on load and before rich copying.
- Honest copy feedback: a blocked write says the capture is saved and points to
  **Copy all**; encoding/size failures use privacy-safe messages.
- Cancellation reaches image/SVG downloads, detached conversion and asset
  recovery; owned temporary resources are released.
- All rich design batches use **48 MiB JSON / 64 MiB rich HTML** limits with
  bounded UTF-8 counting before expensive work. No silent truncation.

## 1.7.3 — full-page images and missing lower sections

- Full-page snapshots use the full document height even when
  `html { height: 100% }` makes the HTML rectangle viewport-sized; the viewport
  rectangle and child coordinates are preserved.
- Off-screen images resolve explicit lazy metadata, active picture sources and
  measured URL templates **inside the copy only**; no guessed endpoints.
- Failed assets recover in batches of at most 64 URLs.

## 1.7.2 — responsive captures without new tabs

- Removed the temporary-window capture path. Extra widths render the current DOM
  into a script-disabled, isolated frame at each selected width.
- Removed the `H2D_CAPTURE_VIEWPORT` worker RPC and its temporary-window code.
- Partial failures keep completed captures in the tray and name the failed width.

## 1.7.1 — Viewports opening off-screen

- The picker anchors to the rendered Viewports button (not the zero-height page
  host), flips above/below with 8px margins, and is cleaned up on close,
  Escape, outside click, other actions, disposal and reinjection.

## 1.7.0 — viewport presets

- Viewport presets and persisted selection. Responsive capture at this version
  used temporary windows; that approach was replaced in 1.7.2.
