# Privacy and verification audit

Version: **1.6.0**  
Review/test date: **18 October 2026**

## Summary

Version 1.4.0 added the optional local Design System Generator; 1.5.0 added review tools. Version **1.6.0 adds Copy design system** inside that same panel: a local rich clipboard snapshot of a new editable reference board. It follows the current dark/blue design and does not replace the capture UI, resize the website, create/bind native variables/shared styles, modify existing Figma layers or add an upload path.

The new modules are readable standalone JavaScript. No runtime dependency, Chrome permission, CSP exception, account, remote integration or Figma API has been added.

## 1.6.0 editable-board boundaries

- Only an explicit **Copy design system** click writes the clipboard. No clipboard read API or read permission is added. Success is displayed only after the native write resolves; denied/failed preparation or writing reports an error. There is no screenshot/plain-text fallback or automatic paste/upload.
- The board uses **included, reviewed tokens**, not the website, generator controls or existing capture tray. Renames, exclusions and canonical merges are honored across all six categories regardless of search/category/row selection. Empty sections are omitted. Copying does not mutate the model, create a capture-tray record or write extension storage.
- Every captured element is created in the extension's parent JavaScript realm, then adopted into an initial `about:blank` frame for independent layout. This preserves the existing engine's `instanceof Element` assumptions while isolating source CSS. The frame has no `src`/`srcdoc` navigation, `sandbox="allow-same-origin"` (no scripts), and a restrictive resource CSP including `font-src`, `img-src` and `connect-src 'none'`. Styling uses CSSOM assignments, including on strict-CSP source pages.
- The frame lives inside the generator's ignored closed root. The actual board is inside **another closed shadow root** within the frame, not its public document tree. This prevents ordinary same-origin frame enumeration from directly reading/editing the board tree. These are UI/layout isolation measures, not a general security boundary against browser/devtools/other privileged extensions or a promise that a hostile site cannot disrupt injected UI.
- The snapshot receives `extractCssVariables:false`, `captureSourceProps:false`, `skipRemoteAssetSerialization:true`, `assertLayoutValid:false` (its own bounds are checked), and an opt-in `skipScrollbarHiding:true`. That last option bypasses the capture engine's source-document scrollbar probe/stylesheet mutations. Default normal-capture behavior is unchanged.
- The only captured content is generated board DOM. Expected assets are an empty Map/object. Unexpected assets, missing/collapsed/non-finite layout, invalid names and over-limit boards fail explicitly. The engine's global page-title default is replaced by the reviewed model's title before serialization.
- The existing private snapshot, serializer and UTF-8/base64 helpers are passed through one optional toolbar bridge. The adapter emits the same version-2 **snapshot array**, `type:"snapshot"`, `figmeta`/`figh2d` markers, `dataType:"h2d"`, `source:"chrome-extension"` and `capturedAtIso` metadata as the established rich clipboard. Base64 is encoding, not encryption or compression. It is not a DTCG/native-variable import, SVG or image.
- Text, cards, color rectangles, alpha checkerboard tiles and preview shapes remain separate snapshot nodes. No screenshot/canvas/SVG outlining is used. Typography specimens are bounded **Arial**, with all six original metrics listed. Signed spacing values/elliptical axes are retained; rulers are scaled to fit. Original website fonts are not fetched/embedded; destination font substitution and CSS/color/effect fidelity remain limitations.
- Preparation is limited to 12 seconds, 480 included tokens, 200,000px board height and 16 MiB rich clipboard HTML. The maximum 480-card case is tested. Copy never silently truncates a board. Existing analysis caps/truncation warnings still apply.
- During preparation, conflicting inputs/downloads/repeat copies are disabled while Close/Cancel remain available. Cancel/Escape/close/standard capture/disposal abort preparation and remove the frame. `finally` removes the frame/listener/timer on success/failure. A stale/aborted job cannot overwrite the panel status after a newer job or reopen.
- The frame is removed **before** handing rich HTML to `navigator.clipboard.write`. Native clipboard writes are not abortable/revocable once submitted. Cancel is disabled during that final phase; closing then removes UI but cannot undo a write already started. No rollback would be possible without reading/replacing the user's clipboard, and no such permission or behavior is added.

Relative to 1.5.0, runtime changes are the new readable `js/design-system-board.js`, its worker injection, panel copy/lifecycle controls, two tightly bounded toolbar edits and the manifest version. The other **13 runtime files** (including the extraction/review core, permission/options/privacy helpers, assets and locales) are byte-identical. Permissions/host permissions/extension CSP/RPCs are unchanged; no runtime dependency or font/image asset is added.

