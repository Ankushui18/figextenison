# Privacy and verification audit

Version: **1.8.2**

Review/test date: **21 October 2026**

## 1.8.2 — wireframe fidelity

- **Shape of the change.** Only `extension/js/wireframe-core.js` changed. The
  popover, persistence, capture pipeline and clipboard contract are identical to
  1.8.1, so **Capture design** still writes the wireframe and nothing else moved.
- **No hue can reach Figma.** Every colour-bearing key (`*Color`, `fill`, `stroke`,
  `caretColor`, `accentColor`, `columnRuleColor`, …) is rewritten to a grey, and
  alpha is composited over the real backdrop first. A 6% black hover veil becomes
  near-white; it can no longer become a dark slab. A 5%-opacity veil that sits
  inside a painted sibling is dropped instead of being re-toned.
- **Output is rebuilt from a whitelist.** `computedStyles`, `variableStyles`,
  `sourceProps`, pseudo-element styles, `placeholderUrl`, `content` and
  `scrollRect` are never copied, so no second style channel or asset pointer can
  carry a page colour or image into the paste.
- **Faithful tones.** The grey ramp now reaches dark values, so a black footer
  stays dark at High, a brand band reads mid grey and white cards stay light. Text
  is inked against its own surface, keeping labels readable on dark sections.
- **Placeholders instead of blanks.** A `div` that paints a background image is a
  placeholder (not a lost card); real children are kept and the label is skipped
  so the two cannot collide.
- **Verification:** `npm test` — **293 checks, 0 failures**, including 34 wireframe
  checks. `scripts/wireframe-preview.js` renders a synthetic Dribbble-shaped page
  through the real transform for visual review.
- **Inventory:** **22 files / 757,920 bytes**, of which **12 JavaScript
  files / 384,178 bytes**. Manifest version is **1.8.2**.

## 1.8.1 — wireframe as a capture setting

- **Shape of the change.** Wireframe is an option in the Viewports popover; the
  normal **Capture design** copy writes it. `extension/js/h2d_toolbar.js` and
  `extension/js/design-system.js` are byte-identical to 1.7.9 (`npm test` hashes
  the bundle with the known hooks stripped), so the capture engine, the toolbar
  and the design-system panel are provably untouched.
- **Two seams only.** `js/wireframe.js` decorates the Viewports popover when it
  opens and wraps `PageCaptureSafety.prepareClipboard` once. The wrapper delegates
  unchanged when the option is off.
- **What a wireframe can contain:** measured geometry, text, colours reduced to a
  fixed grey ramp and vector placeholders. It contains **no images, no page CSS,
  no fonts, no canvas pixels, no cross-origin frame content and no form values** —
  inputs contribute their placeholder only. The transform empties `assets` and
  strips URL attributes, so no image data can be embedded and no asset recovered.
- **No new permissions and no new network code.** `tests/wireframe.test.cjs` fails
  the build if `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`, clipboard
  reads/writes or `chrome.runtime`/`chrome.tabs`/`chrome.scripting` appear in
  either file. The only storage use is the saved choice (`pc_wireframe_v1`).
- **Nothing is mutated.** The stored capture is left as captured, so the wireframe
  is reversible; a record that cannot be rewritten is copied unchanged.
- **Inventory:** **22 files / 22 bytes**, of which **12 JavaScript
  files / 384,178 bytes** of the **22 files / 757,920 bytes** shipped. Manifest
  version is **1.8.2**.

## 1.8.0 — wireframe module (first attempt)

- **Added:** `extension/js/wireframe-core.js` (pure planning: levels, grey ramp,
  text bars, limits) and `extension/js/wireframe.js` (scan, render, preview panel,
  copy). Both are readable source, injected before `js/h2d_toolbar.js`. The only
  change to existing code is one attach hook in `h2d_toolbar.js` and one menu item
  in `design-system.js`; stripping that hook restores the 1.7.9 toolbar byte for
  byte (`tests/design-system.test.cjs` still hashes the rest of the bundle).
- **No new permissions.** The manifest still requests `storage`, `tabs`,
  `unlimitedStorage`, `scripting`, `clipboardWrite` and `<all_urls>` host access.
- **No network code in the new files.** `tests/wireframe.test.cjs` fails the build
  if `fetch`, `XMLHttpRequest`, `createObjectURL`, `chrome.runtime`/`chrome.storage`,
  a `src=` assignment or `srcdoc` appears in either file.
- **What a wireframe can contain:** measured geometry, text, colours reduced to a
  fixed grey ramp, and vector placeholders. It contains **no images, no page CSS,
  no fonts, no canvas pixels, no cross-origin frame content and no form values** —
  inputs contribute their placeholder only.
- **Reading, not writing.** The scanner calls `getBoundingClientRect`,
  `getComputedStyle` and `Range.getClientRects`; it never writes an attribute,
  scrolls or resizes the page. `tests/wireframe.test.cjs` asserts the source DOM is
  byte-identical after a scan.
