/* Asset-read policy shared by the worker and isolated capture script.
 * This is not an upload client. Remote assets may only be read with GET.
 * Known Figma/service and Sentry destinations are explicitly denied, including
 * Figma-prefixed cloud-storage hosts. Page-owned requests are not intercepted.
 */
(() => {
  "use strict";
  function isBlockedHost(hostname) {
    const host = hostname.toLowerCase().replace(/\.$/, "");
    return /(?:^|[.-])figma(?:[.-]|$)/.test(host) ||
      ["figmausercontent.com", "sentry.io"].some(domain => host === domain || host.endsWith(`.${domain}`));
  }

  function isAllowedAssetUrl(value, base) {
    try {
      const url = new URL(value, base);
      if (url.username || url.password) return false;
      if (url.protocol === "data:" || url.protocol === "blob:") return true;
      if (url.protocol === "file:") return base != null && new URL(base).protocol === "file:";
      return ["http:", "https:"].includes(url.protocol) && !isBlockedHost(url.hostname);
    } catch {
      return false;
    }
  }

  // Background recovery must not become a privileged intranet request proxy.
  function isPublicAssetUrl(value) {
    if (typeof value !== "string" || value.length > 16384 || !isAllowedAssetUrl(value)) return false;
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return false;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
    if (host.includes(":") || host === "localhost" || host.endsWith(".localhost") ||
        [".local", ".internal", ".home.arpa"].some(suffix => host.endsWith(suffix))) return false;
    const ip = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (!ip) return true;
    const [a, b] = ip.slice(1).map(Number);
    return !(a === 0 || a === 127 || a === 10 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) || a >= 224);
  }

  globalThis.PageCapturePrivacy = Object.freeze({ isBlockedHost, isAllowedAssetUrl, isPublicAssetUrl });
})();
