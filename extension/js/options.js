/* Permission/status controller. No tutorial, login, vendor framework or network. */
(() => {
  "use strict";
  const Core = globalThis.PageCaptureCore;
  const panel = document.getElementById("settings");
  const state = {
    permissions: null,
    permissionError: false,
    denied: false,
    fileDenied: false,
    busy: false,
    finishing: false,
    error: "",
    reason: Core.parseOptionsReason(location.search),
    requestId: Core.parseOptionsToolbarRequestId(location.search)
  };
  const text = (key, substitutions) => chrome.i18n.getMessage(key, substitutions) || key;
  const view = () => Core.selectOptionsView({ hasCapturePermissions: state.permissions, optionsReason: state.reason });

  function element(tag, content, className) {
    const node = document.createElement(tag);
    if (content) node.textContent = content;
    if (className) node.className = className;
    return node;
  }
  function notice(message) {
    const node = element("div", message, "notice");
    node.setAttribute("role", "alert");
    panel.append(node);
  }
  function button(label, action, secondary = false) {
    const node = element("button", label, secondary ? "secondary" : "");
    node.type = "button";
    node.disabled = state.busy;
    node.addEventListener("click", () => run(action));
    panel.append(node);
  }
  async function run(action) {
    if (state.busy) return;
    state.busy = true;
    state.error = "";
    render();
    try { await action(); }
    catch { state.error = text("h2dActionFailed"); }
    finally { state.busy = false; render(); }
  }
  async function sendCommand(cmd, payload) {
    const response = await chrome.runtime.sendMessage({ cmd, payload });
    if (!response?.success) throw new Error("Local operation failed");
    return response.value;
  }
  async function finish() {
    if (state.finishing) return;
    state.finishing = true;
    try {
      if (state.requestId) {
        const outcome = await sendCommand("H2D_OPEN_TOOLBAR", { requestId: state.requestId });
        if (outcome !== "opened") {
          if (outcome === "needs_permissions" || outcome === "needs_file_access") {
            location.assign(Core.buildOptionsUrl(chrome.runtime.getURL("options.html"), outcome, state.requestId));
          } else {
            await chrome.storage.session.remove(Core.toolbarRequestKey(state.requestId));
            state.requestId = undefined;
            state.reason = null;
            history.replaceState(null, "", chrome.runtime.getURL("options.html"));
            state.error = text("optionsSourceUnavailable");
            render();
          }
          return;
        }
        await chrome.storage.session.remove(Core.toolbarRequestKey(state.requestId));
        state.requestId = undefined;
      }
      const tab = await chrome.tabs.getCurrent();
      if (Number.isInteger(tab?.id)) await chrome.tabs.remove(tab.id);
      else window.close();
    } finally { state.finishing = false; }
  }
  async function refreshPermissions() {
    try {
      state.permissions = await chrome.permissions.contains(Core.CAPTURE_PERMISSIONS);
      state.permissionError = false;
    } catch {
      state.permissions = false;
      state.permissionError = true;
    }
    render();
    if (view() === "ready" && state.requestId && !state.error && !state.finishing) {
      try { await finish(); }
      catch { state.error = text("h2dActionFailed"); render(); }
    }
  }
  async function requestPermissions() {
    state.denied = false;
    if (await chrome.permissions.request(Core.CAPTURE_PERMISSIONS)) await refreshPermissions();
    else state.denied = true;
  }
  async function retryFileAccess() {
    state.fileDenied = false;
    if (await chrome.extension.isAllowedFileSchemeAccess()) await finish();
    else state.fileDenied = true;
  }
  function render() {
    panel.replaceChildren();
    panel.classList.toggle("loading", view() === "loading");
    if (view() === "loading" || (view() === "ready" && state.requestId && !state.error)) {
      panel.append(element("p", text("h2dLoadingText")));
      return;
    }
    if (view() === "file_access") {
      panel.append(element("h1", text("optionsFileAccessTitle")));
      const pill = element("div", "", "pill");
      pill.append(element("span", text("optionsFileAccessSetting")), element("span", "", "toggle"));
      pill.lastChild.setAttribute("aria-hidden", "true");
      panel.append(pill);
      if (state.fileDenied) notice(text("optionsFileAccessRetryHint"));
      if (state.error) notice(state.error);
      button(text("optionsFileAccessCta"), () => chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` }));
      button(text("optionsFileAccessRetry"), retryFileAccess, true);
      return;
    }
    if (view() === "permissions") {
      const icon = document.createElement("img");
      icon.src = chrome.runtime.getURL("img/capture-permissions.svg");
      icon.className = "icon";
      icon.alt = "";
      panel.append(icon, element("h1", text("optionsCapturePermissionsTitle")), element("p", text("optionsCapturePermissionsIntro")));
      const list = document.createElement("ul");
      for (const [description, title] of [
        ["optionsCapturePermissionsWebsiteDescription", "optionsCapturePermissionsWebsiteTitle"],
        ["optionsCapturePermissionsClipboardDescription", "optionsCapturePermissionsClipboardTitle"]
      ]) {
        const item = document.createElement("li");
        const check = document.createElement("img");
        check.src = chrome.runtime.getURL("img/permission-check.svg");
        check.alt = "";
        item.append(check, element("span", text(description, [text(title)])));
        list.append(item);
      }
      panel.append(list);
      if (state.denied) notice(text("optionsCapturePermissionsDeniedHint"));
      if (state.error || state.permissionError) notice(state.error || text("h2dActionFailed"));
      button(text(state.permissionError ? "retryButton" : "optionsCapturePermissionsCta"), state.permissionError ? refreshPermissions : requestPermissions);
      return;
    }
    panel.append(element("h1", text("optionsCaptureReadyTitle")), element("p", text("optionsCaptureReadyDescription")));
    if (state.error) notice(state.error);
    button(text("optionsFigmaImportCta"), () => chrome.tabs.create({ url: chrome.runtime.getURL("figma-import.html") }), true);
    button(text(state.error && state.requestId ? "retryButton" : "closeButton"), finish);
  }

  chrome.permissions.onAdded.addListener(refreshPermissions);
  chrome.permissions.onRemoved.addListener(refreshPermissions);
  render();
  refreshPermissions();
})();