- **Isolation and cleanup.** The board renders in a `sandbox="allow-same-origin"`
  iframe carrying `default-src 'none'`, styled through CSSOM only. The temporary
  frame is removed in a `finally` block after success, failure or cancellation,
  and preparation is bounded at 12 s / 16 MiB.
- **Inventory:** **22 files / 786,506 bytes**, of which **12 JavaScript files /
  412,764 bytes**. Manifest version is **1.8.0**; `tests/design-system-board.test.cjs`
  tracks that version.
- **Verification:** `npm run verify` — **293 checks, 0 failures**, including the
  repository hygiene checks (version handshake, layout, docs links, quoted counts).

## 1.7.9 — packaged-leftovers cleanup and repository layout

This entry removes files and moves the runtime, but changes no capture,
clipboard, permission or network behavior.

- **Runtime moved into `extension/`** (manifest, options page, `js/`, `font/`,
  `img/`, `_locales/`, icons). Chrome loads exactly the same file set and the
  service worker's `importScripts("core.js", "privacy.js")` and the injected
  seven-file list are unchanged, because both resolve relative to the extension
  root. `npm run check` now fails if a runtime file appears outside `extension/`.
  Paths in the historical sections below are written relative to today's
  `extension/` (e.g. `js/background.js` → `extension/js/background.js`).
- Documentation, CI, tests and scripts stay at the repository root; nothing under
  `extension/` was rewritten for the move, which is why the capture and privacy
  behaviour is provably untouched.

- Five unreferenced files are deleted: `js/vendor.js` (340,906 bytes), `js/vendor.js.LICENSE.txt`, `js/background.js.LICENSE.txt`, `font/MaterialIcons.woff2` and `font/InterVariable-Italic.woff2`. Nothing in `manifest.json`, `options.html`, the service worker (`importScripts("core.js", "privacy.js")`) or the injected file list referenced them; the only reference in the repository was the test that asserts they are gone.
- The removed webpack bundle was the last place carrying an unused Figma/Sentry client stack (a `chrome.runtime.getURL("img/toolbar-logo.png")` modal, a Sentry breadcrumb middleware and redux/saga helpers). No live code path used it, but shipping it widened the review surface and contradicted the documented cleanup.
- Verification: `node --test tests/*.test.cjs` passes **259 checks, 0 failures**. The prior run failed exactly one check (`Unused bundles, their font assets and the native archive permission are removed`) because those files were present in the checkout.
- Runtime inventory after deletion: **20 files / 719,848 bytes**, of which **10 JavaScript files / 346,106 bytes** (manifest, options page, four icons, `font/InterVariable.woff2`, the locale file, two SVG icons and the ten JavaScript modules). Manifest version is **1.7.9**; `tests/design-system-board.test.cjs` tracks that version. A `.gitignore` now keeps `node_modules/`, browser-test artifacts and packaged ZIPs out of the working tree.
- Permissions (`storage`, `tabs`, `unlimitedStorage`, `scripting`, `clipboardWrite`), host permissions, extension CSP, locale strings, storage schema and the six local RPCs are unchanged. The Chromium suites were not re-run here (no Playwright/Chromium is installed in this environment); their fixtures and code paths are untouched by this deletion.

## Historical release: 1.7.6 P2 explicit internal-scroll-area capture

Baseline: the exact delivered **1.7.5 ZIP**, SHA-256 `45db78c5d4de6566ce7553ed65a09d5f64dedb22d5dfa632b767ad076535104e`. Work is isolated in `figextenison-scrollarea-audit`; the final 1.7.5 ZIP and previous workspaces are unchanged. This P2 adds an explicit capture path for one selected vertical scroll area. It does not silently expand every overflow element.

### Reproduction and chosen safety design

- The controlled fixture uses a fixed **1280×813** viewport. Its `#app` element is `overflow-y:auto`, 813px tall, and contains 2,518px of content, including a final footer. The document root stays 813px tall. Baseline `Capture design` therefore serializes the final footer at **y=2,304**, outside the 813px root. Ordinary **Select element** also remains an 813px viewport-sized capture.
- The new **Capture scroll area** action asks the user to select a target and accepts only an actual vertical scrolling element (`overflow-y: auto`, `scroll` or `overlay`, with `scrollHeight > clientHeight`). An ordinary element is rejected; no page-wide scan or automatic expansion of dropdowns, carousels or other overflow nodes is introduced.
- Full-height normalization is opt-in and operates on the serialized H2D model, not source styles/DOM. It rebases descendants from the chosen element's current `scrollTop`, expands only the root height to the content height, preserves the selected responsive width and corrects the model's root scroll metadata. This means a scroller already at scrollTop 560 still includes its first and final content sections without scrolling the live page.
- Capture preview remains a screenshot of the selected element's real viewport bounds. The output/model height is not passed as if it were a page screenshot crop.
- The new scroll-area logic does not set source `scrollTop`, resize the viewport, open a tab/window, navigate to the source URL or add a network/recovery path. The controlled fixture has no external assets and recorded zero remote requests. Browser verification compared source outerHTML, document scroll, app scrollTop and viewport dimensions before/after. Existing temporary asset decode/scrollbar helpers restore their original state; the established asset-handling policy remains unchanged.
- This captures content already present in the DOM. It does not invoke infinite loading, reveal virtualized/offscreen app rows, rerun page scripts, or expand nested scrollers inside the chosen area. Sticky/fixed transformed content and site-specific rendering still require validation. Horizontal-only carousels are not the selected vertical-scroll target.
- Existing current-page, visible-section, responsive no-new-tabs, clipboard and raw **Capture code** paths remain separate. No permissions, host permissions, CSP, service worker asset policy or remote recovery boundary changed. No live Figma paste is claimed.

