# Page Capture — 1.7.9

Local page capture with an optional **Design System Generator** and **Copy design system** action. The established dark toolbar, blue accent, capture controls and permission help are retained. No account, onboarding, runtime framework or build step is required.

## Install or update

1. Extract the full extension ZIP to a permanent folder.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Choose **Load unpacked** and select the folder containing `manifest.json`.
4. To update an existing unpacked installation without changing its ID, replace its files in the existing folder and click **Reload** on the extension card.
5. Refresh website tabs that already had the previous toolbar injected.

## Cleanup in 1.7.9: shipped leftovers removed and the test suite green again

- Deleted five files that no runtime file references: the unused `js/vendor.js` webpack bundle, its `.LICENSE.txt` notice, the obsolete `js/background.js.LICENSE.txt`, `font/MaterialIcons.woff2` and `font/InterVariable-Italic.woff2`. The active `font/InterVariable.woff2` used by the options page is kept.
- Those leftovers were the only failing check in the dependency-free suite (`tests/privacy.test.cjs` asserts they are absent). `node --test tests/*.test.cjs` now passes every check again. The vendor bundle also carried an unused Sentry/redux client and a Figma-hosted toolbar logo URL, so removing it keeps the packaged surface identical to the documented privacy boundary.
- Runtime inventory is **20 files / 719,848 bytes**, including **10 JavaScript files / 346,106 bytes**. About **840 KiB** of unreferenced bundle and font bytes (859,784 bytes) are no longer packaged.
- No behavior, permission, host-permission, CSP, locale, storage or RPC change. The scroll-area, viewport, generator and board features are untouched.

## Fixed in 1.7.8: Capture scroll area accepts any point inside the scroller

Previously, clicking a card or text *inside* a scrollable region was rejected ("Select an element with vertical overflow") unless you first adjusted the selection upward with the arrow keys. The action now resolves the clicked element to its nearest vertically scrollable ancestor (the page itself is never chosen) and captures that. Elements with no scrollable ancestor still show the same error. A second browser test (`tests/scrollarea-child-browser.cjs`) covers the direct-child selection.

## Cleanup in 1.7.7: dead code and a distinct scroll-area icon

- Removed unused code: an unreferenced helper and error class in the toolbar bundle, two unused icons and two unused locale strings.
- **Capture scroll area** now has its own icon instead of sharing the pointer icon with **Select element**.
- No behavior, permission or network changes; all suites pass.

## Fixed in 1.7.6: explicit full internal scroll-area capture

Dashboard content inside a nested vertical scroller can extend far beyond the page's document root. The regular page capture and existing **Select element** action keep their established behavior; nothing automatically expands every overflow container.

- A new **Capture scroll area** action lets you explicitly choose one vertically scrollable element. The chosen region must use `overflow-y: auto`, `scroll` or `overlay` and contain more content than its viewport; an unsuitable selection is rejected with a clear message.
- Only the selected region's **serialized capture model** is expanded to its full scroll height. If you select it while scrolled, child coordinates are normalized to the content's top so both the first and final sections are present. The region's captured width remains the current responsive width.
- The source page is not programmatically scrolled or resized. Its DOM, current scroll position and viewport are preserved; no new tab, window or page navigation is used. There is no automatic expansion of dropdowns, carousels or unrelated overflow containers.
- The normal full-page capture, visible-section selection, no-new-tabs responsive capture, manual local clipboard workflow and intentionally raw **Capture code** action remain distinct. Permissions, host permissions, CSP and remote-asset rules are unchanged.
- This captures content represented in the current DOM. It does not force infinite feeds, virtualized rows, lazy app rendering or nested scroll areas inside the chosen region to load/expand. A live Figma paste was not part of this fixture verification.

**Regression fixture:** at an 813px-high viewport, ordinary document capture has an 813px root while the selected internal area is 2,518px tall. The new explicit action produces a 2,518px capture root with the final section inside it, both at scrollTop 0 and after a 560px internal scroll. At a 393px viewport the root remains 393px wide. Browser tests verify the source DOM/scroll/viewport are unchanged, the action creates no new page, and no remote requests occur. **1.7.6 verification: 259 Node checks + all 101 existing Chromium checks + a dedicated scroll-area Chromium regression.** The unchanged Viewports browser suite hit its known intermittent 200px-open timing failure once in the combined run and passed 11/11 on isolated retry.

