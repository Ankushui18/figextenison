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
    files: ["js/privacy.js", "js/design-system-core.js", "js/design-system-board.js", "js/design-system.js", "js/viewports.js", "js/h2d_toolbar.js"],
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

function toDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not encode local capture"));
    reader.readAsDataURL(blob);
  });
}

async function captureElementPreview(tab, payload) {
  const rect = payload?.rect;
  const ratio = payload?.devicePixelRatio || 1;
  if (!rect || ![rect.x, rect.y, rect.width, rect.height, ratio].every(Number.isFinite) || ratio <= 0) return "";
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

// Optional recovery reads only public image assets already referenced by the
// captured page. It never sends capture HTML, credentials or request bodies.
// Existing extension CSP remains restrictive; failed reads degrade gracefully.
async function readImage(url, signal) {
  if (!Privacy.isPublicAssetUrl(url)) return { url, blob: null, error: "blocked" };
  try {
    const response = await fetch(url, {
      method: "GET", signal, cache: "force-cache", credentials: "omit",
      redirect: "error", referrerPolicy: "no-referrer"
    });
    const mime = (response.headers.get("content-type") || "").split(";")[0].toLowerCase();
    const limit = 10 * 1024 * 1024;
    if (!response.ok || !mime.startsWith("image/") || Number(response.headers.get("content-length")) > limit) {
      await response.body?.cancel();
      return { url, blob: null, error: "recovery_failed" };
    }
    const reader = response.body?.getReader();
    if (!reader) return { url, blob: null, error: "recovery_failed" };
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) { await reader.cancel(); return { url, blob: null, error: "recovery_failed" }; }
      chunks.push(value);
    }
    return { url, blob: { type: mime, base64Blob: await toDataUrl(new Blob(chunks, { type: mime })) } };
  } catch { return { url, blob: null, error: "recovery_failed" }; }
}

async function recoverAssets(payload) {
  if (!Array.isArray(payload?.urls) || payload.urls.length > 64 ||
      payload.urls.some(url => typeof url !== "string")) throw new Error("Invalid asset request");
  const results = new Array(payload.urls.length);
  const signal = AbortSignal.timeout(5000);
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(4, payload.urls.length) }, async () => {
    while (index < payload.urls.length) {
      const current = index++;
      results[current] = await readImage(payload.urls[current], signal);
    }
  }));
  return results;
}

const handlers = Object.freeze({
  H2D_GET_TAB_ID: sender => {
    if (!Number.isInteger(sender.tab?.id)) throw new Error("Capture must originate from a tab");
    return sender.tab.id;
  },
  H2D_OPEN_TOOLBAR: resumeCapture,
  H2D_CAPTURE_VISIBLE_TAB: sender => capturePreview(sender.tab),
  H2D_CAPTURE_ELEMENT_PREVIEW: (sender, payload) => captureElementPreview(sender.tab, payload),
  H2D_FETCH_ASSETS: (sender, payload) => {
    if (!sender.tab || sender.frameId !== 0) throw new Error("Invalid asset request sender");
    return recoverAssets(payload);
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
  chrome.storage.local.remove([Core.capturesKey(tabId), Core.openKey(tabId)]).catch(ignoreOperationFailure);
});
