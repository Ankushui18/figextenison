/* Experimental bridge between the toolbar and Figma's own copy.
 *
 * The capture engine can only describe HTML. When the thing you selected is a
 * canvas, the capture is honest but useless as layers: it arrives as one image.
 * This module sits next to Capture design / Select element, notices when a
 * capture needed a canvas raster, and offers the one route that does produce
 * layers — Figma's own Ctrl/Cmd+C payload (docs/CANVAS-RESEARCH.md).
 *
 * Experimental on purpose: it is branch-only work, so it is labelled in the UI
 * and one stored flag (`FLAG_KEY: false`) removes it completely.
 *
 * There is no toolbar-side hook to add an action, and the bundle is generated
 * and out of bounds. The bridge therefore wraps the one seam the bundle already
 * calls with the live controller — `globalThis.PageCaptureDesignSystem.attach`
 * — and mounts its own button beside the tools it belongs to.
 */
(() => {
  "use strict";

  const HOST_ID = "__figma_h2d_figma_bridge__";
  const FLAG_KEY = "figma_h2d_figma_bridge";      // false disables the whole feature
  const COVERAGE_THRESHOLD = 0.5;                 // half the viewport painted on canvas
  const ATTACHED = new WeakSet();

  const Clip = () => globalThis.PageCaptureFigmaClip;
  const Canvas = () => globalThis.PageCaptureCanvas;

  /* ---------- pure helpers (unit-tested) ---------- */

  /** How much of the viewport is covered by canvases, 0..1. */
  function canvasCoverage(doc = globalThis.document, view = globalThis) {
    if (!doc?.querySelectorAll) return 0;
    const width = Number(view.innerWidth) || 0, height = Number(view.innerHeight) || 0;
    if (width <= 0 || height <= 0) return 0;
    let covered = 0;
    for (const canvas of doc.querySelectorAll("canvas")) {
      const rect = canvas.getBoundingClientRect?.();
      if (!rect || !(rect.width > 0) || !(rect.height > 0)) continue;
      const overlapWidth = Math.max(0, Math.min(rect.right, width) - Math.max(rect.left, 0));
      const overlapHeight = Math.max(0, Math.min(rect.bottom, height) - Math.max(rect.top, 0));
      covered += overlapWidth * overlapHeight;
    }
    return Math.min(1, covered / (width * height));
  }

  function isCanvasHeavy(coverage) {
    return Number.isFinite(coverage) && coverage >= COVERAGE_THRESHOLD;
  }

  function isEnabled(stored) {
    return stored?.[FLAG_KEY] !== false;
  }

  /** Locale key explaining a raster note from canvas-capture.js. */
  function rasterTextKey(note) {
    if (note?.kind === "replaced") return "figmaBridgeRasterReplaced";
    if (note?.kind === "resized") return "figmaBridgeRasterResized";
    if (note?.kind === "blank") return "figmaBridgeRasterBlank";
    return "";
  }

  /* ---------- toolbar integration ---------- */

  const STYLE = `
    :host { all: initial; }
    .panel { position: fixed; z-index: 2147483647; width: 320px; max-height: min(460px, calc(100vh - 96px)); display: flex;
      flex-direction: column; gap: 9px; padding: 12px; box-sizing: border-box; overflow: auto; overscroll-behavior: contain;
      background: #2c2c2c; color: rgba(255,255,255,.9); border: 1px solid rgba(255,255,255,.1); border-radius: 13px;
      box-shadow: 0 8px 32px #0006; font: 12px/1.45 var(--ui-font, Inter, system-ui, sans-serif); }
    header { display: flex; align-items: center; gap: 8px; }
    header strong { font-size: 13px; font-weight: 550; }
    .badge { margin-left: auto; font-size: 10px; letter-spacing: .06em; text-transform: uppercase; color: #8ccfff;
      border: 1px solid rgba(13,153,255,.35); background: rgba(13,153,255,.12); border-radius: 4px; padding: 1px 5px; }
    p { margin: 0; color: rgba(255,255,255,.62); }
    .hint { padding: 8px; border-radius: 6px; background: rgba(13,153,255,.12); color: rgba(255,255,255,.85); }
    button { font: inherit; color: inherit; border: 0; border-radius: 5px; height: 28px; padding: 0 10px; cursor: pointer;
      background: rgba(255,255,255,.08); }
    button:hover:enabled { background: rgba(255,255,255,.14); }
    button.primary { background: #0d99ff; color: #fff; font-weight: 550; }
    button.primary:hover:enabled { background: #0785e2; }
    button:disabled { opacity: .4; cursor: default; }
    button:focus-visible { outline: 2px solid #0d99ff; outline-offset: 2px; }
    ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
    li { display: flex; align-items: center; gap: 6px; padding: 6px 0; border-top: 1px solid rgba(255,255,255,.08); }
    li span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    li button { height: 24px; padding: 0 8px; font-size: 11px; flex-shrink: 0; }
    footer { display: flex; align-items: center; gap: 8px; color: rgba(255,255,255,.45); font-size: 11px; }
    footer button { height: auto; padding: 0; background: none; color: #8ccfff; font-size: 11px; margin-left: auto; }
    .status { color: #9fe0b3; }
    .status.error { color: #ffb5a6; }
    @media (prefers-reduced-motion: no-preference) { .panel { animation: pop 120ms ease-out; } }
    @keyframes pop { from { opacity: 0; transform: translateY(4px); } }
  `;

  const LAYERS_ICON = "M8 2.2 14 5.3 8 8.4 2 5.3zM2 8.2l6 3.1 6-3.1v1.6l-6 3.1-6-3.1zm0 3.2 6 3.1 6-3.1v1.6L8 16.3l-6-3.2z";

  /** Read rich clipboard text through the async API, then the paste command. */
  async function readClipboardHtml(context) {
    try {
      return await Clip().readHtml(context.navigator || globalThis.navigator);
    } catch (error) {
      if (error?.code !== "clipboard_denied" && error?.code !== "clipboard_unavailable") throw error;
      const html = pasteIntoHiddenField(context);
      if (html) return html;
      throw error;
    }
  }

  /**
   * `navigator.clipboard.read` is governed by the host page's policy, and
   * figma.com need not allow it. A paste command into a hidden editable still
   * yields `text/html` while the extension holds `clipboardRead`, and it keeps
   * the `(figma)` comment intact. User-gesture bound, so it runs from a click.
   */
  function pasteIntoHiddenField(context = globalThis) {
    const doc = context.document;
    if (!doc?.body || typeof doc.execCommand !== "function") return "";
    let holder;
    try {
      holder = doc.createElement("div");
      holder.setAttribute("contenteditable", "true");
      holder.setAttribute("data-h2d-ignore", "true");
      Object.assign(holder.style, { position: "fixed", left: "-9999px", top: "0", opacity: "0", pointerEvents: "none" });
      doc.body.append(holder);
      holder.focus({ preventScroll: true });
      context.getSelection?.()?.selectAllChildren(holder);
      if (!doc.execCommand("paste")) return "";
      const html = holder.innerHTML;
      return typeof html === "string" && html.length > 0 ? html : "";
    } catch { return ""; }
    finally { holder?.remove(); }
  }

  function attach(controller) {
    if (!controller || ATTACHED.has(controller)) return;
    if (globalThis.self !== globalThis.top) return;
    if (!Clip() || typeof chrome === "undefined" || !chrome.runtime?.id) return;
    ATTACHED.add(controller);

    const signal = controller.lifecycleAbort.signal;
    let host, root, panel, trigger, observer, tabId = null, busy = false;
    let status = "", failed = false, note = null, clips = [];

    const el = (tag, text, className) => {
      const node = document.createElement(tag);
      if (text != null) node.textContent = text;
      if (className) node.className = className;
      return node;
    };
    const text = (key, fallback) => {
      try { return (key && chrome.i18n?.getMessage?.(key)) || fallback; } catch { return fallback; }
    };
    const button = (label, action, className = "") => {
      const node = el("button", label, className);
      node.type = "button";
      node.addEventListener("click", event => { event.stopPropagation(); run(action); });
      return node;
    };
    const errors = {
      clipboard_empty: ["figmaImportErrorEmpty", "Your clipboard is empty. Select layers in Figma and press Ctrl/Cmd+C first."],
      not_figma_copy: ["figmaImportErrorNotFigma", "That is not a Figma copy. Select layers in Figma, press Ctrl/Cmd+C, then import."],
      too_large: ["figmaImportErrorTooLarge", "That copy is larger than 16 MB. Copy fewer layers and try again."],
      clipboard_denied: ["figmaImportErrorDenied", "Clipboard access is off. Turn it on once from the extension's options page."],
      clipboard_unavailable: ["figmaImportErrorUnavailable", "This browser does not allow reading rich clipboard data here."],
      clipboard_write_failed: ["figmaImportErrorWrite", "Copying failed. Click the page once and try again."],
      storage_failed: ["figmaImportErrorStorage", "That copy could not be stored locally. Free some space and try again."]
    };

    async function run(action) {
      if (busy) return;
      busy = true;
      status = "";
      failed = false;
      render();
      try { await action(); }
      catch (error) {
        const [key, fallback] = errors[error?.code] || errors.clipboard_unavailable;
        status = text(key, fallback);
        failed = true;
      }
      finally { busy = false; render(); }
    }

    function ensureHost() {
      if (host?.isConnected) return;
      host = document.createElement("page-capture-figma-bridge");
      host.id = HOST_ID;
      host.setAttribute("data-h2d-ignore", "true");
      root = host.attachShadow({ mode: "closed" });
      root.append(el("style", STYLE));
      try { host.style.setProperty("--ui-font", getComputedStyle(controller.toolbarEl).fontFamily, "important"); } catch {}
      (document.body || document.documentElement).append(host);
    }
    function placePanel() {
      if (!panel || !trigger) return;
      const rect = trigger.getBoundingClientRect();
      const box = panel.getBoundingClientRect();
      panel.style.left = `${Math.max(8, Math.min(innerWidth - box.width - 8, rect.right - box.width))}px`;
      panel.style.top = `${Math.max(8, Math.min(innerHeight - box.height - 8, rect.top - box.height - 10))}px`;
    }
    function closePanel(restoreFocus = true) {
      panel?.remove();
      panel = null;
      host?.remove();
      host = null;
      root = null;
      trigger?.setAttribute("aria-expanded", "false");
      if (restoreFocus && trigger?.isConnected) trigger.focus({ preventScroll: true });
    }
    function openPanel() {
      if (panel) { closePanel(); return; }
      removeDot();
      ensureHost();
      panel = el("div", null, "panel");
      panel.setAttribute("role", "dialog");
      panel.setAttribute("aria-label", text("figmaBridgeTitle", "Figma copy"));
      panel.addEventListener("keydown", event => { if (event.key === "Escape") { event.preventDefault(); closePanel(); } });
      root.append(panel);
      trigger?.setAttribute("aria-expanded", "true");
      render();
      panel.querySelector("button.primary")?.focus({ preventScroll: true });
    }

    async function importHere() {
      note ??= Canvas()?.recentRaster?.() || null;
      const html = await readClipboardHtml(globalThis);
      clips = await Clip().saveClip(chrome.storage.local, Clip().record(html));
      status = text("figmaBridgeImported", "Saved locally. Copy it again any time, then paste into a Figma file.");
    }
    async function copyAgain(entry) {
      await Clip().writeHtml(globalThis.navigator, globalThis.ClipboardItem, entry.html);
      status = text("figmaImportCopied", "Copied — switch to Figma and paste with Ctrl/Cmd+V.");
    }
    async function removeClip(entry) {
      clips = await Clip().removeClip(chrome.storage.local, entry.id);
    }
    async function hideForProfile() {
      await chrome.storage.local.set({ [FLAG_KEY]: false }).catch(() => {});
      closePanel(false);
      trigger?.remove();
      controller.updateActionBarLayout?.();
    }

    function render() {
      if (!panel) return;
      panel.replaceChildren();
      const header = el("header");
      header.append(el("strong", text("figmaBridgeTitle", "Figma copy")), el("span", text("figmaBridgeExperimental", "Experimental"), "badge"));
      panel.append(header);
      panel.append(el("p", text("figmaBridgeIntro",
        "A canvas has no HTML layers, so a capture of it is an image. Figma's own copy does have layers: select in Figma, press Ctrl/Cmd+C, then import it here.")));

      const noteKey = rasterTextKey(note);
      if (noteKey) panel.append(el("p", text(noteKey, "This capture included a canvas, so it arrived as pixels."), "hint"));

      panel.append(button(
        clips.length ? text("figmaBridgeImportAnother", "Import another copy") : text("figmaBridgeImport", "Import Figma copy"),
        importHere, "primary"
      ));

      if (clips.length) {
        const list = el("ul");
        for (const entry of clips) {
          const item = el("li");
          item.append(el("span", entry.label || "Figma copy"));
          item.append(button(text("figmaImportCopyAgain", "Copy again"), () => copyAgain(entry)));
          item.append(button(text("figmaImportDelete", "Delete"), () => removeClip(entry)));
          list.append(item);
        }
        panel.append(list);
      }

      if (status) panel.append(el("p", status, failed ? "status error" : "status"));
      if (failed) panel.append(el("p", text("figmaBridgePermission",
        "Reading the clipboard needs a one-time permission. The extension's options page has the same importer and can ask for it.")));

      const footer = el("footer");
      footer.append(el("span", text("figmaBridgeLocal", "Stored locally only")), button(text("figmaBridgeHide", "Hide"), hideForProfile));
      panel.append(footer);
      placePanel();
    }

    async function loadClips() {
      clips = (await Clip().readAll?.(chrome.storage.local).catch(() => null)) || [];
      if (panel) render();
    }

    // A capture that needed a raster is the moment to look here, so mark the
    // entry until it is opened.
    function addDot() {
      if (!trigger || trigger.querySelector("[data-figma-bridge-dot]")) return;
      const dot = document.createElement("span");
      dot.setAttribute("data-figma-bridge-dot", "");
      Object.assign(dot.style, {
        position: "absolute", top: "2px", right: "2px", width: "5px", height: "5px",
        borderRadius: "50%", background: "#0d99ff", pointerEvents: "none"
      });
      trigger.append(dot);
    }
    function removeDot() {
      trigger?.querySelector("[data-figma-bridge-dot]")?.remove();
    }

    function mountTrigger() {
      if (signal.aborted || trigger?.isConnected) return;
      const tools = controller.shadowRoot?.querySelector('[data-toolbar-role="tools"]');
      if (!tools || tools.querySelector("[data-figma-bridge]")) return;
      trigger = document.createElement("button");
      trigger.type = "button";
      trigger.className = "h2d-toolbar-btn";
      trigger.setAttribute("data-figma-bridge", "");
      trigger.setAttribute("data-variant", "ghost");
      trigger.setAttribute("aria-haspopup", "dialog");
      trigger.setAttribute("aria-expanded", "false");
      trigger.setAttribute("aria-label", text("figmaBridgeButton", "Import a Figma copy"));
      trigger.title = `${text("figmaBridgeButton", "Import a Figma copy")} · ${text("figmaBridgeExperimental", "Experimental")}`;
      Object.assign(trigger.style, {
        display: "inline-flex", alignItems: "center", justifyContent: "center", width: "24px", height: "24px",
        flexShrink: "0", padding: "0", border: "none", borderRadius: "5px", background: "none",
        color: "rgba(255,255,255,.9)", cursor: "pointer", position: "relative"
      });
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("width", "16"); svg.setAttribute("height", "16"); svg.setAttribute("viewBox", "0 0 16 16"); svg.setAttribute("aria-hidden", "true");
      const path = document.createElementNS(svg.namespaceURI, "path");
      path.setAttribute("d", LAYERS_ICON); path.setAttribute("fill", "currentColor"); path.setAttribute("fill-rule", "evenodd");
      svg.append(path);
      trigger.append(svg);
      trigger.addEventListener("click", event => { event.stopPropagation(); openPanel(); });
      tools.append(trigger);
      if (note) addDot();
      controller.updateActionBarLayout?.();
    }

    async function resolveTabId() {
      if (Number.isInteger(tabId)) return tabId;
      const reply = await chrome.runtime.sendMessage({ cmd: "H2D_GET_TAB_ID" }).catch(() => null);
      tabId = reply?.success && Number.isInteger(reply.value) ? reply.value : null;
      return tabId;
    }

    function watchCaptures() {
      resolveTabId().then(id => {
        const key = id != null ? globalThis.PageCaptureCore?.capturesKey?.(id) : null;
        if (!key || signal.aborted) return;
        chrome.storage.onChanged.addListener((changes, area) => {
          if (area !== "local" || !changes[key] || signal.aborted) return;
          const added = Array.isArray(changes[key].newValue) ? changes[key].newValue.length : 0;
          const before = Array.isArray(changes[key].oldValue) ? changes[key].oldValue.length : 0;
          if (added <= before) return;
          const raster = Canvas()?.recentRaster?.();
          if (!raster) return;
          note = raster;
          if (!trigger?.isConnected) { mountTrigger(); loadClips(); }
          addDot();
          if (panel) render();
          const message = text(rasterTextKey(raster), "This capture included a canvas, so it arrived as pixels.");
          try { controller.showTransientMessage?.({ tone: "info", message }, "status"); } catch {}
        });
      }).catch(() => {});
    }

    async function start() {
      const stored = await chrome.storage.local.get(FLAG_KEY).catch(() => ({}));
      if (!isEnabled(stored)) return;
      // On a page without a canvas the entry stays out of the way; a capture that
      // needed a raster still brings it back, because that is exactly the case
      // the user needs to see explained.
      if (isCanvasHeavy(canvasCoverage())) {
        await loadClips();
        mountTrigger();
      }
      observer = new MutationObserver(() => mountTrigger());
      observer.observe(controller.shadowRoot, { childList: true, subtree: true });
      document.addEventListener("click", event => {
        if (!panel) return;
        // Clicks inside the toolbar retarget to its host, so ask the path.
        const path = typeof event.composedPath === "function" ? event.composedPath() : [];
        if (path.includes(trigger) || path.includes(host)) return;
        closePanel(false);
      }, { capture: true, signal });
      window.addEventListener("resize", () => placePanel(), { signal });
      watchCaptures();
    }

    signal.addEventListener("abort", () => {
      observer?.disconnect();
      closePanel(false);
      trigger?.remove();
    }, { once: true });

    start().catch(() => {});
  }

  /* ---------- hook install ---------- */

  const API = Object.freeze({
    HOST_ID,
    FLAG_KEY,
    COVERAGE_THRESHOLD,
    canvasCoverage,
    isCanvasHeavy,
    isEnabled,
    rasterTextKey,
    readClipboardHtml,
    pasteIntoHiddenField,
    attach
  });

  /**
   * The bundle calls `PageCaptureDesignSystem?.attach(controller, copier)` once
   * it has mounted. Wrapping that is the only supported way for a readable
   * module to receive the live controller without editing the bundle.
   */
  function installHook() {
    const designSystem = globalThis.PageCaptureDesignSystem;
    if (!designSystem || typeof designSystem.attach !== "function" || designSystem.__h2dFigmaBridge__) return false;
    const attachDesignSystem = designSystem.attach;
    globalThis.PageCaptureDesignSystem = Object.freeze({
      ...designSystem,
      __h2dFigmaBridge__: true,
      attach(controller, copier) {
        const result = attachDesignSystem.call(designSystem, controller, copier);
        try { attach(controller); } catch {}
        return result;
      }
    });
    return true;
  }

  globalThis.PageCaptureFigmaBridge = API;

  if (!installHook()) {
    // design-system.js normally loads first; keep trying briefly in case it does not.
    let tries = 0;
    const timer = setInterval(() => {
      if (installHook() || ++tries > 40) clearInterval(timer);
    }, 50);
  }
})();
