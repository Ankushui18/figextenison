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
               → js/viewports.js → js/h2d_toolbar.js
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
| `js/design-system.js` | the Design System panel UI | medium, readable |
| `js/h2d_toolbar.js` | **everything else in the page**: toolbar chrome, capture engine, serializer, picker, viewports popover, clipboard write | large, minified |
| `js/options.js` | options/permission page controller | small, readable |
| `options.html`, `img/*`, `font/*`, `_locales/en/messages.json`, `icon*.png` | UI assets and strings | — |

If you only need to change a toast message or a limit, it is probably in
`capture-safety.js` or `viewports.js`, not in the minified bundle.

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

## Where to change things

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