### Verification

**259 Node checks passed.** The existing eight Chromium suites passed sequentially after the change (**101 groups**: 14 capture, 25 generator, 15 editable-board, 11 viewport, 10 responsive, 8 full-page, 3 image-completeness, 15 capture-safety); the dedicated internal-scroll-area Chromium fixture also passed. The unchanged Viewports suite hit its known intermittent 200px-open timing failure once in the combined run and passed all 11 groups on isolated retry. That fixture directly measured default document/section capture, explicit full-area model capture at scrollTop 0/560, the real toolbar action, and a 393px responsive viewport. It verified **2,518px** full height, the final section inside the root, widths **1280px / 393px**, unchanged live DOM/scroll/viewport, no extra page, and zero remote requests. Browser actions use the existing manual/local clipboard workflow; no paste into live Figma was attempted.

Runtime: **721,055 bytes / 20 files**, including **346,905 bytes of JavaScript** (a 4,218-byte increase over 1.7.5). The archive also includes the new controlled fixture and browser regression. ZIP inventory/CRC, extracted bytes, version, JSON/JS syntax, and extracted-package tests are checked before delivery. No Git commit, push or upload is performed.

## Historical release: 1.7.5 P2 image-completeness pass

Baseline: the exact delivered **1.7.4 ZIP**, SHA-256 `1efe3f3fe08f6abac063398d494bccfdf9ad4f51fabdcac83b43ae1306b674bb`. Work was isolated in `figextenison-image-audit`; the 1.7.4 ZIP and prior P1 workspace remain unchanged. This pass repaired explicit lazy-image selection and reports aggregate media-copy outcomes; it did not claim a live Dribbble capture or Figma paste.

### Source selection and responsive images

- Reproduced the defect with a controlled `https://example.com/pixel.svg` whose loaded intrinsic size is 1×1 and whose `data-src` supplies a real image. Before the patch, `imageSource` returned the placeholder rather than the explicit target.
- A loaded image of at most 2×2 intrinsic pixels is treated as a placeholder only when an explicit page-provided candidate exists. A larger, successfully loaded image continues to win over lazy metadata. No source attributes are changed in Browser/section capture; responsive capture changes only the isolated copy.
- The explicit lazy-source allowlist now includes `data-src`, `data-lazy-src`, `data-original`, `data-original-src`, `data-actualsrc`, `data-lazy`, `data-url`, `data-image-src`, `data-hi-res-src`, `data-echo`, `data-flickity-lazyload` and `data-cfsrc`. Lazy `srcset` variants include `data-srcset`, `data-lazy-srcset` and `data-original-srcset`, including active `<picture>` sources. Standard `srcset` remains supported.
- Existing dimensions/DPR bounds, template resolution, page-base URL resolution, blocked-host/protocol filtering and image-fetch boundaries remain. Active picture media is evaluated at the target responsive width. Open-shadow image copies are also visited. No guessed URLs, new tabs/windows, extra site-script execution, permission changes, host grants or CSP relaxations are introduced.

### Aggregate copy status and privacy

- After a successful rich clipboard write, the established transient success notice reports the number of image assets embedded and the number **not embedded** across the captures being copied. Rejected/unavailable requests remain failures; no recovery guarantee is implied.
- The diagnostic is counts only: no image URL, hostname, page text, alt text or raw asset error is placed in UI status. A separate per-asset URL list was not added to avoid exposing private/credential-bearing page URLs. Assets remain in the user-requested local capture/clipboard data as before.
- Remote worker recovery remains governed by the existing `connect-src 'self'` CSP, GET-only/omitted-credential/redirect restrictions, public-URL validation and image limits. Blocked/unavailable assets are reported as not embedded; they are not fetched by relaxing policy.

### Verification

Dependency-free tests cover HTTP 1×1 precedence, source non-mutation, additional lazy metadata/srcset patterns, active picture media, real-source precedence, safety-filter preservation, aggregate counts and the no-URL diagnostics contract. A local Chromium extension test exercised actual Browser and 393px responsive captures and native rich clipboard output. In each capture, five valid candidates were embedded and one controlled 404 stayed unembedded; the post-copy status reported **10 included / 2 not embedded** across the two copied snapshots. The live source image URLs/attributes, viewport and scroll were unchanged; no extra page/window/document visit or remote host request occurred. Counts in this section are from the local fixture, not a live site.