## Review-tool boundaries retained from 1.5.0

- Suggestions operate only on already-extracted, included tokens in one category. Up to 12 ranked pairs are shown. The underlying helper is capped at 80 tokens/20 output pairs per category. It is pure and does not mutate the model. **Review merge** only selects a pair and opens the existing canonical-value confirmation; only the final **Merge tokens** click changes the model.
- Color similarity uses conservative Euclidean OKLab distance for explicit sRGB colors (up to 0.03), with alpha differences limited to 0.025. It is not CIEDE2000, semantic-role inference or an automatic merge rule. Spacing/radii use small absolute and relative tolerances with matching units/direction; typography keeps family/weight/style/tracking fixed; borders keep line style fixed; shadow suggestions keep geometry fixed. Different intent remains a reason to keep similar values separate.
- Contrast is calculated from the selected **token values**, using sRGB relative luminance and source-over compositing for a translucent foreground over an explicit opaque background. WCAG 2.x text thresholds are reported for that pair only. Backgrounds with alpha, unsupported color spaces, gradients/images, inherited opacity and overlays are not guessed. This is not a DOM/text-pair accessibility audit or certification. Classification uses unrounded ratios; unsupported cases show an explanation, not a pass/fail claim.
- Review selections, ratios and suggestions are not persisted or added to token exports. Checking a pair/opening previews leaves actual JSON exports unchanged. Excluded tokens are omitted from suggestions and contrast choices.
- All six token types have larger previews. Extracted font families are displayed as text, not loaded/applied as website fonts. Typography specimens use bounded system-font rendering, with observed values retained separately. Color checkerboards are generated in CSS, not images. The standalone HTML guide uses the same safe font/color-preview approach.
- List scroll/focus is restored across review rerenders. New panes remain inside the original dialog, with internal scrolling on short/narrow screens. No source-page styling, form-value writes, viewport resizing or source scrolling was added.

Historical 1.4.0 → 1.5.0 scope: only the extraction/review core, panel and manifest version changed; the other 14 runtime files were byte-identical. Those review calculations and existing export formats are unchanged in 1.6.0.

## Generator data flow

1. Read computed styles and element bounds from the current document and inspectable open shadow roots.
2. Reduce observations to colors, typography combinations, nonzero spacing, radii, borders and shadows. SVG fill/stroke values are considered only for SVG painting elements, not default paint properties on ordinary HTML.
3. Deduplicate exact values, frequency-rank them and retain up to 80 tokens per category. Existing safe custom-property values can provide matching aliases; this is value-based evidence, not CSS declaration provenance or a reconstructed semantic role.
4. Hold this model only in the current toolbar instance's memory. Searches, renames, exclusions and explicit same-category merges affect that model only. Merges retain all original observations/counts/aliases in JSON. User-edited names are identified as such.
5. Serialize included tokens into local Blob downloads (custom JSON, CSS variables, standalone HTML) or explicitly generate/copy the new visual board through the isolated adapter. No clipboard reads occur; board writes require the user's Copy action.

There are no fetch, XMLHttpRequest, WebSocket, beacon, remote stylesheet or font-loading calls in the three generator modules. No stylesheet source is fetched. Panel/HTML previews use toolbar/system fonts; the clipboard board uses Arial rather than applying extracted website fonts. The exported HTML contains escaped text, inline styles and a restrictive resource CSP, with no scripts, linked resources, images or font downloads.

### Data minimization and metadata

- Does not retain/export source-page body text, input values, raw HTML, screenshots, selectors, element IDs/classes or an arbitrary CSS-variable dump. Generated board node IDs/labels are local presentation identifiers, not source selectors. Text presence is checked only to identify typography observations; the words themselves are not recorded.
- Candidate variable values must be safe style-like values and only aliases matching retained design values reach exports. Inspection is bounded to 128 custom properties per computed declaration and 1,600 unique name/value pairs. Unrelated values are discarded.
- Exports intentionally contain the document title and sanitized source URL, viewport, analysis scope/time and aggregate element count. HTTP(S) URL credentials/query/fragment are removed; local-file URLs retain only the filename. **Titles and URL paths may still be sensitive; review files before sharing.** This is not a general-purpose anonymizer.
- CSS/type names and safe observed style values can identify a site's design. Local downloads/the clipboard remain subject to normal file-sharing and OS clipboard practices.
- Closing the dialog keeps a completed review in memory while that toolbar instance is alive. Closing the toolbar or reloading the document clears generator state. No generator model is written to extension storage.

### Read-only/lifecycle boundaries

