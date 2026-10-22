/* Native-first capture on figma.com. Branch-only experiment, not merged.
 *
 * The problem this exists for: on a Figma file, pressing Capture design used to
 * write this extension's HTML payload over Figma's own `(figma)` clipboard
 * payload. The next paste therefore produced the editor panels as layers and the
 * canvas as one image — because the native scene had just been thrown away.
 *
 * What can and cannot be done about it is documented in docs/CANVAS-RESEARCH.md.
 * A canvas has no scene graph, so no button here can invent layers. Figma *can*:
 * its own Ctrl/Cmd+C puts the real nodes — frames, text, vectors, images,
 * instances — on the clipboard as fig-kiwi bytes. That payload is the only
 * supported channel that pastes as genuinely editable nodes, and this module's
 * whole job is to stop destroying it.
 *
 * With the toolbar switch on, and only on figma.com:
 *   - If the clipboard holds a Figma scene, the outgoing write is replaced with
 *     that scene, so the paste is native. Nothing is re-encoded, re-serialized or
 *     reconstructed; the bytes are Figma's own.
 *   - If it does not, the normal capture is written (canvas as a labelled image).
 *   - Without clipboard read access, the normal capture is written and the user
 *     is told once how to enable the native path.
 *
 * The switch's own module (canvas-toggle.js) stays quiet on figma.com so only one
 * of the two explains what happened.
 */
