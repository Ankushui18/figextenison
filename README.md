# Page Capture — 1.7.0

Local page capture with an optional **Design System Generator** and **Copy design system** action. The established dark toolbar, blue accent, capture controls and permission help are retained. No account, onboarding, runtime framework or build step is required.

## Install or update

1. Extract the full extension ZIP to a permanent folder.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Choose **Load unpacked** and select the folder containing `manifest.json`.
4. To update an existing unpacked installation without changing its ID, replace its files in the existing folder and click **Reload** on the extension card.
5. Refresh website tabs that already had the previous toolbar injected.

## New in 1.7.0: Viewports and a polished generator

**Viewports** (toolbar button) lets **Capture design** record the page at several widths in one go: *Browser* (the current window) plus editable presets (1600, 1440, 1024, 768, 393 px). Tick the sizes you want, then click **Capture design**. Each extra size opens the same page in a small temporary window, captures it with the normal local capture, and closes the window; every size becomes its own frame in the pasted result. With only *Browser* ticked, behavior is unchanged.

- Selections are remembered locally (`chrome.storage.local`).
- The temporary window loads the page's own URL like a normal visit; the extension itself sends nothing anywhere. Chrome may enforce a minimum window width — if so the status line reports the width actually used.
- The Design System dialog now has themed dropdowns and checkboxes, review panes (Contrast / Similar) that scroll instead of clipping, a clearer footer and a dialog centred under the toolbar.

## New in 1.6.0: copy a visual design-system board

This creates a **new, editable reference board** for manual pasting into Figma Design. It does **not** create native variables/shared styles, bind tokens, modify existing layers or apply a design system to the file.

1. Open the extension on a website.
2. Choose **More (···) → Generate design system**.
3. Review the **colors, typography, spacing, radii, shadows and borders**. Rename tokens, exclude unwanted ones, and confirm any merges.
4. Click **Copy design system**. Keep the website tab visible/focused until the status confirms the copy.
5. Switch to **Figma Design**, click an empty area of the canvas rather than an active text field, and paste with **Ctrl+V / ⌘V**.

The clipboard contains the extension's established rich editable-design format: one board with separate text, swatches, typography specimens and token cards—not a website screenshot, outline-only SVG or plain JSON. All included tokens are used, regardless of search, active category or row selection. Exclusions, reviewed names and explicitly chosen canonical merge values are honored. Empty sections are omitted; invalid/colliding names or an empty selection of included tokens block copying.

### Board behavior and limits

- Uses the current generator's dark/blue visual language. Its fixed **1120px reference-board width** does not resize the source website or replace existing viewport capture functionality.
- Color transparency is shown over individual editable checkerboard rectangles. Spacing signs and original values are listed; preview rulers are scaled to fit. Elliptical corner axes are preserved.
- Typography samples use **scaled Arial** rather than loading website fonts. All six original metrics—including the observed family—are listed. Exact website-font appearance is not reconstructed, and Figma may substitute unavailable fonts.
- Uses the existing local snapshot serializer/clipboard markers. Does not add a tray entry, take a screenshot, change the token review or upload anything. No companion variable-import plugin is added or needed by this copy path.
- Preparation can be cancelled. Conflicting edits/downloads/repeat copies are disabled while copying. Escape, closing the panel/toolbar or starting a standard capture aborts preparation and removes its temporary board.
- **A native clipboard write cannot be undone once handed to the browser.** The preparation Cancel button is disabled during this final phase. Closing then removes UI but cannot revoke a write already started.
- Preparation has a 12-second deadline. The board is limited to the generator's **480 tokens** (80 per category), 200,000px height and 16 MiB of rich clipboard HTML. Over-limit/invalid layouts fail explicitly rather than silently dropping cards.
- Rich clipboard access depends on Chrome's secure-context/focus requirements and destination-format support. A blocked write reports an error, not success; no screenshot/plain-text fallback is silently substituted.

**Verification boundary:** real Chromium writes and the decoded native clipboard payload are tested, including a 480-token board. An actual paste into a live Figma file has **not** been verified here. Upstream paste handling, modern CSS/color/effect fidelity, font substitution and destination-specific behavior can vary. If the destination rejects the format, the unchanged JSON/CSS/HTML exports remain available; those files are not automatically a native Figma variables import.