The scan uses computed-style/layout reads and a detached color-normalization canvas. It does not change source styles/attributes/form values, scroll, resize, force interaction states or inspect iframe documents/closed roots. Temporary extension UI is marked `data-h2d-ignore`, excluded from scanning and isolated in a closed shadow root. Host styling is reset against inherited page CSS. Closing removes its host completely.

Scanning yields every 100 inspected nodes, supports abort signals and stops after 4,000 eligible inspected elements. Element/category truncation is reported. CSS aliases are resolved only after category caps to bound post-scan work. This is a bounded sample, not a comprehensive reconstruction of every state on every website.

Escape closes only the generator first. Mod+Enter is blocked while its modal is open. A preserved/wrapped controller event callback closes temporary UI synchronously before standard capture actions read the document. Cancelling a scan retains the previous completed result and restores its scope. Disposal also aborts board preparation, disconnects the observer/listeners, clears timers, revokes Blob URLs, removes UI and restores the prior event callback. The frame/closed-root board is generated only for copying; the scanner still does not inspect website iframe documents.

### Capture-engine isolation

Relative to 1.3.29, `js/h2d_toolbar.js` has only two reversible changes:

1. The optional local feature/clipboard helper attachment:

```js
,globalThis.PageCaptureDesignSystem?.attach(d,globalThis.PageCaptureDesignBoard?.createCopier({capture:Sn,serialize:zr,encode:Ir}))
```

2. An opt-in no-mutation scrollbar-manager branch:

```js
scrollbarManager:n.skipScrollbarHiding?{hide(){},show(){}}:new ft({analyticsTimer:L=>o("sb",L)})
```

Removing the attachment and restoring `scrollbarManager:new ft({analyticsTimer:L=>o("sb",L)})` reproduces every original pre-generator byte. A regression checks SHA-256:

```text
cd792a38fa05b99a91cc56912bd3ef5a020af9872130c0aaf46d8852554f3975
```

Normal page/element capture never passes the new flag, so its default behavior and existing clipboard writer are unchanged. The prior exact raw-HTML helper is untouched. No capture/tray refactor is hidden in the feature.

The worker only injects privacy/core/board/panel modules before the existing toolbar. Permissions, host permissions, extension CSP and the six capture RPCs are unchanged.

## Prior cleanup retained from 1.3.29

The previous local build contained substantial unused Figma account/calendar UI and Sentry/analytics code. Its account API and telemetry wrappers were already disabled/no-op stubs. The earlier review did **not** establish that that build was uploading captures to Figma; removing dormant code is not evidence of a previous data leak.

The active capture-code helper formerly called Chrome's local MHTML API. After the earlier raw-HTML clipboard change, that helper and its worker handler became unreachable and were removed. The native archive API was not a remote Figma API.

| Area | Cleanup retained |
| --- | --- |
| Worker account/file RPCs | Removed LOGIN, LOGOUT, IS_LOGGED_IN, GET_USER, GET_FILE, GET_FILES, SEARCH_FILES, CREATE_FILE |
| Legacy calendar integration | Removed calendar tab broadcasting and unrelated CLOSE_TAB RPC |
| Telemetry | Removed SENTRY_BREADCRUMB, SENTRY_EXCEPTION, TRACK, EXPERIMENT, Sentry SDK and unused toolbar telemetry/error hooks |
| Native code archive producer | Removed H2D_CAPTURE_CODE, Kc helper, pageCapture.saveAsMHTML reader, unreachable error mappings and pageCapture permission |
| Options stack | Replaced unused account/profile/branding/Redux/saga/UI modules with a local permission/status controller |
| Assets | Removed vendor.js, notices associated with removed/replaced bundles, MaterialIcons.woff2 and InterVariable-Italic.woff2 |
| Localization | Removed obsolete entries; 43 active English keys remain from the local cleanup |
| Onboarding | No tutorial components, steps, Get started action or tutorial routing |

### Active local paths retained

The worker accepts only these six capture RPCs:

- H2D_GET_TAB_ID
- H2D_OPEN_TOOLBAR
- H2D_CAPTURE_VISIBLE_TAB
- H2D_CAPTURE_ELEMENT_PREVIEW
- H2D_FETCH_ASSETS
- H2D_TOOLBAR_CLOSED

Messages are restricted to this extension ID. The resume operation must originate from its own options page. Background asset recovery validates inputs, rejects intranet/credentialed URLs, limits list size/concurrency/response size, and uses GET with no request body, credentials or referrer.

