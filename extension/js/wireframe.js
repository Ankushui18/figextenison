/* Wireframe as a capture setting, not a separate mode.
 *
 * It works exactly like a Viewports preset: one option in the Viewports popover,
 * and the normal **Capture design** button does the work. The page is captured by
 * the existing engine at every checked width; this file only rewrites the capture
 * into greyscale layers just before it is encoded for the clipboard.
 *
 * Local only. No new permissions, no network, no second copy action. */
(() => {
  "use strict";
  if (globalThis.PageCaptureWireframe) return;
  const Core = globalThis.PageCaptureWireframeCore;
  if (!Core) return;

  const KEY = Core.STORAGE_KEY;
  const PANEL_ID = "__pc_viewports__";
  const settings = Core.normalizeSettings(null);
  let loaded = false;
  let panels = new Set();
  let lastCount = 0;

  const el = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    if (className) node.className = className;
    return node;
  };

  const STYLE = `
.wf{margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,.12)}
.wf h4{margin:0 0 6px;display:flex;align-items:center;gap:6px}
.wf .chip{font-size:9px;font-weight:600;letter-spacing:.06em;color:#0d99ff;border:1px solid rgba(13,153,255,.4);background:rgba(13,153,255,.12);border-radius:3px;padding:0 4px;line-height:13px}
.wf .row{display:flex;align-items:center;gap:8px;height:26px}
.wf .row .lbl{flex:1;white-space:nowrap}
.wf input[type=checkbox]{appearance:none;-webkit-appearance:none;flex:none;width:14px;height:14px;margin:0;border:1px solid rgba(255,255,255,.4);border-radius:3px;display:grid;place-content:center;cursor:pointer;background:transparent}
.wf input[type=checkbox]:checked{background:#0d99ff;border-color:#0d99ff}
.wf input[type=checkbox]:checked::after{content:"";width:8px;height:4px;border-left:1.5px solid #fff;border-bottom:1.5px solid #fff;transform:rotate(-45deg) translate(1px,-1px)}
.wf input[type=checkbox]:focus-visible,.wf button:focus-visible{outline:2px solid #0d99ff;outline-offset:1px}
.wf .seg{display:flex;gap:2px;padding:2px;margin-left:22px;border-radius:5px;background:rgba(255,255,255,.08)}
.wf .seg button{appearance:none;border:0;background:transparent;color:rgba(255,255,255,.8);font:inherit;font-size:11px;line-height:1;height:20px;padding:0 8px;border-radius:4px;cursor:pointer}
.wf .seg button:hover:enabled{background:rgba(255,255,255,.1)}
.wf .seg button[aria-pressed=true]{background:#0d99ff;color:#fff}
.wf .seg button:disabled{opacity:.4;cursor:default}
.wf .hint{margin-top:5px;font-size:11px;line-height:14px;color:rgba(255,255,255,.62);font-weight:400}
`;

  /* ------------------------------------------------------------- settings */

  function persist() {
    try { chrome.storage.local.set({ [KEY]: { on: settings.on, level: settings.level } }); } catch {}
  }

  async function load() {
    try {
      const stored = (await chrome.storage.local.get(KEY))[KEY];
      if (stored && typeof stored === "object") Object.assign(settings, Core.normalizeSettings(stored));
    } catch {}
    loaded = true;
    for (const panel of panels) sync(panel);
  }

  function update(patch) {
    Object.assign(settings, Core.normalizeSettings({ ...settings, ...patch }));
    persist();
    for (const panel of panels) sync(panel);
  }

  /* -------------------------------------------------------------- popover */

  function hintText() {
    if (!settings.on) return "Off: Capture design copies the page as it looks.";
    const level = Core.LEVELS.find(entry => entry.id === settings.level) || Core.LEVELS[1];
    return `${level.title}: text ${level.id === "low" ? "becomes bars" : "is kept in a neutral face"}. Applies to Capture design at every checked width.`;
  }

  function sync(panel) {
    if (!panel?.section?.isConnected) { panels.delete(panel); return; }
    panel.checkbox.checked = settings.on;
    panel.checkbox.setAttribute("aria-checked", String(settings.on));
    panel.hint.textContent = hintText();
    panel.seg.querySelectorAll("button").forEach(button => {
      button.setAttribute("aria-pressed", String(button.dataset.level === settings.level));
      button.disabled = !settings.on;
    });
    panel.section.setAttribute("data-state", settings.on ? "on" : "off");
  }

  function decorate(host) {
    if (!host || host.nodeType !== 1) return;
    const root = host.shadowRoot;
    const box = root?.querySelector?.(".box");
    if (!box || box.querySelector("[data-wireframe-section]")) return;

    if (!root.querySelector("[data-wireframe-style]")) {
      const sheet = el("style");
      sheet.setAttribute("data-wireframe-style", "");
      sheet.textContent = STYLE;
      root.append(sheet);
    }

    const section = el("div", null, "wf");
    section.setAttribute("data-wireframe-section", "");
    section.setAttribute("role", "group");
    section.setAttribute("aria-label", "Wireframe");

    const heading = el("h4", "Wireframe");
    heading.append(el("span", "BETA", "chip"));
    section.append(heading);

    const row = el("label", null, "row");
    const checkbox = el("input");
    checkbox.type = "checkbox";
    checkbox.checked = settings.on;
    checkbox.setAttribute("aria-label", "Copy as wireframe");
    checkbox.addEventListener("change", () => update({ on: checkbox.checked }));
    row.append(checkbox, el("span", "Copy as wireframe", "lbl"));

    const seg = el("div", null, "seg");
    seg.setAttribute("role", "group");
    seg.setAttribute("aria-label", "Wireframe detail");
    for (const entry of Core.LEVELS) {
      const button = el("button", entry.label);
      button.type = "button";
      button.dataset.level = entry.id;
      button.setAttribute("aria-pressed", String(settings.level === entry.id));
      button.setAttribute("aria-label", `${entry.label} — ${entry.description}`);
      button.title = `${entry.label} · ${entry.title} — ${entry.description}`;
      button.addEventListener("click", () => update({ on: true, level: entry.id }));
      seg.append(button);
    }

    const hint = el("div", null, "hint");
    section.append(row, seg, hint);
    box.append(section);

    const panel = { section, checkbox, seg, hint };
    panels.add(panel);
    sync(panel);
    if (!loaded) load();
  }

  function scanForPanels() {
    const host = document.getElementById(PANEL_ID);
    if (host) decorate(host);
  }

  // The Viewports popover is rebuilt on every open, so watch for it appearing.
  function watchPopover() {
    scanForPanels();
    try {
      const observer = new MutationObserver(records => {
        for (const record of records) {
          for (const node of record.addedNodes) {
            if (node.nodeType === 1 && node.id === PANEL_ID) decorate(node);
          }
        }
      });
      observer.observe(document.documentElement, { childList: true });
    } catch {}
  }

  /* ------------------------------------------------------------ copy hook */

  // Every copy path (Capture design, per-item, Copy all) runs through
  // PageCaptureSafety.prepareClipboard. Rebuilding there means the existing
  // Viewports pipeline, budgets, redaction and clipboard write are untouched.
  function transformRecords(records, level = settings.level) {
    const output = [];
    let transformed = 0;
    for (const record of Array.isArray(records) ? records : []) {
      if (record?.type !== "snapshot" || typeof record.h2dJson !== "string") { output.push(record); continue; }
      try {
        const result = Core.transformDocument(JSON.parse(record.h2dJson), { level });
        output.push({ ...record, h2dJson: JSON.stringify(result.document), wireframe: Core.summarize(result) });
        transformed++;
      } catch {
        // A record we cannot rebuild is copied as the real capture rather than
        // failing the whole clipboard write.
        output.push(record);
      }
    }
    lastCount = transformed;
    return output;
  }

  function install() {
    const Safety = globalThis.PageCaptureSafety;
    if (!Safety || Safety.__wireframe === true) return !!Safety;
    if (typeof Safety.prepareClipboard !== "function") return false;
    const prepare = Safety.prepareClipboard;
    const summary = Safety.imageAssetSummary;
    globalThis.PageCaptureSafety = Object.freeze({
      ...Safety,
      __wireframe: true,
      prepareClipboard(records, options) {
        if (!settings.on) return prepare(records, options);
        return prepare(transformRecords(records), options);
      },
      imageAssetSummary(records) {
        // A wireframe embeds no page images, so the "images included" sentence
        // would be wrong on the success message.
        if (settings.on) return { total: 0, included: 0, notEmbedded: 0 };
        return typeof summary === "function" ? summary(records) : { total: 0, included: 0, notEmbedded: 0 };
      }
    });
    return true;
  }

  globalThis.PageCaptureWireframe = Object.freeze({
    settings,
    levels: Core.LEVELS,
    transformRecords,
    install,
    isEnabled: () => settings.on,
    lastTransformed: () => lastCount,
    decoratePopover: decorate
  });

  install();
  watchPopover();
  load();
})();
