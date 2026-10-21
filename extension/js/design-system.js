/* Optional, local-only design-system panel. No page mutation, account or upload. */
(() => {
  "use strict";
  if (globalThis.PageCaptureDesignSystem) return;
  const Core = globalThis.PageCaptureDesignSystemCore;
  if (!Core) return;
  const controllers = new WeakMap();
  const HOST_ID = "__page_capture_design_system__";
  const svg = (paths, size = 16) => {
    const node = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    node.setAttribute("width", size); node.setAttribute("height", size); node.setAttribute("viewBox", "0 0 16 16");
    node.setAttribute("fill", "none"); node.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(node.namespaceURI, "path");
    path.setAttribute("d", paths); path.setAttribute("stroke", "currentColor"); path.setAttribute("stroke-width", "1.25");
    path.setAttribute("stroke-linecap", "round"); path.setAttribute("stroke-linejoin", "round"); node.append(path); return node;
  };
  const icons = {
    grid: "M2 2h5v5H2z M9 2h5v5H9z M2 9h5v5H2z M9 9h5v5H9z",
    wireframe: "M2 3.5h12M2 8h12M2 12.5h12M5 3.5v9M11 3.5v9",
    close: "M4 4l8 8 M12 4l-8 8",
    download: "M8 2v8 M5 7l3 3 3-3 M3 11v3h10v-3",
    refresh: "M13 6A5 5 0 1 0 13 10 M13 2v4H9",
    copy: "M5 5h8v9H5z M3 11H2V2h8v1"
  };
  const style = `
:host{all:initial!important;display:block!important;visibility:visible!important;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;color-scheme:dark!important;--bg:#2c2c2c!important;--fg:rgba(255,255,255,.9)!important;--muted:rgba(255,255,255,.5)!important;--line:rgba(255,255,255,.1)!important;--blue:#0d99ff!important;font:500 12px/16px var(--ui-font,system-ui,sans-serif)!important;color:var(--fg)!important}
*,*::before,*::after{box-sizing:border-box}button,input,select{font:inherit;color:inherit}button{cursor:pointer}button:disabled{opacity:.35;cursor:default}button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid var(--blue);outline-offset:2px}button{border:0;background:none;border-radius:5px;padding:0 8px;height:28px;display:inline-flex;align-items:center;justify-content:center;gap:6px;white-space:nowrap;font-weight:500}button:hover:enabled{background:rgba(255,255,255,.08)}button.primary{background:var(--blue);color:#fff}button.primary:hover:enabled{background:#0785e2}button.secondary{border:1px solid var(--line)}button.icon{width:28px;padding:0;flex-shrink:0}input,select{border:1px solid var(--line);background:#252525;border-radius:5px;height:28px;padding:0 8px;min-width:0}input[type=checkbox]{width:13px;height:13px;accent-color:var(--blue);margin:0;cursor:pointer}input.invalid{border-color:#f24822}h1,h2,p{margin:0;font-size:inherit;font-weight:500}svg{flex-shrink:0}small{font-size:11px;color:var(--muted)}
.menu{pointer-events:auto;position:fixed;width:246px;max-width:calc(100vw - 16px);max-height:calc(100vh - 16px);overflow:auto;background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:6px;box-shadow:0 8px 24px #0005}.menu button{width:100%;height:auto;min-height:54px;justify-content:flex-start;text-align:left;padding:10px;gap:10px}.menu .text{display:grid;gap:4px;min-width:0;white-space:normal}.menu small{font-size:11px;line-height:14px}.menu svg{color:var(--muted)}
dialog{pointer-events:auto;position:fixed;inset:72px 24px auto auto;margin:0;width:min(820px,calc(100vw - 48px));height:min(650px,calc(100vh - 104px));max-width:none;max-height:none;padding:0;color:var(--fg);background:var(--bg);border:1px solid var(--line);border-radius:13px;box-shadow:0 8px 32px #0004;font:inherit;overflow:hidden}dialog::backdrop{background:rgba(0,0,0,.18)}.shell{height:100%;display:flex;flex-direction:column}.header{display:flex;align-items:center;gap:8px;min-height:52px;padding:10px 12px 10px 16px;border-bottom:1px solid var(--line)}.header h1{font-size:13px;line-height:20px}.header>svg{color:var(--muted)}.local{font-size:10px;letter-spacing:.06em;color:var(--blue);border:1px solid rgba(13,153,255,.3);background:rgba(13,153,255,.08);border-radius:4px;padding:1px 5px}.header .spacer{flex:1}.intro{display:flex;gap:8px;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--line)}.intro p{color:var(--muted);line-height:18px}.scope-tools{display:flex;align-items:center;gap:4px;flex-shrink:0}.scope-tools select{max-width:142px}.body{display:flex;flex:1;min-height:0}.nav{display:flex;flex-direction:column;gap:4px;width:142px;flex-shrink:0;padding:12px 8px;border-right:1px solid var(--line)}.nav button{width:100%;justify-content:space-between;padding:0 8px;height:32px;color:var(--muted)}.nav button.active{background:rgba(13,153,255,.12);color:var(--blue)}.count{font-size:11px;min-width:20px;text-align:right}.workspace{display:flex;flex-direction:column;flex:1;min-width:0;min-height:0}.tools{display:flex;align-items:center;flex-wrap:wrap;gap:4px;padding:8px 12px;border-bottom:1px solid var(--line);min-height:45px}.search{flex:1;min-width:90px;max-width:220px}.tools button{font-size:11px}.list{overflow:auto;flex:1;min-height:0;padding:0 12px 12px;overscroll-behavior:contain;scrollbar-color:#555 transparent;scrollbar-width:thin}.table-head{position:sticky;top:0;background:var(--bg);z-index:1;display:flex;align-items:center;gap:12px;height:32px;color:var(--muted);font-size:11px;border-bottom:1px solid var(--line)}.table-head label{display:flex;align-items:center;gap:12px}.row{display:flex;align-items:center;gap:12px;min-height:68px;padding:10px 0;border-bottom:1px solid var(--line)}.row.excluded{opacity:.45}.preview{width:36px;height:36px;flex-shrink:0;border:1px solid rgba(255,255,255,.18);border-radius:5px;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#303030}.preview i{display:block;max-width:30px;height:8px;background:var(--blue);min-width:2px}.preview b{display:block;width:22px;height:22px;background:#888}.preview.type{font:500 20px/1 system-ui,sans-serif}.details{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}.name{width:100%;max-width:260px;border-color:transparent;background:transparent;height:24px;padding:0 4px;margin-left:-4px}.name:hover{background:#252525}.value{font:11px/15px ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--muted);overflow-wrap:anywhere;word-break:break-word}.evidence{display:flex;gap:6px;flex-wrap:wrap;font-size:10px;line-height:14px;color:var(--muted)}.evidence .alias{color:#8ccfff}.include{font-size:11px;width:58px;flex-shrink:0;padding:0 4px}.empty{padding:40px 12px;text-align:center;color:var(--muted);line-height:20px}.footer{border-top:1px solid var(--line);padding:12px 16px;display:flex;flex-direction:column;gap:10px}.export-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap}.export-row .included{color:var(--muted);font-size:11px;margin-right:auto}.footnote{color:var(--muted);font-size:10px;line-height:15px}.status{min-height:14px;color:var(--muted);font-size:11px}.status.error{color:#ffb5a6}.loading-view{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:24px;text-align:center}.spinner{width:20px;height:20px;border:2px solid var(--line);border-top-color:var(--blue);border-radius:50%;animation:pc-spin .8s linear infinite}@keyframes pc-spin{to{transform:rotate(360deg)}}.confirm{padding:12px 16px;border-bottom:1px solid var(--line);background:#252525;display:flex;align-items:center;gap:8px;flex-wrap:wrap}.confirm p{width:100%;line-height:18px;color:var(--muted)}.confirm select{max-width:240px}.notice{padding:8px 16px;color:var(--muted);font-size:11px;border-bottom:1px solid var(--line)}
@media(max-width:640px){dialog{inset:56px 12px auto auto;width:calc(100vw - 24px);height:calc(100vh - 72px)}.intro{align-items:flex-start;flex-direction:column;gap:8px}.body{flex-direction:column}.nav{width:100%;flex-direction:row;overflow-x:auto;gap:4px;border-right:0;border-bottom:1px solid var(--line);padding:6px 8px;scrollbar-width:thin}.nav button{width:auto;gap:8px;flex-shrink:0;height:28px}.tools{padding:8px}.list{padding:0 8px 8px}.row{gap:8px}.preview{width:28px;height:28px}.footer{padding:10px 12px}.header{padding-left:12px}.export-row .included{width:100%}.footnote{font-size:10px}.name{max-width:100%}.include{width:46px}.scope-tools select{max-width:180px}}
@media(max-height:520px){dialog{top:12px;height:calc(100vh - 24px)}.shell{overflow-y:auto;overscroll-behavior:contain}.header,.intro,.footer{flex-shrink:0}.body{flex:0 0 240px;min-height:240px}.nav{overflow-y:auto}.nav button{flex-shrink:0}}
@media(prefers-reduced-motion:reduce){.spinner{animation:none}}
.workspace{overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:#555 transparent}.row input,.row button{scroll-margin-block:40px 16px}.workspace.has-review .list{min-height:132px;flex-shrink:0}.tools{flex-shrink:0}.tools .review-active{color:var(--blue);background:rgba(13,153,255,.12);border-color:rgba(13,153,255,.3)}button.preview{padding:0;cursor:zoom-in}button.preview:hover:enabled{border-color:var(--blue)}.preview.checker{position:relative;background-color:#fff;background-image:conic-gradient(#ccc 25%,#fff 0 50%,#ccc 0 75%,#fff 0);background-size:10px 10px;background-clip:padding-box}.color-fill{position:absolute;inset:0}.preview.large{width:88px;height:72px;cursor:default}.preview.large b{width:58px;height:40px}.preview.large i{max-width:76px}.review-pane{flex-shrink:0;max-height:246px;overflow:auto;padding:8px 12px 12px;background:#252525;border-bottom:1px solid var(--line);overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:#555 transparent}.review-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px}.review-head h2{font-size:12px}.review-head .review-scope{font-size:10px;line-height:14px;margin-right:auto;min-width:0}.review-head button{width:24px;height:24px}.review-note{font-size:11px;line-height:17px;color:var(--muted);overflow-wrap:anywhere;margin-top:6px}.similar-pair{display:flex;gap:10px;align-items:center;padding:10px 0;border-bottom:1px solid var(--line)}.similar-pair:last-child{border-bottom:0;padding-bottom:0}.pair-details{flex:1;min-width:0}.pair-tokens{display:flex;gap:12px;margin-bottom:5px}.pair-token{display:flex;align-items:center;gap:8px;flex:1;min-width:0}.pair-token>div:last-child{min-width:0}.pair-token .preview{width:24px;height:24px}.pair-token .preview b{width:16px;height:16px}.pair-name{font-size:11px;display:block;overflow-wrap:anywhere}.similar-pair>button{font-size:11px;flex-shrink:0}.contrast-fields{display:flex;align-items:flex-end;gap:6px}.review-field{display:flex;flex-direction:column;gap:5px;color:var(--muted);font-size:11px;flex:1;min-width:0}.review-field select{width:100%;color:var(--fg);font-size:11px}.contrast-fields>button{font-size:11px;flex-shrink:0}.contrast-sample{border:1px solid var(--line);border-radius:5px;margin:10px 0;padding:12px;font:700 24px/30px system-ui,sans-serif;overflow-wrap:anywhere}.contrast-result{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:6px}.contrast-ratio{font:500 22px/28px var(--ui-font,system-ui,sans-serif);margin-right:4px}.contrast-badge{font-size:10px;line-height:16px;padding:2px 6px;border:1px solid var(--line);border-radius:4px}.contrast-badge.pass{color:#8ccfff;border-color:rgba(13,153,255,.3);background:rgba(13,153,255,.08)}.contrast-badge.below{color:#ffb5a6;border-color:rgba(242,72,34,.3);background:rgba(242,72,34,.06)}.inspector-name{font-size:12px;overflow-wrap:anywhere;margin:0 0 8px}.inspector-body{display:flex;gap:12px;align-items:center}.inspector-body>div:last-child{min-width:0;flex:1}.inspector-type{padding:10px 12px;background:#303030;border:1px solid var(--line);border-radius:5px;font-family:system-ui,sans-serif;max-height:110px;overflow:auto;overflow-wrap:anywhere;margin-bottom:10px}.type-metrics{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px 12px}.type-metrics>div:first-child{grid-column:1/-1}.type-metrics small{text-transform:capitalize;font-size:10px}.type-metrics .value{color:var(--fg);font-size:11px}@media(max-width:640px){.review-pane{padding:6px 8px 10px;max-height:240px}.pair-tokens{flex-direction:column;gap:6px}.similar-pair{align-items:flex-start}.similar-pair>button{padding:0 6px}.contrast-ratio{font-size:20px}.contrast-sample{font-size:21px}.preview.large{width:72px;height:64px}.tools .search{flex-basis:100%;max-width:none}.workspace.has-review .list{min-height:132px}}
/* v1.7 visual polish: themed form controls, scrollable review panes, clearer footer, edge-aware tabs */
select{appearance:none;-webkit-appearance:none;padding-right:26px;background-color:#252525;background-image:linear-gradient(45deg,transparent 50%,var(--muted) 50%),linear-gradient(135deg,var(--muted) 50%,transparent 50%);background-position:calc(100% - 14px) 12px,calc(100% - 9px) 12px;background-size:5px 5px,5px 5px;background-repeat:no-repeat;cursor:pointer;text-overflow:ellipsis}select:hover{border-color:rgba(255,255,255,.22)}select option{background:#2c2c2c;color:rgba(255,255,255,.9)}
input[type=checkbox]{appearance:none;-webkit-appearance:none;display:inline-grid;place-content:center;width:14px;height:14px;border:1px solid rgba(255,255,255,.38);border-radius:3px;background:transparent;padding:0;accent-color:initial}input[type=checkbox]:hover{border-color:rgba(255,255,255,.6)}input[type=checkbox]:checked{background:var(--blue);border-color:var(--blue)}input[type=checkbox]:checked::after{content:"";width:8px;height:4px;border-left:1.5px solid #fff;border-bottom:1.5px solid #fff;transform:rotate(-45deg) translate(1px,-1px)}
input::placeholder{color:rgba(255,255,255,.4)}.search:focus{border-color:var(--blue);outline:0}
.tools{position:sticky;top:0;z-index:3;background:var(--bg)}.tools button.secondary{height:26px}.tools button.secondary:hover:enabled{background:rgba(255,255,255,.08)}
.review-pane{max-height:none;overflow:visible;padding:10px 12px 12px;border-bottom:1px solid var(--line)}.review-head h2{font-size:12px;font-weight:600}.workspace.has-review .list{min-height:210px}
.row{min-height:60px;padding:8px 0}.details{gap:2px}.include{color:var(--muted);height:24px}.include:hover:enabled{color:var(--fg);background:rgba(255,255,255,.08)}.row.excluded .include{color:var(--blue);opacity:1}
.footer{gap:8px;padding:12px 16px 14px}.footnote,.evidence,.notice,.type-metrics small,.review-note{color:rgba(255,255,255,.62)}.footnote{font-size:11px;line-height:16px;max-width:72ch}.status{font-size:11px;color:rgba(255,255,255,.62)}.status:empty{display:none}.status.error{color:#ffb5a6}
.export-row button.secondary{height:28px}.export-row button.secondary:hover:enabled{background:rgba(255,255,255,.08);border-color:rgba(255,255,255,.2)}
.table-head{height:30px}.name:focus{background:#252525;border-color:var(--blue);outline:0}
@media(min-width:641px) and (min-height:521px){dialog{inset:72px auto auto 50%;transform:translateX(-50%)}}@media(min-width:641px) and (max-height:520px){dialog{left:50%;right:auto;transform:translateX(-50%)}}
@media(max-width:640px){.nav{background:linear-gradient(to right,var(--bg),var(--bg)) left center/20px 100% no-repeat local,linear-gradient(to left,var(--bg),var(--bg)) right center/20px 100% no-repeat local,linear-gradient(to right,rgba(255,255,255,.16),transparent) left center/12px 100% no-repeat scroll,linear-gradient(to left,rgba(255,255,255,.16),transparent) right center/12px 100% no-repeat scroll}.nav button{padding:0 8px;gap:6px}.review-pane{max-height:none}.workspace.has-review .list{min-height:180px}}
`;

  async function scanPage(doc, { scope = "rendered", signal, onProgress } = {}) {
    const records = [], variables = [], seenVariables = new Set(), warnings = [];
    const maxElements = 4000, variableLimit = 1600;
    const colorContext = doc.createElement("canvas").getContext("2d");
    const addVariables = styles => {
      let count = 0;
      for (let index = 0; index < styles.length && count < 128; index++) {
        const name = styles[index];
        if (!name.startsWith("--")) continue;
        count++;
        let value = styles.getPropertyValue(name).trim();
        if (!Core.safeValue(value)) continue;
        if (colorContext && globalThis.CSS?.supports("color", value)) {
          colorContext.fillStyle = "#010203";
          colorContext.fillStyle = value;
          value = colorContext.fillStyle;
        }
        const key = `${name}\n${value}`;
        if (!seenVariables.has(key) && variables.length < variableLimit) {
          seenVariables.add(key); variables.push({ name, value });
        }
      }
    };
    const win = doc.defaultView;
    addVariables(win.getComputedStyle(doc.documentElement));
    const stack = [doc.body || doc.documentElement];
    let visited = 0;
    const properties = [...new Set([...Core.colorProperties, ...Core.spaceProperties, ...Core.radiusProperties, ...Core.typeProperties,
      "boxShadow", "outlineWidth", "outlineStyle", "textDecorationLine",
      ...["Top", "Right", "Bottom", "Left"].flatMap(side => [`border${side}Width`, `border${side}Style`])])];
    while (stack.length && visited < maxElements) {
      signal?.throwIfAborted();
      const node = stack.pop();
      if (!node || node.nodeType !== 1 || node.getAttribute("data-h2d-ignore") === "true" ||
          ["SCRIPT", "STYLE", "NOSCRIPT", "HEAD", "TEMPLATE", "LINK", "META"].includes(node.tagName)) continue;
      visited++;
      if (visited % 100 === 0) { onProgress?.(visited); await new Promise(resolve => setTimeout(resolve, 0)); signal?.throwIfAborted(); }
      const computed = win.getComputedStyle(node);
      if (computed.display === "none" || computed.opacity === "0") continue;
      // Layout reads only: no scrolling, attribute changes, fetches, or interactions.
      const rect = node.getBoundingClientRect();
      const rendered = computed.visibility !== "hidden" && computed.visibility !== "collapse" && rect.width > 0 && rect.height > 0;
      const inViewport = rendered && rect.bottom > 0 && rect.right > 0 && rect.top < win.innerHeight && rect.left < win.innerWidth;
      if (rendered && (scope !== "viewport" || inViewport)) {
        addVariables(computed);
        const hasText = ["INPUT", "TEXTAREA", "SELECT"].includes(node.tagName) ||
          [...node.childNodes].some(child => child.nodeType === 3 && child.nodeValue.trim());
        const styles = Object.fromEntries(properties.map(property => [property, computed[property] || ""]));
        // SVG paint properties exist on HTML too, but their default black fill
        // does not paint HTML elements and must not pollute the palette.
        const svgPaint = node.namespaceURI === "http://www.w3.org/2000/svg" &&
          ["path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "tspan", "textPath", "use"].includes(node.localName);
        if (!svgPaint) { styles.fill = ""; styles.stroke = ""; }
        records.push({ hasText, styles });
      }
      // Open component roots are inspectable locally. Closed roots and frames are not forced open.
      if (node.shadowRoot) stack.push(...[...node.shadowRoot.children].reverse());
      stack.push(...[...node.children].reverse());
    }
    signal?.throwIfAborted();
    if (stack.length) warnings.push("Analysis reached the 4,000-element limit. Results describe only the inspected portion of the page.");
    warnings.push("Only currently rendered styles at this viewport are observed. Hidden states, closed components and cross-origin frames are not reconstructed.");
    return Core.buildSystem(records, { title: doc.title, url: doc.location.href, scope, variables, warnings, truncated: !!stack.length,
      viewport: { width: win.innerWidth, height: win.innerHeight }, analyzedAt: new Date().toISOString() });
  }

  function attach(controller, copyDesign) {
    if (controllers.has(controller)) return;
    let boardCopy;
    let host, root, menu, dialog, more, analysis, observer, system, category = "colors", query = "", selected = new Set();
    let scope = "rendered", mergeOpen = false, confirmRescan = false, status = "", exportingError = false, searchFocus = false, disposed = false;
    let reviewMode = "", inspectedId = "", contrastForeground = "", contrastBackground = "", focusNext = "";
    let renderedCategory = "", renderedQuery = "", renderedReview = "";
    const objectUrls = new Set(), downloadTimers = new Set();
    const signal = controller.lifecycleAbort.signal;
    const config = controller.config, previousOnEvent = config.onEvent;
    const featureOnEvent = event => {
      if (event.type === "action-run") { closeMenu(false); closePanel(false); }
      previousOnEvent?.(event);
    };
    const el = (tag, text, className) => { const node = document.createElement(tag); if (text != null) node.textContent = text; if (className) node.className = className; return node; };
    function button(label, action, className = "", icon) {
      const node = el("button", null, className); node.type = "button";
      if (icon) node.append(svg(icons[icon]));
      node.append(el("span", label)); node.addEventListener("click", action); return node;
    }
    function ensureHost() {
      if (host?.isConnected) return;
      host = document.createElement("page-capture-design-system"); host.id = HOST_ID; host.setAttribute("data-h2d-ignore", "true");
      root = host.attachShadow({ mode: "closed" }); root.append(el("style", style));
      const font = getComputedStyle(controller.toolbarEl).fontFamily;
      host.style.setProperty("--ui-font", font, "important");
      (document.body || document.documentElement).append(host);
    }
    function removeEmptyHost() {
      if (host && !menu && !dialog) { host.remove(); host = null; root = null; }
    }
    function closeMenu(restoreFocus = true) {
      menu?.remove(); menu = null; more?.setAttribute("aria-expanded", "false"); removeEmptyHost();
      if (restoreFocus && more?.isConnected) more.focus({ preventScroll: true });
    }
    function closePanel(restoreFocus = true) {
      cancelBoardCopy(false);
      analysis?.abort(); analysis = null;
      scope = system?.source.scope || scope; confirmRescan = false; mergeOpen = false; reviewMode = ""; inspectedId = ""; focusNext = "";
      dialog?.close(); dialog?.remove(); dialog = null; removeEmptyHost();
      if (restoreFocus && more?.isConnected) more.focus({ preventScroll: true });
    }
    function openMenu() {
      if (menu) { closeMenu(); return; }
      closeMenu(false); ensureHost();
      const rect = more.getBoundingClientRect();
      menu = el("div", null, "menu"); menu.setAttribute("role", "menu"); menu.setAttribute("aria-label", "More tools");
      const item = button("", () => { closeMenu(false); openPanel(); }); item.setAttribute("role", "menuitem");
      item.replaceChildren(svg(icons.grid));
      const content = el("span", null, "text"); content.append(el("span", "Generate design system"), el("small", "Extract and review local design tokens"));
      item.append(content); menu.append(item);
      // The wireframe panel is a separate module; the menu only offers it when
      // that module injected and attached successfully.
      const wireframe = globalThis.PageCaptureWireframe;
      if (wireframe?.openPanel) {
        const wire = button("", () => { closeMenu(false); wireframe.openPanel(); });
        wire.setAttribute("role", "menuitem");
        wire.replaceChildren(svg(icons.wireframe));
        const wireContent = el("span", null, "text");
        wireContent.append(el("span", "Copy as wireframe"), el("small", "Rebuild this page as greyscale layers"));
        wire.append(wireContent); menu.append(wire);
      }
      root.append(menu);
      const menuRect = menu.getBoundingClientRect();
      menu.style.left = `${Math.max(8, Math.min(innerWidth - menuRect.width - 8, rect.right - menuRect.width))}px`;
      menu.style.top = `${Math.max(8, rect.bottom + menuRect.height + 18 > innerHeight ? rect.top - menuRect.height - 10 : rect.bottom + 10)}px`;
      more.setAttribute("aria-expanded", "true"); item.focus({ preventScroll: true });
    }
    function mountMore() {
      if (disposed) return;
      const tools = controller.shadowRoot.querySelector('[data-toolbar-role="tools"]');
      if (!tools || tools.querySelector('[data-design-system-more]')) return;
      more = document.createElement("button"); more.type = "button"; more.className = "h2d-toolbar-btn";
      more.setAttribute("data-design-system-more", ""); more.setAttribute("data-variant", "ghost");
      more.setAttribute("aria-label", "More tools"); more.setAttribute("aria-haspopup", "menu"); more.setAttribute("aria-expanded", "false"); more.title = "More tools";
      Object.assign(more.style, { display: "inline-flex", alignItems: "center", justifyContent: "center", width: "24px", height: "24px", flexShrink: "0", padding: "0", border: "none", borderRadius: "5px", color: "rgba(255,255,255,.9)" });
      const dots = document.createElementNS("http://www.w3.org/2000/svg", "svg"); dots.setAttribute("width", "16"); dots.setAttribute("height", "16"); dots.setAttribute("viewBox", "0 0 16 16"); dots.setAttribute("aria-hidden", "true");
      for (const x of [3, 8, 13]) { const dot = document.createElementNS(dots.namespaceURI, "circle"); dot.setAttribute("cx", x); dot.setAttribute("cy", "8"); dot.setAttribute("r", "1.25"); dot.setAttribute("fill", "currentColor"); dots.append(dot); }
      more.append(dots); more.addEventListener("click", event => { event.stopPropagation(); openMenu(); }); tools.append(more);
      controller.updateActionBarLayout();
    }
    function openPanel() {
      if (dialog?.open) return;
      closeMenu(false); ensureHost();
      dialog = document.createElement("dialog"); dialog.setAttribute("aria-label", "Design system generator");
      dialog.addEventListener("cancel", event => { event.preventDefault(); closePanel(); });
      root.append(dialog); render(); dialog.showModal();
      if (!system) analyze();
    }
    async function analyze() {
      cancelBoardCopy(false);
      analysis?.abort(); const abort = new AbortController(); analysis = abort; mergeOpen = false; confirmRescan = false; status = ""; exportingError = false;
      reviewMode = ""; inspectedId = "";
      renderLoading(0);
      try {
        const result = await scanPage(document, { scope, signal: abort.signal, onProgress: count => { if (dialog?.open && analysis === abort) renderLoading(count); } });
        if (abort.signal.aborted || disposed) return;
        system = result; selected.clear(); query = "";
        category = Core.categories.find(item => system.tokens.some(token => token.category === item.id))?.id || "colors";
        analysis = null; render();
      } catch (error) {
        if (abort.signal.aborted || disposed) return;
        analysis = null; scope = system?.source.scope || scope; status = "Could not read this page's styles. Try reanalyzing the page."; exportingError = true; render();
      }
    }
    function header(shell) {
      const row = el("header", null, "header"); row.append(svg(icons.grid), el("h1", "Design system"), el("span", "LOCAL", "local"), el("span", null, "spacer"));
      const close = button("", closePanel, "icon", "close"); close.setAttribute("aria-label", "Close design system"); row.append(close); shell.append(row);
    }
    function renderLoading(count) {
      if (!dialog) return;
      dialog.replaceChildren(); const shell = el("div", null, "shell"); header(shell);
      const loading = el("div", null, "loading-view"); loading.setAttribute("role", "status");
      loading.append(el("div", null, "spinner"), el("p", "Reading rendered styles…"), el("small", count ? `${count.toLocaleString()} elements inspected · no network requests` : "Local analysis only. Your page is not modified."));
      loading.append(button("Cancel", closePanel, "secondary")); shell.append(loading); dialog.append(shell);
    }
    function matchingTokens() {
      return system?.tokens.filter(token => token.category === category && `${token.name} ${Core.valueText(token)} ${token.aliases.join(" ")}`.toLowerCase().includes(query.toLowerCase())) || [];
    }
    function preview(token, interactive = true, large = false) {
      const className = `preview${token.category === "typography" ? " type" : ""}${large ? " large" : ""}${token.category === "colors" ? " checker" : ""}`;
      const node = interactive ? button("", () => toggleReview("preview", token.id), className) : el("div", null, className);
      node.replaceChildren();
      if (interactive) {
        node.setAttribute("aria-label", `Preview ${token.id}`); node.title = "Open token preview";
        node.setAttribute("aria-expanded", String(reviewMode === "preview" && inspectedId === token.id)); node.setAttribute("aria-controls", "token-review-panel");
        node.dataset.focusKey = `preview-${token.id}`;
      } else node.setAttribute("aria-hidden", "true");
      if (token.category === "colors") { const fill = el("span", null, "color-fill"); fill.style.backgroundColor = token.value; node.append(fill); }
      else if (token.category === "typography") { node.textContent = "Aa"; node.style.fontWeight = token.value.fontWeight; node.style.fontStyle = token.value.fontStyle; }
      else if (token.category === "spacing") { const bar = el("i"); bar.style.width = `${Math.min(large ? 76 : 30, Math.abs(parseFloat(token.value)))}px`; node.append(bar); }
      else { const shape = el("b"); if (token.category === "radii") shape.style.borderRadius = token.value; if (token.category === "shadows") shape.style.boxShadow = token.value; if (token.category === "borders") shape.style.border = Core.valueText(token); node.append(shape); }
      return node;
    }
    function toggleReview(mode, tokenId = "") {
      if (confirmRescan) scope = system?.source.scope || scope;
      confirmRescan = false; mergeOpen = false;
      reviewMode = reviewMode === mode && (mode !== "preview" || inspectedId === tokenId) ? "" : mode;
      inspectedId = tokenId; render();
    }
    function reviewPane(title, mode) {
      const pane = el("section", null, "review-pane"); pane.dataset.reviewPanel = mode; pane.id = "token-review-panel";
      pane.setAttribute("aria-label", title);
      const head = el("div", null, "review-head"); head.append(el("h2", title));
      const close = button("", () => {
        focusNext = mode === "preview" ? `preview-${inspectedId}` : mode;
        reviewMode = ""; render();
      }, "icon", "close");
      close.setAttribute("aria-label", `Close ${title.toLowerCase()}`); close.dataset.focusKey = "close-review";
      head.append(close); pane.append(head); return pane;
    }
    function renderSimilar(container, pairs) {
      const pane = reviewPane("Similar values", "similar");
      pane.append(el("p", "Up to 12 closest included pairs in this category. Similar values can have different roles. Nothing changes until you confirm a merge.", "review-note"));
      if (!pairs.length) pane.append(el("p", "No pairs within the conservative thresholds. Unsupported color spaces are not approximated.", "review-note"));
      for (const pair of pairs) {
        const tokens = pair.ids.map(id => system.tokens.find(token => token.id === id));
        const row = el("div", null, "similar-pair"), details = el("div", null, "pair-details"), samples = el("div", null, "pair-tokens");
        for (const token of tokens) {
          const item = el("div", null, "pair-token"), text = el("div");
          const name = el("span", token.name, "pair-name"); name.dataset.nameRef = token.id;
          text.append(name, el("div", Core.valueText(token), "value"));
          item.append(preview(token, false), text); samples.append(item);
        }
        details.append(samples, el("small", pair.reason));
        const action = button("Review merge", () => {
          selected = new Set(pair.ids); query = ""; reviewMode = ""; mergeOpen = true; focusNext = "canonical-token"; render();
        }, "secondary");
        action.dataset.reviewPair = pair.ids.join(" "); action.dataset.focusKey = `pair-${pair.ids.join("-")}`;
        row.append(details, action); pane.append(row);
      }
      container.append(pane);
    }
    function renderContrast(container) {
      const pane = reviewPane("Color contrast", "contrast");
      const heading = pane.querySelector(".review-head"); heading.insertBefore(el("small", "Palette pair only · not a page audit", "review-scope"), heading.lastChild);
      const colors = system.tokens.filter(token => token.included && token.category === "colors");
      const opaque = colors.filter(token => Core.colorLuminance(token.value) != null).sort((a, b) => Core.colorLuminance(a.value) - Core.colorLuminance(b.value));
      if (!colors.some(token => token.id === contrastForeground)) contrastForeground = opaque[0]?.id || colors[0]?.id || "";
      if (!opaque.some(token => token.id === contrastBackground)) contrastBackground = opaque[opaque.length - 1]?.id || "";
      const fields = el("div", null, "contrast-fields");
      const field = (label, tokens, current, key, change) => {
        const wrapper = el("label", label, "review-field"), select = document.createElement("select");
        select.setAttribute("aria-label", label); select.dataset.focusKey = key;
        for (const token of tokens) { const option = el("option", `${token.name} · ${Core.valueText(token)}`); option.value = token.id; option.selected = token.id === current; select.append(option); }
        select.disabled = !tokens.length; select.addEventListener("change", () => { change(select.value); render(); });
        wrapper.append(select); return wrapper;
      };
      fields.append(field("Text token", colors, contrastForeground, "contrast-foreground", value => { contrastForeground = value; }),
        field("Background token", opaque, contrastBackground, "contrast-background", value => { contrastBackground = value; }));
      const swap = button("Swap", () => { [contrastForeground, contrastBackground] = [contrastBackground, contrastForeground]; render(); }, "secondary");
      const foreground = colors.find(token => token.id === contrastForeground), background = opaque.find(token => token.id === contrastBackground);
      swap.setAttribute("aria-label", "Swap contrast colors"); swap.dataset.focusKey = "contrast-swap";
      swap.disabled = !foreground || !background || Core.colorLuminance(foreground.value) == null;
      swap.title = "Swap is available when both colors are opaque sRGB"; fields.append(swap); pane.append(fields);
      const result = foreground && background ? Core.colorContrast(foreground.value, background.value) : null;
      if (result) {
        const sample = el("div", "Aa · Sample text 0123", "contrast-sample");
        sample.style.color = foreground.value; sample.style.backgroundColor = background.value; pane.append(sample);
        const row = el("div", null, "contrast-result"); row.setAttribute("role", "status");
        const ratio = el("strong", `${(Math.floor(result.ratio * 100 + 1e-10) / 100).toFixed(2)}:1`, "contrast-ratio"); ratio.dataset.contrastRatio = String(result.ratio); row.append(ratio);
        for (const [label, passes] of [["AA normal · 4.5:1", result.aaNormal], ["AA large · 3:1", result.aaLarge]]) {
          const badge = el("span", `${label} · ${passes ? "Meets" : "Below"}`, `contrast-badge ${passes ? "pass" : "below"}`); row.append(badge);
        }
        pane.append(row, el("small", `AAA normal (7:1): ${result.aaaNormal ? "meets" : "below"} · AAA large (4.5:1): ${result.aaaLarge ? "meets" : "below"}`));
        if (result.foregroundAlpha < 1) pane.append(el("p", "Text opacity is composited over the selected opaque background.", "review-note"));
      } else {
        pane.append(el("p", opaque.length ? "Choose an explicit sRGB text color (hex or RGB). Other color spaces are preserved in exports, not guessed here." : "Include an opaque sRGB background token to calculate contrast. Transparent backgrounds need an explicit underlay.", "review-note"));
      }
      pane.append(el("p", "Palette-pair calculation, not a page accessibility audit. Backgrounds must be opaque. Gradients, images, inherited opacity and overlays are not evaluated. Large text means at least 24px, or 18.67px bold. Thresholds use unrounded ratios.", "review-note"));
      container.append(pane);
    }
    function renderInspector(container) {
      const token = system.tokens.find(item => item.id === inspectedId);
      if (!token) { reviewMode = ""; return; }
      const pane = reviewPane("Token preview", "preview"), name = el("p", token.name, "inspector-name"); name.dataset.nameRef = token.id; pane.append(name);
      if (token.category === "typography") {
        const heading = pane.querySelector(".review-head"); heading.insertBefore(el("small", "Scaled system-font specimen", "review-scope"), heading.lastChild);
        const sample = el("div", "The quick brown fox · 0123456789", "inspector-type");
        Object.assign(sample.style, Core.typographyPreview(token.value)); pane.append(sample);
        const metrics = el("div", null, "type-metrics");
        for (const property of Core.typeProperties) {
          const item = el("div"); item.append(el("small", property.replace(/[A-Z]/g, char => ` ${char.toLowerCase()}`)), el("div", token.value[property], "value")); metrics.append(item);
        }
        pane.append(metrics, el("p", "Scaled system-font specimen. Observed values are shown above; website font files are not loaded.", "review-note"));
      } else {
        const body = el("div", null, "inspector-body"), details = el("div"); details.append(el("div", Core.valueText(token), "value"));
        const rgba = token.category === "colors" ? Core.parseSrgb(token.value) : null;
        if (rgba) details.append(el("p", `RGB ${[rgba.r, rgba.g, rgba.b].map(channel => Math.round(channel * 255)).join(", ")} · ${Number((rgba.a * 100).toFixed(1))}% opacity`, "review-note"));
        else if (token.category === "spacing") details.append(el("p", "Ruler is scaled to fit. The signed observed value is retained in exports.", "review-note"));
        else if (token.category === "colors") details.append(el("p", "Original color space is retained; no sRGB approximation is made.", "review-note"));
        body.append(preview(token, false, true), details); pane.append(body);
      }
      pane.append(el("p", `${token.count} property observations · ${token.included ? "Included in exports" : "Excluded from exports"}${token.merged ? ` · ${token.observations.length} original values retained` : ""}`, "review-note"));
      if (token.aliases.length) pane.append(el("p", `Matching CSS variables: ${token.aliases.join(", ")}`, "value"));
      container.append(pane);
    }
    function updateFooter() {
      if (!system || !dialog) return;
      const errors = Core.validate(system), byId = new Map(system.tokens.map(token => [token.id, token]));
      for (const node of root.querySelectorAll('[data-name-ref]')) { const token = byId.get(node.dataset.nameRef); if (token) node.textContent = token.name; }
      for (const option of root.querySelectorAll('select option')) { const token = byId.get(option.value); if (token) option.textContent = `${token.name} · ${Core.valueText(token)}`; }
      for (const check of root.querySelectorAll('.row input[type=checkbox]')) { const token = byId.get(check.closest('.row').dataset.tokenId); if (token) check.setAttribute("aria-label", `Select ${token.name}`); }
      const notice = root.querySelector('[data-generator-status]');
      if (notice) { notice.textContent = errors[0] || status || "Names are suggestions unless linked to a CSS variable."; notice.classList.toggle("error", !!errors.length || exportingError); }
      for (const action of root.querySelectorAll('[data-export-kind]')) action.disabled = !!errors.length || !!boardCopy;
      const copy = root.querySelector('[data-copy-design-system]');
      if (copy) { copy.disabled = !!errors.length || !!boardCopy; copy.querySelector('span').textContent = boardCopy ? "Copying…" : "Copy design system"; }
      const cancel = root.querySelector('[data-cancel-board-copy]'); if (cancel) cancel.disabled = boardCopy?.phase === "writing";
      dialog.setAttribute("aria-busy", String(!!boardCopy));
      if (boardCopy) for (const control of dialog.querySelectorAll('input,select,button')) {
        if (!control.hasAttribute('data-cancel-board-copy') && control.getAttribute('aria-label') !== "Close design system") control.disabled = true;
      }
      const included = root.querySelector('[data-included-count]'); if (included) included.textContent = `${system.tokens.filter(token => token.included).length} tokens included`;
      for (const input of root.querySelectorAll('[data-token-name]')) {
        const token = system.tokens.find(item => item.id === input.dataset.tokenName);
        const collisions = Core.cssEntries(token).some(([name]) => errors.includes(`Duplicate exported variable: ${name}`));
        input.classList.toggle("invalid", token.included && (!/^[a-z][a-z0-9-]{0,63}$/.test(token.name) || collisions || system.tokens.some(other => other.id !== token.id && other.included && other.name === token.name)));
        input.setAttribute("aria-invalid", input.classList.contains("invalid") ? "true" : "false");
      }
    }
    function cancelBoardCopy(announce = true) {
      const job = boardCopy;
      if (!job) return;
      job.abort.abort(); boardCopy = null;
      status = announce ? "Board preparation cancelled." : ""; exportingError = false;
      if (announce && dialog?.open) { focusNext = "copy-design-system"; render(); }
    }
    async function copyBoard() {
      if (boardCopy || !system || typeof copyDesign !== "function") return;
      const errors = Core.validate(system);
      if (errors.length) { status = errors[0]; exportingError = true; updateFooter(); return; }
      const job = { abort: new AbortController(), phase: "preparing" }; boardCopy = job;
      status = "Preparing editable board… Keep this page focused."; exportingError = false; render();
      try {
        const result = await copyDesign(system, {
          mount: root, signal: AbortSignal.any([job.abort.signal, signal]),
          onPhase: phase => {
            if (boardCopy !== job || disposed || !dialog?.open) return;
            job.phase = phase; status = "Writing design-system board to the clipboard…"; updateFooter();
          }
        });
        if (boardCopy !== job || job.abort.signal.aborted || disposed || !dialog?.open) return;
        status = `${result.count} tokens copied as an editable board. Switch to Figma Design and paste onto the canvas.`; exportingError = false;
      } catch (error) {
        if (boardCopy !== job || job.abort.signal.aborted || disposed || !dialog?.open) return;
        status = job.phase === "writing" ? "Clipboard write failed. Keep this page focused and try again." :
          error?.name === "TimeoutError" ? "Board preparation timed out. Keep this tab visible and try again." :
          "Could not prepare the editable board. Try again on HTTPS, or exclude some tokens from a large board.";
        exportingError = true;
      } finally {
        if (boardCopy === job) { boardCopy = null; if (!disposed && dialog?.open) { focusNext = "copy-design-system"; render(); } }
      }
    }
    function download(kind) {
      if (boardCopy) return;
      try {
        const formats = { json: [Core.toJson, "application/json", "tokens.json"], css: [Core.toCss, "text/css", "variables.css"], html: [Core.toHtml, "text/html", "style-guide.html"] };
        const [build, type, suffix] = formats[kind];
        const url = URL.createObjectURL(new Blob([build(system)], { type })); objectUrls.add(url);
        const link = document.createElement("a"); link.href = url; link.download = `${Core.slug(system.source.title) || "website"}-${suffix}`; link.style.display = "none"; root.append(link); link.click(); link.remove();
        const timer = setTimeout(() => { URL.revokeObjectURL(url); objectUrls.delete(url); downloadTimers.delete(timer); }, 30000);
        downloadTimers.add(timer);
        status = `${kind === "json" ? "Tokens JSON" : kind === "css" ? "CSS variables" : "Style guide"} exported locally.`; exportingError = false; updateFooter();
      } catch { status = "Export failed. Check the token names and try again."; exportingError = true; updateFooter(); }
    }
    function renderList(container) {
      const tokens = matchingTokens();
      const list = el("div", null, "list"); list.setAttribute("data-token-list", "");
      const top = el("div", null, "table-head"); const label = el("label");
      const all = document.createElement("input"); all.type = "checkbox"; all.setAttribute("aria-label", "Select all visible tokens");
      all.checked = tokens.length > 0 && tokens.every(token => selected.has(token.id)); all.indeterminate = !all.checked && tokens.some(token => selected.has(token.id));
      all.addEventListener("change", () => { for (const token of tokens) all.checked ? selected.add(token.id) : selected.delete(token.id); render(); });
      label.append(all, el("span", `${Core.categories.find(item => item.id === category).label} · ${tokens.length}`)); top.append(label); list.append(top);
      if (!tokens.length) list.append(el("div", "No matching tokens in this category.", "empty"));
      for (const token of tokens) {
        const row = el("div", null, `row${token.included ? "" : " excluded"}`); row.dataset.tokenId = token.id;
        const check = document.createElement("input"); check.type = "checkbox"; check.checked = selected.has(token.id); check.setAttribute("aria-label", `Select ${token.name}`); check.dataset.focusKey = `select-${token.id}`;
        check.addEventListener("change", () => { check.checked ? selected.add(token.id) : selected.delete(token.id); render(); });
        const details = el("div", null, "details");
        const name = document.createElement("input"); name.type = "text"; name.value = token.name; name.className = "name"; name.maxLength = 64; name.dataset.tokenName = token.id; name.setAttribute("aria-label", `Token name ${token.id}`); name.spellcheck = false;
        name.addEventListener("input", () => { token.name = name.value; token.nameOrigin = "user"; status = ""; exportingError = false; updateFooter(); });
        const value = el("div", Core.valueText(token), "value");
        const evidence = el("div", null, "evidence"); evidence.append(el("span", `${token.count} uses`), el("span", token.aliases.length ? token.aliases[0] : "Suggested name", token.aliases.length ? "alias" : ""));
        if (token.aliases.length) evidence.title = `CSS variables: ${token.aliases.join(", ")}`;
        if (token.merged) evidence.append(el("span", "Merged · original values retained"));
        if (!token.included) evidence.append(el("span", "Excluded from exports"));
        details.append(name, value, evidence);
        const include = button(token.included ? "Exclude" : "Include", () => { token.included = !token.included; status = ""; render(); }, "include"); include.setAttribute("aria-label", `${token.included ? "Exclude" : "Include"} ${token.id}`); include.dataset.focusKey = `include-${token.id}`;
        row.append(check, preview(token), details, include); list.append(row);
      }
      container.append(list);
    }
    function render() {
      if (!dialog) return;
      if (analysis) { renderLoading(0); return; }
      const sameView = renderedCategory === category && renderedQuery === query;
      const listTop = sameView ? root.querySelector('[data-token-list]')?.scrollTop || 0 : 0;
      const workspaceTop = sameView && renderedReview === reviewMode ? root.querySelector('.workspace')?.scrollTop || 0 : 0;
      const shellTop = sameView ? root.querySelector('.shell')?.scrollTop || 0 : 0;
      const focusKey = focusNext || root.activeElement?.dataset.focusKey; focusNext = "";
      dialog.replaceChildren(); const shell = el("div", null, "shell"); header(shell);
      const intro = el("div", null, "intro"); const description = el("div");
      description.append(el("p", "Observed styles. Review names and roles before exporting."));
      description.append(el("small", system ? `${system.source.elements.toLocaleString()} elements · ${system.source.viewport.width}px viewport · session only` : "No styles analyzed yet."));
      const scopeTools = el("div", null, "scope-tools"); const select = document.createElement("select"); select.setAttribute("aria-label", "Analysis scope");
      for (const [value, text] of [["rendered", "Rendered page"], ["viewport", "Current viewport"]]) { const option = el("option", text); option.value = value; option.selected = scope === value; select.append(option); }
      select.addEventListener("change", () => { scope = select.value; confirmRescan = true; mergeOpen = false; render(); });
      const rescan = button("", () => { confirmRescan = true; mergeOpen = false; render(); }, "icon secondary", "refresh"); rescan.title = "Reanalyze"; rescan.setAttribute("aria-label", "Reanalyze page");
      scopeTools.append(select, rescan); intro.append(description, scopeTools); shell.append(intro);
      if (confirmRescan) {
        const confirm = el("div", null, "confirm"); confirm.append(el("p", "Reanalyzing replaces your current names, exclusions and merges. The website will not be changed."), button("Reanalyze", analyze, "primary"), button("Cancel", () => { scope = system?.source.scope || scope; confirmRescan = false; render(); })); shell.append(confirm);
      }
      if (!system) {
        const empty = el("div", status || "No tokens found. Try analyzing another rendered page.", "empty"); shell.append(empty, button("Analyze page", analyze, "secondary")); dialog.append(shell); return;
      }
      if (system.source.truncated) shell.append(el("div", system.warnings[0], "notice"));
      const body = el("div", null, "body"), nav = el("nav", null, "nav"); nav.setAttribute("aria-label", "Token categories");
      for (const item of Core.categories) {
        const count = system.tokens.filter(token => token.category === item.id).length;
        const tab = button(item.label, () => { category = item.id; query = ""; selected.clear(); mergeOpen = false; reviewMode = ""; render(); }, item.id === category ? "active" : "");
        tab.dataset.focusKey = `category-${item.id}`;
        tab.setAttribute("aria-current", item.id === category ? "page" : "false"); tab.append(el("span", count, "count")); tab.setAttribute("aria-label", `${item.label}, ${count} tokens`); nav.append(tab);
      }
      const workspace = el("div", null, "workspace"), tools = el("div", null, "tools");
      const search = document.createElement("input"); search.type = "search"; search.placeholder = "Search tokens…"; search.setAttribute("aria-label", "Search tokens"); search.className = "search"; search.value = query;
      search.addEventListener("input", () => { query = search.value; searchFocus = true; render(); });
      const merge = button(`Merge${selected.size ? ` (${selected.size})` : ""}`, () => { mergeOpen = !mergeOpen; if (confirmRescan) scope = system?.source.scope || scope; confirmRescan = false; reviewMode = ""; if (mergeOpen) focusNext = "canonical-token"; render(); }, "secondary"); merge.disabled = selected.size < 2; merge.dataset.focusKey = "merge";
      const exclude = button("Exclude selected", () => { for (const token of system.tokens) if (selected.has(token.id)) token.included = false; selected.clear(); render(); }); exclude.disabled = !selected.size;
      const pairs = Core.suggestSimilar(system, category);
      const similar = button(`Similar (${pairs.length})`, () => toggleReview("similar"), reviewMode === "similar" ? "secondary review-active" : "secondary");
      similar.setAttribute("aria-label", "Review similar values"); similar.setAttribute("aria-expanded", String(reviewMode === "similar")); similar.dataset.focusKey = "similar";
      tools.append(search, merge, exclude, similar);
      if (category === "colors") {
        const contrast = button("Contrast", () => toggleReview("contrast"), reviewMode === "contrast" ? "secondary review-active" : "secondary");
        contrast.setAttribute("aria-label", "Check color contrast"); contrast.setAttribute("aria-expanded", String(reviewMode === "contrast")); contrast.dataset.focusKey = "contrast"; tools.append(contrast);
      }
      workspace.classList.toggle("has-review", !!reviewMode); workspace.append(tools);
      if (reviewMode === "similar") renderSimilar(workspace, pairs);
      else if (reviewMode === "contrast") renderContrast(workspace);
      else if (reviewMode === "preview") renderInspector(workspace);
      if (mergeOpen) {
        const confirm = el("div", null, "confirm"), keep = document.createElement("select"); keep.setAttribute("aria-label", "Canonical token to keep"); keep.dataset.focusKey = "canonical-token";
        for (const token of system.tokens.filter(token => selected.has(token.id))) { const option = el("option", `${token.name} · ${Core.valueText(token)}`); option.value = token.id; keep.append(option); }
        confirm.append(el("p", "Choose the name and value to keep. Only exported tokens change; original observed values remain in JSON evidence."), keep,
          button("Merge tokens", () => { system = Core.mergeTokens(system, [...selected], keep.value); selected.clear(); mergeOpen = false; status = "Tokens merged locally; original observations are preserved."; render(); }, "primary"),
          button("Cancel", () => { mergeOpen = false; render(); })); workspace.append(confirm);
      }
      renderList(workspace); body.append(nav, workspace); shell.append(body);
      const footer = el("footer", null, "footer"), exportRow = el("div", null, "export-row");
      const count = el("span", "", "included"); count.setAttribute("data-included-count", ""); exportRow.append(count);
      if (typeof copyDesign === "function") {
        const copy = button("Copy design system", copyBoard, "primary", "copy"); copy.setAttribute("data-copy-design-system", ""); copy.dataset.focusKey = "copy-design-system";
        copy.title = "Copy included tokens as a new editable visual board, then paste into Figma Design. No variables or shared styles are applied."; exportRow.append(copy);
        if (boardCopy) { const cancel = button("Cancel", () => cancelBoardCopy(), "secondary"); cancel.setAttribute("data-cancel-board-copy", ""); cancel.title = "Cancel preparation; a native clipboard write already started cannot be undone."; exportRow.append(cancel); }
      }
      for (const [kind, label] of [["json", "Tokens JSON"], ["css", "CSS variables"], ["html", "Style guide"]]) {
        const action = button(label, () => download(kind), kind === "json" && typeof copyDesign !== "function" ? "primary" : "secondary", "download"); action.dataset.exportKind = kind; exportRow.append(action);
      }
      const message = el("div", "", "status"); message.setAttribute("data-generator-status", ""); message.setAttribute("role", "status");
      footer.append(exportRow, message, el("p", "All included tokens are used. Copy creates a new visual board, not variables or shared styles. Nothing is uploaded; fonts are not downloaded.", "footnote")); shell.append(footer); dialog.append(shell); updateFooter();
      root.querySelector('[data-token-list]').scrollTop = listTop;
      workspace.scrollTop = workspaceTop; shell.scrollTop = shellTop;
      renderedCategory = category; renderedQuery = query; renderedReview = reviewMode;
      if (searchFocus) { searchFocus = false; search.focus({ preventScroll: true }); }
      else if (focusKey) root.querySelector(`[data-focus-key="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
    }

    function dispose() {
      disposed = true; cancelBoardCopy(false); observer?.disconnect(); closeMenu(false); analysis?.abort(); dialog?.close(); host?.remove(); more?.remove();
      for (const timer of downloadTimers) clearTimeout(timer); downloadTimers.clear();
      for (const url of objectUrls) URL.revokeObjectURL(url); objectUrls.clear();
      if (config.onEvent === featureOnEvent) config.onEvent = previousOnEvent;
    }
    try {
      config.onEvent = featureOnEvent;
      observer = new MutationObserver(() => mountMore()); observer.observe(controller.shadowRoot, { childList: true, subtree: true }); mountMore();
      signal.addEventListener("abort", dispose, { once: true });
      document.addEventListener("pointerdown", event => {
        if (menu && !event.composedPath().includes(host) && !event.composedPath().includes(controller.element)) closeMenu(false);
      }, { capture: true, signal });
      window.addEventListener("keydown", event => {
        if (dialog?.open) {
          if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); closePanel(); }
          else if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); event.stopImmediatePropagation(); }
        } else if (menu && event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); closeMenu(); }
        else if (menu && (event.key === "Tab" || (event.ctrlKey || event.metaKey) && event.key === "Enter")) closeMenu();
      }, { capture: true, signal });
      controllers.set(controller, { dispose });
    } catch { observer?.disconnect(); more?.remove(); if (config.onEvent === featureOnEvent) config.onEvent = previousOnEvent; }
  }
  globalThis.PageCaptureDesignSystem = Object.freeze({ attach, scanPage });
})();