(() => {
  "use strict";

  const STORAGE_KEY = "figma_h2d_canvas_capture";
  const FIGMA_HOST = /(^|\.)figma\.com$/i;
  const ATTACHED = new WeakSet();

  const Clip = () => globalThis.PageCaptureFigmaClip;

  /* ---------- pure helpers (unit-tested) ---------- */

  function isFigmaHost(hostname) {
    return typeof hostname === "string" && FIGMA_HOST.test(hostname);
  }

  function hostOf(location) {
    try { return location?.hostname || ""; } catch { return ""; }
  }

  /**
   * What should this clipboard write become?
   * `native` only when the switch is on, the page is Figma, and the clipboard
   * holds a real Figma scene. Everything else keeps today's behaviour.
   */
  function decide({ enabled, hostname, clipboardHtml }, detect) {
    if (!enabled) return { mode: "html", reason: "switch_off" };
    if (!isFigmaHost(hostname)) return { mode: "html", reason: "not_figma" };
    if (typeof clipboardHtml !== "string" || clipboardHtml.length === 0) return { mode: "html", reason: "empty" };
    let info = null;
    try { info = detect(clipboardHtml); } catch { info = null; }
    if (!info) return { mode: "html", reason: "not_native" };
    return { mode: "native", reason: "native", bytes: info.bytes, magic: info.magic };
  }

  /** The clipboard item that keeps Figma's own bytes untouched. */
  function nativeItem(html, ClipboardItemLike = globalThis.ClipboardItem) {
    if (typeof ClipboardItemLike !== "function" || typeof html !== "string" || html.length === 0) return null;
    return new ClipboardItemLike({ "text/html": new Blob([html], { type: "text/html" }) });
  }

  /* ---------- write guard ---------- */

  function install({
    clipboard = globalThis.navigator?.clipboard,
    storage = globalThis.chrome?.storage?.local,
    location = globalThis.location,
    readHtml = () => Clip()?.readHtml?.(globalThis.navigator),
    detect = html => Clip()?.detect?.(html) || null,
    ClipboardItemLike = globalThis.ClipboardItem,
    now = () => Date.now()
  } = {}) {
    const original = clipboard?.write;
    if (!clipboard || typeof original !== "function" || clipboard.__h2dNativeGuard__) return false;

    let enabled = false;
    let explained = false;
    const guard = {
      lastNativeAt: 0,

      async write(items) {
        if (!enabled) return original.call(clipboard, items);
        let html = "";
        try { html = await readHtml(); }
        catch (error) {
          // No read access is a Chrome restriction, not a capture failure. Say so
          // once, then behave exactly as before.
          if (!explained && (error?.code === "clipboard_denied" || error?.code === "clipboard_unavailable")) {
            explained = true;
            guard.onExplain?.("permission");
          }
          return original.call(clipboard, items);
        }
        const decision = decide({ enabled, hostname: hostOf(location), clipboardHtml: html }, detect);
        if (decision.mode !== "native") {
          guard.onExplain?.(decision.reason === "not_native" || decision.reason === "empty" ? "no-native" : "");
          return original.call(clipboard, items);
        }
        const item = nativeItem(html, ClipboardItemLike);
        if (!item) return original.call(clipboard, items);
        guard.lastNativeAt = now();
        guard.onExplain?.("native", decision);
        return original.call(clipboard, [item]);
      },

      onExplain: null,

      state() {
        return { enabled, explained };
      },

      setEnabled(value) {
        enabled = Boolean(value);
        return enabled;
      }
    };

    // Patch the instance *and* the prototype: `navigator.clipboard` is a
    // singleton today, but if a browser ever hands back a fresh object the
    // bundle's call would otherwise slip past the guard.
    const patch = target => {
      if (!target || target.__h2dNativeGuard__) return false;
      Object.defineProperty(target, "write", { configurable: true, writable: true, value: guard.write });
      target.__h2dNativeGuard__ = true;
      return true;
    };
    let patched = false;
    try { patched = patch(clipboard) || patched; } catch {}
    try { patched = patch(globalThis.Clipboard?.prototype) || patched; } catch {}
    if (!patched) return false;
    guard.readEnabled = async () => {
      try {
        const stored = await storage?.get?.(STORAGE_KEY);
        enabled = stored?.[STORAGE_KEY] === true;
      } catch { enabled = false; }
      return enabled;
    };
    guard.readEnabled();
    try {
      globalThis.chrome?.storage?.onChanged?.addListener?.((changes, area) => {
        if (area === "local" && changes?.[STORAGE_KEY]) guard.setEnabled(changes[STORAGE_KEY].newValue === true);
      });
    } catch {}
    return guard;
  }

  /* ---------- toolbar messages ---------- */

  function attach(controller) {
    if (!controller || ATTACHED.has(controller)) return;
    ATTACHED.add(controller);
    const text = (key, fallback) => {
      try { return (key && globalThis.chrome?.i18n?.getMessage?.(key)) || fallback; } catch { return fallback; }
    };
    const guard = globalThis.__h2dNativeGuard__ || (globalThis.__h2dNativeGuard__ = install());
    if (!guard || typeof guard !== "object") return;
    guard.onExplain = (kind, decision) => {
      const message = kind === "native"
        ? text("figmaNativeKept", `Figma's native copy kept (${Math.round((decision?.bytes || 0) / 1024)} kB). Paste with Ctrl/Cmd+V for editable layers.`)
        : kind === "permission"
          ? text("figmaNativePermission", "The canvas was copied as an image. To keep Figma's native layers, allow clipboard read once on the extension's options page.")
          : kind === "no-native"
            ? text("figmaNativeMissing", "No Figma copy on the clipboard, so the canvas was copied as an image. Select layers in Figma, press Ctrl/Cmd+C, then capture again.")
            : "";
      if (!message) return;
      try { controller.showTransientMessage?.({ tone: kind === "native" ? "success" : "info", message }, "status"); } catch {}
    };
  }

  /* ---------- hook install (same seam as the switch) ---------- */

  const API = Object.freeze({
    STORAGE_KEY,
    isFigmaHost,
    hostOf,
    decide,
    nativeItem,
    install,
    attach
  });

  globalThis.PageCaptureFigmaNative = API;

  const shared = install();
  if (shared && typeof shared === "object") globalThis.__h2dNativeGuard__ = shared;

  function installHook() {
    const designSystem = globalThis.PageCaptureDesignSystem;
    if (!designSystem || typeof designSystem.attach !== "function" || designSystem.__h2dFigmaNative__) return false;
    const attachDesignSystem = designSystem.attach;
    globalThis.PageCaptureDesignSystem = Object.freeze({
      ...designSystem,
      __h2dFigmaNative__: true,
      attach(controller, copier) {
        const result = attachDesignSystem.call(designSystem, controller, copier);
        try { attach(controller); } catch {}
        return result;
      }
    });
    return true;
  }

  if (!installHook()) {
    let tries = 0;
    const timer = setInterval(() => {
      if (installHook() || ++tries > 40) clearInterval(timer);
    }, 50);
  }
})();