The rich clipboard markers `figh2d`/`figmeta`, `FIGMA_H2D_TOOLBAR_COMMAND`, local-storage prefixes, Figma-related DOM metadata and an inline SVG icon name remain intentionally. They are local compatibility identifiers, not remote integrations. Previously saved MHTML tray entries remain locally copyable.

### Existing capture network boundaries

`js/privacy.js`, used by both worker and capture script, denies known Figma/Sentry hosts, including subdomains of figma.com, figma.site, figmausercontent.com, Sentry hosts and Figma-prefixed cloud-storage hostnames. Guards run before asset reads/new video requests; image preparation skips denied destinations. Asset fetch redirects are rejected.

No account client, telemetry transport, API upload action, POST/PUT upload implementation or script/CDN dependency remains in the runtime. The old SDK stubs were removed, not merely disabled.

**Existing design capture can still retrieve non-Figma page images/SVG assets.** Direct capture reads may use same-origin website credentials. Worker recovery omits credentials and remains subject to the unchanged `connect-src 'self'` policy. A failed recovery returns missing-asset information locally rather than uploading diagnostics.

This is not a network firewall or a zero-network browser mode. The website, browser or destination application can make its own requests. Manual clipboard paste/share is a deliberate user action. Blocking Figma-hosted assets can reduce capture fidelity. Generator downloads and the visual-board clipboard are separate output choices. Neither creates/binds shared Figma variables/styles/components or applies tokens to existing layers.

### Size context

The 1.3.29 cleanup reduced runtime files (excluding tests/Markdown) from **1,808,556 to 559,548 bytes**, and JavaScript from **911,064 to 186,609 bytes**. These are historical pre-generator figures.

The 1.4.0 runtime was **610,747 bytes**, including **237,809 bytes of JavaScript**. The 1.5.0 runtime was **636,630 bytes**, including **263,692 bytes of JavaScript**. Version 1.6.0 is **656,033 bytes** across 18 runtime files, including **283,095 bytes of JavaScript**. It adds about 19 KB of local code, with no font/image/framework bundle.

## Verification

### 144 Node checks

The existing 46 regression/privacy checks remain. They cover permission routing, retired tutorial URLs, asset/locale references, service-host blocking, safe ordinary URLs, privileged-recovery restrictions/settings, the exact local RPC allowlist, rejection of retired commands, sender checks, clipboard-format retention and removal of unused files/permissions.

The additional 34 generator checks cover normalization/deduplication, matching CSS-variable naming, extraction categories, hidden border handling, spacing/radius limits, no unrelated custom-property payloads, sanitized URLs, exclusions, invalid/duplicate names and expanded typography collisions, evidence-preserving immutable merges, safe self-contained exports, token caps, idempotent initialization, unchanged permissions and exact capture-engine isolation.

The 35 additional polish checks cover strict explicit-sRGB parsing, unsupported/malformed colors, known contrast ratios and AA/AAA boundaries, alpha compositing, no assumed underlays, symmetry/bounds, similarity for all six categories, exclusion/no-mutation/limits/determinism, safe typography scaling and unchanged exports after review calculations.

The **29 editable-board checks** cover construction of all six token categories, real text/cards/alpha rectangles, safe typography, original metrics/elliptical axes/signs, reviewed names/exclusions/merges, immutable review state, safe text/URL handling, validation/category/token/layout/clipboard-size bounds, Unicode/metadata/format parity, unexpected assets, optional/idempotent loading, private engine options, resource-blocked closed-root frame setup, missing clipboard support, cancellation before/during/after serialization, capture/serialize/encode/native-write failures, final-write non-revocability and complete cleanup. Source/static guards rule out network/storage/clipboard-read/native-variable APIs in the adapter.

### 14 existing Chromium smoke checks

Actual toolbar clicks exercise raw HTML/native clipboard writing, editable-design capture with an embedded local image, rich clipboard output, Copy all, element selection, Discard all and close. Other checks cover fresh-install/no-tour behaviour, permission/file retries, real pending-request resumption/cleanup, known-host RPC rejection, GET-only fixture assets and absence of remote request attempts/uncaught page errors.

Permission-denial/file-access cases use targeted browser API mocks. Capture, selection, worker resumption, previews, local asset embedding and clipboard writes use real extension APIs.

### 25 generator Chromium checks

