# FAQ

### Does this upload my pages anywhere?

No. The extension has no server, account, analytics or Figma API call. Captures
go to `chrome.storage.local` and your clipboard. The only network requests are
`GET`s for images the page already references — see [PRIVACY.md](../PRIVACY.md).

### Is this the Figma plugin, an extension, or both?

It is a **Chrome extension**. It puts a dark toolbar on top of any page and
copies a Figma-compatible rich clipboard payload; you paste in Figma yourself.
There is no Figma login and no plugin install.

### What do I actually get on the clipboard?

A `text/html` payload containing the established `figma`/`figh2d` snapshot
format — one entry per capture, plus plain text. Pasting into Figma produces
editable frames, text, shapes and image fills, not a single screenshot.

### How do I get a wireframe?

Open **Viewports**, tick **Copy as wireframe**, pick **Low**, **Medium** or
**High**, then press **Capture design** as usual. It is a setting, not a separate
button — every checked width is rebuilt in the same copy, and the choice is
remembered until you uncheck it.

### How is the wireframe different from **Capture design**?

**Capture design** reproduces the page: colours, images, fonts and effects as
editable layers. With **Copy as wireframe** ticked, the same capture is rewritten
to keep only structure — measured boxes, text (or grey bars at Low), labelled
placeholders and a fixed grey palette. Uncheck it and copy again to get the real
page back; the stored capture is never modified.

### Why does the tray thumbnail show the real page?

Because that is what was captured. The wireframe is produced at copy time, so the
thumbnail (and the *Copy* button in the tray) reflect the stored capture. With the
option on, the tray copy is a wireframe too.

### Why are all the images boxes with a label?

Wireframes never load or embed assets. An `img`, a CSS background image, a
gradient, a `video`, a canvas, inline SVG artwork and a cross-origin frame all
become vector placeholders, labelled from `alt` or `aria-label` where there is
one. That keeps the copy fast and means the wireframe cannot make a request the
page did not.

### Why does my wireframe look empty?

If the content is drawn into a canvas or WebGL, or lives inside a cross-origin
frame, there is no box to rewrite. Uncheck **Copy as wireframe** and capture the
layers instead, or capture the section that does have a DOM.

### Which files do I load?

`extension/`. The manifest lives at `extension/manifest.json`, so **Load
unpacked** must point at that folder, not the repository root.

### The toolbar doesn't appear.

1. Did you approve the permissions? The options tab opens the first time; if you
   closed it, click the extension icon again.
2. Is the page a Chrome Web Store page or `chrome://` URL? Those cannot be
   captured.
3. Is it a `file://` page? Enable **Allow access to file URLs** on the extension
   card.
4. Already had the toolbar injected before reloading? Refresh the tab.

### Why does my capture miss the bottom of the page?

Pages with `html { height: 100% }` used to keep a viewport-height root; 1.7.3
made full-page captures use the document height. If content is inside a nested
scroller (a dashboard card with its own scrollbar), use **Capture scroll area**
and click anywhere inside it.

### The lower half of the page is empty.

That is usually a lazy-loaded section that never rendered because it was never
scrolled. Capture covers the DOM as it exists — it does not scroll, click
"Load more", or wait for infinite feeds.

### Responsive copies look like stretched desktops.

Media queries, container queries and viewport units are re-evaluated at the
target width, but **JavaScript-only** breakpoint rerenders are not replayed. If a
site builds its mobile layout in JS on resize, use **Browser** only.

### Why are some images missing from my paste?

The asset was not readable: it 404'd, needed cookies the extension deliberately
omits, was on a blocked host (anything `figma`, `sentry.io`), or pointed at a
private address. The success notice reports how many were **not embedded** rather
than pretending they were captured.

### Can I copy exactly two sizes?

Yes: check the two widths you want and **uncheck Browser**, so the browser width
is not also captured.

### Where do captures go if I close the tray?

The tray lives in `chrome.storage.local` per tab and is removed when that tab
closes. Copied content stays on your clipboard.

### Does it work in incognito or on embedded frames?

Incognito requires the separate "Allow in incognito" toggle. Captures run in the
top frame; `Capture code` is unavailable in embedded frames.

### Does it work in Firefox, Edge or Safari?

Only Chromium-based browsers with Manifest V3 service workers are tested
(Chrome 116+). Edge usually works; Firefox and Safari are untested.

### Is my password field captured?

No. Password values, hidden controls and non-visual control IDs are removed
(1.7.4+). Visible text, titles and image URLs are still captured — a capture is
as sensitive as the page it came from.

### Why is `Capture code` different?

It is intentionally raw: `document.documentElement.outerHTML` with no privacy
filtering, for people who want the actual markup. It is not cleaned or truncated.

### How do I verify the privacy claims myself?

Run `npm test` and read `tests/privacy.test.cjs`, or search the runtime:

```bash
grep -rnE "fetch\(|XMLHttpRequest|sendBeacon" extension/js
```

You will find exactly one `fetch`, in `background.js` `readImage()`, with `GET`,
`credentials: "omit"`, `redirect: "error"` and a blocked-host check in front of it.

### Why isn't it on the Chrome Web Store?

The repo is source-distributed today; nothing in the code prevents a store
build. If you package it yourself, the ZIP must contain `manifest.json` at its
root.
