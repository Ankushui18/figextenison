# Architecture

Two questions this document answers: **where does a change go**, and **what
happens when you click a capture button**. Read it before touching
`h2d_toolbar.js`, which is the large, already-minified file.

There is no build step. Every file below is shipped exactly as it is.

## Layers

```
chrome://extensions  →  extension/  (manifest.json, service worker, assets)
      │
      ├── service worker   js/background.js   + js/core.js + js/privacy.js
      │        │  chrome.scripting.executeScript  (7 files, in order)
      │        ▼
      └── isolated world in the page (the toolbar and all capture code)
               js/privacy.js → js/capture-safety.js → js/design-system-core.js
               → js/design-system-board.js → js/design-system.js
               → js/viewports.js → js/wireframe-core.js → js/wireframe.js
               → js/embedded-frames.js → js/h2d_toolbar.js
```

The **options page** (`options.html` + `js/core.js` + `js/options.js`) is a
separate extension page; it only asks for permissions and hands a pending
capture back to the worker.

## Files

| File | Role | Size class |
|---|---|---|
| `js/background.js` | service worker: 6 message handlers, toolbar injection, tab previews, asset recovery | small, readable |
| `js/core.js` | shared constants (permission set, storage keys, options URL builder) | small, readable |
| `js/privacy.js` | asset-URL policy: blocked hosts, private ranges, `data:`/`blob:` handling | small, readable |
| `js/capture-safety.js` | redaction, cancellation, size budgets, clipboard preparation, saved-record migration | medium, readable |
| `js/viewports.js` | responsive copy rendering, lazy-image resolution, asset batching, full-page and scroll-area expansion | medium, readable |
| `js/design-system-core.js` | pure token extraction/review/merge logic (no DOM, no network) | medium, readable |
| `js/design-system-board.js` | builds the editable board and the `text/html` clipboard payload | medium, readable |
| `js/design-system.js` | the Design System panel UI, and the **More tools** menu | medium, readable |
| `js/wireframe-core.js` | pure wireframe transform: levels, grey ramps, text bars, placeholders, the capture-model walk | medium, readable |
| `js/wireframe.js` | the **Wireframe** option inside the Viewports popover, its saved choice, and the clipboard hook that applies the transform | small, readable |
| `js/embedded-frames.js` | rebuilds same-origin iframe content into the capture, and leaves frames the browser keeps private alone | small, readable |
| `js/h2d_toolbar.js` | **everything else in the page**: toolbar chrome, capture engine, serializer, picker, viewports popover, clipboard write | large, minified |
| `js/options.js` | options/permission page controller | small, readable |
| `options.html`, `img/*`, `font/*`, `_locales/en/messages.json`, `icon*.png` | UI assets and strings | — |

If you only need to change a toast message or a limit, it is probably in
`capture-safety.js` or `viewports.js`, not in the minified bundle.

The Design System panel is a plug-in: the toolbar calls
`attach(controller, helpers)` once, the panel mounts its own host element in a
closed shadow root, adds a menu entry, and cleans up on
`controller.lifecycleAbort`.

The embedded-frames module is the same kind of plug-in as the wireframe hook: it
decorates two globals the engine already reads, and `h2d_toolbar.js` is
unchanged. It wraps `PageCaptureDesignBoard.createCopier` to borrow the engine's
own `capture`/`serialize` (handed over on every toolbar mount), then wraps
`PageCaptureSafety.prepareClipboard` to rebuild same-origin frames through
`PageCaptureViewports.createCapturer` before the clipboard is written. It
installs *after* the wireframe hook, so a wireframe copy receives the rebuilt
frame content and then transforms it. Frames the page cannot read - cross-origin,
sandboxed without same-origin, or `blob:` documents with an opaque origin, which
is what a saved page opened from `file://` produces - are left exactly as the
engine serialized them.

The wireframe module needs none of that. It is a **capture setting**, so it only
touches two seams that already exist: the Viewports popover (decorated when it
opens) and `PageCaptureSafety.prepareClipboard` (wrapped once, at injection).
`h2d_toolbar.js` and `design-system.js` are unchanged, which the toolbar hash
test verifies byte for byte.

## Message protocol

The toolbar talks to the worker through `chrome.runtime.sendMessage` with
`{ cmd, payload }` and reads `{ success, value | error }` back. The allowlist is
frozen in `background.js`:

| `cmd` | Sender requirement | Purpose |
|---|---|---|
| `H2D_GET_TAB_ID` | any extension context | which tab am I in |
| `H2D_OPEN_TOOLBAR` | options page, with a pending `request_id` | resume a capture after permissions are granted |
| `H2D_CAPTURE_VISIBLE_TAB` | tab frame 0 | PNG preview of the visible tab |
| `H2D_CAPTURE_ELEMENT_PREVIEW` | tab frame 0 | cropped preview for a selected element's rect |
| `H2D_FETCH_ASSETS` | tab frame 0 | batched `GET` recovery for page images (supports `requestId` + `cancel`) |
| `H2D_TOOLBAR_CLOSED` | tab frame 0 | clear the tab's "toolbar open" flag |

Unknown commands get a generic failure and are never dispatched. Asset jobs are
keyed by `tabId:frameId`, so one tab cannot cancel another's work.

Downward, the worker sends `{ type: "FIGMA_H2D_TOOLBAR_COMMAND", command }`
(`capture_code`, `capture_page`, `select_element`) to run a keyboard-shortcut
command after injection.

## Capture pipeline

1. **Trigger.** Toolbar button, keyboard command, or `chrome.action` click.
2. **Inject.** `background.js` checks the URL and permissions, injects the seven
   files in the order above, and sets the tab's "open" flag.
