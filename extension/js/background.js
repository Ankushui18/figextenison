/* Local capture service worker. No Figma API, account, upload or telemetry RPCs. */
"use strict";
importScripts("core.js", "privacy.js");
const Core = globalThis.PageCaptureCore;
const Privacy = globalThis.PageCapturePrivacy;

function isInjectable(url) {
  try {
    const parsed = new URL(url);
    return ["http:", "https:", "file:"].includes(parsed.protocol) &&
      !(parsed.protocol === "file:" && parsed.pathname.toLowerCase().endsWith(".mhtml")) &&
      parsed.hostname !== "chromewebstore.google.com" &&
      !(parsed.hostname === "chrome.google.com" && parsed.pathname.startsWith("/webstore"));
  } catch { return false; }
}

async function injectToolbar(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId, frameIds: [0] },
    files: ["js/privacy.js", "js/capture-safety.js", "js/design-system-core.js", "js/design-system-board.js", "js/design-system.js", "js/viewports.js", "js/wireframe-core.js", "js/wireframe.js", "js/canvas-capture.js", "js/figma-clip.js", "js/figma-bridge.js", "js/h2d_toolbar.js"],
    injectImmediately: true
  });
}

async function openToolbar(tab, request = {}, restoreFocus = false) {
  if (!Number.isInteger(tab?.id) || !isInjectable(tab.url)) return "source_unavailable";
  if (!await chrome.permissions.contains(Core.CAPTURE_PERMISSIONS)) return "needs_permissions";
  if (tab.url.startsWith("file:") && !await chrome.extension.isAllowedFileSchemeAccess()) return "needs_file_access";
  if (restoreFocus) {
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
  }
  await injectToolbar(tab.id);
  await chrome.storage.local.set({ [Core.openKey(tab.id)]: true });
  if (Core.isToolbarCommand(request.command)) {
    await chrome.tabs.sendMessage(tab.id, {
      type: "FIGMA_H2D_TOOLBAR_COMMAND", command: request.command
    }, { frameId: 0 });
  }
  return "opened";
}

async function openPermissionHelp(tab, request, outcome) {
  const base = chrome.runtime.getURL("options.html");
  const requestId = crypto.randomUUID();
  const pending = { tabId: tab.id };
  if (Core.isToolbarCommand(request.command)) pending.command = request.command;
  await chrome.storage.session.set({ [Core.toolbarRequestKey(requestId)]: pending });
  const reason = outcome === "needs_file_access" ? Core.OPTIONS_REASON.needsFileAccess : Core.OPTIONS_REASON.needsPermissions;
  const url = Core.buildOptionsUrl(base, reason, requestId);
  const [existing] = await chrome.tabs.query({ url: [base, `${base}?*`] });
  if (existing?.id != null) {
    await chrome.tabs.update(existing.id, { active: true, url });
    await chrome.windows.update(existing.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
}

async function startCapture(tab, request) {
  const outcome = await openToolbar(tab, request);
  if (outcome === "needs_permissions" || outcome === "needs_file_access") {
    await openPermissionHelp(tab, request, outcome);
  }
}

async function resumeCapture(sender, payload) {
  if (sender.url?.split("?")[0] !== chrome.runtime.getURL("options.html")) return "source_unavailable";
  if (typeof payload?.requestId !== "string" || payload.requestId.length > 128) return "source_unavailable";
  const key = Core.toolbarRequestKey(payload.requestId);
  const request = (await chrome.storage.session.get(key))[key];
  if (!Number.isInteger(request?.tabId)) return "source_unavailable";
  const tab = await chrome.tabs.get(request.tabId).catch(() => null);
  return tab ? openToolbar(tab, request, true) : "source_unavailable";
}

// captureVisibleTab screenshots the active tab, not an arbitrary tab ID.
// Check both sides of the operation to avoid recording an unrelated tab.
async function capturePreview(tab) {
  if (!Number.isInteger(tab?.id)) return "";
  try {
    const [before] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
    if (before?.id !== tab.id) return "";
    const image = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    const [after] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
    return after?.id === tab.id ? image : "";
  } catch { return ""; }
}

function toDataUrl(blob, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    const reader = new FileReader(); let settled = false;
    const cleanup = () => { signal?.removeEventListener("abort", abort); reader.onload = reader.onerror = reader.onabort = null; };
    const finish = (callback, value) => { if (settled) return; settled = true; cleanup(); callback(value); };
    const abort = () => { try { if (reader.readyState === 1) reader.abort(); } catch {} finish(reject, signal.reason); };
    reader.onload = () => finish(resolve, reader.result);
    reader.onerror = () => finish(reject, new Error("Could not encode local capture"));
    reader.onabort = () => finish(reject, signal?.reason || new DOMException("Capture cancelled", "AbortError"));
    signal?.addEventListener("abort", abort, { once: true });
    try { reader.readAsDataURL(blob); } catch (error) { finish(reject, error); }
  });
}