**258 Node checks + 101 Chromium groups passed**: 14 capture, 25 generator, 15 editable-board, 11 viewport, 10 responsive, 8 full-page, 3 image-completeness and 15 capture-safety. All browser suites passed against the extracted 1.7.5 ZIP in individual sequential runs. Separate repeats exposed intermittent timing timeouts in the unchanged Viewports browser-test script (opening at 200px or waiting for toolbar teardown); its 11-group run passed on retry, and the 1.7.4 baseline suite also passed. Viewport capture logic was not modified in this image pass. The real extension/native clipboard fixture reports **5 included / 1 not embedded** for each of Browser and 393px copies, and **10 / 2** for the combined paste; its one 404 stays unembedded. The fixture and static/privacy tests record no external hosts, no new document visits/tabs/windows and no source DOM/scroll/viewport changes. No live Figma paste or public-site revalidation was performed. Incomplete capture of intentionally hidden content, nested scrollers, dynamically-generated content and remote assets blocked by browser/CSP/site policy remains possible.

Runtime: **716,837 bytes / 20 files**, including **343,591 bytes of JavaScript** (a 3,993-byte increase over the 1.7.4 runtime); the archive also carries the additional local image-completeness browser test. ZIP inventory, CRCs, extracted bytes, version, JSON/JS syntax and regression suites are checked before delivery. No Git commit, push or upload is performed.

## Prior release: 1.7.4 P1 stability/privacy repair

Baseline: the delivered **1.7.3 ZIP**, SHA-256 `8ec22315c8851e187aab4c63aafd480e220b0a4985343822d327a08885036c78`. Work is isolated in `figextenison-stability-fix`; previous release files/workspaces are not changed. The user authorized starting the four P1 audit fixes, not a redesign, new-tab capture or a broader network policy.

### Visual privacy and stored data

- The engine skips nonvisual form controls based on their native hidden type, actual layout and computed display/visibility/opacity/content visibility. Off-screen but normally rendered controls are not considered hidden just because they are below the viewport. The source DOM is never cleared/edited to implement redaction.
- Password values and nonvisual control-value IDs (button/option/select and checkbox/radio/file/image input values) are removed, preserving visible text, labels and checked/selected state. The serializer also sanitizes snapshot trees before storage, and clipboard preparation sanitizes older documents as defense in depth.
- Ordinary legacy snapshot records are cleaned on load with IDs/previews preserved. JSON reading uses a budget; corrupt/oversized old records are kept locally with an export-blocked marker, not silently deleted. Their original local data can remain until the user deletes/recaptures them. Legacy raw/code-layer records and explicit Capture code are intentionally not silently rewritten. This is a scoped visual-form privacy fix, not universal PII/secret removal from visible content, source titles, asset URLs, links or raw HTML.

### Copy correctness and byte budgets

- New dependency-free `js/capture-safety.js` handles preparation, privacy, UTF-8 counting, owned async cleanup and copy phases. The worker injects it before the existing capture modules. Normal copy failures no longer return silently; automatic failures identify that the capture was saved and point to existing Copy all. Source JSON, private URLs and raw exception contents are not echoed in these messages.
- All rich design batches use **48 MiB JSON / 64 MiB HTML** bounds. This extends the previous legacy-only guard to snapshot-only batches. Raw record bytes are counted before parse; combined bytes are checked before base64; expected HTML/base64 size is checked before the expensive data encoding; final Blob size is checked again. Counting yields regularly and respects cancellation. The board retains its existing separate **16 MiB** cap. This does not claim that all capture-time image/DOM allocations are bounded by the copy budget or that out-of-memory conditions are impossible.
- Preparing is cancellable; native writing is explicitly marked and protected against overlapping raw/design/selection commands. Native writes cannot be undone once submitted. Cancel/disposal after a completed storage request cannot unsave it automatically; already completed captures are retained. Raw HTML output is still the original documentElement.outerHTML, without applying visual redaction or rich-copy size policy. Its write phase is protected and stale raw success timers cannot overwrite a newer error.
- Error text is constrained within the established toolbar, with full tooltip/live-region text and existing compact icons when needed. The viewport width cap is preserved through transitions for ordinary windows. Below 320px the historical toolbar behavior is retained so the already-tested tiny Viewports trigger is not squeezed to an unusable hit box; this is not a claim that every toolbar control fits a 200px window. Success toasts no longer consume clicks and are cleared on a new action. No new panel, palette or branding redesign is introduced.

### Asset cancellation and ownership

