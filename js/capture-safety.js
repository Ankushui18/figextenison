/* Local visual-export privacy, abort handling and bounded clipboard preparation. */
(() => {
  "use strict";
  if (globalThis.PageCaptureSafety) return;
  const LIMITS = Object.freeze({ jsonBytes: 48 * 1024 * 1024, htmlBytes: 64 * 1024 * 1024 });
  const abortError = () => new DOMException("Capture cancelled", "AbortError");
  function check(signal) { signal?.throwIfAborted(); }
  function wait(promise, signal) {
    if (signal?.aborted) { Promise.resolve(promise).catch(() => {}); return Promise.reject(signal.reason || abortError()); }
    if (!signal) return Promise.resolve(promise);
    return new Promise((resolve, reject) => {
      const abort = () => reject(signal.reason || abortError());
      signal.addEventListener("abort", abort, { once: true });
      Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    });
  }
  const yieldTask = signal => wait(new Promise(resolve => setTimeout(resolve, 0)), signal);
  class CopyBudgetError extends Error {
    constructor(kind = "size") {
      super(kind === "invalid" ? "This saved capture could not be prepared. Recapture the page or copy another capture." : "These captures are too large to copy together. Copy fewer captures or select a smaller section. Nothing was copied.");
      this.name = "CopyBudgetError"; this.code = kind === "invalid" ? "INVALID_CAPTURE" : "COPY_TOO_LARGE";
    }
  }
  async function utf8Bytes(text, limit, signal) {
    check(signal);
    let size = 0, nextYield = 262144;
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code < 128) size++;
      else if (code < 2048) size += 2;
      else if (code >= 0xD800 && code <= 0xDBFF && i + 1 < text.length && text.charCodeAt(i + 1) >= 0xDC00 && text.charCodeAt(i + 1) <= 0xDFFF) { size += 4; i++; }
      else size += 3;
      if (size > limit) throw new CopyBudgetError();
      if (i >= nextYield) { nextYield = i + 262144; await yieldTask(signal); }
    }
    check(signal); return size;
  }
  function nonVisualControl(element) {
    const tag = String(element.localName || element.tagName || "").toLowerCase();
    if (!["input", "textarea", "select"].includes(tag)) return false;
    if (tag === "input" && String(element.type || element.getAttribute?.("type") || "").toLowerCase() === "hidden") return true;
    try {
      const rect = element.getBoundingClientRect();
      if (rect.width <= 1 || rect.height <= 1) return true;
      for (let node = element; node?.nodeType === 1; node = node.parentElement || node.getRootNode?.().host) {
        const styles = node.ownerDocument.defaultView.getComputedStyle(node);
        if (styles.display === "none" || Number(styles.opacity) === 0 || styles.contentVisibility === "hidden") return true;
        if (node === element && ["hidden", "collapse"].includes(styles.visibility)) return true;
      }
    } catch { /* A failed optional visibility read must not drop a visible field. */ }
    return false;
  }
  function sanitizeDocument(doc) {
    if (!doc?.root) return { changed: false, removed: 0 };
    let changed = false, removed = 0;
    const pending = [{ node: doc.root, parent: null, blocked: false }];
    while (pending.length) {
      const { node, parent, blocked } = pending.pop();
      if (!node || typeof node !== "object") continue;
      const styles = node.styles || {}, tag = String(node.tag || "").toUpperCase(), attrs = node.attributes || {};
      const hidden = blocked || styles.display === "none" || styles.contentVisibility === "hidden" || styles.opacity != null && Number(styles.opacity) === 0;
      const control = ["INPUT", "TEXTAREA", "SELECT"].includes(tag);
      const nonvisual = hidden || ["hidden", "collapse"].includes(styles.visibility) || node.rect && (node.rect.width <= 1 || node.rect.height <= 1);
      if (control && (tag === "INPUT" && String(attrs.type).toLowerCase() === "hidden" || nonvisual)) {
        if (!parent) throw new CopyBudgetError("invalid");
        parent.childNodes = parent.childNodes.filter(child => child !== node); changed = true; removed++; continue;
      }
      if ((tag === "INPUT" && ["password", "hidden", "checkbox", "radio", "file", "image"].includes(String(attrs.type).toLowerCase()) || ["BUTTON", "OPTION", "SELECT"].includes(tag)) && Object.hasOwn(attrs, "value")) { delete attrs.value; changed = true; }
      for (const child of node.childNodes || []) pending.push({ node: child, parent: node, blocked: hidden });
    }
    return { changed, removed };
  }
  async function cleanSavedCaptures(records, signal) {
    let changed = false; const result = [];
    for (const record of records) {
      if (record?.type !== "snapshot") { result.push(record); continue; }
      try {
        if (typeof record.h2dJson !== "string") throw new CopyBudgetError("invalid");
        await utf8Bytes(record.h2dJson, LIMITS.jsonBytes, signal);
        const doc = JSON.parse(record.h2dJson); if (doc?.version !== 2 || doc.root?.nodeType !== 1) throw new CopyBudgetError("invalid"); const clean = sanitizeDocument(doc);
        if (clean.changed || record.copyBlocked) {
          const next = { ...record, h2dJson: clean.changed ? JSON.stringify(doc) : record.h2dJson }; delete next.copyBlocked;
          result.push(next); changed = true;
        } else result.push(record);
      } catch (error) {
        // Do not discard old user work. Oversized/corrupt legacy captures stay
        // local, but cannot be exported without a fresh safe capture.
        const reason = error instanceof CopyBudgetError && error.code === "COPY_TOO_LARGE" ? "too_large" : "needs_recapture";
        result.push({ ...record, copyBlocked: reason }); changed ||= record.copyBlocked !== reason;
      }
    }
    return { records: result, changed };
  }
  async function prepareClipboard(records, { encode, signal, limits = LIMITS } = {}) {
    const bounded = (value, fallback) => Number.isFinite(value) && value > 0 ? Math.min(fallback, value) : fallback;
    const jsonLimit = bounded(limits.jsonBytes, LIMITS.jsonBytes), htmlLimit = bounded(limits.htmlBytes, LIMITS.htmlBytes);
    check(signal);
    let estimated = 2;
    const inputs = [];
    // Count before JSON.parse/combined serialization, and stop counting at the
    // budget instead of allocating an unbounded UTF-8/base64 buffer.
    for (const record of records) {
      check(signal);
      if (record.copyBlocked) throw new CopyBudgetError(record.copyBlocked === "too_large" ? "size" : "invalid");
      const text = record.type === "mhtml" ? JSON.stringify(record.mhtml) : record.h2dJson;
      if (typeof text !== "string") throw new CopyBudgetError("invalid");
      estimated += await utf8Bytes(text, jsonLimit - estimated, signal) + 18;
      if (estimated > jsonLimit) throw new CopyBudgetError();
      inputs.push({ record, text });
    }
    const docs = [];
    for (const { record, text } of inputs) {
      check(signal);
      if (record.type === "mhtml") docs.push(record.mhtml);
      else {
        let doc; try { doc = JSON.parse(text); } catch { throw new CopyBudgetError("invalid"); }
        if (!doc || typeof doc !== "object" || doc.version !== 2 || doc.root?.nodeType !== 1) throw new CopyBudgetError("invalid");
        sanitizeDocument(doc); docs.push({ ...doc, type: "snapshot" });
      }
      await yieldTask(signal);
    }
    const json = JSON.stringify(docs), jsonBytes = await utf8Bytes(json, jsonLimit, signal);
    const metadata = { dataType: "h2d", source: "chrome-extension", capturedAtIso: new Date().toISOString() };
    const meta = await wait(encode(JSON.stringify(metadata)), signal);
    const head = '<span data-metadata="<!--(figmeta)', middle = '(/figmeta)-->"></span><span data-h2d="<!--(figh2d)', tail = '(/figh2d)-->"></span>';
    if (head.length + meta.length + middle.length + 4 * Math.ceil(jsonBytes / 3) + tail.length > htmlLimit) throw new CopyBudgetError();
    check(signal);
    const data = await wait(encode(json), signal);
    if (![meta, data].every(value => typeof value === "string" && /^[A-Za-z0-9+/]*={0,2}$/.test(value))) throw new Error("Clipboard encoding failed");
    const blob = new Blob([head, meta, middle, data, tail], { type: "text/html" });
    if (blob.size > htmlLimit) throw new CopyBudgetError();
    check(signal); return blob;
  }
  // Report only aggregate media counts. Per-asset URLs, source text and failure
  // messages can contain private page data and must never enter UI diagnostics.
  function imageAssetSummary(records) {
    let total = 0, included = 0, notEmbedded = 0;
    for (const record of Array.isArray(records) ? records : []) {
      if (record?.type !== "snapshot" || typeof record.h2dJson !== "string") continue;
      let assets;
      try { assets = JSON.parse(record.h2dJson)?.assets; } catch { continue; }
      if (!assets || typeof assets !== "object" || Array.isArray(assets)) continue;
      for (const asset of Object.values(assets)) {
        total++;
        const blob = asset?.blob, data = blob?.base64Blob;
        const hasImageData = typeof data === "string" && data.startsWith("data:") && (String(blob?.type || "").toLowerCase().startsWith("image/") || /^data:image\//i.test(data));
        if (hasImageData) included++;
        else notEmbedded++;
      }
    }
    return Object.freeze({ total, included, notEmbedded });
  }
  function copyMessage(error, reason, automatic) {
    const prefix = automatic ? "Capture saved, but " : "";
    if (error instanceof CopyBudgetError) return automatic ? prefix + error.message[0].toLowerCase() + error.message.slice(1) : error.message;
    if (reason === "clipboard_write_failed") return automatic ? "Capture saved, but copying failed. Keep this tab focused and use Copy all to retry." : "Copying failed. Keep this tab focused, allow clipboard access, and try Copy all again.";
    return automatic ? "Capture saved, but preparing the clipboard failed. Use Copy all to retry, or recapture a smaller section." : "Could not prepare the clipboard. Try fewer captures or recapture the page.";
  }
  function createSession() {
    let current = null, copy = null, latest = null;
    return {
      begin() {
        if (copy?.phase === "writing") throw new Error("A clipboard write is already in progress.");
        current?.abort(); current = new AbortController(); copy = null; latest = current.signal; return current.signal;
      },
      cancel(force = false) {
        if (copy?.phase === "writing" && !force) return false;
        current?.abort(); current = null; copy = null; return true;
      },
      clear(signal) { if (current?.signal === signal) current = null; if (copy?.signal === signal) copy = null; },
      isCurrent: signal => current?.signal === signal,
      isLatest: signal => latest === signal,
      isActive: () => !!current && !current.signal.aborted,
      isWriting: () => copy?.phase === "writing",
      phase: () => copy?.phase || null,
      copyPhase(signal, phase) { check(signal); if (current?.signal !== signal) throw abortError(); copy = { signal, phase }; },
      finishCopy(signal) { if (copy?.signal === signal) copy = null; }
    };
  }
  function blobDataURL(value, signal) {
    check(signal);
    return new Promise((resolve, reject) => {
      const reader = new FileReader(); let settled = false;
      const cleanup = () => { signal?.removeEventListener("abort", abort); reader.onload = reader.onerror = reader.onabort = null; };
      const finish = (callback, result) => { if (settled) return; settled = true; cleanup(); callback(result); };
      const abort = () => { try { if (reader.readyState === 1) reader.abort(); } catch {} finish(reject, signal?.reason || abortError()); };
      reader.onload = () => finish(resolve, reader.result);
      reader.onerror = () => finish(reject, new Error("Could not encode a local capture asset"));
      reader.onabort = () => finish(reject, signal?.reason || abortError());
      signal?.addEventListener("abort", abort, { once: true });
      try { reader.readAsDataURL(value); } catch (error) { finish(reject, error); }
    });
  }
  async function convertImage(blob, signal, encode) {
    check(signal); const url = URL.createObjectURL(blob), image = new Image();
    try {
      image.src = url; await wait(image.decode(), signal); check(signal);
      const canvas = document.createElement("canvas"); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d"); if (!context) throw new Error("Image conversion is unavailable");
      context.drawImage(image, 0, 0); return await wait(encode(canvas, signal), signal);
    } finally { image.src = ""; URL.revokeObjectURL(url); }
  }
  function releaseVideo(video) {
    try { video.pause(); video.removeAttribute("src"); video.load(); } catch {}
  }
  async function videoBlob(source, signal, encode) {
    check(signal); let temporary;
    try {
      const url = source.currentSrc || source.src;
      let crossOrigin = false; try { crossOrigin = new URL(url, location.href).origin !== location.origin; } catch {}
      if (globalThis.PageCapturePrivacy?.isAllowedAssetUrl(url, location.href) && crossOrigin && source.crossOrigin == null) {
        const time = Math.max(0, Number(source.currentTime) || 0);
        temporary = document.createElement("video"); temporary.crossOrigin = "anonymous"; temporary.muted = true; temporary.preload = "auto";
        await new Promise((resolve, reject) => {
          let frame = null, sought = time === 0, painted = false, settled = false;
          const timer = setTimeout(() => finish(new Error("Video loading timed out")), 8000);
          const cleanup = () => {
            clearTimeout(timer); signal?.removeEventListener("abort", abort);
            temporary.removeEventListener("error", failed); temporary.removeEventListener("loadedmetadata", metadata); temporary.removeEventListener("seeked", seeked);
            if (frame != null) temporary.cancelVideoFrameCallback(frame);
          };
          const finish = error => { if (settled) return; settled = true; cleanup(); if (error) { releaseVideo(temporary); reject(error); } else resolve(); };
          const abort = () => finish(signal?.reason || abortError()), failed = () => finish(new Error("The video frame could not load"));
          const done = () => { if (sought && painted) finish(); };
          const seeked = () => { sought = true; done(); };
          const requestFrame = () => { frame = temporary.requestVideoFrameCallback(() => { painted = true; done(); }); };
          const metadata = () => {
            if (time > 0) { temporary.addEventListener("seeked", seeked, { once: true }); requestFrame(); temporary.currentTime = time; }
            else { requestFrame(); temporary.play().then(() => temporary.pause()).catch(failed); }
          };
          signal?.addEventListener("abort", abort, { once: true }); temporary.addEventListener("error", failed, { once: true }); temporary.addEventListener("loadedmetadata", metadata, { once: true });
          temporary.src = url;
        });
      }
      check(signal); const video = temporary || source;
      if (!video.videoWidth || !video.videoHeight) throw new Error("Video has invalid dimensions");
      const canvas = document.createElement("canvas"); canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      const context = canvas.getContext("2d"); if (!context) throw new Error("Video conversion is unavailable");
      context.drawImage(video, 0, 0); return await wait(encode(canvas, signal), signal);
    } finally { if (temporary) releaseVideo(temporary); }
  }
  async function requestAssets(urls, signal, send) {
    check(signal);
    const requestId = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : (() => {
      const bytes = crypto.getRandomValues(new Uint8Array(16)); bytes[6] = bytes[6] & 15 | 64; bytes[8] = bytes[8] & 63 | 128;
      const hex = [...bytes].map(value => value.toString(16).padStart(2, "0")).join("");
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    })();
    const abort = () => { try { Promise.resolve(send({ cancel: requestId })).catch(() => {}); } catch {} };
    signal?.addEventListener("abort", abort, { once: true });
    try { return await wait(send({ urls, requestId }), signal); }
    finally { signal?.removeEventListener("abort", abort); }
  }
  globalThis.PageCaptureSafety = Object.freeze({ limits: LIMITS, CopyBudgetError, check, wait, utf8Bytes, nonVisualControl, sanitizeDocument, cleanSavedCaptures, prepareClipboard, imageAssetSummary, copyMessage, createSession, blobDataURL, convertImage, videoBlob, requestAssets });
})();