Install the **whole ZIP**, reload the extension and **refresh source tabs** to receive the new button and helper.

## Fixed in 1.7.5: lazy-image completeness and asset reporting

- A loaded 1×1 **HTTP** image is now treated as a placeholder when the page also supplies an explicit lazy-image target. A genuinely loaded image still wins; the source page is not edited.
- Source selection now recognizes additional explicit image metadata (`data-actualsrc`, `data-lazy`, `data-url`, `data-image-src`, `data-hi-res-src`, `data-echo`, `data-flickity-lazyload`, `data-cfsrc`) and more lazy `srcset` variants, including on active `<picture>` sources. Candidate URLs still pass through the existing URL/privacy checks; no endpoints are guessed.
- After a successful rich copy, the existing toolbar success notice reports aggregate image assets **included** versus **not embedded** across the captures being copied. It deliberately omits per-image URLs, page text and raw errors. A partial/unavailable image remains a partial capture; the notice does not claim blocked or failed assets were recovered.
- The controlled Chromium regression fixture verified full-page Browser and 393px responsive copies: each embedded five valid candidates and honestly left one 404 image unembedded. Unit tests cover the added metadata patterns, media-aware sources, real-source precedence and private aggregate diagnostics. **1.7.5 verification: 258 Node checks + 101 Chromium groups** (14 capture, 25 generator, 15 editable-board, 11 viewport, 10 responsive, 8 full-page, 3 image-completeness, 15 capture-safety). All eight browser suites passed against the extracted release in individual sequential runs. On separate repeats, the unchanged Viewports test script intermittently timed out while opening its 200px panel or waiting for toolbar teardown; it passed all 11 checks on retry, and the 1.7.4 baseline suite also passed. Viewport capture logic was not changed in this image pass. No live Dribbble recheck or live Figma paste was performed for this patch.

The no-new-tabs responsive workflow, selected-section path, current dark/blue design, permissions, host permissions and extension CSP remain unchanged. The blocked remote-recovery policy is not relaxed.

Install the **whole ZIP**, reload the extension and **refresh source tabs** so the helpers and UI are replaced.

## Fixed in 1.7.4: privacy, copy feedback, cancellation and size limits

This is the first **P1 stability/privacy patch** from the 1.7.3 audit. It keeps the current dark/blue interface, the full-page/Dribbble repair, responsive captures without new tabs, the existing generator and the editable design-system board.

- **Visual capture privacy:** hidden/non-rendered input, textarea and select nodes are omitted. Password values and nonvisual button/option/checkbox/radio value IDs are excluded while visible labels, selected/checked states and ordinary visible form values remain. The actual page is not edited. This is not general PII anonymization: visible content, titles, links and image URLs can still be sensitive.
- **Older saved captures:** regular valid snapshots are sanitized when the toolbar loads and again before rich copying. IDs/previews/visible work are kept. Oversized or corrupt legacy captures are retained locally rather than deleted, but are blocked from export; recapture a smaller section and delete the old item to clear its original local data. Legacy raw/code-layer records are not silently rewritten.
- **Honest copy feedback:** a blocked/failed automatic write now says the capture is saved and directs you to **Copy all**. Encoding and size failures have privacy-safe messages rather than source/error dumps. Preparing the clipboard can be cancelled; the final native write shows **Copying to clipboard** without a misleading Cancel button. Conflicting commands are held off until that write finishes. A native write already submitted to Chrome cannot be revoked.
- **Cancellation through asset work:** the job signal now reaches image/SVG downloads, detached image/video conversion, blob/FileReader work and sender-bound worker recovery. Owned temporary resources/listeners are released; the original website's media are not paused or reset. Non-abortable native work may finish internally, but cancelled/stale results cannot trigger new capture/copy feedback. Completed captures already saved before clipboard preparation are retained.
- **Normal design batch budgets:** all rich design batches, not just legacy code-layer batches, use **48 MiB JSON / 64 MiB rich HTML** limits. Bounded UTF-8 counting runs before expensive parse/base64 work, checks combined size and yields for cancellation. No silent truncation or partial automatic copy is substituted. Copy fewer captures, copy individual items, or select a smaller section if a batch is too large. The separate design-system-board limit remains **16 MiB**.
- **Reachable error/retry controls:** long messages no longer push Copy all outside normal/narrow windows. The complete message is retained for the tooltip/live announcement, with existing compact icons used when space is tight. Success notices do not intercept clicks, and stale raw-code timers cannot clear a newer error.