- A single capture signal now reaches image fetch/response work, SVG external references and collector waits. Per-asset timeouts remain bounded. Abortable FileReader encoding and detached image conversion release handlers/object URLs; cross-origin video conversion only operates on an owned temporary element and captures the source time once. Original page video playback is not played/paused/reloaded by this cleanup. Canvas encoding and other native operations without cancellation APIs may finish internally; abandoned results are ignored rather than committed.
- Source worker recovery uses **the same H2D_FETCH_ASSETS command** with an optional random requestId/cancel payload. Jobs are scoped to the authenticated sender tab/top frame. Another tab/frame cannot cancel them. Malformed/duplicate IDs are rejected, cancellation-before-registration is remembered briefly, tombstones are bounded to 128/10 seconds, active jobs are removed in finally, and tab closure aborts its jobs. Older payloads remain compatible with their existing five-second worker timeout.
- HTTP contexts without crypto.randomUUID use crypto.getRandomValues to create an RFC4122-style request ID. IDs do not contain source data. Cancellation messages contain only the ID. No new RPC, Chrome permission, host grant or CSP exception is added.
- Existing public/sensitive URL checks, omitted recovery credentials, GET-only reads, redirect errors, MIME/10 MiB image limits and service denial remain. **Remote recovery blocked by connect-src self is not unblocked here.** That P2 policy decision requires separate approval; do not confuse valid batching/cancellation with permission to read every remote asset.

### Verification

**242 Node checks + 98 Chromium groups pass**: the existing 195 checks plus 47 safety checks; 14 capture + 25 generator + 15 editable-board + 11 picker/viewport + 10 responsive + 8 full-page + 15 safety browser groups. Suites run sequentially against source and the extracted release, using real controls, storage and native clipboard payloads where applicable. Test instrumentation/read grants, reduced test budgets and held/failed operations are not runtime behavior.

The new browser suite covers legacy redaction without lost work, hidden/CSS-hidden/textarea/select/password and nonvisual-ID exclusion, preserved visible input/option/button/checked state and source DOM, denied automatic writes with unchanged old clipboard, native manual retry, budgets before encoding/writing, safe encoding failures, cancelled downloads/preparation, completed-capture retention, irreversible writing with guarded concurrent commands, long errors/retry at desktop/600/390px, raw HTML unchanged, stale timer protection, disposal/reinjection and real content-script-to-worker cancellation. Unit tests additionally cover UTF-8/surrogates, worker owner isolation, late and pre-cancelled promises, FileReader cleanup, temporary video/image cleanup, fixed video times, malformed/early cancellation and HTTP-context IDs.

A normal anonymous live Dribbble capture-data check was repeated with the normal **10-second Browser snapshot signal**. Browser and phone roots remained **4795px / 10772px**, with zero empty/unresolved image sources, 85 artwork/avatar image elements and unchanged source width/scroll. Third-party advertising/tracking and an inactive rotating video remained unavailable in some runs; no policy bypass was attempted. A live Figma paste remains unverified, and no universal website or minimum-browser-version certification is claimed.

Runtime: **712,844 bytes / 20 files**, including **339,797 bytes of JavaScript**. Relative to 1.7.3, changes are the new safety module; targeted toolbar/worker logic; the manifest version; and forwarding the board's active signal to its unchanged clipboard encoder format. The other **15 retained runtime files**, including viewport/full-page rendering, generator/scanner/review core, assets, options, locale and privacy policy, are byte-identical. JSON/JS syntax, package inventory/CRC/extracted bytes and regression suites are checked before delivery. No commit/push/upload to the repository is performed.

### Still separate work (as of 1.7.4)

At the 1.7.4 cut, HTTP-hosted placeholders and asset-health reporting were deferred; this 1.7.5 pass addresses those two scoped items. Primary internal scrolling-container capture, a remote-recovery policy change, project/draft persistence, permission minimization and live-Figma release acceptance remain separate. Raw capture remains raw; visible private content is not automatically anonymized. Do not claim all audit items are fixed by this patch.

## Historical 1.7.3 full-page completeness repair

Baseline: public **1.7.2**, commit **869174d6456f3b0494578c3fdd52d01b572ad476**. Work is isolated in `figextenison-fullpage-fix`; the previous 1.6/1.7.2 workspaces and release ZIPs remain unchanged. No repository commit/push is performed.

### Reproduced defects

The user reported that selecting a section preserves images, while full-page captures miss images/lower sections in both Browser and extra widths on **dribbble.com**. A controlled 30-card lazy gallery reproduced both causes: the page had a **3928px scroll height but an 813px root rectangle**, and only **6 of 30 images** had real current sources before scrolling. Selected card capture, once in view, contained its real image. The 1.7.2 Browser snapshot kept the 813px frame and only six real image URLs; its phone copy kept a 900px frame for a 9696px page.

Normal browser readiness subsequently loaded the real anonymous Dribbble page (its initial HTTP response was a 202 challenge). **No CAPTCHA solving, browser-fingerprint overrides, alternate proxies, authentication or access-control bypass was used.** The real 1.7.2 baseline reproduced an **813px root for a 4795px document**, **40 empty image sources** in Browser, and **37 empty image sources / an 813px root for a 10772px document** in phone capture.

### Scoped implementation

