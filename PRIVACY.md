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

The service worker has exactly seven local message handlers
(`H2D_GET_TAB_ID`, `H2D_OPEN_TOOLBAR`, `H2D_CAPTURE_VISIBLE_TAB`,
`H2D_CAPTURE_ELEMENT_PREVIEW`, `H2D_FETCH_ASSETS`, `H2D_WRITE_CLIPBOARD`,
`H2D_TOOLBAR_CLOSED`). None of them sends data anywhere.

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
`document.documentElement.outerHTML` without the privacy filter. The explicit
Paper action re-sanitizes the saved model and independently blocks active HTML,
handlers, dangerous URLs and hidden/password values, but visible page content
and ordinary visible form values still leave the machine when you paste them.

## Clipboard

- Rich **Copy** / **Copy all** writes the existing Figma `text/html` payload.
  The separate **Copy for Paper** action writes only its own sanitized inline
  HTML plus `text/plain` for the latest snapshot. Neither action changes raw
  **Capture code**, and the extension never reads your clipboard.
- Direct writes run first. After a rejection, up to **32 MiB** of the exact same
  text/HTML can be forwarded inside the extension to a short-lived offscreen
  document. It accepts only a worker-originated write job, does not parse or
  persist the payload, and closes afterward. Larger content is never truncated.
- A native write that Chrome has already accepted cannot be revoked. Cancelling
  during preparation stops the write before it starts; the recovery path does
  not change that rule.
- Paper HTML prefers embedded capture assets but can retain a safe HTTP(S) image
  or CSS URL when no bytes were embedded. The extension makes no additional
  Paper request; the destination may resolve that URL after your paste.
- `clipboardWrite` is requested at runtime through the options page; if you deny
  it, automatic copy is skipped and the capture stays in the tray for manual
  **Copy all**.

## Permissions and why

| Permission | Why |
|---|---|
| `scripting` | inject the toolbar and capture script into the tab |
| `<all_urls>` host access | capture any page you open; also requested at runtime |
| `tabs` | identify the capture source tab and its preview |
| `storage`, `unlimitedStorage` | keep the local capture tray |
| `clipboardWrite` | write the design/HTML clipboard payload |
| `offscreen` | retry an explicitly requested write when the tab cannot complete it |

No `clipboardRead`, `pageCapture`, `downloads`, `webRequest`, or remote
`host_permissions`
beyond the page you are capturing.

## Local files

`file://` pages require the separate **Allow access to file URLs** toggle in
`chrome://extensions`. The extension detects this and opens a help page instead
of failing silently.

## Reporting a privacy problem

Open an issue using the bug template and describe the page (or a minimal
fixture) where you saw it. See [SECURITY.md](SECURITY.md) for anything that
should not be public.