**Capture code remains intentionally raw:** it still copies `document.documentElement.outerHTML`, including original form values and the existing raw-mode limitations. The privacy filter and rich-batch budgets do not silently clean or truncate that explicit advanced action.

No Chrome permission, host permission, CSP exception, account/upload path or additional capture RPC is added. The existing asset RPC gains sender-bound request/cancel IDs; sensitive destinations, public-URL validation, GET-only recovery, omitted credentials, redirect restrictions and MIME/image limits remain. In particular, **the restrictive remote-recovery CSP is not relaxed**.

Install the **whole ZIP** (it adds `js/capture-safety.js`), reload the extension and **refresh source tabs** before testing. The 1.7.3 ZIP/workspace is not overwritten. At the 1.7.5 release cut, arbitrary internal scroll areas were still separate; 1.7.6 adds the explicit vertical scroll-area action described above. Project saving and any remote-recovery policy change remain separate. Live Figma paste is still a separate acceptance check.

## Fixed in 1.7.3: full-page images and missing lower sections

Full-page and selected-section capture could differ on galleries such as Dribbble:

- A page with `html { height:100% }` can have a viewport-height HTML rectangle but thousands of pixels of document content. The snapshot root previously kept that short height, which could clip lower sections when pasted. Full-page snapshots now use the full document height, while keeping the original viewport dimensions and child coordinates. Selected-section and design-system-board roots are not expanded.
- Off-screen images can expose only `data-src` / `data-srcset` metadata, a one-pixel placeholder, or unresolved `{width}` / `{height}` URLs. The capture now resolves explicit lazy metadata, active picture sources and measured URL templates. Responsive copies activate those image sources **inside the copy only**. Real loaded sources win; no guessed image endpoints or site scripts are run, and empty `src` never becomes a request for the document URL.
- Eligible failed assets are recovered in **batches of at most 64 URLs**, rather than sending an oversized request that rejects all recovery for a large page. Existing URL validation, CSP, redirect and image limits are unchanged. Failed batches do not prevent later eligible batches; cancellation stops the sequence.
- Waiting for image decoding now respects cancellation/the supplied timeout and restores the original `loading` / `decoding` attributes. This is not a claim that native clipboard writes or every video/asset operation can be revoked after submission.

**Live verification:** after normal browser readiness, the actual anonymous Dribbble homepage reproduced the problem in 1.7.2: a **4,795px document** had an **813px snapshot root**, and **40 image sources were empty**. The revised build captured the full **4,795px Browser / 10,772px phone** height with **zero empty/unresolved image sources**, without source scrolling or resizing. A repeat showed 94/93 embedded assets for Browser/phone; three third-party advertising/tracking assets still failed. Site content/ads can vary. Public Dribbble CDN PNGs were also fetched and embedded in a controlled gallery test. This verifies capture data, **not a live paste into Figma**.

This captures content **already represented in the current DOM**. It does not scroll an infinite feed, click Load more, recreate missing app-generated sections, unblock third-party tracking/ads, or force intentionally hidden menus/mobile-only content to appear. Existing embedded-video, font and destination-fidelity limitations remain. No new tab/window, page URL navigation, site-script replay, source viewport change, extension permission or redesign is introduced.

Install the **full ZIP**, reload the extension, and **refresh the Dribbble/source tab** so the new helper and click handlers replace the old injected code.

## Fixed in 1.7.2: responsive captures without new tabs

The temporary-window approach introduced in 1.7.0 and retained by the 1.7.1 picker fix is **removed**. Viewport selection no longer opens a tab/window, reloads the URL or resizes the live page.