1. The readable existing `js/viewports.js` gains common full-page helpers. The engine calls `expandFullPage` only for Document capture or the explicit `captureFullPage` option used by responsive HTML-root copies. It enlarges only the snapshot root/height constraints, not the live DOM, viewport, width, child coordinates or selected-section/board geometry.
2. `imageSource` reads explicit `data-src`, lazy/original variants and `data-srcset`, respects active picture media and valid loaded sources, resolves relative assets and `{width}/{height}` (including encoded templates), and bounds requested image dimensions/DPR. It reuses existing asset URL/privacy validation. No image URLs are guessed. `currentSrc` in the snapshot and the collected asset key use the same resolved URL. Empty source attributes are not treated as the document URL.
3. Only the isolated responsive copy activates those lazy image URLs before image/layout capture. The live Source DOM is not scrolled/resized or assigned new image src/srcset values. The decoder temporarily changes loading/decoding as before but now restores the original attributes in finally on success, failure, cancellation or timeout. Pending decode waits race the active signal; a pre-cancelled decode does no work.
4. The serializer's optional helper chunks recovery into **64-URL RPC payloads**, preserving the unchanged worker's validation and bounded image-only recovery. It deduplicates, accepts only requested results, continues after an independent batch failure and stops on cancellation. No new RPC, network permission, host permission, CSP exception, account/upload path or redirect relaxation is added.
5. Existing source raw-HTML copying, native clipboard/metadata encoding, generator/scanner/review/board modules and selected-section flow remain. Native clipboard writes and video/other asset-stage work retain their existing cancellation/fidelity limits. Hidden visual-snapshot form-value handling, silent automatic-copy failure feedback and general design-batch byte budgets from the separate audit are **not claimed fixed by this release**.
6. Remove the same five unused vendor/font/license leftovers that were still present in the public 1.7.2 upload. The release ZIP already excluded them; the public copy otherwise matched all 35 release files. Their presence is not evidence of an active telemetry/upload path. All retained runtime files except the toolbar, viewport helper and manifest are byte-identical to 1.7.2.

### Verification and remaining limits

**195 Node checks + 83 Chromium groups pass** (14 capture, 25 generator, 15 board, 11 picker/viewport, 10 responsive, 8 full-page). The new gallery suite uses real native controls/storage/clipboard: Browser and 393px copies each include **30 real embedded images**, all captions/footer, full 3928px/9696px roots and the correct unchanged viewport rectangles. It proves no source HTML/value/scroll/viewport changes, no new capture tab/window/document visit, no invalid template requests, preserved selected-section sizing, scrolled-source coordinates, 130-asset recovery in **64/64/2** batches, and cancellation of a never-settling image decode. New pure tests cover URL/source selection, unsafe destinations, root constraints, original attribute restoration and batch failure/abort behavior.

A separate real-site check after the fix captured the actual Dribbble page with **4795px Browser / 10772px phone** roots, **zero empty image sources and zero unresolved templates**. An initial successful run contained 92 image elements; a repeat had 93 as site ads varied. The repeat embedded **94 Browser / 93 phone** assets. Three remaining failures were third-party ad/tracking image endpoints; an earlier rotating video ad also exposed the existing inactive-video limitation. Intentionally CSS-hidden images have zero bounds on some layouts and are not forced visible. This is not a claim that every third-party resource can or should be retrieved.

Public CDN PNG capture was separately checked with real `cdn.dribbble.com` URLs and explicit URL-template resolution; native Blob data was embedded successfully. Only aggregate real-site metrics/asset error hosts were recorded in scratch diagnostics, not raw page HTML, form values, cookies, captures or clipboard payloads. The deterministic release suites use local fixtures and no remote resources. **A paste into live Figma remains unverified.**

Full-page height refers to the current document, not an unlimited feed or arbitrary nested scroll containers. Missing app-generated DOM, Load more/infinite pagination, closed roots, blocked resources, font substitution, video and destination behavior remain limitations. No automatic source scrolling/clicking, source URL reload or JavaScript breakpoint rerun is introduced.

Runtime: **694,017 bytes** / 19 files, including **320,970 bytes of JavaScript**. **16 retained runtime files** are byte-identical to 1.7.2; worker/RPC/permission/CSP rules are unchanged. Release ZIP CRC, complete byte inventory, JSON/JS syntax and extracted-package suites are checked before delivery.

## Historical 1.7.2 in-page responsive capture

**User correction:** keep the 1.6 current-page workflow, produce genuinely responsive extra screens, and never open another tab/window or resize/reload the actual page. The 1.7.0 temporary-window strategy was retained by the earlier dropdown-only fix; this release replaces it rather than claiming its original site-specific failure was reproduced (no failing public URL/error was supplied).

### Implementation and boundaries