## Review and download tokens

- Search/switch categories, edit names, and exclude unwanted tokens.
- To combine similar values, select at least two tokens in one category, click **Merge**, choose the canonical name/value to keep, and confirm. Merging changes only the local token model, never the website. Original values, counts and matching variable aliases remain in JSON evidence.
- Download **Tokens JSON**, **CSS variables**, or the self-contained **Style guide** HTML as before.

The dialog follows the existing toolbar's colors, typography scale, compact controls and rounded corners. It floats over the website without changing its viewport or layout. Escape closes the generator first; the normal capture hotkey is blocked while the modal is open. A capture command dispatched by Chrome closes the generator before capturing.

### Review tools retained from 1.5.0

- **Similar (N):** review up to 12 close, included token pairs in the active category. Click **Review merge**, choose the canonical token, then explicitly confirm. Opening a suggestion or cancelling does not change exports. These are conservative heuristics for near values, not proof that different semantic roles should be merged. Excluded tokens are ignored; the whole active category is considered, not just the search results.
- **Contrast** (Colors only): select a text token and an opaque background token. The checker shows a live sample, ratio, and WCAG 2.x AA/AAA text thresholds. Translucent text is composited over that explicit background. Swap is available only for two opaque sRGB colors. Excluded colors are not offered.
- **Larger previews:** inspect any token's value, observation count and matching variable aliases. Color checkerboards reveal transparency. Typography shows all six observed metrics beside a scaled system-font specimen.
- **Scroll/focus retention:** selection/exclusion rerenders preserve list position and control focus. Preview/contrast panes scroll within the existing dialog on narrow/short screens.

**Contrast scope:** this is a selected palette-pair calculation, not a page accessibility audit or compliance certificate. Only explicit hex/RGB sRGB values are calculated. Other color spaces remain unchanged in exports and are not approximated. Background images/gradients, inherited opacity, overlays, actual text usage and other accessibility criteria are not evaluated. Displayed ratios use two decimals; threshold decisions use the unrounded calculation. Large text means at least 24px, or 18.67px bold (700+).

Suggestions, preview settings and contrast selections are session UI only. They do not rewrite tokens automatically or change website styles. The extraction/review core and existing export formats are unchanged from 1.5.0.

### How extraction works

- Reads computed styles of currently rendered elements. Exact duplicates are combined automatically; similar values merge only when explicitly chosen.
- Uses matching safe CSS-variable values as naming evidence when available. This is value matching, not proof of declaration provenance or a reconstructed semantic role. Names without evidence are numbered suggestions; manually edited names are marked as user-supplied.
- Typography is a combination of font family, size, weight, line height, letter spacing and style. Font files are not downloaded/embedded. Panel/HTML previews use system fonts; the clipboard board uses Arial.
- `uses` counts computed-property observations, not unique components. One element can contribute multiple uses of the same spacing/border value.
- **Rendered page** includes rendered elements below the fold. **Current viewport** limits observations to elements intersecting the visible area. Analysis uses the existing viewport; it does not resize the website.
- Reanalysis asks before replacing names, exclusions and merges. Cancelling keeps the last completed analysis. Closing the dialog retains the review only while that toolbar instance remains open; closing the toolbar or refreshing clears it.

### Exports and extraction limits

- **JSON:** custom `schemaVersion: 1` format with `$type`, `$value` and observation evidence. It is **not advertised as DTCG-compliant** or a native Figma import format.
- **CSS:** `:root` variables. Composite typography expands into six individual variables. Included names must be globally unique lowercase letters/numbers/hyphens, start with a letter, and be at most 64 characters. Invalid names or expanded-variable collisions block exports/copying.
- **HTML:** escaped standalone visual guide with embedded CSS, a restrictive resource policy, and no scripts, linked resources, images or font downloads.
- All included tokens are exported/copied, regardless of the active category/search. Row selection is only for merging/bulk exclusion.
- Analysis is bounded to 4,000 inspected elements and 80 frequent tokens per category. It yields, supports cancellation and reports truncation. Custom-property inspection is capped as well.
- The scanner reads open shadow roots, but does not force open closed roots, inspect website iframe documents, scroll, resize, click controls or activate hidden/hover/dark/responsive states.
- This is an observed-style **starter**, not reconstruction of the original design system. Native variables/shared styles/components, component generation and variant discovery are out of scope.

