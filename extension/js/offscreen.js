/* Isolated clipboard document. It only accepts worker-originated write jobs. */
"use strict";

const MAX_CLIPBOARD_BYTES = 32 * 1024 * 1024;
const WORKER_URL = chrome.runtime.getURL("js/background.js");
let writeQueue = Promise.resolve();

function validPayload(payload) {
  if (!payload || typeof payload !== "object") return false;
  if (payload.kind === "text") {
    return typeof payload.text === "string" && new Blob([payload.text]).size <= MAX_CLIPBOARD_BYTES;
  }
  if (payload.kind !== "html" || typeof payload.html !== "string" || typeof payload.text !== "string") return false;
  return new Blob([payload.html, payload.text]).size <= MAX_CLIPBOARD_BYTES;
}

function legacyCopy(payload) {
  const field = document.createElement("textarea");
  field.value = payload.text || " ";
  field.setAttribute("aria-hidden", "true");
  Object.assign(field.style, {
    position: "fixed", left: "-10000px", top: "0", width: "1px", height: "1px",
    opacity: "0", pointerEvents: "none"
  });
  let copied = false;
  const onCopy = event => {
    if (!event.clipboardData) return;
    if (payload.kind === "html") event.clipboardData.setData("text/html", payload.html);
    event.clipboardData.setData("text/plain", payload.text);
    event.preventDefault();
    copied = true;
  };
  document.body.append(field);
  document.addEventListener("copy", onCopy);
  try {
    field.focus();
    field.select();
    if (!document.execCommand("copy") || !copied) throw new Error("Legacy clipboard copy was rejected");
    return "offscreen-legacy";
  } finally {
    document.removeEventListener("copy", onCopy);
    field.remove();
  }
}

async function write(payload) {
  try {
    if (payload.kind === "html") {
      const formats = {
        "text/html": new Blob([payload.html], { type: "text/html" }),
        "text/plain": new Blob([payload.text], { type: "text/plain" })
      };
      await navigator.clipboard.write([new ClipboardItem(formats)]);
    } else {
      await navigator.clipboard.writeText(payload.text);
    }
    return "offscreen-async";
  } catch {
    // Some Chromium versions reject the asynchronous API in an unfocused
    // offscreen document even with clipboardWrite. A copy-event fallback keeps
    // rich HTML intact and never parses or injects the captured markup.
    return legacyCopy(payload);
  }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.cmd !== "H2D_OFFSCREEN_WRITE") return false;
  if (sender.id !== chrome.runtime.id || sender.tab || sender.url !== WORKER_URL || !validPayload(message.payload)) {
    respond({ success: false });
    return false;
  }
  const result = writeQueue.then(() => write(message.payload));
  writeQueue = result.catch(() => {});
  result.then(
    method => respond({ success: true, value: method }),
    () => respond({ success: false })
  );
  return true;
});
