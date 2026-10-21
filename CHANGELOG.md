# Changelog

All notable changes are listed here. Versions follow `MAJOR.MINOR.PATCH`; the
manifest version in `extension/manifest.json`, `package.json` and the newest
entry below must always match (`npm run check` enforces it).

## 1.8.5 — a dead toolbar says why

### Fixed

- **A toolbar left by an earlier extension instance no longer shadows the new
  one.** Updating the extension (or clicking *Reload* on `chrome://extensions`)
  leaves the old toolbar element in every open tab. The freshly injected script
  saw that element, assumed the toolbar was already live, and returned — so the
  click appeared to do nothing while the stale UI answered with errors from an
  invalidated extension context. A host is now marked with a per-isolated-world
  flag; a host without that flag belongs to a dead instance and is replaced.
- **A dead context reports an action, not a bare stack.** Capture, copy and the
  viewport run all talk to the service worker. If the extension was reloaded
  under the page, `chrome.runtime.id` is gone and the old code rejected with
  `Extension context invalidated` whose only useful frame was
  `js/h2d_toolbar.js:1`. Those paths now stop first and show
  *"Reload the extension and refresh this page before capturing."* in the
  toolbar instead of throwing.

### Changed

- Two new checks pin the recovery contract: the stale host is dropped before the
  "already mounted" short circuit, and every service-worker call site guards the
  context. The toolbar hash baseline still hashes to the 1.8.4 value once these
  deliberate deltas are stripped, so nothing else in the shipped bundle moved.

## 1.8.4 — Scrims are lids, not slabs

### Fixed

- **Dark hover scrims no longer become grey slabs.** Dribbble-style cards paint a
  `rgba(13,13,13,0.8)` scrim over the shot on hover, and gradients over hero media.
  A content-free, edge-free box that covers a large part of a painted surface
  underneath it is now dropped at every level. A badge chip of the same shape
  (a fraction of the area) keeps its place, so `PRO` labels survive.
- **An image-backed section keeps its own surface.** A dark hero card that holds an
  image and real content used to be flattened to the generic placeholder grey; it
  keeps its own tone now (dark stays dark, white stays white) and keeps its
  children, including the media placeholder inside it.
- **The lid scan is linear.** The first cut of the scrim rule compared every child
  with every sibling: a page with 6,000 translucent cards took **150 s** and froze
  the tab. Candidates are indexed once per parent and capped, so the same page
  takes **213 ms** (a regression test holds it under 5 s).

### Changed

- `scripts/wireframe-preview.js` now mirrors the page the feature is tested
  against: nav, promo pill, hero with dark media card, tab row, search field, chip
  row, 12 shot cards with scrims/PRO badges/captions, category tiles and footer.

## 1.8.3 — The popover says which build it is

### Added

- **A build stamp in the popover.** The Wireframe section now ends with
  `Wireframe v1.8.3 · hook live` (or `hook missing`). A release ZIP whose files
  predate the transform can no longer look identical to a current one: it shows an
  older version, or no line at all.
- **A miss is reported, never dressed up as success.** If the option is ticked but
  the copy rebuilds nothing, the hint turns red and says *"The last copy was the
  real page, not a wireframe (0 of N records rebuilt)"*, with a console warning.
  A normal copy now also says how much it rebuilt: *"Last copy rebuilt 2 of 2"*.

### Changed

- `wireframe-core.js` exports `BUILD`, and a test fails if it drifts from
  `manifest.json` — the stamp cannot lie.

## 1.8.2 — Wireframe fidelity

### Fixed

- **Page colour no longer leaks into a wireframe.** Before, only a fixed list of
  properties was greyed, so `color`, `caretColor`, `columnRuleColor`,
  `accentColor` and similar keys could carry a brand hue (and a pink footer) into
  Figma. Every colour-bearing key is normalised now, and the output nodes are
  rebuilt from a whitelist instead of being patched in place.
- **Faint overlays stay light.** `rgba(0, 0, 0, 0.06)` is composited over the real
  backdrop, so a hover veil reads near-white instead of becoming a dark grey slab.
- **Sections keep their tonal order.** The ramp now spans dark tones, so a black
  quote band stays dark at High, a brand band reads mid grey and white cards stay
  light, instead of a black section and a grey card both landing on mid grey.
- **Text stays readable on dark sections.** Ink is judged against the surface the
  element itself paints, so labels on a dark band are not painted dark-on-dark.
- **Image cards are placeholders, not blanks.** A `div` that paints a
  background image is treated as media; its real children (badges, captions) are
  kept and the media label is skipped so the two cannot overlap.

