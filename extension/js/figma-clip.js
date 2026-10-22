/* Reading and re-emitting a Figma copy. No DOM access at load, no network.
 *
 * A canvas region cannot be described as layers by walking the page (see
 * docs/CANVAS-RESEARCH.md). Figma's own copy does describe it: pressing
 * Ctrl/Cmd+C writes the real scene to the clipboard as `text/html`, in the
 * `(figma)` channel. This module validates that payload, keeps it, and writes it
 * back later, so a capture survives the next copy and can be pasted into any
 * Figma file.
 *
 * The other channel, `(figh2d)`, is what this extension produces from HTML. The
 * two are deliberately not interchangeable and this module accepts only Figma's.
 */
(() => {
  "use strict";

  const LIMITS = Object.freeze({
    recordBytes: 16 * 1024 * 1024, // one payload, as HTML text
    records: 12,                   // kept per profile, newest first
    metadataBytes: 4096            // figmeta is a small JSON object
  });
  const MARKERS = Object.freeze({
    buffer: /<!--\(figma\)([A-Za-z0-9+/=\s]+?)\(\/figma\)-->/,
    metadata: /<!--\(figmeta\)([A-Za-z0-9+/=\s]+?)\(\/figmeta\)-->/,
    h2d: /<!--\(figh2d\)/
  });
  const MAGIC = Object.freeze(["fig-kiwi", "fig-jam.", "fig-deck"]);
  const STORAGE_KEY = "figma_h2d_figma_clips";
  const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

  class FigmaClipError extends Error {
    constructor(code) {
      super(code);
      this.name = "FigmaClipError";
      this.code = code;
    }
  }

  function compact(base64) {
    return typeof base64 === "string" ? base64.replace(/\s+/g, "") : "";
  }

  /** Decoded byte count of a base64 string, without allocating the bytes. */
  function base64Bytes(base64) {
    const text = compact(base64);
    if (!text || /[^A-Za-z0-9+/=]/.test(text)) return 0;
    const padding = text.endsWith("==") ? 2 : text.endsWith("=") ? 1 : 0;
    return Math.floor(text.length * 3 / 4) - padding;
  }

  /** First `maxBytes` decoded bytes, enough to read a magic string. */
  function decodePrefix(base64, maxBytes = 8) {
    const text = compact(base64);
    const out = new Uint8Array(Math.min(maxBytes, base64Bytes(text)));
    for (let index = 0, byte = 0; index < text.length && byte < out.length; index += 4) {
      const a = ALPHABET.indexOf(text[index]), b = ALPHABET.indexOf(text[index + 1]);
      const c = ALPHABET.indexOf(text[index + 2]), d = ALPHABET.indexOf(text[index + 3]);
      if (a < 0 || b < 0) break;
      if (byte < out.length) out[byte++] = (a << 2) | (b >> 4);
      if (byte < out.length && c >= 0) out[byte++] = ((b & 15) << 4) | (c >> 2);
      if (byte < out.length && d >= 0) out[byte++] = ((c & 3) << 6) | d;
  }
    return out;
  }

  function ascii(bytes) {
    let out = "";
    for (const byte of bytes) out += String.fromCharCode(byte);
    return out;
  }

  function metadataFrom(html) {
    const match = MARKERS.metadata.exec(html);
    if (!match || base64Bytes(match[1]) > LIMITS.metadataBytes) return null;
    try {
      const value = JSON.parse(ascii(decodePrefix(match[1], LIMITS.metadataBytes)));
      if (!value || typeof value !== "object") return null;
      const fileKey = typeof value.fileKey === "string" && value.fileKey.length <= 128 ? value.fileKey : undefined;
      return fileKey ? { fileKey } : {};
    } catch { return null; }
  }

  /**
   * Is this clipboard HTML a Figma scene copy?
   * Returns `null` for anything else — ordinary page HTML, our own `(figh2d)`
   * captures, truncated or non-base64 payloads.
   */
  function detect(html) {
    if (typeof html !== "string" || html.length === 0) return null;
    if (MARKERS.h2d.test(html)) return null;
    const match = MARKERS.buffer.exec(html);
    if (!match) return null;
    const bytes = base64Bytes(match[1]);
    if (bytes < 16) return null;
    const magic = ascii(decodePrefix(match[1], 8));
    if (!MAGIC.includes(magic)) return null;
    return Object.freeze({ bytes, magic, metadata: metadataFrom(html) });
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return "unknown size";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function randomId() {
    try {
      if (globalThis.crypto?.randomUUID) return `fig-${globalThis.crypto.randomUUID()}`;
    } catch {}
    return `fig-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  /** Build a stored record, or throw a typed error the UI can explain. */
  function record(html, now = Date.now()) {
    if (typeof html !== "string" || html.length === 0) throw new FigmaClipError("clipboard_empty");
    const info = detect(html);
    if (!info) throw new FigmaClipError("not_figma_copy");
    if (html.length > LIMITS.recordBytes) throw new FigmaClipError("too_large");
    return Object.freeze({
      id: randomId(),
      type: "figma-clip",
      html,
      bytes: info.bytes,
      magic: info.magic,
      fileKey: info.metadata?.fileKey,
      createdAtIso: new Date(now).toISOString(),
      label: `Figma copy · ${formatBytes(info.bytes)}`
    });
  }

  /** Newest first, deduplicated by id, trimmed to the record cap. */
  function merge(records, entry) {
    const next = [entry, ...(Array.isArray(records) ? records : [])]
      .filter(item => item && typeof item.id === "string" && typeof item.html === "string")
      .filter((item, index, all) => all.findIndex(other => other.id === item.id) === index);
    return next.slice(0, LIMITS.records);
  }

  /* ---------- storage (chrome.storage.local, injected for tests) ---------- */

  async function readAll(storage) {
    const stored = await storage.get(STORAGE_KEY);
    const list = stored?.[STORAGE_KEY];
    return Array.isArray(list) ? list.filter(item => item && typeof item.html === "string" && typeof item.id === "string") : [];
  }

  async function saveClip(storage, entry) {
    const next = merge(await readAll(storage), entry);
    await storage.set({ [STORAGE_KEY]: next });
    return next;
  }

  async function removeClip(storage, id) {
    const next = (await readAll(storage)).filter(item => item.id !== id);
    await storage.set({ [STORAGE_KEY]: next });
    return next;
  }

  async function clearClips(storage) {
    await storage.remove(STORAGE_KEY);
    return [];
  }

  /* ---------- clipboard (navigator is injected for tests) ---------- */

  /** Read `text/html` from the clipboard without HTML sanitization, if allowed. */
  async function readHtml(navigatorLike) {
    const clipboard = navigatorLike?.clipboard;
    if (typeof clipboard?.read !== "function") throw new FigmaClipError("clipboard_unavailable");
    let items;
    try {
      items = await clipboard.read({ unsanitized: ["text/html"] });
    } catch (error) {
      if (error?.name === "NotAllowedError") throw new FigmaClipError("clipboard_denied");
      try { items = await clipboard.read(); }
      catch (fallback) {
        throw new FigmaClipError(fallback?.name === "NotAllowedError" ? "clipboard_denied" : "clipboard_unavailable");
      }
    }
    for (const item of Array.isArray(items) ? items : []) {
      if (!item?.types?.includes?.("text/html")) continue;
      const blob = await item.getType("text/html");
      const text = await blob.text();
      if (typeof text === "string" && text.length > 0) return text;
    }
    throw new FigmaClipError("clipboard_empty");
  }

  /** Write a stored payload back as a rich clipboard item. */
  async function writeHtml(navigatorLike, ClipboardItemLike, html) {
    if (typeof navigatorLike?.clipboard?.write !== "function" || typeof ClipboardItemLike !== "function") {
      throw new FigmaClipError("clipboard_unavailable");
    }
    const blob = new Blob([html], { type: "text/html" });
    try {
      await navigatorLike.clipboard.write([new ClipboardItemLike({ "text/html": blob })]);
    } catch (error) {
      throw new FigmaClipError(error?.name === "NotAllowedError" ? "clipboard_denied" : "clipboard_write_failed");
    }
  }

  globalThis.PageCaptureFigmaClip = Object.freeze({
    LIMITS,
    STORAGE_KEY,
    FigmaClipError,
    base64Bytes,
    decodePrefix,
    detect,
    formatBytes,
    record,
    merge,
    readAll,
    saveClip,
    removeClip,
    clearClips,
    readHtml,
    writeHtml
  });
})();