1. More retains the three established capture actions.
2. More menu/Escape removes its temporary host.
3. Scanner/UI excludes itself and hidden content, handles visible descendants, avoids phantom HTML SVG paint colors, and retains real SVG paint.
4. Actual JSON download contains all six categories but no fixture body text/input values/unrelated secrets.
5. Native rename/search interactions and export validation work.
6. Exclusion affects actual downloads.
7. Explicit canonical merge preserves original evidence and user-name provenance.
8. Actual CSS/HTML downloads preserve edits and have no remote dependencies.
9. Mod+Enter does not capture while the modal is open.
10. Reanalysis confirmation/cancellation and viewport scope behave correctly.
11. Narrow (390px) and short (400–480px tall) layouts stay usable and in bounds; source DOM, form value, viewport/scroll position and capture-button styles remain unchanged after generator use.
12. Abort, 4,000-element truncation, cancelled-scope restoration and reopening work.
13. Existing toolbar drag/bottom docking still works; More positions above it.
14. An actual raw-HTML clipboard action works after generator use, without generator markup.
15. A worker capture command closes the generator synchronously before raw HTML is read.
16. Toolbar disposal/reinjection leaves no temporary host or duplicate More control.
17. Generator/exports add zero HTTP requests and produce no uncaught page errors in these fixture flows; exported HTML also opens successfully in a real browser.

The eight added browser checks exercise larger alpha previews, inspectors for all six categories/system-font-only specimens, 21:1 contrast and swapping, foreground-alpha composition and unsupported/background-alpha handling, selector focus/list-scroll preservation, actual unchanged JSON downloads before/cancelled suggestion approval, explicit suggested canonical merging and exclusion filtering, and review panes on narrow/short screens with confirmed reanalysis. These checks run before the 17 existing generator regression groups above.

### 15 editable-board Chromium checks

1. Real Copy click/native rich clipboard decode: one complete six-category version-2 board with individual text/swatches/effect/cards, not an image.
2. Isolated frame/second closed root, same-realm nodes, no public board/source data, opt-out flags, no bindings/assets/tray/model changes or source DOM/layout/scroll/form/stylesheet mutations.
3. Full-height positive layout and editable text/shapes; actual board preview rendered/visually inspected.
4. Invalid-name blocking; actual renames/exclusions/canonical merges; all included tokens copied regardless of search/category/selection.
5. Disabled conflicting controls, real cancellation, immediate frame cleanup and unchanged native clipboard.
6. Escape after real snapshot capture, no late write, and preserved review on reopening.
7. Background raw-HTML capture preempts board preparation without board/UI leaks or delayed writes.
8. Mocked clipboard denial yields an error, preserves the old native clipboard and re-enables controls.
9. Injected capture/serializer/encoder failures do not write or leak a frame.
10. The actual 12-second deadline aborts held preparation and cleans up.
11. Final native-write phase removes frame first, disables cancellation, and only reports success after resolution.
12. 390px narrow/short and 1280px short layouts retain reachable copy controls; board width stays 1120px without source resizing by the feature.
13. A full **480-token** board copies 480 cards/six sections at full height without truncation/model changes.
14. Strict source CSP including `frame-src 'none'` and `style-src 'none'` still permits local isolated board layout/copy without subresource requests or source writes.
15. Disposal/reinjection leaves no temporary UI, remote HTTP attempts or uncaught page errors.

All three browser suites use local fixtures and block/record remote requests. Native clipboard/window-focus suites are run **sequentially**; denial/failure/hold hooks and closed-root instrumentation are test-only and absent from runtime files. A parallel initial smoke run hit Playwright's close-target timing race on a self-closing options page; the unchanged suite passed serially. Screenshots were inspected for the board and desktop/mobile/short/strict-CSP copy controls, as well as retained review/docked layouts. The release ZIP was extracted and all Node/browser suites rerun against that extracted folder.


### Limitations / not tested

No live Figma session/paste/upload, arbitrary authenticated websites, every browser version, every CSS feature or complete offline capture fidelity was tested. A decoded editable-board snapshot is not proof of successful live Figma paste, native-variable import or exact destination rendering. Native shared variables/styles are intentionally not produced by this feature. Generator styles are a current-view sample, not automatic component/semantic/variant reconstruction.

The earlier raw-HTML helper still omits the doctype, may include the established toolbar, and has no new clipboard-denial fallback. Broad capture-engine, storage and success-timer refactoring was not part of this feature. Source titles/paths remain reviewable metadata, not anonymized content. Repository changes have not been committed or pushed.


## 1.7.0 addendum: Viewports
- New background command `H2D_CAPTURE_VIEWPORT` opens a temporary popup window (`chrome.windows.create`) on the requesting tab's own http(s)/file URL, injects the existing local toolbar, runs the existing local `capture_page`, reads the result from local storage and closes the window.
- Only the originating tab (frame 0) may call it; the URL is taken from the sender, never from the message; width/height are range-checked.
- No new permissions, hosts, network clients or telemetry were added.