3. **Build the model.** `h2d_toolbar.js` walks the DOM in a `requestAnimationFrame`
   (so layout is settled), producing a version-2 snapshot: nodes with
   `rect`, `styles`, `computedStyles`, `attributes`, text, pseudo-elements,
   canvas/video placeholders, and a per-document `assets` map.
4. **Reference images.** `viewports.js` resolves the real image source: loaded
   source first, then explicit lazy metadata, then active `<picture>` sources.
   Nothing is guessed and the live DOM is not edited.
5. **Shape the root.** Full-page captures call `expandFullPage`; the explicit
   scroll-area action calls `expandScrollArea` first. Both operate on the
   **serialized model only**.
6. **Serialize.** Unresolved assets are encoded to base64, then still-missing
   public assets are recovered in batches of 64 through `H2D_FETCH_ASSETS`.
7. **Sanitize and bound.** `capture-safety.js` sanitizes the snapshot, then
   counts UTF-8 bytes against the 48 MiB / 64 MiB budgets before encoding.
8. **Store.** The snapshot is pushed into the tab's tray in
   `chrome.storage.local`.
9. **Copy.** On copy, the tray is turned into one `text/html` payload and written
   with `navigator.clipboard.write`. The success notice adds the image
   included/not-embedded counts.

## Cancellation

One `AbortController` per capture session (`captureSession` in the toolbar).
Its signal is threaded through image decoding, detached conversion, asset
recovery (`requestId` + `cancel`), clipboard preparation and serialization.
Cancelling releases owned resources; a cancelled job cannot produce feedback for
a newer one. **A native clipboard write already submitted to Chrome cannot be
revoked** — the UI disables Cancel for that final phase.

## Responsive copies

Extra widths never open a tab, reload a URL or resize the page. The current DOM
is cloned into a script-disabled frame inside the extension's ignored toolbar
root, styles are re-read at the target width (including open shadow roots,
adopted stylesheets and readable CSSOM), and the same serializer runs per width.

When this is not enough, it says so: JavaScript-only breakpoint rerenders are not
replayed. See "Known limits" in the README.

## Wireframe

Wireframe is a **capture setting**, not a second capture path. Its whole job is to
rewrite a finished capture just before it is encoded:

```
Capture design ─► engine builds the snapshot(s) ─► PageCaptureSafety.prepareClipboard
                                                     │  (wireframe.js wraps this)
                                                     ├─ setting off → records unchanged
                                                     └─ setting on  → wireframe-core.js rewrites each h2dJson
                                                   ─► encode ─► clipboard.write
```

- **Why there.** `prepareClipboard` is the one funnel used by *Capture design*,
  per-item copy and *Copy all*. Wrapping it means the wireframe inherits the
  existing responsive pipeline (one record per checked width), redaction, size
  budgets, cancellation and the clipboard write — and it is reversible, because
  the stored record is never mutated.
- **What the transform does** (`wireframe-core.js`, pure). It walks the
  version-2 snapshot model and rewrites only presentation: colours become a fixed
  grey ramp, radii/borders/shadows are clamped or re-coloured, typography switches
  to a neutral face (except at High), text becomes bars (Low) and images, video,
  canvas, SVG artwork and embeds collapse to labelled vector placeholders. It also
  empties `assets` and strips URL attributes, so nothing can be embedded or
  fetched. Geometry, ids, ordering and `documentRect` are untouched.
- **Why not re-measure.** Measuring the live DOM again would need its own picker,
  its own scroll handling and its own responsive copies — a second capture engine.
  Rewriting the finished capture keeps one source of truth for layout.
- **The option** (`wireframe.js`). The Viewports popover is rebuilt on every open,
  so the module watches for `#__pc_viewports__` and appends a group to its open
  shadow root: a checkbox, three level buttons and a one-line hint. The choice is
  saved in `chrome.storage.local` under `pc_wireframe_v1`.
- **Safe failure.** A record that is not a version-2 snapshot, or does not parse,
  is copied unchanged; a wireframe never turns a working copy into an error.
- **Purity and repeatability.** The transform builds a new document and never edits
  the capture it was given. Tones that are already wireframe tones are final, so a
  second pass over the output is byte-identical to the first.
- **What is not copied.** `display:none` / `opacity:0` / `visibility:hidden`
  subtrees are dropped (`stats.hidden`), zero-area wrappers are flattened into
  their children (`stats.flattened`), ids are capped at 48 characters, text at
  2,000 characters with control characters and lone surrogates removed, and
  coordinates are clamped to ±1,000,000px / 200,000px per side.
- **Fonts by name.** At High the family/style/weight names survive so the type
  stack still reads; a face `url`, `http(s):` or `data:` value never does.

## Where to change things## Where to change things

| I want to change… | Go to |
|---|---|
| a toolbar button, icon or shortcut | `js/h2d_toolbar.js` (`actions` array) |
| a user-facing string | `_locales/en/messages.json` (all 48 keys are used; keep it that way) |
| capture limits or a size budget | `js/viewports.js` (`LIMITS`), `js/capture-safety.js` |
| redaction of form values | `js/capture-safety.js` |
| which asset hosts are refused | `js/privacy.js` |
| a new message handler | `handlers` in `js/background.js` **and** a test in `tests/privacy.test.cjs` |
| what a capture contains | the walker in `js/h2d_toolbar.js` + a fixture test |
| the permission/options flow | `js/core.js`, `js/options.js`, `background.js` |

## Invariants worth not breaking

1. `extension/` contains only files Chrome loads.
2. No new permissions, hosts or CSP exceptions without a privacy review.
3. No upload path, ever.
4. Only a user action writes the clipboard.
5. Old saved captures keep loading (migration is tested).
6. Limits fail loudly instead of silently truncating.