- **Browser only:** keeps the established current-page capture flow; 1.7.3 adds full-height framing and explicit lazy-image resolution.
- **Extra widths:** copy the current DOM into a temporary, script-disabled frame inside the extension's ignored toolbar root, render responsive CSS at each selected width, and use the existing editable snapshot serializer/clipboard. These are different responsive layouts, not stretched/duplicated screenshots.
- Current text, unsaved form/checkbox/selection state, canvas pixels where supported, readable runtime CSSOM rules, adopted styles and open shadow roots are copied. The page's scripts/custom-element constructors are not rerun, and embedded page URLs are not reloaded.
- To paste **exactly two screens**, select two sizes and uncheck **Browser** unless the current browser width should be one of those two. Keep the source tab visible/focused while capturing, then paste the combined design clipboard as usual.
- Cancel, timeout and errors remove the temporary frame. If an extra width fails, earlier completed captures are retained in the tray, the failed width is identified, and **Copy all** remains available. A partial failure does not replace the clipboard with an incomplete batch automatically.
- No extra Chrome permission, extension CSP exception, runtime dependency, account or upload is added. The former `H2D_CAPTURE_VIEWPORT` worker RPC and temporary-window code are removed. The latest generator design and the 1.7.1 picker repair remain.

**Responsive scope:** media/container queries, viewport units, flex/grid and other CSS layout respond to the isolated width. JavaScript-only breakpoint rerenders are **not** replayed; missing lazy-loaded/app-generated mobile content cannot be invented from the current DOM. Closed shadow roots, embedded documents and live video have the usual snapshot limitations. This is width-based layout capture, not a mobile user-agent/device emulator or a guarantee of pixel-perfect fidelity on every app. Use Browser only for the original capture if a site's responsive copy is unsupported.

Each copy is limited to 50,000 DOM nodes, 5 MiB of copied CSS, 200–3840px width, 200–4000px height and a 20-second preparation deadline. Over-limit copies fail explicitly, not by silently dropping content. Styles/images/fonts may still require ordinary asset GETs; **no new document visit or application-script execution** is used for responsive capture.

**Update:** replace the extension's files, click **Reload** in `chrome://extensions`, and **refresh the website tab** before trying again. Existing viewport preferences are retained.

## Fixed in 1.7.1: Viewports opening off-screen

Based on the latest repository commit `db95a8a` (1.7.0). The existing viewport feature and generator design are retained—not replaced with the older 1.6 build.

**Cause:** the picker was positioned against `controller.element`, an invisible/zero-height host in normal page flow, rather than the visible fixed toolbar. On long pages that host sits below the fold, so clicking Viewports created the panel off-screen.

**Fix:** anchor to the current visible Viewports button, falling back only to `controller.toolbarEl`. Resolve the live button after toolbar rerenders, flip above/below as needed, and clamp to the window with 8px margins. Narrow/short pickers scroll instead of clipping. Source CSS cannot hide the reset popup host.

Toggle/keyboard opening, Escape/focus restoration, outside clicks, toolbar close/reinjection and cleanup are also covered. Opening is awaited by the normal action dispatcher, so errors are not left as silent/unhandled promises. Other capture actions close the picker before reading the page. In that 1.7.1 release, the worker, presets/storage key, capture engine/serializer, generator polish and board-copy code were otherwise retained; 1.7.2 changes the multi-width rendering strategy as described above.

**After replacing files, click Reload in `chrome://extensions`, then refresh every website tab before testing.** A tab with the old injected toolbar can otherwise keep its previous click handler.

The 1.7.0 upload also retained unused vendor bundles/fonts that earlier releases had removed. Those unreferenced leftovers are removed again; the active toolbar font is kept.

## Viewports and the retained 1.7 generator design

**Viewports** lets **Capture design** record *Browser* (the current width) plus editable presets (1600, 1440, 1024, 768, 393px). Tick the desired sizes, then capture. In 1.7.2 each extra size is rendered locally in the page's isolated capture frame, with no new tab/window or URL reload. Every selected size becomes a separate editable snapshot in the combined pasted result.

- Selections and widths remain stored locally under `pc_viewports_v1`.
- Exact narrow widths are no longer subject to Chrome's minimum popup-window width.
- The generator retains the 1.7 themed dropdowns/checkboxes, scrolling Contrast/Similar review panes, footer and toolbar-centred dialog.

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