## Preserved capture behavior

- The extension icon opens capture directly, without a welcome tour or account.
- **Capture code** copies the current document's raw HTML as plain text using the native Clipboard API.
- **Capture design** and **Select element** create editable-design capture data and copy the established rich clipboard format locally.
- The capture tray, Copy all, individual copy/delete, Discard all, close, and local-file permission help remain available.
- Existing storage keys and clipboard markers are preserved for compatibility. Figma-related identifiers are not network connections.
- Previously saved MHTML items remain locally copyable; creation of native MHTML captures remains removed.
- The minified capture engine has only the optional generator/clipboard bridge and an opt-in scrollbar-hiding bypass for the isolated board. Default capture behavior is unchanged; a hash regression verifies every other byte against the pre-generator engine.
- The worker adds the local generator modules to its injection list only. Permissions, extension CSP and the six local capture RPCs are unchanged.

## Privacy scope

Generator analysis/downloads/board-copying are local: no account, telemetry, stylesheet/font fetching, upload or clipboard reads. The board is generated from reviewed tokens, not from source-page HTML, body text or form values. A resource-blocked, script-disabled temporary frame inside the extension's ignored closed root isolates its layout; the board itself is in a second closed root. The frame is removed on completion, error or cancellation. Copying bypasses the engine's page-scrollbar mutations and disables CSS-variable/source-prop extraction.

**Source metadata includes the document title and URL origin/path.** Credentials, query strings and fragments are removed; local-file URLs retain only the filename. Titles and paths may themselves be sensitive, so review exports and the pasted board before sharing. Only safe variable aliases matching design values are retained. Generator data is held in memory, not extension storage; local downloads/the clipboard remain subject to normal user sharing and OS clipboard behavior.

Existing captures stay in local extension storage and the clipboard unless explicitly pasted/shared elsewhere. There is no Figma login, API upload, account request or telemetry client.

**This is not a zero-network browser mode.** Standard design capture can read referenced non-Figma website images/SVG assets with GET requests. Worker recovery omits credentials, bodies and referrers and remains subject to the restrictive extension CSP. Capture-script reads may use same-origin website credentials. Known Figma/Sentry service hosts are denied before an extension asset fetch; redirects are rejected.

A website's own scripts/requests and the destination application's activity are not intercepted. Figma-hosted assets may be missing from standard captures because retrieval is blocked. Raw HTML copying omits the doctype, does not make all resources available offline, and may include the established toolbar host. Temporary generator UI is removed before standard captures. Native clipboard access depends on browser security/focus requirements.

See `PRIVACY-AUDIT.md` for implementation boundaries and verification details.

## Tests

Dependency-free tests (Node.js 20+):

```sh
node --test tests/*.test.cjs
```

Optional real-browser checks (run sequentially; they use native clipboard/window focus):

```sh
npm install --no-save --package-lock=false playwright
npx playwright install chromium
# Linux may also need: npx playwright install-deps chromium
node tests/browser-smoke.cjs
node tests/design-system-browser.cjs
node tests/design-system-board-browser.cjs
```

All browser suites accept `EXTENSION_ROOT` for an extracted release folder. The generator/board suites accept `ARTIFACT_DIR` for screenshots and fixture artifacts, and share `tests/fixtures/design-system.html`. Test-only instrumentation and clipboard-read permission grants are absent from the runtime.

Verified: **144 Node checks + 54 Chromium groups** (14 existing capture, 25 generator, 15 editable-board). Coverage includes actual native rich clipboard payloads, six-category editable layers, review/exclusions/merges, privacy/source-mutation checks, cancellation, clipboard denial/failure/timeout, strict CSP, a full 480-token board, responsive/docked layouts, cleanup and all prior capture flows. Fixture flows block/record remote requests. No live Figma paste was tested.

No changes have been committed or pushed to the online repository.
