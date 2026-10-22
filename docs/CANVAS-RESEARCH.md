# Capturing canvas content as layers — research and decision

**Question.** Today the extension can copy any *HTML* page into Figma as editable
layers, but a canvas region (Figma's own editor, charts, maps, 3D viewers) arrives as
a single image. Can we make the extension capture that content as layers too — and
does that need a second extension?

**Short answer.** Not by reading the canvas: a canvas has no layers to read, from any
angle, in any tool. It *is* possible to capture a design that lives on a canvas as
real layers — but only by taking **Figma's own clipboard payload** instead of the
pixels, or by asking **a companion Figma plugin**. Those are two different products
and they have very different costs. This document compares all five routes that exist,
with the evidence and a recommendation.

Status: research finished 2026-10-23. **Route A (phase 1) and route D are now
implemented**: `figma-import.html` + `js/figma-clip.js` keep Figma's own copy, and
`js/canvas-capture.js` makes the raster honest. Phases 2–4 below are still open.

---

## 1. Why the canvas is opaque

| Claim | Evidence |
|---|---|
| Figma's editor paints the design into a WebGL canvas | Figma's own engineering write-up: browsers give no low-level access to the render tree, so they built a custom renderer on top of canvas/WebGL — [figma.com/blog](https://www.figma.com/blog/building-a-professional-design-tool-on-the-web/) |
| Figma's clipboard format is `text/html` with binary data inside an HTML comment | Same write-up: "our Figma clipboard 'format' is text/html with binary data encoded in an HTML comment"; the markup is two spans with `data-metadata` / `data-buffer` attributes — [alexharri.com](https://alexharri.com/blog/clipboard) |
| The DOM-description channel (`figh2d`) is fed by *walking elements*; a canvas is one element | `h2d_toolbar.js` in this repo: `t instanceof HTMLCanvasElement ? M = o.addCanvas(t)` → `placeholderUrl = "rasterized:1"`. The published format notes say the same of the official extension: nodes carry "tags, computed styles, boxes" — [snapdom `emit/h2d.js`](https://github.com/zumerlab/snapdom/blob/main/packages/plugins/vector/src/emit/h2d.js) |
| Even Figma's own feature admits the limit | "Complex scroll-driven or canvas-rendered sites may capture imperfectly… try element capture on the specific section" — [Figma Help](https://help.figma.com/hc/en-us/articles/40826832449303-Turn-coded-screens-into-editable-design-layers) |
| Reading pixels back does not help | `toDataURL`/`toBlob` on a WebGL canvas without `preserveDrawingBuffer` returns an empty (transparent/black) frame; and even a perfect bitmap is one layer, not a tree |

So "capture the canvas as layers" is not a harder version of what we already do. It is
a different data source. There are exactly five data sources:

**A** the clipboard payload Figma writes when you copy, **B** a Figma plugin running
inside the file, **C** the `.fig` file on disk, **D** the pixels, **E** the engine's
internal scene graph.

---

## 2. Route A — read Figma's own copy payload (extension only, no plugin)

**Idea.** The user selects layers in Figma and presses `Ctrl/Cmd + C`, exactly as they
do today. Figma writes its real scene into the clipboard as `text/html`. The
extension reads that HTML (instead of the DOM), keeps it in the capture tray, and can
re-emit it later — so "capture the canvas" becomes "take Figma's own copy".

**Why it is attractive.** The payload *is* the design: frames, text, vectors, images,
components, instances, auto-layout, effects and variables survive because nothing is
re-serialized by us. There is no fidelity loss to design for, and no format to
invent. It also needs **no new library and no build step** for the core version:
storing and re-writing the HTML string is string work.

**Does it work?** The pieces are all verified:

- Reading rich clipboard data from an extension needs the `clipboardRead` permission
  and a focused document; extension pages can read without a per-use prompt —
  [MDN](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Interact_with_the_clipboard),
  [Chrome permissions](https://developer.chrome.com/docs/extensions/reference/permissions-list).
- Chrome sanitizes `text/html` on read and can strip the comment markers, but
  `navigator.clipboard.read({ formats: { "text/html": { unsanitized: true } } })`
  opts out — [MDN `Clipboard.read()`](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/read).
  Figma also keeps its marker inside an attribute value, which survives sanitization.
- Writing it back is the same `navigator.clipboard.write` path this repo already
  uses, and `clipboardWrite` is already requested.

**Costs and risks.**

- `clipboardRead` is a strong permission ("Read data you copy and paste"), and the
  Chrome Web Store reviews it harder. Mitigation: make it **optional**
  (`optional_permissions`), request it only when the user presses the button, and
  never read the clipboard on load. Data is used only if the payload contains the
  `(figma)` marker, and unrelated clipboard content is discarded immediately. This
  fits the repo's privacy posture (see `PRIVACY.md`).
- One extra gesture before the capture (`Ctrl/Cmd + C`). We cannot copy on the user's
  behalf without a plugin.
- Payload size: a large frame copy can be several MB. The tray already stores
  captures in `chrome.storage.local` with `unlimitedStorage`; a size cap and the
  existing budget/error style are needed.
- It only works on `figma.com` (secure context) and only for content the user is
  allowed to copy.
- Fidelity is Figma's, not ours: components land as instances only in files that have
  the library (Figma's documented behaviour).

**What it gives the product.** A tray entry that is a *real* Figma design, which can
be re-pasted into any file later, long after the clipboard was overwritten — a
"Figma clipboard history", something Figma itself does not offer. It can also be
decoded (route C's reader) to export HTML/SVG/tokens/wireframes from a real Figma
design.

**Effort: S–M.** No format work. New optional permission, a reader in an extension
page, a new record type (`type: "figma-clip"`) in the tray, copy path, docs, tests.

---

## 3. Route B — a companion Figma plugin (a second extension is not possible)

A Chrome extension cannot run inside Figma's iframe world, and it cannot ask a plugin
to do work; so "capture the canvas" from inside Figma means a **plugin**, not another
extension. Two very different plugin implementations:

### B1. Plugin copies SVG of the selection — **small, real, lossy**

`node.exportAsync({ format: "SVG_STRING", svgOutlineText: false })` returns SVG markup
for the selection, with text kept as `<text>` instead of outlined paths —
[ExportSettings](https://developers.figma.com/docs/plugins/api/ExportSettings/),
[exportAsync](https://developers.figma.com/docs/plugins/api/properties/nodes-exportasync/).

Figma **imports pasted SVG as vectors** — paths in a group, not an image fill (measured
by the snapdom project against a real Figma; see their `h2d.inline-svg-as-asset` note).

- **Gains:** one click, no `Ctrl+C`, editable vector layers instead of a picture.
- **Loses:** no components, no auto-layout, no variables, no layer names/hierarchy,
  no images as fills on their own layers (they ride inside the SVG), text only if the
  font matches what Figma has.
- **Clipboard caveat:** plugin UI iframes do not reliably get `navigator.clipboard`;
  the working recipe is `document.execCommand("copy")` from the plugin UI, which
  burns the data through the legacy path and has a size limit —
  [Figma forum](https://forum.figma.com/t/write-to-clipboard-from-custom-plugin/11860),
  and this is what other plugins ship ([example](https://github.com/asifdotdev/figma-mcp-link-bridge)).
  Alternative with no clipboard at all: write a `.svg` file with `figma.saveFile`… not
  offered; a plugin can `figma.showUI` with a download link instead.

**Effort: S.** A ~200-line plugin, no schema work. This is the cheapest "not an
image" answer and a good companion product.

### B2. Plugin writes a native Figma payload — **large**

The plugin builds a `NODE_CHANGES` message, encodes it as fig-kiwi, wraps it in the
`(figma)` envelope and copies it. This is the only way to get *native* layers without
the user pressing `Ctrl+C`.

Feasibility of the container is **proven** (see the spike in §7): a payload we encode
is read back correctly by two independent parsers. The hard part is not the
container, it is the semantics: for every node type we would have to emit transforms,
sizes, `fillPaints`, strokes, effects, text `characters` + `fontName` + line height,
image hashes with blobs, auto-layout fields, and instance overrides, against an
**undocumented schema that changes between Figma versions** (583 types in schema
version 106 today; the h2d research puts it plainly: "Figma can change it in any
release, with no version negotiation, no error… the failure mode is that someone hits
⌘V and nothing appears").

**Effort: L.** Weeks, plus ongoing maintenance against schema drift. A library like
`@figit/dom-to-figma` solves the DOM→Figma direction, not Figma→Figma.

---

## 4. Route C — the `.fig` file (offline, whole file)

**File → Save local copy (.fig)** gives a ZIP whose `canvas.fig` is `fig-kiwi`:
magic + version + deflated Kiwi schema + deflated/zstd Kiwi message; images live in
`images/` by hash. Parsers exist and are MIT: `openfig-core` (0.4.1, deps `fflate`,
`fzstd`, `kiwi-schema`), `fig-kiwi`, `@figit/fig-kiwi` (which also does the clipboard
envelope).

- **Gains:** the *entire* file, offline, no clipboard permission, no plugin, no
  gesture. Perfect for "bring this Figma file into HTML / a wireframe / tokens".
- **Loses:** it is a file workflow, not a capture; it is a snapshot of the file, not a
  selection; and it needs a decoder shipped in the extension.
- **Cost:** the repo is deliberately **zero-dependency and build-step-free**. Vendoring
  a ~570 kB single-file module with two binary deps would break that rule, so this
  route needs either a build step or a hand-written reader (~300 lines: inflate,
  zstd, kiwi varint walk).

**Effort: M.**

---

## 5. Route D — improve the pixels we already capture

Independent of everything above, the current canvas path has two real defects:

1. **Over-capture.** `addCanvas` rasterizes the *whole* canvas element
   (`canvas.toBlob`), so selecting a 400×300 region of Figma's editor hands you the
   entire viewport. Route: crop the rasterized asset to the selected rect, or take the
   bitmap from `chrome.tabs.captureVisibleTab` and crop it — the service worker
   already does exactly that for selection thumbnails (`captureElementPreview`).
2. **WebGL read-back.** `toBlob` on a WebGL canvas without `preserveDrawingBuffer`
   can return a blank frame, and Figma's editor is WebGL. The visible-tab screenshot
   path does not have that problem.

This makes the existing behaviour honest and useful (a correctly cropped, correctly
rendered image of the selected region) without pretending it is layers.

**Effort: S.** Localized change in the capture engine + a background message; no new
permissions.

---

## 6. Route E — the engine's internal scene graph (rejected for now)

If Figma renders with CanvasKit/Skia, the design lives in a Skia `SkPicture`. Two
theoretical openings exist:

- `CanvasKit.MakeSurface(canvas)` returning the **existing** surface of a canvas that
  is not ours — no public API documents read-back of a foreign `SkCanvas`; `makeSurface`
  creates a new surface for a canvas node.
- Pixel read-back (`gl.readPixels`, `toDataURL`) — possible in principle, still only
  pixels, and the same `preserveDrawingBuffer` caveat.

The one property worth having would be a retained command list (`SkPicture`) instead of
flattened pixels. Nobody has published a way to reach it from outside the app, Figma
ships no such API, and it would be undefined behaviour that changes under an
`npm`/WASM bump. **Do not build a product on this.** If we ever want to settle it
empirically, the experiment is: load `figma.com` in a Playwright browser, find the
`<canvas>`, inspect `canvas.__proto__`/the module registry for a CanvasKit instance and
`getContext` state, and check whether a surface lookup exists — a half-day spike with a
likely "no".

---

## 7. Verified spike (this is why route A/B2 is not speculative)

Run outside the repo, with `npm i @figit/fig-kiwi@0.2.0 openfig-core@0.4.1`:

```js
import { encodeFigmaData, composeClipboardHtml, parseClipboardHtml, decodeFigmaData } from "@figit/fig-kiwi";
import { parseFigBinary, nodeId } from "openfig-core";

const message = { type: "NODE_CHANGES", sessionID: 7, ackID: 0, blobs: [], nodeChanges: [
  /* DOCUMENT → CANVAS → FRAME → TEXT, with guid/phase/transform/parentIndex */
]};

const { figBytes, size } = encodeFigmaData(message);          // fig-kiwi container
const html = composeClipboardHtml(base64, { dataType: "scene", fileKey: "SPIKE", pasteID: 42 });
const parsed = parseClipboardHtml(html);                     // (figmeta) + (figma) markers
const decoded = decodeFigmaData(parsed.fig);                 // real Figma schema
const doc = parseFigBinary(figBytes);                        // independent parser
```

Output on 2026-10-23:

```
encoded fig-kiwi bytes: 29212 | schema types: 583
parseClipboardHtml -> 29212 bytes, meta: {"dataType":"scene","fileKey":"SPIKE","pasteID":42}
decodeFigmaData -> prelude fig-kiwi version 106 | nodeChanges: 4 | types: DOCUMENT,CANVAS,FRAME,TEXT
round trip preserved name: Captured card
openfig-core: { prelude: 'fig-kiwi', version: 106 } | nodes: 2 | ids: 0:0:DOCUMENT 0:1:CANVAS
```

Two independent parsers agree on what we wrote, so the envelope and container are
solved and licence-clean (all MIT). The open work in B2 is node semantics only.

**One important distinction** this spike surfaced: Figma has **two** clipboard
channels, and this repo writes the other one.

| Marker | Meaning | Who writes it | What pastes |
|---|---|---|---|
| `(figma)` + fig-kiwi bytes | Figma's native scene | Figma itself, on `Ctrl/Cmd+C` | native layers, instances, auto-layout |
| `(figh2d)` + JSON nodes | a description of HTML (tags/boxes/styles) | Figma's Chrome extension, this repo, snapdom | Figma *converts* it on paste |

Our capture format is the second one. A canvas cannot be described in either, but the
first one can carry a canvas's *content* when Figma is the one writing it — which is
exactly route A.

---

## 8. Comparison

| | A · read Figma's copy | B1 · plugin SVG | B2 · plugin native | C · `.fig` file | D · pixels (today, fixed) | E · engine internals |
|---|---|---|---|---|---|---|
| Layers, not pixels | ✅ native | ◑ vectors + optional text | ✅ native | ✅ (to export, not to clipboard) | ❌ | ◑ unknown |
| Components / instances | ✅ | ❌ | ✅ (with serializer) | ✅ | ❌ | ? |
| Auto-layout / variables | ✅ (variables bind if library present) | ❌ | ✅ (with serializer) | ✅ | ❌ | ? |
| User gesture needed | `Ctrl/Cmd+C` | none | none | save file | none | none |
| New permission | `clipboardRead` (optional) | none | none | none | none | — |
| New library / build step | no (core), yes (decode) | no | no | yes | no | — |
| Effort | S–M | S | L | M | S | XL, unstable |
| Maintenance risk | low | low | high (schema drift) | medium | low | extreme |
| Works on non-Figma canvases | ❌ | ❌ | ❌ | ❌ | ✅ (as an image) | ❌ |

---

## 9. Recommendation

1. **Say the honest thing in the product.** A canvas region is only ever going to be
   an image from us; stop producing a *wrong* image (D). Crop the raster to the
   selection and take it from the visible tab so WebGL does not come back blank.
   Small, no permissions, immediate value.
2. **Build route A next.** It is the only path that turns "capture the canvas" into
   real layers without a serializer, and it fits the repo: optional permission, one
   new tray record type, no dependencies, fully local. Position it as **Import Figma
   copy** rather than an automatic capture, so the extra `Ctrl/Cmd+C` is expected.
3. **Ship B1 as the optional companion** if users want one click without the gesture.
   Keep B2 out of scope until A proves demand; it is the only item here that can quietly
   eat months.
4. **Treat C as the offline export feature**, after a decoder decision (vendored reader
   vs. build step).
5. **Do not pursue E.** Document the experiment, not a product.

### Phased plan for route A (proposal)

| Phase | Scope | Files |
|---|---|---|
| 1 | Optional `clipboardRead`; "Import Figma copy" in the options page reads the clipboard, accepts only payloads containing `(figma)`, stores `{type:"figma-clip"}` in the tray; tray re-copy re-reads the stored HTML | `manifest.json` (optional_permissions), `options.html`, `js/options.js`, `js/background.js`, `js/core.js` |
| 2 | Toolbar entry + `H2D_IMPORT_FIGMA_CLIP` command; size guard and clear errors in the house style | `js/h2d_toolbar.js`, `js/capture-safety.js` |
| 3 | Optional decode: `(figma)` → node tree → our existing wireframe/design-system pipeline, or an HTML export | new `js/figma-clip.js` + a decoder decision |
| 4 | Docs, FAQ entry, privacy audit row, tests (string round trip + a refusal test for non-Figma HTML) | `README.md`, `docs/FAQ.md`, `docs/PRIVACY-AUDIT.md`, `tests/` |

Privacy guardrails for phase 1, to keep the audit credible: read only on an explicit
click, only with the optional permission granted, discard anything without the
`(figma)` marker, never log or upload the payload, and store it only in
`chrome.storage.local` under the tab's existing tray key.

---

## 10. Sources

- Figma engineering, renderer + clipboard format: [figma.com/blog](https://www.figma.com/blog/building-a-professional-design-tool-on-the-web/)
- Figma Help, code to canvas and its canvas caveat: [help.figma.com](https://help.figma.com/hc/en-us/articles/40826832449303-Turn-coded-screens-into-editable-design-layers)
- Clipboard markup (`data-metadata` / `data-buffer`): [alexharri.com](https://alexharri.com/blog/clipboard)
- h2d format notes, decoded real capture, "no version negotiation": [snapdom `emit/h2d.js`](https://github.com/zumerlab/snapdom/blob/main/packages/plugins/vector/src/emit/h2d.js), [fixture notes](https://github.com/zumerlab/snapdom/blob/main/packages/plugins/vector/test/fixtures/h2d/README.md)
- `@figit/fig-kiwi` (MIT, encode/decode + envelope): [npm](https://www.npmjs.com/package/@figit/fig-kiwi)
- `openfig-core` (MIT, independent parser): [npm](https://www.npmjs.com/package/openfig-core)
- `.fig` container layout (zip, deflate, zstd): [OpenFig research notes](https://github.com/OpenFig-org/openfig-core/blob/main/docs/research.md)
- `exportAsync` / `ExportSettingsSVG`, `svgOutlineText`: [developers.figma.com](https://developers.figma.com/docs/plugins/api/ExportSettings/)
- Plugin clipboard constraints (`execCommand`, iframe): [Figma forum](https://forum.figma.com/t/write-to-clipboard-from-custom-plugin/11860), [figma-mcp-link-bridge](https://github.com/asifdotdev/figma-mcp-link-bridge)
- Clipboard read permission, secure context, focus: [MDN](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Interact_with_the_clipboard), [`Clipboard.read()` + `unsanitized`](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/read), [Chrome permissions](https://developer.chrome.com/docs/extensions/reference/permissions-list)