**This is not a zero-network browser mode.** Standard design capture can read referenced non-Figma website images/SVG assets with GET requests. Responsive copies can also load normal stylesheet/font/image assets; CSSOM-unreadable external stylesheets keep their native links. No new document visit or app-script execution is used for extra widths. Worker recovery omits credentials, bodies and referrers and remains subject to the restrictive extension CSP. Capture-script reads may use same-origin website credentials. Known Figma/Sentry service hosts are denied before an extension asset fetch; redirects are rejected.

A website's own scripts/requests and the destination application's activity are not intercepted. Figma-hosted assets may be missing from standard captures because retrieval is blocked. Raw HTML copying omits the doctype, does not make all resources available offline, and may include the established toolbar host. Temporary generator UI is removed before standard captures. Native clipboard access depends on browser security/focus requirements.

See `PRIVACY-AUDIT.md` for implementation boundaries and verification details.

## Tests

Dependency-free tests (Node.js 20+):

```sh
npm test          # same as: node --test tests/*.test.cjs
```

`package.json` only declares that script; the extension itself still has no build step and no runtime dependency. `node_modules/`, Playwright artifacts and packaged ZIPs are ignored by `.gitignore` so the optional browser run does not pollute the working tree.

Optional real-browser checks (run sequentially; they use native clipboard/window focus):

```sh
npm install --no-save --package-lock=false playwright
npx playwright install chromium
# Linux may also need: npx playwright install-deps chromium
node tests/browser-smoke.cjs
node tests/design-system-browser.cjs
node tests/design-system-board-browser.cjs
node tests/viewports-browser.cjs
node tests/viewports-responsive-browser.cjs
node tests/fullpage-browser.cjs
node tests/scrollarea-browser.cjs
node tests/scrollarea-child-browser.cjs
node tests/image-completeness-browser.cjs
node tests/capture-safety-browser.cjs
```

All browser suites accept `EXTENSION_ROOT` for an extracted release folder. The generator/board/viewport/responsive/full-page/safety suites accept `ARTIFACT_DIR` for screenshots and fixture artifacts. Generator/board tests share `tests/fixtures/design-system.html`; viewport tests use a deliberately long responsive fixture. Test-only instrumentation and clipboard-read permission grants are absent from the runtime.

**1.7.4 P1 verification (historical):** **242 Node checks + 98 Chromium groups** (14 existing capture, 25 generator, 15 editable-board, 11 viewport, 10 in-page responsive, 8 full-page, 15 capture-safety). Coverage includes actual native rich clipboard payloads, six-category editable layers, review/exclusions/merges, privacy/source-mutation checks, cancellation, clipboard denial/failure/timeout, strict CSP, a full 480-token board, responsive/docked layouts, cleanup and all prior capture flows. The viewport suite covers real opening/toggle/keyboard/outside clicks on long/scrolled pages, top/bottom docking, narrow/short windows, native saved settings and actual 1280/768/393px rich clipboard snapshots without new tabs/windows. The responsive suite additionally checks exact two-screen 1600/393px output, current SPA/input state, source/scroll/focus preservation, scripts/custom-constructor non-execution, mixed-origin/runtime CSSOM/adopted/shadow styles, strict CSP, cancellation/timeout and partial-failure retention. Full-page tests add a 30-image lazy gallery, a 100%-height root, preserved footer/scrolled coordinates, 130-asset recovery, source preservation and decode cancellation. Safety tests additionally verify legacy migration, hidden/nonvisual-value redaction, native denied-copy/manual retry, pre-encoding size protection, safe encoding errors, preparation/download/disposal cancellation, non-cancellable native write phases, narrow retry controls, raw HTML preservation and real source-to-worker cancellation. Fixture flows block/record remote requests; a separate real-site probe verifies Dribbble capture data. No live Figma paste was tested.

The 1.7.5 and 1.7.6 builds were prepared locally before being committed; 1.7.7, 1.7.8 and 1.7.9 are in this repository. The Node suite is runnable without installing anything (`node --test tests/*.test.cjs`); the Chromium suites need Playwright plus a local Chromium build.
