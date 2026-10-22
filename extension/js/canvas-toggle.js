/* Canvas Capture: one switch in the toolbar, nothing else.
 *
 * A canvas paints pixels and exposes no scene graph, so no button in this
 * extension can turn canvas content into Figma layers. What a capture *can* do
 * is keep the canvas honest: crop the raster to the canvas box, recover a blank
 * WebGL frame from the visible pixels, and leave everything else on the page as
 * the editable layers it already was.
 *
 * So this module adds a single ON/OFF switch. When it is on, Capture design and
 * Select element automatically use the canvas strategy in `canvas-capture.js`.
 * When it is off, `toBlob` is passed through untouched — the behaviour of every
 * build before the canvas work. There is no importer, no panel, no clipboard
 * read and no extra step in the capture flow.
 *
 * Branch-only experiment: not merged, not released.
 */
(() => {
  "use strict";

  const STORAGE_KEY = "figma_h2d_canvas_capture";
  const ATTACHED = new WeakSet();

  const Canvas = () => globalThis.PageCaptureCanvas;

  /* ---------- pure helpers (unit-tested) ---------- */

  /** Stored value → boolean. Off unless the user turned it on. */
  function readEnabled(stored) {
    return stored?.[STORAGE_KEY] === true;
  }

  function nextEnabled(current) {
    return !current;
  }

  /** Locale keys for the switch and for what a capture actually produced. */
  function labelKey(enabled) {
    return enabled ? "canvasCaptureToggleOn" : "canvasCaptureToggleOff";
  }

  function statusKey(enabled) {
    return enabled ? "canvasCaptureEnabledMessage" : "canvasCaptureDisabledMessage";
  }

  function rasterTextKey(note) {
    if (note?.kind === "replaced") return "canvasCaptureRasterReplaced";
    if (note?.kind === "resized") return "canvasCaptureRasterResized";
    if (note?.kind === "blank") return "canvasCaptureRasterBlank";
    return "";
  }

  /* ---------- toolbar integration ---------- */

  const ICON = "M3 3.5A1.5 1.5 0 0 1 4.5 2h7A1.5 1.5 0 0 1 13 3.5v9a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 3 12.5zm1 0v6.1l2.4-2.4a1 1 0 0 1 1.42 0L10 9.4l.62-.62a1 1 0 0 1 1.4 0l.98.98V3.5a.5.5 0 0 0-.5-.5h-7a.5.5 0 0 0-.5.5M4 12.5a.5.5 0 0 0 .5.5h7a.5.5 0 0 0 .5-.5v-.09l-1.69-1.69-.62.62a1 1 0 0 1-1.41 0L6.4 9.45 4 11.85zM6.25 5a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5";

  function attach(controller) {
    if (!controller || ATTACHED.has(controller)) return;
    if (globalThis.self !== globalThis.top) return;
    if (typeof chrome === "undefined" || !chrome.runtime?.id) return;
    ATTACHED.add(controller);

    const signal = controller.lifecycleAbort.signal;
    let button, observer, enabled = false, tabId = null, seen = 0;

    const text = (key, fallback) => {
      try { return (key && chrome.i18n?.getMessage?.(key)) || fallback; } catch { return fallback; }
    };

    async function setEnabled(value, { announce = false, persist = true } = {}) {
      enabled = Boolean(value);
      Canvas()?.setEnabled?.(enabled);
      paint();
      if (persist) await chrome.storage.local.set({ [STORAGE_KEY]: enabled }).catch(() => {});
      if (announce) {
        const message = text(statusKey(enabled), enabled
          ? "Canvas capture on. On figma.com, Figma's own copy is kept so the paste is editable; elsewhere canvases copy as cropped images."
          : "Canvas capture off. Canvas regions copy exactly as the page paints them, including blank WebGL frames.");
        try { controller.showTransientMessage?.({ tone: "info", message }, "status"); } catch {}
      }
    }

    function paint() {
      if (!button) return;
      button.setAttribute("aria-pressed", enabled ? "true" : "false");
      button.setAttribute("aria-label", text(labelKey(enabled), enabled ? "Canvas capture: on" : "Canvas capture: off"));
      button.setAttribute("title", `${text("canvasCaptureToggle", "Canvas capture")} · ${enabled ? "ON" : "OFF"}`);
      // A ring rather than a background: the toolbar's own hover style still wins.
      button.style.boxShadow = enabled ? "inset 0 0 0 1px rgba(13,153,255,.9)" : "none";
      button.style.color = enabled ? "#8ccfff" : "rgba(255,255,255,.9)";
    }

    function mount() {
      if (signal.aborted || button?.isConnected) return;
      const tools = controller.shadowRoot?.querySelector('[data-toolbar-role="tools"]');
      if (!tools || tools.querySelector("[data-canvas-toggle]")) return;
      button = document.createElement("button");
      button.type = "button";
      button.className = "h2d-toolbar-btn";
      button.setAttribute("data-canvas-toggle", "");
      button.setAttribute("data-variant", "ghost");
      Object.assign(button.style, {
        display: "inline-flex", alignItems: "center", justifyContent: "center", width: "24px", height: "24px",
        flexShrink: "0", padding: "0", border: "none", borderRadius: "5px", cursor: "pointer"
      });
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("width", "16"); svg.setAttribute("height", "16"); svg.setAttribute("viewBox", "0 0 16 16");
      svg.setAttribute("aria-hidden", "true");
      const path = document.createElementNS(svg.namespaceURI, "path");
      path.setAttribute("d", ICON);
      path.setAttribute("fill", "currentColor");
      path.setAttribute("fill-rule", "evenodd");
      svg.append(path);
      button.append(svg);
      button.addEventListener("click", event => {
        event.stopPropagation();
        setEnabled(nextEnabled(enabled), { announce: true });
      });
      tools.append(button);
      paint();
      controller.updateActionBarLayout?.();
    }

    function watchCaptures() {
      chrome.runtime.sendMessage({ cmd: "H2D_GET_TAB_ID" }).then(reply => {
        tabId = reply?.success && Number.isInteger(reply.value) ? reply.value : null;
        const key = tabId != null ? globalThis.PageCaptureCore?.capturesKey?.(tabId) : null;
        if (!key || signal.aborted) return;
        chrome.storage.onChanged.addListener((changes, area) => {
          if (area !== "local" || signal.aborted) return;
          if (changes[STORAGE_KEY]) {
            const stored = changes[STORAGE_KEY].newValue === true;
            if (stored !== enabled) { enabled = stored; Canvas()?.setEnabled?.(stored); paint(); }
          }
          if (!changes[key] || !enabled) return;
          const list = Array.isArray(changes[key].newValue) ? changes[key].newValue : [];
          if (list.length <= seen) return;
          seen = list.length;
          // On figma.com the native module owns this explanation; two modules
          // talking at once is how users learn to distrust both.
          if (globalThis.PageCaptureFigmaNative?.isFigmaHost?.(globalThis.location?.hostname)) return;
          // Say plainly what the capture produced: pixels, not layers.
          const note = Canvas()?.recentRaster?.();
          const message = text(rasterTextKey(note) || "canvasCaptureRasterReplaced",
            "Canvas region copied as an image. Editable layers need Figma's own copy.");
          try { controller.showTransientMessage?.({ tone: "info", message }, "status"); } catch {}
        });
      }).catch(() => {});
    }

    function start() {
      chrome.storage.local.get(STORAGE_KEY)
        .then(stored => setEnabled(readEnabled(stored), { persist: false }))
        .catch(() => setEnabled(false, { persist: false }))
        .finally(() => {
          if (signal.aborted) return;
          mount();
          observer = new MutationObserver(() => mount());
          observer.observe(controller.shadowRoot, { childList: true, subtree: true });
          watchCaptures();
        });
    }

    signal.addEventListener("abort", () => {
      observer?.disconnect();
      button?.remove();
    }, { once: true });

    start();
  }

  /* ---------- hook install ---------- */

  const API = Object.freeze({
    STORAGE_KEY,
    readEnabled,
    nextEnabled,
    labelKey,
    statusKey,
    rasterTextKey,
    attach
  });

  /**
   * The bundle calls `PageCaptureDesignSystem?.attach(controller, …)` once it has
   * mounted. Wrapping that is the only supported way for a readable module to
   * receive the live controller without editing the generated bundle.
   */
  function installHook() {
    const designSystem = globalThis.PageCaptureDesignSystem;
    if (!designSystem || typeof designSystem.attach !== "function" || designSystem.__h2dCanvasToggle__) return false;
    const attachDesignSystem = designSystem.attach;
    globalThis.PageCaptureDesignSystem = Object.freeze({
      ...designSystem,
      __h2dCanvasToggle__: true,
      attach(controller, copier) {
        const result = attachDesignSystem.call(designSystem, controller, copier);
        try { attach(controller); } catch {}
        return result;
      }
    });
    return true;
  }

  globalThis.PageCaptureCanvasToggle = API;

  if (!installHook()) {
    let tries = 0;
    const timer = setInterval(() => {
      if (installHook() || ++tries > 40) clearInterval(timer);
    }, 50);
  }
})();
