# Paper HTML export

## Status

**Implemented in 1.10.0; real Paper paste compatibility is not yet verified.**
The export and clipboard-recovery paths have dependency-free tests, and the
real-MV3 browser fixture covers the generated payload. Neither unit tests nor a
Chromium clipboard read prove that Paper accepts or preserves the markup.

The current action uses `<x-paper-html>` as a **probe candidate**, not as a
proven requirement. Do not describe the action as verified Paper compatibility
until the four-case probe below and an actual paste in Paper are complete.

## Using the action

1. Capture a page, element, scroll area or responsive design as usual.
2. Choose **Copy for Paper** in the toolbar.
3. Paste into the destination only if you intend to share the captured content
   with that destination.

The action exports the **latest design snapshot** in the tab's tray. Code-layer
captures are not eligible. Automatic copy after capture, **Copy**, per-item
Figma copy, responsive copy and **Capture code** do not use this projection.
Figma remains the default action and Capture code remains raw `outerHTML`.
Wireframe remains a Figma-payload setting; this action projects the stored
design snapshot rather than applying a separate greyscale transform.

## Payload and boundaries

`js/html-export.js` is a standalone capture-model-to-HTML projector. It uses no
Chrome APIs, DOM HTML parser, network request or serialized `outerHTML` input.
It produces:

- `text/html`: ordinary elements with captured computed styles inlined;
- `text/plain`: visible text for destinations that do not accept rich HTML;
- embedded raster data for available image, canvas and video-frame assets;
- materialized `::before` / `::after` text and current visible form state.

The projector removes scripts, stylesheets, active embeds, event handlers,
`srcdoc`, dangerous URLs, motion declarations, hidden/password values and
pre-existing `x-paper-*` subtrees. It does not inject the capture model's
serialized SVG `content` strings. This is not a raster-to-vector or editable-SVG
feature.

Available embedded assets are preferred. A safe HTTP(S) image or CSS URL can
remain when the capture has no embedded bytes. The extension adds no Paper
network request, but Paper or another destination may fetch such a remaining
URL after the user pastes. Treat that as part of sharing the capture with the
destination.

Projection yields every 200 nodes, honors the existing capture-session
cancellation and enforces node/output limits. The write uses the existing
`PageCaptureClipboard` direct-first/offscreen recovery path; it does not create
a second clipboard implementation.

## Required four-case paste probe

Use one small normal-flow fixture and one small absolutely positioned fixture.
Each should contain identifiable text, contrasting inline colors, a border, and
an embedded raster image. Keep the fixtures free of accounts or private data.

For each case, project the same sanitized version-2 model with the shown wrapper
option, write the returned `html` and `text` through the existing clipboard
writer, and paste into a new Paper document. Record the actual Paper version
and browser version with the results.

| Case | Layout fixture | Projector option | Paper result |
|---|---|---|---|
| 1 | Normal flow | `{ wrapper: false }` | **Pending** |
| 2 | Normal flow | `{ wrapper: "x-paper-html" }` | **Pending** |
| 3 | Absolute positioning | `{ wrapper: false }` | **Pending** |
| 4 | Absolute positioning | `{ wrapper: "x-paper-html" }` | **Pending** |

For every case, record:

- whether paste is accepted, rejected, flattened or stripped;
- whether text, inline styles, image bytes and element order survive;
- whether absolute positions and dimensions survive;
- whether a custom wrapper is preserved, unwrapped or displayed as text;
- whether a second paste creates nested `x-paper-*` markup (it must not);
- whether any console error or unexpected network request appears.

A wrapper is required only if the wrapped cases succeed where the corresponding
plain cases fail. If both forms work, prefer the simpler form that preserves the
most layout. If neither works, keep the action marked unverified and change the
projection based on the observed result rather than guessing another wrapper.
Update this matrix and the release notes only after the actual Paper paste test.