- **Hidden content is no longer pasted.** A `display:none` menu, an `opacity:0`
  backdrop or a `visibility:hidden` screen-reader label used to arrive as a very
  real grey box with very real (hidden) text in it. Such subtrees are dropped and
  counted; `content-visibility:hidden` keeps its own box and drops only its
  contents.
- **The copy is repeatable.** Rebuilding an already-built wireframe used to drift,
  because our own grey was re-quantised (`#a8a8a8` → `#d2d2d2`). Tones that are
  already ours are now final, so copying the same capture twice gives the same
  payload.
- **Absurd geometry and text are bounded.** A 1e9px rect is clamped instead of
  pasted off-canvas, a node with no usable geometry is dropped, ids are capped at
  48 characters and one enormous text run cannot bloat the payload past a paste.
- **Font names only, never font files.** The capture's `fonts` map can carry a
  `url`; a wireframe now keeps the family/style/weight names at High and never an
  `http(s)`, `data:` or `url()` value.
- **The capture is never edited.** The transform returns a fresh document and
  leaves the capture you were given alone, so unchecking the option still gives
  the real page.
- **Gradients carried by the `background` shorthand** are recognised as surfaces
  instead of disappearing.
- **A hairline on a dark band is lightened** so it reads; a pale hairline on a
  light page is left as the page had it.
- **The option reports its own state.** If the capture pipeline is missing (a
  partial or older build) the checkbox says *Unavailable* instead of silently
  copying the real page, the section re-attaches when the popover is rebuilt, a
  choice made while storage is loading is no longer overwritten by the saved one,
  and a copy that stopped at the layer limit says so in the popover hint.
- **A fallback record is honest.** When one record cannot be rebuilt it is copied
  as the real page — and the success message no longer claims zero embedded
  images for that copy.

### Added

- `scripts/wireframe-preview.js` and `scripts/preview-raster.py` render a
  synthetic Dribbble-shaped page through the real transform for visual review
  (developer tools only; not shipped in the extension).

## 1.8.1 — Wireframe becomes a capture setting

### Changed

- **Wireframe no longer has its own panel or copy button.** It is an option in the
  existing **Viewports** popover, exactly like a width preset: tick
  **Copy as wireframe**, choose **Low / Medium / High**, then press the normal
  **Capture design** button. Every checked width is rebuilt in the same copy.
- The rebuild runs on the captured snapshot immediately before it is encoded, so
  the capture engine, responsive pipeline, redaction, size budgets and clipboard
  write are all reused unchanged — nothing about the copy path is duplicated.
- `extension/js/h2d_toolbar.js` and `extension/js/design-system.js` are back to
  their 1.7.9 contents; the toolbar hash test proves the bundle is byte-identical.
  Integration is now two readable files: `wireframe-core.js` (the transform) and
  `wireframe.js` (the popover option, persistence and the clipboard hook).

### Removed

- The separate toolbar button, modal panel, **More tools** entry and the
  self-scanning demo page from 1.8.0.

### Fixed

- Near-white page surfaces keep the lightest grey instead of disappearing, so
  light headers and cards still read as structure.

## 1.8.0 — Wireframe (first attempt)

> Superseded by 1.8.1, which moves the feature into the Viewports popover. Kept
> for history: this release shipped a separate panel and copy button.

### Added

- **Wireframe**: a third copy mode next to design layers and code. It rebuilds
  the page you are looking at as editable, greyscale layers — measured boxes,
  real text or text bars, and labelled placeholders — then copies it through the
  existing rich clipboard path, so a paste into Figma Design stays editable.
- **Three fidelity levels**, chosen in a live preview panel: **Low · Skeleton**
  (outlined boxes and text bars), **Medium · Structure** (real text in a neutral
  typeface, labelled placeholders, capped radii) and **High · Detail** (observed
  type hierarchy, radii, border weights and greyscaled shadows).
- **Scope switch**: full page or the visible area, plus **Rescan** when the page
  changes underneath the panel.
- New files `js/wireframe-core.js` (pure planning: tone mapping, text bars,
  placeholder rules, limits) and `js/wireframe.js` (scan, render, preview panel,
  copy). Both are plain readable files, injected before `h2d_toolbar.js`;
  `js/design-system.js` adds the **Copy as wireframe** entry to **More tools**.
- `tests/wireframe.test.cjs`: 29 checks covering levels, colour parsing, tone
  mapping, tree geometry, clipping, bars, placeholders, rendering, the clipboard
  payload, cancellation, panel lifecycle and the injection order.

### Notes

- No new permissions, no new network code. Wireframes contain no images, no
  page CSS and no form values; images, canvas, video and cross-origin frames
  become vector placeholders.
- The existing toolbar, capture engine, design-system board and viewports are
  untouched apart from one attach hook in `h2d_toolbar.js` and one menu entry.

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