- Remove `captureViewport`, all capture-window creation/resize/storage-polling code, and **H2D_CAPTURE_VIEWPORT**. The worker returns to its **six local capture RPCs** and injects the new dependency-free `js/viewports.js`. Existing permission-help tab opening is retained; extra-width capture never uses it to visit the source URL.
- Keep the original Browser/normal single-page capture and rich clipboard path. Only extra widths call the local adapter. Its iframe has **no src/srcdoc navigation**, lives in the toolbar's ignored closed root, uses `sandbox="allow-same-origin"` without scripts/forms/popups/top-navigation, and adds script/connect/object/frame/form restrictions. Static literal document initialization establishes standards mode; the website HTML is never passed to document.write/innerHTML.
- Import the current DOM into an inert parent-realm document before adoption. Source script/event handlers, refresh/CSP/base/preload metadata and embedded navigation are removed/neutralized. Scripts and custom-element constructors are not rerun. Current live form properties, text, readable CSSOM/adopted sheets and open shadow roots are carried over. Browser-supported canvas pixels are copied as canvas content, as with normal snapshot capture.
- Re-evaluate CSS in an actually sized iframe viewport. Readable sheets/imports are serialized with original stylesheet-relative asset URLs and media/supports/layer conditions into that frame's constructed sheets. CSSOM-unreadable cross-origin styles keep their normal stylesheet links/cascade; stylesheet loads must succeed. Current CSSOM changes to readable links are preserved as well. Empty/blocked source sheets are not retried as new styles. Known blocked service URLs/unsafe schemes are rejected when rewriting CSS/src/srcset URLs.
- No application/document URL is visited for extra widths. **Asset GETs may occur**, including normal stylesheet/font/image reads. The frame inherits site resource CSP and adds restrictions; extension CSP/permissions/host permissions remain unchanged. The page's own requests/service worker are not intercepted. This is not a zero-network mode.
- The existing private capture engine needs three small cross-document pseudo-element compatibility edits: two root checks accept real iframe Document nodes, and pseudo measurement constructs its stylesheet in the owning frame's realm. Current-document/normal shadow-root branches keep the original constructor. Reversing these three edits makes the complete pre-viewport engine/helper prefix byte-identical to 1.7.1; serializer/encoding/raw-HTML helpers are unchanged. Existing generator/review/board runtime modules are byte-identical to the user's 1.7.0 build.
- Extra snapshots opt out of source scrollbar probing and CSS-variable provenance extraction, using computed responsive values instead. The copied root is validated, viewport/document bounds are set from the actual frame, and titles include the width. No screenshot of the whole page, fake stretching, native-variable binding, upload or new clipboard format is substituted. Extra captures use the existing tray with an icon rather than a screenshot of the wrong source viewport.
- One temporary frame at a time. Limits: **50,000 nodes (checked before cloning), 5 MiB aggregate CSS, widths 200–3840px, heights 200–4000px, 20 seconds** per preparation. Capture, serialization, cancellation, timeout and controller disposal are abort-scoped and remove the frame. Errors identify the width; already completed captures are saved for manual Copy rather than discarded, and an incomplete batch is not automatically written over the clipboard. Cancel intentionally discards the unfinished batch. Native clipboard writes retain their existing irrevocable-write limitation.
- Responsive CSS/media/container/flex/grid/viewport behavior is supported, **not JavaScript-only breakpoint rerenders**, missing lazy-loaded content or mobile UA emulation. Closed shadow DOM, embedded documents, running video, animation state, unusual stylesheet namespace/base handling, fonts/assets/CSP and destination fidelity have limitations. Unsupported/over-limit preparation is an explicit error; Browser remains available. UI/frame isolation is not a security boundary against a hostile source page or privileged tools.

### Historical 1.7.2 verification and release

**175 Node checks + 75 Chromium groups pass** (14 capture, 25 generator, 15 editable-board, 11 picker/viewport, 10 in-page responsive). Browser suites run sequentially; no clipboard/focus-sharing parallel runs. Release inventory/CRC/bytes, all JS syntax, all JSON, permissions/CSP and extracted-package suites are checked.

Native clipboard decoding verifies both Browser+768+393px and **exactly two 1600/393px** snapshots with Browser unchecked. Responsive grid positions, styles and media/shadow pseudo-text differ at the requested widths; this is not duplicate/stretch-only output. Tests prove **zero new capture tabs/windows/document visits**, unchanged source width/height/scroll/focus/current SPA/form state, no script/custom-constructor reruns, mixed-origin/dynamic/adopted/shadow CSS, standards mode, strict CSP, normal asset-only GETs, no remote attempts/uploads/uncaught page errors, cancel/failure/serialization/timeout cleanup, and retention/manual copy of the original capture after an extra-width error.

The historical 157 checks are retained (updated to expect six RPCs/the new version/renderer), plus 18 responsive unit checks. Test-only hooks, forced failures/timer scaling and clipboard-read grants are absent from runtime code. Native clipboard polling waits for a full rich payload rather than assuming asynchronous manual Copy has already completed.

Runtime: **687,925 bytes** / 19 files, including **314,878 bytes of JavaScript**. Relative to 1.7.1, only the manifest, toolbar and worker change, plus the new local viewport module; the other **15 retained runtime files** remain byte-identical. The previous original 1.6 workspace and all delivered ZIPs remain untouched. No commit/push/upload was performed; live Figma paste remains unverified.

