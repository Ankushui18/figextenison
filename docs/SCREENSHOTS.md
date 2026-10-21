# Screenshots

The images in [`screenshots/`](screenshots) and [`brand/`](brand) are used by the
README and the repository's social preview.

## What is real, and what is a render

Be careful here — this matters for trust.

| Image | Status |
|---|---|
| `brand/icon.svg`, `brand/icon-128.png` | **Real.** Vector reconstruction of the shipped icon; mean pixel difference from `extension/icon128.png` is 5/255 (anti-aliasing only). |
| `options.png` | **Faithful render.** Uses the real `options.html` markup, real strings from `_locales/en/messages.json`, and the real `img/capture-permissions.svg` / `img/permission-check.svg` assets. Not a browser screenshot. |
| `capture-page.png`, `select-element.png`, `viewports.png`, `scroll-area.png` | **Accurate renders.** Toolbar geometry (`40px` tall, `13px` radius, `#2c2c2c`, `40×40` buttons), real icon paths, real strings. The page behind them is an abstract placeholder — no third-party site is depicted. |
| `design-system.png` | **Accurate render** of the panel layout and styling. The token values are sample data, not extracted from a real page. |
| `privacy.png` | **Diagram.** Not a UI screenshot at all. |
| `brand/cover-1920x1080.png`, `brand/social-1280x640.png` | **Brand renders.** Composition for the README header and social card. |

None of these are screenshots of a real website, and none of them claim to be.
If you replace one with a real capture, update this table.

## A wireframe you can run yourself

[`wireframe-demo.html`](wireframe-demo.html) is not a screenshot: it is a sample
page that loads the shipped `extension/js/wireframe-core.js` and
`extension/js/wireframe.js`, scans itself with the real scanner, and renders the
real plan at Low, Medium or High. Serve the repository root and open it:

```bash
python3 -m http.server 4173
# then visit http://localhost:4173/docs/wireframe-demo.html
```

The demo bar and preview panel carry `data-h2d-ignore`, so the scanner skips the
demo chrome — only the sample site is rebuilt.

## Replacing them with real screenshots

Real captures look better and are easy to take. Use the same names and sizes so
the README keeps working.

| File | Size | How to capture |
|---|---|---|
| `capture-page.png` | 1440×900 | Load a real page, open the toolbar, capture once so the tray has a thumbnail, screenshot the window. |
| `select-element.png` | 1440×900 | Click **Select element**, hover a card so the outline and tooltip show, screenshot. |
| `viewports.png` | 1440×900 | Click **Viewports**, check 768 and 393, screenshot with the popover open. |
| `scroll-area.png` | 1440×900 | Click **Capture scroll area**, hover inside a scroller, screenshot the outline. |
| `design-system.png` | 1200×860 | Open **Design system** on a page with real colors and type, screenshot the panel. |
| `options.png` | 1200×800 | Open `chrome-extension://<id>/options.html`, screenshot the card. |
| `cover-1920x1080.png` | 1920×1080 | Keep the render, or re-compose with your own browser screenshot. |
| `social-1280x640.png` | 1280×640 | Used as the GitHub social preview. Upload under **Settings → Social preview**. |

Tips:

- Take screenshots on a page you have permission to publish. Avoid customer
  data, real names, avatars and private dashboards.
- Capture at 2× device pixel ratio and downscale, or use a browser at the exact
  size above; the PNG stays small and text stays crisp.
- Keep the dark toolbar in frame — it is the thing people recognise.
- Do not add fake annotations or arrows inside the image; put captions in Markdown.

## Adding a new image

1. Put it in `docs/screenshots/` (UI) or `docs/brand/` (identity).
2. Add it to the table above with its honest status.
3. Reference it from `README.md` with descriptive `alt` text.
4. Run `npm run check` — it verifies that every referenced image exists.
