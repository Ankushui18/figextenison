/* Controller for figma-import.html: keep Figma's own copy, paste it again later.
 * Local only — chrome.storage.local, the clipboard, nothing else.
 */
(() => {
  "use strict";

  const Clip = globalThis.PageCaptureFigmaClip;
  const panel = document.getElementById("import");
  const CLIPBOARD_PERMISSION = Object.freeze({ permissions: ["clipboardRead"] });
  const state = {
    permission: null,   // clipboardRead granted?
    busy: false,
    error: "",
    status: "",
    clips: []
  };
  const text = (key, fallback) => chrome.i18n.getMessage(key) || fallback;
  const MESSAGES = Object.freeze({
    clipboard_empty: () => text("figmaImportErrorEmpty", "Your clipboard is empty. Select layers in Figma and press Ctrl/Cmd+C first."),
    not_figma_copy: () => text("figmaImportErrorNotFigma", "That clipboard content is not a Figma copy. Select layers in Figma and press Ctrl/Cmd+C, then try again."),
    too_large: () => text("figmaImportErrorTooLarge", "That copy is larger than 16 MB. Copy fewer layers and try again."),
    clipboard_denied: () => text("figmaImportErrorDenied", "Clipboard read access was not granted, so nothing was imported."),
    clipboard_unavailable: () => text("figmaImportErrorUnavailable", "This browser does not allow reading rich clipboard data here."),
    clipboard_write_failed: () => text("figmaImportErrorWrite", "Copying failed. Click the page once and try again."),
    storage_failed: () => text("figmaImportErrorStorage", "The copy could not be stored locally. Delete an older copy and try again.")
  });
  const codeOf = error => (error?.code && MESSAGES[error.code] ? error.code : "clipboard_unavailable");

  function element(tag, content, className) {
    const node = document.createElement(tag);
    if (content) node.textContent = content;
    if (className) node.className = className;
    return node;
  }
  function notice(message, role = "alert") {
    const node = element("div", message, "notice");
    node.setAttribute("role", role);
    panel.append(node);
  }
  function button(label, action, { secondary = false, small = false } = {}) {
    const node = element("button", label);
    node.type = "button";
    if (secondary) node.className = "secondary";
    if (small) node.className = `${node.className} small`.trim();
    node.disabled = state.busy;
    node.addEventListener("click", () => run(action));
    return node;
  }
  async function run(action) {
    if (state.busy) return;
    state.busy = true;
    state.error = "";
    state.status = "";
    render();
    try { await action(); }
    catch (error) { state.error = MESSAGES[codeOf(error)](); }
    finally { state.busy = false; render(); }
  }

  async function refreshPermission() {
    try { state.permission = await chrome.permissions.contains(CLIPBOARD_PERMISSION); }
    catch { state.permission = false; }
  }
  async function refreshClips() {
    state.clips = await Clip.readAll(chrome.storage.local).catch(() => []);
  }

  async function importCopy() {
    if (!state.permission) {
      const granted = await chrome.permissions.request(CLIPBOARD_PERMISSION).catch(() => false);
      if (!granted) throw new Clip.FigmaClipError("clipboard_denied");
      state.permission = true;
    }
    const html = await Clip.readHtml(navigator);
    const entry = Clip.record(html);
    try { state.clips = await Clip.saveClip(chrome.storage.local, entry); }
    catch { throw new Clip.FigmaClipError("storage_failed"); }
    state.status = text("figmaImportStored", "Saved. Copy it again here any time, then paste into any Figma file.");
  }

  async function copyAgain(entry) {
    await Clip.writeHtml(navigator, globalThis.ClipboardItem, entry.html);
    state.status = text("figmaImportCopied", "Copied — switch to Figma and paste with Ctrl/Cmd+V.");
  }

  async function remove(entry) {
    state.clips = await Clip.removeClip(chrome.storage.local, entry.id);
  }

  function renderRow(entry) {
    const row = element("div", "", "row");
    const meta = element("div", "", "meta");
    meta.append(
      element("strong", entry.fileKey ? `${entry.label} · ${entry.fileKey}` : entry.label),
      element("span", new Date(entry.createdAtIso).toLocaleString())
    );
    const actions = element("div", "", "row-actions");
    actions.append(
      button(text("figmaImportCopyAgain", "Copy again"), () => copyAgain(entry), { small: true }),
      button(text("figmaImportDelete", "Delete"), () => remove(entry), { secondary: true, small: true })
    );
    row.append(meta, actions);
    return row;
  }

  function render() {
    panel.replaceChildren();
    panel.append(
      element("h1", text("figmaImportTitle", "Import a Figma copy")),
      element("p", text("figmaImportDescription", "A design drawn on Figma's canvas has no HTML layers to read, so it cannot be captured like a page. Figma's own copy can, and this page keeps it: the layers survive, and you can paste them into any file later."))
    );
    const steps = document.createElement("ol");
    for (const key of [
      ["figmaImportStep1", "In Figma, select the frames or layers you want."],
      ["figmaImportStep2", "Press Ctrl/Cmd+C."],
      ["figmaImportStep3", "Come back here and press Import copy from clipboard."]
    ]) steps.append(element("li", text(key[0], key[1])));
    panel.append(steps);

    const actions = element("div", "", "actions");
    actions.append(button(text("figmaImportCta", "Import copy from clipboard"), importCopy));
    panel.append(actions);

    if (state.status) notice(state.status, "status");
    if (state.error) notice(state.error);
    if (state.permission === false) {
      panel.append(element("p", text("figmaImportPermissionNote", "Importing reads your clipboard once, when you press the button. Nothing is read on page load and nothing leaves this browser."), "foot"));
    }

    const list = element("div", "", "list");
    if (state.clips.length === 0) list.append(element("p", text("figmaImportEmptyState", "No Figma copies saved yet."), "empty"));
    else {
      list.append(element("h2", text("figmaImportSavedTitle", "Saved copies")));
      for (const entry of state.clips) list.append(renderRow(entry));
      if (state.clips.length >= Clip.LIMITS.records) {
        list.append(element("p", text("figmaImportLimited", "The 12 most recent copies are kept; older ones are dropped."), "foot"));
      }
    }
    panel.append(list);
  }

  (async () => {
    await refreshPermission();
    await refreshClips();
    render();
  })();
  chrome.permissions?.onAdded?.addListener(() => { refreshPermission().then(render); });
  chrome.permissions?.onRemoved?.addListener(() => { refreshPermission().then(render); });
})();