## Historical 1.7.1 viewport opening repair

Baseline: public repository commit **db95a8a67a2b90495e18ff2ddfc3c1928804b314**, version 1.7.0. The previously delivered 1.6.0 workspace is not overwritten. No commit/push/upload to the repository was performed.

### Reproduced cause and scoped changes

The existing Viewports action passed `r().element` to its placement function. That element is the toolbar's invisible/zero-height normal-flow host, not its fixed visible controls. On a long fixture, the host was at **1622px**, the panel started at **1354px**, and the window was only **900px** high. The click worked but put the picker off-screen.

1. Pass/await the controller through the existing action dispatcher. Placement resolves its current visible Viewports button (rerenders replace buttons), with `controller.toolbarEl` as the only fallback. No source-flow host is used for anchoring.
2. Use pure, bounded placement with above/below flipping and 8px window margins. Constrain popup width/height and allow internal scrolling; reset only the ignored popup host against site CSS. No global page stylesheet, source styling/value, website scroll/viewport or design-system redesign is introduced by opening the picker.
3. Tie popup listeners and its animation frame to explicit close/lifecycle cleanup. Toggle, Escape/focus restoration, outside click, More, other capture actions and toolbar disposal/reinjection remove it. Closed-shadow-root retargeting is respected: toolbar button hit paths are checked inside the toolbar root, not incorrectly inferred from document-level paths.
4. Close the picker synchronously before standard raw-HTML/selection/design actions. The actual raw-HTML helper, snapshot/serialization/clipboard helpers and viewport capture worker are unchanged.
5. Bump only the manifest version to 1.7.1. No Chrome permissions, host permissions, extension CSP, storage schema or RPC is added by this repair. The other **16 retained runtime files** are byte-identical to 1.7.0, including the worker, privacy/options helpers, generator/review/board modules, locale and retained assets.
6. Remove five unreferenced leftovers present in the 1.7.0 repository upload: `js/vendor.js`, its license, the obsolete worker-bundle license, `MaterialIcons.woff2` and `InterVariable-Italic.woff2`. They were already removed in the prior cleanup. No active reference uses them; the active Inter font remains. Their presence was not evidence of an active upload/telemetry path.

The existing 1.7.0 feature deliberately opens the source URL in temporary windows **only when Capture design is requested with extra widths selected**. Normal page visits can execute the site's scripts and use its normal session; these are not a clone of unsaved in-page form/application state. This fix does not change that worker or claim those visits are zero-network. Opening the picker alone makes no page visit or new window.

Version 1.7.0 already added the seventh local RPC, **H2D_CAPTURE_VIEWPORT**, alongside the six historical capture RPCs listed below. It uses the sender tab's URL rather than a caller-supplied destination. The worker remains byte-identical in this repair. Original cancellation/timeout/window-minimum limits of that capture workflow are not redesigned here.

### Historical 1.7.1 verification

**157 Node checks and 65 Chromium groups pass**: 144 retained checks + 13 viewport checks, and 14 capture + 25 generator + 15 editable-board + 11 viewport browser groups. Browser suites run sequentially against the unpacked release. Permissions/CSP, syntax/JSON, ZIP CRC/full inventory and extracted-package checks are verified.

The new tests exercise long/scrolled source pages with a below-fold host, actual trigger-relative positioning, toggle/keyboard/Escape/outside clicks, source DOM/value/scroll preservation, CSS hiding attempts, native width/checkbox changes and local persistence/clamping, bottom docking, 390px/200px narrow and 240px/180px short windows, scrollable popup bounds, pre-capture cleanup, More/disposal/reinjection, and actual **1280 / 768 / 393px** responsive design captures. Native rich clipboard decoding confirms three editable snapshots; temporary windows close and the source width remains unchanged. Only expected localhost GET fixture visits occur, with no remote attempts or uncaught page errors.

The old coordinate-scanning viewport test is replaced by dynamic-port/real-control tests with bounded waits and guaranteed cleanup. Test clicks wait for responsive/docking animation geometry to settle. A test CSS selector containing `__pc_viewports__` is not confused with an actual leaked host in raw HTML. Test instrumentation and clipboard-read grants are not shipped in runtime code.

Current runtime: **672,123 bytes** across 18 retained runtime files, including **299,076 bytes of JavaScript** (excluding tests/docs). All existing generator/clipboard tests pass unchanged in behavior. Real Figma paste remains unverified; native clipboard payload tests do not claim a live destination integration.

## Historical 1.6.0 audit (retained behavior)

The following sections document the earlier generator/clipboard cleanup baseline, not a claim that 1.7.0 never added viewport code/RPCs. Current changes and verification supersede historical version/count/engine-isolation figures where noted above.

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

### Historical 1.6.0 capture-engine isolation

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

Before the 1.7.0 Viewports addition, the worker accepted these six capture RPCs (the current seventh is documented above):

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

## Historical 1.6.0 verification

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
