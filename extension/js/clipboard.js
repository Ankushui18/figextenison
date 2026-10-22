/* User-initiated clipboard writes with a bounded, local MV3 recovery path. */
(() => {
  "use strict";
  if (globalThis.PageCaptureClipboard) return;

  // Chrome extension messages are JSON payloads, not transferable Blobs. Keep a
  // failed direct write recoverable without allowing an unbounded string RPC.
  // Larger captures still use the normal direct writer and fail loudly if it is
  // unavailable; they are never truncated to fit the fallback.
  const LIMITS = Object.freeze({ offscreenBytes: 32 * 1024 * 1024 });

  async function requestOffscreen(payload) {
    if (!chrome.runtime?.id) throw new Error("Extension context unavailable");
    const response = await chrome.runtime.sendMessage({ cmd: "H2D_WRITE_CLIPBOARD", payload });
    if (!response?.success || response.value !== true) throw new Error("Offscreen clipboard write failed");
  }

  function withinLimit(...parts) {
    return parts.every(part => typeof part === "string" && new Blob([part]).size <= LIMITS.offscreenBytes);
  }

  async function richPayload(items) {
    for (const item of Array.from(items || [])) {
      if (!item?.types?.includes("text/html") || typeof item.getType !== "function") continue;
      const htmlBlob = await item.getType("text/html");
      if (htmlBlob.size > LIMITS.offscreenBytes) throw new Error("Capture is too large for clipboard recovery");
      const html = await htmlBlob.text();
      let text = "";
      if (item.types.includes("text/plain")) {
        const textBlob = await item.getType("text/plain");
        if (htmlBlob.size + textBlob.size > LIMITS.offscreenBytes) throw new Error("Capture is too large for clipboard recovery");
        text = await textBlob.text();
      }
      if (!withinLimit(html, text)) throw new Error("Capture is too large for clipboard recovery");
      return { kind: "html", html, text };
    }
    throw new Error("No rich HTML clipboard payload");
  }

  async function write(items) {
    try {
      await navigator.clipboard.write(items);
      return "direct";
    } catch (directError) {
      // Preserve the original, actionable browser error if recovery is not
      // possible. Internal RPC/offscreen diagnostics can contain no user data,
      // but keeping this error also avoids changing existing UI behaviour.
      try {
        const payload = await richPayload(items);
        await requestOffscreen(payload);
        return "offscreen";
      } catch {
        throw directError;
      }
    }
  }

  async function writeText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return "direct";
    } catch (directError) {
      try {
        if (!withinLimit(text)) throw new Error("Text is too large for clipboard recovery");
        await requestOffscreen({ kind: "text", text });
        return "offscreen";
      } catch {
        throw directError;
      }
    }
  }

  globalThis.PageCaptureClipboard = Object.freeze({ write, writeText, limits: LIMITS });
})();
