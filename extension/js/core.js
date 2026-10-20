/* Shared local settings and message helpers. No accounts, analytics or network. */
(() => {
  "use strict";
  const reasons = Object.freeze({
    needsPermissions: "needs_permissions",
    needsFileAccess: "needs_file_access"
  });
  const validReasons = new Set(Object.values(reasons));
  const commands = new Set(["capture_code", "capture_page", "select_element"]);

  function selectOptionsView({ hasCapturePermissions, optionsReason }) {
    if (hasCapturePermissions == null) return "loading";
    if (!hasCapturePermissions) return "permissions";
    return optionsReason === reasons.needsFileAccess ? "file_access" : "ready";
  }

  function parseOptionsReason(search) {
    const reason = new URLSearchParams(search).get("reason");
    return validReasons.has(reason) ? reason : null;
  }

  function parseOptionsToolbarRequestId(search) {
    return new URLSearchParams(search).get("request_id") || undefined;
  }

  function buildOptionsUrl(base, reason, requestId) {
    const params = new URLSearchParams();
    if (validReasons.has(reason)) params.set("reason", reason);
    if (requestId) params.set("request_id", requestId);
    const query = params.toString();
    return query ? `${base}?${query}` : base;
  }

  globalThis.PageCaptureCore = Object.freeze({
    CAPTURE_PERMISSIONS: Object.freeze({
      origins: ["<all_urls>"],
      permissions: ["scripting", "clipboardWrite"]
    }),
    OPTIONS_REASON: reasons,
    selectOptionsView,
    parseOptionsReason,
    parseOptionsToolbarRequestId,
    buildOptionsUrl,
    toolbarRequestKey: id => `figma_h2d_toolbar_request_${id}`,
    capturesKey: tabId => `figma_h2d_toolbar_captures_${tabId}`,
    openKey: tabId => `figma_h2d_toolbar_open_${tabId}`,
    isToolbarCommand: command => commands.has(command)
  });
})();