function validRect(rect, ratio, maxSide = Infinity) {
  if (!rect || !Number.isFinite(ratio) || ratio <= 0) return false;
  if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)) return false;
  return rect.width >= 2 && rect.height >= 2 && rect.width <= maxSide && rect.height <= maxSide;
}

// Crop the visible tab to one rectangle, in device pixels. Used for selection
// thumbnails and for a WebGL canvas whose own toBlob read back blank.
async function cropVisibleTab(tab, rect, ratio) {
  const image = await capturePreview(tab);
  if (!image) return "";
  let bitmap;
  try {
    const bytes = Uint8Array.from(atob(image.split(",")[1]), char => char.charCodeAt(0));
    bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    const x = Math.max(0, Math.floor(rect.x * ratio));
    const y = Math.max(0, Math.floor(rect.y * ratio));
    const width = Math.min(Math.floor(rect.width * ratio), bitmap.width - x);
    const height = Math.min(Math.floor(rect.height * ratio), bitmap.height - y);
    if (width <= 0 || height <= 0) return "";
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return "";
    ctx.drawImage(bitmap, x, y, width, height, 0, 0, width, height);
    return await toDataUrl(await canvas.convertToBlob({ type: "image/png" }));
  } catch { return ""; }
  finally { bitmap?.close(); }
}

async function captureElementPreview(tab, payload) {
  const rect = payload?.rect;
  const ratio = payload?.devicePixelRatio || 1;
  if (!validRect(rect, ratio)) return "";
  return cropVisibleTab(tab, rect, ratio);
}

// Extension-page CSP intentionally limits connect-src to 'self'. Do not try
// fetching page-hosted URLs from the service worker: Chrome blocks those reads
// and logs a CSP violation even though the failure is handled. Keep the RPC
// response shape so captures can report that the image could not be embedded.
async function readImage(url) {
  return { url, blob: null, error: Privacy.isPublicAssetUrl(url) ? "recovery_failed" : "blocked" };
}

const assetJobs = new Map(), cancelledAssetJobs = new Map();
async function recoverAssets(payload, sender) {
  const owner = Number.isInteger(sender?.tab?.id) ? `${sender.tab.id}:${sender.frameId}` : "legacy";
  for (const [id, time] of cancelledAssetJobs) if (Date.now() - time > 10000) cancelledAssetJobs.delete(id);
  if (payload?.cancel != null) {
    if (typeof payload.cancel !== "string" || !/^[a-f0-9-]{36}$/i.test(payload.cancel) || payload.urls != null) throw new Error("Invalid asset cancellation");
    const key = `${owner}:${payload.cancel}`, job = assetJobs.get(key);
    cancelledAssetJobs.set(key, Date.now());
    while (cancelledAssetJobs.size > 128) cancelledAssetJobs.delete(cancelledAssetJobs.keys().next().value);
    job?.controller.abort(); return [];
  }
  if (payload?.requestId != null && (typeof payload.requestId !== "string" || !/^[a-f0-9-]{36}$/i.test(payload.requestId))) throw new Error("Invalid asset job");
  if (!Array.isArray(payload?.urls) || payload.urls.length > 64 ||
      payload.urls.some(url => typeof url !== "string")) throw new Error("Invalid asset request");
  const results = new Array(payload.urls.length);
  const controller = new AbortController(), key = payload.requestId ? `${owner}:${payload.requestId}` : null;
  if (key && cancelledAssetJobs.has(key)) { cancelledAssetJobs.delete(key); return []; }
  if (key && assetJobs.has(key)) throw new Error("Duplicate asset job");
  if (key) assetJobs.set(key, { controller, tabId: sender?.tab?.id });
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]);
  let index = 0;
  try { await Promise.all(Array.from({ length: Math.min(4, payload.urls.length) }, async () => {
    while (index < payload.urls.length && !signal.aborted) {
      const current = index++;
      results[current] = await readImage(payload.urls[current], signal);
    }
  }));
  return results;
  } finally { if (key && assetJobs.get(key)?.controller === controller) assetJobs.delete(key); }
}

