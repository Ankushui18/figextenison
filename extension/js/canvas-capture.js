/* Canvas fallbacks for capture. No network, no page modification beyond a
 * temporary, restored toolbar hide.
 *
 * Two things a plain `canvas.toBlob` gets wrong in a real capture:
 *
 * 1. A WebGL canvas that was not created with `preserveDrawingBuffer` reads back
 *    empty once the frame has been presented. Figma's editor, charting
 *    libraries and maps are all WebGL, so the captured asset can be fully
 *    transparent.
 * 2. A canvas larger than 4096px on a side is resized by Figma on paste anyway,
 *    but it travels at full size first, which is where payload budgets go.
 *
 * Transparent is unambiguous: nothing was painted, or the frame is gone. When we
 * see it we fall back to the visible-tab screenshot of that canvas's rectangle,
 * which is what the user is actually looking at. If that also fails the original
 * blob is passed through untouched, so this can only add fidelity, never remove
 * it — and the raster is still an image, never layers (docs/CANVAS-RESEARCH.md).
 */
(() => {
  "use strict";

  const MAX_SIDE = 4096;          // Figma's own paste limit; beyond this it resizes
  const SAMPLE_SIDE = 24;         // blank detection grid, not the full bitmap
  // The id the capture engine actually mounts with, plus an attribute fallback:
  // hiding the toolbar keeps it out of the screenshot, and it is restored in a
  // finally block even when the fallback fails.
  const TOOLBAR_HOST_ID = "__figma_h2d_chrome_extension_toolbar__";
  const RASTER_NOTE_TTL = 15000;  // how long a capture may be attributed to a raster
  let lastRaster = null;          // what the most recent canvas needed, for the UI

  /** Scale a box to fit `maxSide`, never up. Returns integers. */
  function fitWithin(width, height, maxSide = MAX_SIDE) {
    if (![width, height, maxSide].every(Number.isFinite) || width <= 0 || height <= 0 || maxSide <= 0) return null;
    const scale = Math.min(1, maxSide / Math.max(width, height));
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), scale };
  }

  /**
   * Remember what happened to the last canvas so the toolbar can say why a
   * capture came back as pixels instead of layers. Local only, never uploaded.
   */
  function noteRaster(kind, detail) {
    lastRaster = Object.freeze({ kind, at: Date.now(), ...detail });
    return lastRaster;
  }

  /** The note if it is recent enough to belong to a capture that just happened. */
  function recentRaster(now = Date.now(), ttl = RASTER_NOTE_TTL) {
    if (!lastRaster || !Number.isFinite(ttl) || ttl <= 0) return null;
    const age = now - lastRaster.at;
    return age >= 0 && age <= ttl ? lastRaster : null;
  }

  /** True when every sampled pixel is fully transparent — nothing was painted. */
  function isBlank(pixels) {
    if (!pixels || typeof pixels.length !== "number" || pixels.length < 4) return false;
    for (let index = 3; index < pixels.length; index += 4) if (pixels[index] !== 0) return false;
    return true;
  }

  /** `data:image/png;base64,…` → Uint8Array, without fetch(). */
  function dataUrlToBytes(dataUrl) {
    if (typeof dataUrl !== "string") return null;
    const comma = dataUrl.indexOf(",");
    if (comma < 0 || !/^data:[^,]*;base64$/.test(dataUrl.slice(0, comma))) return null;
    const binary = atob(dataUrl.slice(comma + 1));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return bytes.length > 0 ? bytes : null;
  }

  const nextFrame = () => new Promise(resolve => {
    if (typeof requestAnimationFrame !== "function") return resolve();
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });

  async function sampleIsBlank(blob) {
    if (typeof createImageBitmap !== "function" || typeof OffscreenCanvas !== "function") return false;
    let bitmap;
    try {
      bitmap = await createImageBitmap(blob);
      const small = fitWithin(bitmap.width, bitmap.height, SAMPLE_SIDE);
      if (!small) return false;
      const canvas = new OffscreenCanvas(small.width, small.height);
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return false;
      context.drawImage(bitmap, 0, 0, small.width, small.height);
      return isBlank(context.getImageData(0, 0, small.width, small.height).data);
    } catch { return false; }
    finally { bitmap?.close?.(); }
  }

  /** Downscale to Figma's paste limit. Reports whether it actually resized. */
  async function shrink(blob) {
    const untouched = { blob, resized: false };
    if (typeof createImageBitmap !== "function" || typeof OffscreenCanvas !== "function") return untouched;
    let bitmap;
    try {
      bitmap = await createImageBitmap(blob);
      const fit = fitWithin(bitmap.width, bitmap.height);
      if (!fit || fit.scale === 1) return untouched;
      const canvas = new OffscreenCanvas(fit.width, fit.height);
      const context = canvas.getContext("2d");
      if (!context) return untouched;
      context.drawImage(bitmap, 0, 0, fit.width, fit.height);
      const shrunk = await canvas.convertToBlob({ type: "image/webp", quality: 1 });
      if (!shrunk) return untouched;
      return {
        blob: shrunk,
        resized: true,
        from: { width: bitmap.width, height: bitmap.height },
        to: { width: fit.width, height: fit.height }
      };
    } catch { return untouched; }
    finally { bitmap?.close?.(); }
  }

  /** Screenshot the canvas rectangle from the visible tab, toolbar hidden. */
  async function captureRegion(canvas) {
    if (typeof chrome?.runtime?.sendMessage !== "function") return null;
    const rect = canvas.getBoundingClientRect?.();
    if (!rect || !(rect.width >= 2 && rect.height >= 2)) return null;
    const host = document.getElementById(TOOLBAR_HOST_ID) || document.querySelector('[data-h2d-ignore="true"]');
    const previous = host?.style?.visibility;
    try {
      if (host) host.style.visibility = "hidden";
      await nextFrame();
      const response = await chrome.runtime.sendMessage({
        cmd: "H2D_CAPTURE_REGION_RASTER",
        payload: {
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          devicePixelRatio: window.devicePixelRatio || 1
        }
      });
      if (!response?.success || typeof response.value !== "string" || !response.value) return null;
      const bytes = dataUrlToBytes(response.value);
      return bytes ? new Blob([bytes], { type: "image/png" }) : null;
    } catch { return null; }
    finally {
      if (host) host.style.visibility = previous ?? "";
    }
  }

  /**
   * Improve a canvas blob: replace a blank (unpainted / WebGL-cleared) frame with
   * the visible screenshot of the same rectangle, and keep large rasters inside
   * Figma's paste budget. Returns the original blob on any doubt.
   */
  async function improve(canvas, blob) {
    if (!blob) return blob;
    try {
      const blank = await sampleIsBlank(blob);
      if (blank && globalThis.self === globalThis.top) {
        const replacement = await captureRegion(canvas);
        if (replacement) {
          noteRaster("replaced", { width: Math.round(canvas.getBoundingClientRect?.().width || 0) });
          return replacement;
        }
        noteRaster("blank");
        return blob;
      }
      const result = await shrink(blob);
      if (result.resized) noteRaster("resized", { from: result.from, to: result.to });
      return result.blob;
    } catch { return blob; }
  }

  function install() {
    const prototype = globalThis.HTMLCanvasElement?.prototype;
    if (!prototype || prototype.__pageCaptureCanvas__) return false;
    const original = prototype.toBlob;
    if (typeof original !== "function") return false;
    prototype.toBlob = function toBlob(callback, type, quality) {
      if (typeof callback !== "function") return original.call(this, callback, type, quality);
      return original.call(this, blob => {
        if (!blob) { callback(blob); return; }
        improve(this, blob).then(result => callback(result || blob), () => callback(blob));
      }, type, quality);
    };
    try { prototype.__pageCaptureCanvas__ = true; } catch {}
    return true;
  }

  globalThis.PageCaptureCanvas = Object.freeze({
    MAX_SIDE,
    RASTER_NOTE_TTL,
    TOOLBAR_HOST_ID,
    fitWithin,
    isBlank,
    dataUrlToBytes,
    noteRaster,
    recentRaster,
    improve,
    install
  });

  if (globalThis.HTMLCanvasElement) install();
})();
