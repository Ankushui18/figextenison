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
      │        │  chrome.scripting.executeScript  (13 files, in order)
      │        ▼
      └── isolated world in the page (the toolbar and all capture code)
               js/privacy.js → js/capture-safety.js → js/clipboard.js
               → js/design-system-core.js → js/design-system-board.js
               → js/design-system.js → js/viewports.js → js/wireframe-core.js
               → js/wireframe.js → js/capture-stability.js → js/html-export.js
               → js/picker-navigation.js → js/h2d_toolbar.js

A failed direct clipboard write can additionally use the worker's short-lived
`offscreen.html` + `js/offscreen.js` document. That path is local and write-only.
```

The **options page** (`options.html` + `js/core.js` + `js/options.js`) is a
separate extension page; it only asks for permissions and hands a pending
capture back to the worker.

## Files

| File | Role | Size class |
|---|---|---|
| `js/background.js` | service worker: 7 message handlers, toolbar injection, tab previews, asset recovery, offscreen ownership | small, readable |
| `js/core.js` | shared constants (permission set, storage keys, options URL builder) | small, readable |
| `js/privacy.js` | asset-URL policy: blocked hosts, private ranges, `data:`/`blob:` handling | small, readable |
| `js/capture-safety.js` | redaction, cancellation, size budgets, clipboard preparation, saved-record migration | medium, readable |
| `js/clipboard.js` | direct rich/text writes, bounded conversion to a local offscreen retry | small, readable |
| `js/capture-stability.js` | running-animation freeze and idempotent restoration across document/open shadow roots | small, readable |
| `js/html-export.js` | pure, sanitized capture-model → inline HTML/plain-text projection, independent of Chrome APIs | medium, readable |
| `offscreen.html` + `js/offscreen.js` | short-lived worker-only clipboard document, asynchronous write then copy-event fallback | small, readable |
| `js/picker-navigation.js` | parent / child-or-sibling traversal across open composed-DOM boundaries | small, readable |
| `js/viewports.js` | responsive copy rendering, lazy-image resolution, asset batching, full-page and scroll-area expansion | medium, readable |
| `js/design-system-core.js` | pure token extraction/review/merge logic (no DOM, no network) | medium, readable |
| `js/design-system-board.js` | builds the editable board and the `text/html` clipboard payload | medium, readable |
| `js/design-system.js` | the Design System panel UI, and the **More tools** menu | medium, readable |
| `js/wireframe-core.js` | pure wireframe transform: levels, grey ramps, text bars, placeholders, the capture-model walk | medium, readable |
| `js/wireframe.js` | the **Wireframe** option inside the Viewports popover, its saved choice, and the clipboard hook that applies the transform | small, readable |
| `js/h2d_toolbar.js` | **everything else in the page**: toolbar chrome, capture engine, serializer, picker, viewports popover, clipboard write | large, minified |
| `js/options.js` | options/permission page controller | small, readable |
| `options.html`, `img/*`, `font/*`, `_locales/en/messages.json`, `icon*.png` | UI assets and strings | — |

If you only need to change a toast message or a limit, it is probably in
`capture-safety.js` or `viewports.js`, not in the minified bundle.

The Design System panel is a plug-in: the toolbar calls
`attach(controller, helpers)` once, the panel mounts its own host element in a
closed shadow root, adds a menu entry, and cleans up on
`controller.lifecycleAbort`.

The wireframe module needs none of that. It is a **capture setting**, so it only
touches two seams that already exist: the Viewports popover (decorated when it
opens) and `PageCaptureSafety.prepareClipboard` (wrapped once, at injection).
The wireframe integration needs no additional edits in `h2d_toolbar.js` or
`design-system.js`; the toolbar hash test still guards unrelated byte drift.

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
| `H2D_WRITE_CLIPBOARD` | tab frame 0 | bounded, user-initiated rich/text retry through the offscreen writer |
| `H2D_TOOLBAR_CLOSED` | tab frame 0 | clear the tab's "toolbar open" flag |

Unknown commands get a generic failure and are never dispatched. Asset jobs are
keyed by `tabId:frameId`, so one tab cannot cancel another's work.

Downward, the worker sends `{ type: "FIGMA_H2D_TOOLBAR_COMMAND", command }`
(`capture_code`, `capture_page`, `select_element`) to run a keyboard-shortcut
command after injection.

`H2D_OFFSCREEN_WRITE` is a separate internal message, not a public RPC. The
offscreen document accepts it only from `js/background.js`; the worker's own
listener deliberately leaves that channel unanswered so the document can reply.

## Capture pipeline

1. **Trigger.** Toolbar button, keyboard command, or `chrome.action` click.
2. **Inject.** `background.js` checks the URL and permissions, injects the thirteen
   files in the order above, and sets the tab's "open" flag.
3. **Stabilize and build the model.** `capture-stability.js` pauses only running
   animations at their current frame. `h2d_toolbar.js` then walks the DOM in a
   `requestAnimationFrame` (so layout is settled), producing a version-2 snapshot:
   nodes with `rect`, `styles`, `computedStyles`, `attributes`, text,
   pseudo-elements, canvas/video placeholders, and a per-document `assets` map.
   The one existing walk yields every 200 visited nodes and reports its real
   layout phase/visited count. An outer `finally` restores animations on every
   success, cancellation, timeout or error; no dry run or second serialization
   is performed.
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
9. **Copy for Figma (default).** Automatic copy, Copy all and per-item design copy
   turn the tray into the original `figmeta`/`figh2d` `text/html` payload and
   write it with `navigator.clipboard.write`. A rejection can retry the identical
   payload (up to 32 MiB) through the local offscreen writer; nothing is
   truncated. The success notice adds the image included/not-embedded counts.
10. **Copy for Paper (explicit alternative).** Only the latest snapshot is parsed,
    sanitized again and passed to `html-export.js`. That pure projector returns a
    separate inline-HTML fragment and plain text; it never calls the Figma
    `prepareClipboard` branch or reads raw `outerHTML`. The same capture session,
    cancellation, direct/offscreen writer and failure cleanup then write the two
    representations. Actual Paper acceptance and the wrapper requirement remain
    destination-verification steps, not assumptions in the serializer. See
    [Paper export](PAPER-EXPORT.md) for the security boundaries and probe matrix.

## Cancellation

One `AbortController` per capture session (`captureSession` in the toolbar).
Its signal is threaded through image decoding, detached conversion, asset
recovery (`requestId` + `cancel`), clipboard preparation and serialization.
Cancelling releases owned resources; a cancelled job cannot produce feedback for
a newer one. Animation restoration is owned by the serializer's `finally`, and
both DOM traversal and HTML projection check cancellation at cooperative yield
points. **A native clipboard write already submitted to Chrome cannot be
revoked** — the UI disables Cancel for that final phase.

## Clipboard recovery

`PageCaptureClipboard.write` / `writeText` always try the source tab first. Only
a rejection starts recovery. Rich items are read back from their already-created
`Blob` (never from the system clipboard), bounded to 32 MiB, and sent to the
worker. Raw text follows the same bound. If the item is too large or not HTML,
the original browser error is preserved.

The worker validates the top-frame sender and payload, serializes offscreen
writes, and closes the document in `finally`. The offscreen document validates
the worker URL again, tries the asynchronous API, then uses a temporary textarea
plus a `copy` event to set `text/html` and `text/plain`. Captured markup is never
assigned to `innerHTML`, executed, stored, or included in an error response.
Closing the document cannot undo a write Chrome already accepted.

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
| clipboard recovery or its byte limit | `js/clipboard.js`, `js/offscreen.js`, `js/background.js` + `tests/clipboard.test.cjs` |
| picker keyboard traversal | `js/picker-navigation.js` + its focused unit/browser fixtures |
| what a capture contains | the walker in `js/h2d_toolbar.js` + a fixture test |
| the permission/options flow | `js/core.js`, `js/options.js`, `background.js` |

## Invariants worth not breaking

1. `extension/` contains only files Chrome loads.
2. No new permissions, hosts or CSP exceptions without a privacy review.
3. No upload path, ever.
4. Only a user action writes the clipboard.
5. Old saved captures keep loading (migration is tested).
6. Limits fail loudly instead of silently truncating.