const handlers = Object.freeze({
  H2D_GET_TAB_ID: sender => {
    if (!Number.isInteger(sender.tab?.id)) throw new Error("Capture must originate from a tab");
    return sender.tab.id;
  },
  H2D_OPEN_TOOLBAR: resumeCapture,
  H2D_CAPTURE_VISIBLE_TAB: sender => capturePreview(sender.tab),
  H2D_CAPTURE_ELEMENT_PREVIEW: (sender, payload) => captureElementPreview(sender.tab, payload),
  // A canvas that reads back blank (WebGL without preserveDrawingBuffer) is
  // replaced with the visible pixels of its own rectangle. Same-crop, no upload.
  H2D_CAPTURE_REGION_RASTER: (sender, payload) => {
    if (!Number.isInteger(sender.tab?.id) || sender.frameId !== 0) throw new Error("Invalid raster request sender");
    const rect = payload?.rect, ratio = payload?.devicePixelRatio || 1;
    if (!validRect(rect, ratio, 20000)) return "";
    return cropVisibleTab(sender.tab, rect, ratio);
  },
  H2D_FETCH_ASSETS: (sender, payload) => {
    if (!Number.isInteger(sender.tab?.id) || sender.frameId !== 0) throw new Error("Invalid asset request sender");
    return recoverAssets(payload, sender);
  },
  H2D_TOOLBAR_CLOSED: async sender => {
    if (Number.isInteger(sender.tab?.id)) await chrome.storage.local.remove(Core.openKey(sender.tab.id));
  }
});

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || !Object.hasOwn(handlers, message?.cmd)) {
    respond({ success: false, error: { message: "Unsupported local capture command" } });
    return false;
  }
  Promise.resolve().then(() => handlers[message.cmd](sender, message.payload)).then(
    value => respond({ success: true, value }),
    () => respond({ success: false, error: { message: "Local capture operation failed" } })
  );
  return true;
});

// Errors stay local. Do not log captured markup, asset URLs or user data.
function ignoreOperationFailure() {}
chrome.action.onClicked.addListener(tab => { startCapture(tab, {}).catch(ignoreOperationFailure); });
chrome.commands.onCommand.addListener(command => {
  if (!Core.isToolbarCommand(command)) return;
  chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
    if (tab) return startCapture(tab, { command });
  }).catch(ignoreOperationFailure);
});
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.status !== "loading" || !isInjectable(tab.url)) return;
  chrome.storage.local.get(Core.openKey(tabId)).then(async stored => {
    if (stored[Core.openKey(tabId)] && await chrome.permissions.contains(Core.CAPTURE_PERMISSIONS)) await injectToolbar(tabId);
  }).catch(ignoreOperationFailure);
});
chrome.tabs.onRemoved.addListener(tabId => {
  for (const job of assetJobs.values()) if (job.tabId === tabId) job.controller.abort();
  for (const key of cancelledAssetJobs.keys()) if (key.startsWith(`${tabId}:`)) cancelledAssetJobs.delete(key);
  chrome.storage.local.remove([Core.capturesKey(tabId), Core.openKey(tabId)]).catch(ignoreOperationFailure);
});
