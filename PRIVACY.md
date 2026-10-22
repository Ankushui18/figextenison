# Privacy

**In one line:** the extension captures pages on your machine and writes them to
your clipboard or its own local storage. There is no account, no server, no
telemetry and no upload path.

This page describes what the code actually does. The long-form audit, including
per-release verification counts, is in
[docs/PRIVACY-AUDIT.md](docs/PRIVACY-AUDIT.md).

## What leaves your machine

Nothing, unless you paste it somewhere. There is no analytics client, no crash
reporting, no remote logging and no Figma API call in the runtime.

The service worker has exactly six local message handlers
(`H2D_GET_TAB_ID`, `H2D_OPEN_TOOLBAR`, `H2D_CAPTURE_VISIBLE_TAB`,
`H2D_CAPTURE_ELEMENT_PREVIEW`, `H2D_FETCH_ASSETS`, `H2D_TOOLBAR_CLOSED`). None of
them sends data anywhere.

## The one kind of network request

Capture reads images and SVG assets that the page **already references**, using
plain `GET` requests, so they can be embedded in the copy:

| Rule | Value |
|---|---|
| Method | `GET` only |
| Credentials | `omit` |
| Referrer | `no-referrer` |
| Redirects | rejected (`redirect: "error"`) |
| Request body | none |
| Per-asset size limit | 10 MiB, `image/*` response types only |
| Batch size | 64 URLs per request, 4 in flight, 5s timeout |
| Blocked hosts | anything matching `figma`, plus `figmausercontent.com` and `sentry.io` |
| Blocked targets | `localhost`, `.local`, `.internal`, `.home.arpa`, private and link-local IP ranges |

The extension CSP is `default-src 'self'; connect-src 'self'` — a restrictive
policy that is deliberately **not** relaxed. A website's own scripts and
requests are not intercepted or modified.

Independent of assets, a site's own tracking behaves exactly as it would without
the extension installed.

## What is stored, and where

All storage is `chrome.storage.local` (plus `chrome.storage.session` for one
pending permission hand-off). Nothing is synced to a Google account.

| Key | Contents | Lifetime |
|---|---|---|
| `figma_h2d_toolbar_captures_<tabId>` | the capture tray for that tab | removed when the tab closes |
| `figma_h2d_toolbar_open_<tabId>` | whether the toolbar was open | removed when the tab closes |
| `figma_h2d_toolbar_request_<id>` | one pending capture request (tab id + optional command) | removed when resumed or abandoned |
| `figma_h2d_toolbar_dock_position` | `top` or `bottom` | persists |
| `pc_viewports_v1` | viewport presets and which are checked | persists |

Captures are never written to disk as files unless you explicitly download one
from the Design System panel.

## What a capture can contain

A design capture includes visible text, layout, styles, image URLs and asset
bytes, and form values that are visible on screen. Treat a capture as being as
sensitive as the page it came from.

Deliberate exclusions (1.7.4+):

- hidden or non-rendered `input`, `textarea` and `select` nodes;
- password field values;
- non-visual control value IDs (`button`, `option`, `checkbox`, `radio`, `file`,
  `image`).

Visible labels, checked/selected state and ordinary visible values are kept —
they are part of the design.

**This is not general PII redaction.** Visible text, page titles, links and image
URLs are copied as-is. **Capture code** is intentionally raw: it copies
`document.documentElement.outerHTML` without the privacy filter.

## Clipboard

- Rich **Copy** / **Copy all** writes one `text/html` clipboard payload. The
  extension never reads your clipboard.
- A native write that Chrome has already accepted cannot be revoked. Cancelling
  during preparation stops the write before it starts.
- `clipboardWrite` is requested at runtime through the options page; if you deny
  it, automatic copy is skipped and the capture stays in the tray for manual
  **Copy all**.
- Reading the clipboard is **optional and separate** (`clipboardRead`). It serves
  the *Import a Figma copy* page and, on this experimental branch only, the
  **Canvas capture** switch on figma.com: when that switch is on, each clipboard
  write the extension is about to make first reads the clipboard once to check
  whether it holds a Figma scene, and if it does, that scene is what gets written
  back (so the paste stays editable). Off the switch, or on any other host, the
  clipboard is never read. Nothing from it is stored or sent anywhere. Nothing is read when
  a page loads, when the toolbar opens, or when a capture runs. On click, the
  clipboard's `text/html` is read once, and it is kept only if it contains Figma's
  `(figma)` marker with a valid container; anything else is discarded without
  being stored. Kept payloads live in `chrome.storage.local` and can be deleted
  from the same page. The experimental **Canvas capture** switch in the toolbar
  never reads the clipboard at all: it only changes how a canvas is rasterized.

## Permissions and why

| Permission | Why |
|---|---|
| `scripting` | inject the toolbar and capture script into the tab |
| `<all_urls>` host access | capture any page you open; also requested at runtime |
| `tabs` | identify the capture source tab and its preview |
| `storage`, `unlimitedStorage` | keep the local capture tray |
| `clipboardWrite` | write the design/HTML clipboard payload |
| `clipboardRead` (**optional**) | read one Figma copy, only when *Import a Figma copy* is pressed |

No `pageCapture`, no `downloads`, no `webRequest`, no remote `host_permissions`
beyond the page you are capturing.

## Local files

`file://` pages require the separate **Allow access to file URLs** toggle in
`chrome://extensions`. The extension detects this and opens a help page instead
of failing silently.

## Reporting a privacy problem

Open an issue using the bug template and describe the page (or a minimal
fixture) where you saw it. See [SECURITY.md](SECURITY.md) for anything that
should not be public.
