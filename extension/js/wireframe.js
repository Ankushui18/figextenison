/* Wireframe: rebuild the page you see as editable, greyscale Figma layers.
 * Local only. Reads the live DOM, writes nothing to it, loads no images. */
(() => {
  "use strict";
  if (globalThis.PageCaptureWireframe) return;
  const Core = globalThis.PageCaptureWireframeCore;
  if (!Core) return;

  const HOST_ID = "__page_capture_wireframe__";
  const OWN_IDS = new Set([HOST_ID, "__figma_html_to_design_toolbar_host__", "__pc_viewports__", "__page_capture_design_system__"]);
  const MAX_CLIPBOARD_BYTES = 16 * 1024 * 1024;
  const SCAN = Object.freeze({ elements: 24000, boxes: 2800, texts: 3000, depth: 36, height: 16000 });
  const SKIP_TAGS = new Set([
    "SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "LINK", "META", "TITLE", "HEAD", "BASE",
    "SOURCE", "TRACK", "PARAM", "BR", "WBR", "COL", "COLGROUP", "OPTION", "OPTGROUP", "DATALIST"
  ]);
  const SEMANTIC_TAGS = new Set([
    "HEADER", "NAV", "MAIN", "SECTION", "ARTICLE", "ASIDE", "FOOTER", "FORM", "UL", "OL", "LI",
    "DL", "DT", "DD", "TABLE", "THEAD", "TBODY", "TFOOT", "TR", "TD", "TH", "FIGURE", "FIGCAPTION",
    "BLOCKQUOTE", "DETAILS", "SUMMARY", "P", "H1", "H2", "H3", "H4", "H5", "H6", "LABEL", "PRE"
  ]);
  const SEMANTIC_ROLES = new Set(["banner", "navigation", "main", "contentinfo", "region", "article", "list", "listitem", "form", "dialog", "complementary", "search", "tabpanel", "table", "row", "cell"]);
  const ROLE_NAMES = {
    HEADER: "Header", NAV: "Nav", MAIN: "Main", SECTION: "Section", ARTICLE: "Card", ASIDE: "Aside",
    FOOTER: "Footer", FORM: "Form", UL: "List", OL: "List", LI: "List item", DL: "List", DT: "Term",
    DD: "Description", TABLE: "Table", THEAD: "Table head", TBODY: "Table body", TFOOT: "Table foot",
    TR: "Row", TD: "Cell", TH: "Cell", FIGURE: "Figure", FIGCAPTION: "Caption", BLOCKQUOTE: "Quote",
    DETAILS: "Details", SUMMARY: "Summary", P: "Paragraph", H1: "Heading 1", H2: "Heading 2",
    H3: "Heading 3", H4: "Heading 4", H5: "Heading 5", H6: "Heading 6", LABEL: "Label", PRE: "Code",
    A: "Link", BUTTON: "Button", INPUT: "Input", SELECT: "Select", TEXTAREA: "Textarea", IMG: "Image",
    SVG: "Icon", VIDEO: "Video", AUDIO: "Audio", CANVAS: "Canvas", IFRAME: "Embedded frame",
    EMBED: "Embedded content", OBJECT: "Embedded content"
  };

  const el = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const style = (node, values) => { for (const [key, value] of Object.entries(values)) if (value != null) node.style[key] = value; };
  const px = value => `${Math.round(value * 100) / 100}px`;
  const svg = (paths, size = 16) => {
    const node = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    node.setAttribute("width", size); node.setAttribute("height", size); node.setAttribute("viewBox", "0 0 16 16");
    node.setAttribute("fill", "none"); node.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(node.namespaceURI, "path");
    path.setAttribute("d", paths); path.setAttribute("stroke", "currentColor"); path.setAttribute("stroke-width", "1.25");
    path.setAttribute("stroke-linecap", "round"); path.setAttribute("stroke-linejoin", "round");
    node.append(path);
    return node;
  };
  const icons = {
    wireframe: "M2 3.5h12M2 8h12M2 12.5h12M5 3.5v9M11 3.5v9",
    close: "M4 4l8 8M12 4l-8 8",
    copy: "M5 5h8v9H5zM3 11H2V2h8v1",
    refresh: "M13 6A5 5 0 1 0 13 10M13 2v4H9"
  };

  const CSS = `
:host{all:initial!important;display:block!important;visibility:visible!important;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;color-scheme:dark!important;--bg:#2c2c2c!important;--fg:rgba(255,255,255,.9)!important;--muted:rgba(255,255,255,.5)!important;--line:rgba(255,255,255,.1)!important;--blue:#0d99ff!important;font:500 12px/16px var(--ui-font,system-ui,sans-serif)!important;color:var(--fg)!important}
*,*::before,*::after{box-sizing:border-box}
button{font:inherit;color:inherit;border:0;background:none;border-radius:5px;padding:0 8px;height:28px;display:inline-flex;align-items:center;justify-content:center;gap:6px;white-space:nowrap;cursor:pointer;font-weight:500}
button:hover:enabled{background:rgba(255,255,255,.08)}
button:disabled{opacity:.35;cursor:default}
button:focus-visible{outline:2px solid var(--blue);outline-offset:2px}
button.primary{background:var(--blue);color:#fff}
button.primary:hover:enabled{background:#0785e2}
button.secondary{border:1px solid var(--line)}
button.icon{width:28px;padding:0;flex-shrink:0}
h1,p{margin:0;font-size:inherit;font-weight:500}
svg{flex-shrink:0}
dialog{pointer-events:auto;position:fixed;inset:0;margin:auto;width:min(960px,calc(100vw - 40px));height:min(720px,calc(100vh - 80px));max-width:none;max-height:none;padding:0;color:var(--fg);background:var(--bg);border:1px solid var(--line);border-radius:13px;box-shadow:0 8px 32px #0005;font:inherit;overflow:hidden}
dialog::backdrop{background:rgba(0,0,0,.22)}
.shell{height:100%;display:flex;flex-direction:column;min-height:0}
.header{display:flex;align-items:center;gap:8px;min-height:52px;padding:10px 12px 10px 16px;border-bottom:1px solid var(--line);flex-shrink:0}
.header h1{font-size:13px;line-height:20px}
.header>svg{color:var(--muted)}
.local{font-size:10px;letter-spacing:.06em;color:var(--blue);border:1px solid rgba(13,153,255,.3);background:rgba(13,153,255,.08);border-radius:4px;padding:1px 5px}
.spacer{flex:1}
.intro{display:flex;flex-direction:column;gap:10px;padding:12px 16px;border-bottom:1px solid var(--line);flex-shrink:0}
.intro p{color:var(--muted);line-height:18px}
.levels{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.level{display:flex;flex-direction:column;align-items:flex-start;gap:3px;height:auto;min-height:62px;padding:9px 10px;border:1px solid var(--line);border-radius:8px;text-align:left;background:transparent;white-space:normal}
.level strong{font-size:12px;font-weight:600}
.level span{font-size:10.5px;line-height:14px;color:var(--muted);font-weight:400}
.level[aria-pressed=true]{border-color:rgba(13,153,255,.6);background:rgba(13,153,255,.12);color:var(--blue)}
.level[aria-pressed=true] span{color:rgba(255,255,255,.72)}
.row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:space-between}
.row .group{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.seg{display:inline-flex;border:1px solid var(--line);border-radius:6px;overflow:hidden}
.seg button{border-radius:0;height:24px;padding:0 10px;font-size:11px}
.seg button[aria-pressed=true]{background:rgba(13,153,255,.15);color:var(--blue)}
.stage-wrap{position:relative;flex:1;min-height:0;display:flex;background:#202020;border-bottom:1px solid var(--line)}
.stage{flex:1;min-height:0;overflow:auto;padding:16px;overscroll-behavior:contain;scrollbar-color:#555 transparent;scrollbar-width:thin;background:repeating-conic-gradient(#252525 0 25%,#292929 0 50%) 0 0/16px 16px}
.board{position:relative;margin:0 auto;background:#fff;box-shadow:0 4px 20px #0007}
.board iframe{display:block;border:0;background:transparent}
.loading{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:10px;color:var(--muted);text-align:center;padding:24px}
.spinner{width:20px;height:20px;border:2px solid var(--line);border-top-color:var(--blue);border-radius:50%;animation:pcw-spin .8s linear infinite}
@keyframes pcw-spin{to{transform:rotate(360deg)}}
.footer{border-top:1px solid var(--line);padding:12px 16px;display:flex;flex-direction:column;gap:8px;flex-shrink:0}
.actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.stats{color:var(--muted);font-size:11px;margin-right:auto;min-width:0;overflow-wrap:anywhere}
.status{font-size:11px;line-height:15px;color:var(--muted);min-height:15px}
.status.error{color:#ffb5a6}
.footnote{font-size:10px;line-height:15px;color:var(--muted)}
@media(max-width:640px){dialog{width:calc(100vw - 16px);height:calc(100vh - 32px)}.levels{grid-template-columns:1fr}.level{min-height:0;padding:8px 10px}.intro{padding:10px 12px}.footer{padding:10px 12px}.header{padding-left:12px}}
@media(prefers-reduced-motion:reduce){.spinner{animation:none}}
`;

  /* ------------------------------------------------------------------ scan */

  const number = value => {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const parsePx = value => /px$/.test(String(value)) ? number(value) : null;

  function isLink(element) {
    try { return !!element.closest?.("a[href]"); } catch { return false; }
  }

  function fontOf(computed) {
    const size = number(computed.fontSize) || 14;
    const lineHeight = parsePx(computed.lineHeight) ?? (number(computed.lineHeight) > 0 ? size * number(computed.lineHeight) : size * 1.4);
    return {
      size,
      weight: number(computed.fontWeight) || 400,
      lineHeight: lineHeight > 0 ? lineHeight : size * 1.4,
      family: computed.fontFamily || "",
      align: computed.textAlign === "start" ? "left" : computed.textAlign === "end" ? "right" : computed.textAlign || "left",
      transform: computed.textTransform || "none",
      style: computed.fontStyle || "normal",
      decoration: computed.textDecorationLine || "none",
      spacing: computed.letterSpacing === "normal" ? 0 : number(computed.letterSpacing)
    };
  }

  function radiusOf(box, computed) {
    const value = computed.borderTopLeftRadius || "";
    if (/%$/.test(value)) return Math.min(box.w, box.h) * number(value) / 100;
    return Math.max(parsePx(value) || 0, parsePx(computed.borderBottomRightRadius) || 0);
  }

  function borderWidthOf(computed) {
    return Math.max(
      parsePx(computed.borderTopWidth) || 0,
      parsePx(computed.borderRightWidth) || 0,
      parsePx(computed.borderBottomWidth) || 0,
      parsePx(computed.borderLeftWidth) || 0
    );
  }

  const isPainted = computed => {
    const background = Core.parseColor(computed.backgroundColor);
    return (!!background && background.a > 0.05) ||
      (borderWidthOf(computed) > 0 && computed.borderTopStyle !== "none") ||
      (!!computed.boxShadow && computed.boxShadow !== "none") ||
      hasUrlBackground(computed) || hasGradient(computed);
  };
  const hasUrlBackground = computed => typeof computed.backgroundImage === "string" && computed.backgroundImage.includes("url(");
  const hasGradient = computed => typeof computed.backgroundImage === "string" && computed.backgroundImage.includes("gradient(");
  const clips = computed => /^(hidden|clip|auto|scroll|overlay)$/.test(computed.overflow || "") ||
    /^(hidden|clip|auto|scroll|overlay)$/.test(computed.overflowY || "");

  const clean = (text, length = 34) => {
    const value = String(text || "").replace(/\s+/g, " ").trim();
    return value.length > length ? `${value.slice(0, length - 1)}…` : value;
  };

  function classHint(element) {
    for (const name of element.classList || []) {
      if (!/^[a-z][a-z-]{2,24}$/i.test(name)) continue;
      if (/\d/.test(name)) continue;
      if (/^(css|sc|jsx|ng|mu|Mui|v-|js-|_)/.test(name)) continue;
      return name.replace(/[-_]/g, " ").replace(/\b\w/g, letter => letter.toUpperCase());
    }
    return "";
  }

  function boxName(element) {
    const label = (element.getAttribute("aria-label") || "").trim();
    if (label) return clean(label, 40);
    const custom = (element.getAttribute("data-name") || element.getAttribute("title") || "").trim();
    if (custom) return clean(custom, 40);
    return ROLE_NAMES[element.tagName] || classHint(element) || element.localName;
  }

  function textName(text, font, tag) {
    const snippet = clean(text, 30);
    const heading = /^H[1-6]$/.test(tag) || font.size >= 20 || font.weight >= 600;
    return `${heading ? "Heading" : "Text"} · ${snippet || "label"}`;
  }

  function mediaLabel(element, tag) {
    const explicit = (element.getAttribute("aria-label") || element.getAttribute("title") || "").trim();
    if (explicit) return clean(explicit, 40);
    if (tag === "IMG") return clean(element.getAttribute("alt") || "", 40);
    return "";
  }

  // Returns a terminal node for media and form controls, or null for ordinary
  // elements. Media is never rebuilt from inside: no image is fetched or drawn.
  function specialOf(element, computed, box) {
    const tag = element.tagName;
    const local = element.localName;
    const radius = radiusOf(box, computed);
    const square = Math.abs(box.w - box.h) <= Math.max(2, Math.min(box.w, box.h) * 0.12);
    const round = radius >= Math.min(box.w, box.h) / 2 - 0.5;
    const media = (label, extra = {}) => ({
      kind: "media", name: label || "Media",
      label: mediaLabel(element, tag) || (extra.avatar ? "Avatar" : ROLE_NAMES[tag] || "Media"),
      icon: false, avatar: false, radius, ...extra
    });
    if (local === "svg") return media("Icon", { icon: true });
    if (/^(IMG|VIDEO|CANVAS|IFRAME|EMBED|OBJECT|AUDIO)$/.test(tag)) {
      const avatar = tag === "IMG" && square && box.w <= 160 && (round || /avatar|profile|logo|badge/i.test(element.getAttribute("class") || ""));
      const icon = !avatar && box.w <= 40 && box.h <= 40;
      return media(avatar ? "Avatar" : tag === "IMG" ? "Image" : (ROLE_NAMES[tag] || "Media"), { avatar, icon });
    }
    if (tag === "INPUT") {
      const type = (element.type || "text").toLowerCase();
      if (type === "hidden") return null;
      if (type === "checkbox" || type === "radio") return { kind: "media", name: type === "radio" ? "Radio" : "Checkbox", icon: true, avatar: false, radius: type === "radio" ? radius : 0, label: "" };
      return { kind: "field", name: type === "submit" || type === "button" || type === "reset" ? "Button" : "Input", label: "", radius, placeholder: element.getAttribute("placeholder") || "" };
    }
    if (tag === "SELECT") return { kind: "field", name: "Select", label: "", radius, placeholder: "" };
    if (tag === "TEXTAREA") return { kind: "field", name: "Textarea", label: "", radius, placeholder: element.getAttribute("placeholder") || "" };
    if (tag === "BUTTON" || element.getAttribute("role") === "button") return { kind: "control", name: boxName(element) || "Button", label: "", radius };
    if (tag === "HR") return { kind: "rule", name: "Divider" };
    if (element.getAttribute("role") === "img") return media("Image");
    return null;
  }

  function scanPage(options = {}) {
    const doc = document;
    const mode = options.area === "viewport" ? "viewport" : "page";
    const docEl = doc.documentElement;
    const body = doc.body || docEl;
    const scrollX = Math.max(0, window.scrollX || 0);
    const scrollY = Math.max(0, window.scrollY || 0);
    const viewport = { width: Math.round(window.innerWidth), height: Math.round(window.innerHeight) };
    const pageWidth = Math.max(viewport.width, docEl.scrollWidth || 0, body.scrollWidth || 0);
    const pageHeight = Math.max(viewport.height, docEl.scrollHeight || 0, body.scrollHeight || 0);
    const originX = mode === "viewport" ? scrollX : 0;
    const originY = mode === "viewport" ? scrollY : 0;
    const area = mode === "viewport"
      ? { width: Math.min(viewport.width, Core.LIMITS.width), height: Math.min(viewport.height, Core.LIMITS.height) }
      : { width: Math.min(pageWidth, Core.LIMITS.width), height: Math.min(pageHeight, SCAN.height) };

    const nodes = [];
    const stats = { elements: 0, textRuns: 0, placeholders: 0, skipped: 0, truncated: false };
    const budget = { boxes: SCAN.boxes, texts: SCAN.texts };

    const areaX = value => value + scrollX - originX;
    const areaY = value => value + scrollY - originY;
    const boxOf = rect => ({ x: areaX(rect.left), y: areaY(rect.top), w: rect.width, h: rect.height });
    const areaRect = { x: 0, y: 0, w: area.width, h: area.height };
    const intersects = (box, clip) => box.w > 0.5 && box.h > 0.5 &&
      box.x < clip.x + clip.w && box.x + box.w > clip.x && box.y < clip.y + clip.h && box.y + box.h > clip.y;
    const intersect = (box, clip) => {
      const left = Math.max(box.x, clip.x), top = Math.max(box.y, clip.y);
      return {
        x: left, y: top,
        w: Math.min(box.x + box.w, clip.x + clip.w) - left,
        h: Math.min(box.y + box.h, clip.y + clip.h) - top
      };
    };
    const overlaps = box => intersects(box, areaRect);

    function measureText(textNode, element, computed, parentIndex, clipRect) {
      const value = (textNode.nodeValue || "").replace(/\s+/g, " ").trim();
      if (!value) return;
      if (budget.texts <= 0) { stats.truncated = true; return; }
      let rects = [];
      try {
        const range = element.ownerDocument.createRange();
        range.selectNodeContents(textNode);
        rects = [...range.getClientRects()].map(boxOf).filter(box => intersects(box, clipRect));
        range.detach?.();
      } catch { return; }
      if (!rects.length) return;
      const font = fontOf(computed);
      budget.texts--;
      stats.textRuns++;
      nodes.push({
        kind: "text", parent: parentIndex,
        x: Math.min(...rects.map(rect => rect.x)),
        y: Math.min(...rects.map(rect => rect.y)),
        w: Math.max(...rects.map(rect => rect.x + rect.w)) - Math.min(...rects.map(rect => rect.x)),
        h: Math.max(...rects.map(rect => rect.y + rect.h)) - Math.min(...rects.map(rect => rect.y)),
        text: value.slice(0, 4000),
        name: textName(value, font, element.tagName),
        color: computed.color,
        link: isLink(element),
        font
      });
    }

    function visit(element, parentIndex, parentBox, depth, clipRect) {
      if (depth > SCAN.depth) { stats.truncated = true; return; }
      if (++stats.elements > SCAN.elements) { stats.truncated = true; return; }
      if (SKIP_TAGS.has(element.tagName)) return;
      if (element.hasAttribute("data-h2d-ignore") || OWN_IDS.has(element.id) || /^page-capture-/.test(element.localName)) return;
      let computed;
      try { computed = getComputedStyle(element); } catch { return; }
      if (!computed) return;
      if (computed.display === "none" || computed.visibility === "hidden" || computed.visibility === "collapse") return;
      if (number(computed.opacity) === 0 || computed.contentVisibility === "hidden") return;
      if (computed.display === "contents") {
        // No box of its own, but its children still paint at their own positions.
        walkChildren(element, parentIndex, parentBox, depth, computed, clipRect);
        return;
      }
      let rect;
      try { rect = element.getBoundingClientRect(); } catch { return; }
      const box = boxOf(rect);
      // A fixed bar belongs at the top of a full-page wireframe, not wherever
      // the viewport happened to be when the panel was opened.
      if (mode === "page" && computed.position === "fixed") box.y = 0;
      if (!intersects(box, clipRect)) return;
      // Clipping is inherited even when the clipping element itself is not kept
      // as a layer, so content scrolled out of a panel cannot leak onto the board.
      const childClip = clips(computed) ? intersect(box, clipRect) : clipRect;

      let special = specialOf(element, computed, box);
      let index = parentIndex;
      if (special && budget.boxes <= 0) { stats.truncated = true; special = null; }
      if (special) {
        budget.boxes--;
        if (special.kind === "media") stats.placeholders++;
        nodes.push({
          kind: special.kind, parent: parentIndex,
          x: box.x, y: box.y, w: box.w, h: box.h,
          name: special.name, label: special.label || "",
          icon: special.icon === true, avatar: special.avatar === true,
          radius: special.radius || 0,
          background: computed.backgroundColor,
          borderWidth: borderWidthOf(computed),
          borderColor: computed.borderTopColor,
          shadow: computed.boxShadow,
          clip: clips(computed)
        });
        index = nodes.length - 1;
        if (special.kind === "media" || /^(INPUT|SELECT|TEXTAREA)$/.test(element.tagName)) {
          // Form labels and button text still need a text run for medium/high.
          if (special.kind === "field" && special.placeholder) {
            nodes.push({
              kind: "text", parent: index,
              x: box.x + Math.min(12, box.w * 0.06), y: box.y + Math.max(2, (box.h - (parsePx(computed.lineHeight) || 16)) / 2),
              w: Math.max(8, box.w - Math.min(24, box.w * 0.12)), h: Math.max(10, parsePx(computed.lineHeight) || 16),
              text: special.placeholder.slice(0, 400), name: `Placeholder · ${clean(special.placeholder, 24)}`,
              color: computed.color, font: fontOf(computed)
            });
          }
          if (element.tagName === "INPUT" && /^(submit|button|reset)$/i.test(element.type) && element.value) {
            nodes.push({
              kind: "text", parent: index,
              x: box.x + 4, y: box.y + Math.max(2, (box.h - (parsePx(computed.lineHeight) || 16)) / 2),
              w: Math.max(8, box.w - 8), h: Math.max(10, parsePx(computed.lineHeight) || 16),
              text: element.value.slice(0, 200), name: `Label · ${clean(element.value, 24)}`,
              color: computed.color, font: fontOf(computed)
            });
          }
          return;
        }
        walkChildren(element, index, box, depth, computed, childClip);
        return;
      }

      const semantic = SEMANTIC_TAGS.has(element.tagName) || SEMANTIC_ROLES.has(element.getAttribute("role") || "");
      const painted = isPainted(computed);
      const sameAsParent = !!parentBox &&
        Math.abs(box.x - parentBox.x) < 1.5 && Math.abs(box.y - parentBox.y) < 1.5 &&
        Math.abs(box.w - parentBox.w) < 1.5 && Math.abs(box.h - parentBox.h) < 1.5;
      const structural = !sameAsParent && (element.childElementCount > 0 || !!element.shadowRoot) &&
        depth <= 14 && box.w * box.h >= 400;
      if ((painted || semantic || structural) && (painted || semantic || !sameAsParent) && budget.boxes > 0) {
        budget.boxes--;
        nodes.push({
          kind: "box", parent: parentIndex,
          x: box.x, y: box.y, w: box.w, h: box.h,
          name: boxName(element),
          painted, image: hasUrlBackground(computed), gradient: hasGradient(computed),
          background: computed.backgroundColor,
          borderWidth: borderWidthOf(computed),
          borderColor: computed.borderTopColor,
          radius: radiusOf(box, computed),
          shadow: computed.boxShadow,
          clip: clips(computed)
        });
        index = nodes.length - 1;
      } else if (budget.boxes <= 0) stats.truncated = true;

      walkChildren(element, index, box, depth, computed, childClip);
    }

    function walkChildren(element, parentIndex, parentBox, depth, computed, clipRect) {
      for (const child of element.childNodes) {
        if (child.nodeType === 3) measureText(child, element, computed, parentIndex, clipRect);
        else if (child.nodeType === 1) visit(child, parentIndex, parentBox, depth + 1, clipRect);
      }
      if (element.shadowRoot) {
        for (const child of element.shadowRoot.children) visit(child, parentIndex, parentBox, depth + 1, clipRect);
      }
    }

    const bodyStyle = getComputedStyle(body);
    const start = performance.now();
    for (const child of body.childNodes) {
      if (child.nodeType === 3) measureText(child, body, bodyStyle, -1, areaRect);
      else if (child.nodeType === 1) visit(child, -1, areaRect, 0, areaRect);
    }
    return {
      version: 1,
      title: doc.title || "",
      url: location.href,
      background: bodyStyle.backgroundColor,
      area,
      viewport,
      mode,
      scroll: { x: scrollX, y: scrollY },
      duration: performance.now() - start,
      stats,
      nodes
    };
  }

  /* --------------------------------------------------------------- render */

  function applyBlockStyle(node, block) {
    style(node, {
      position: "absolute",
      left: px(block.x), top: px(block.y),
      width: px(block.w), height: px(block.h),
      margin: "0", padding: "0", boxSizing: "border-box",
      backgroundColor: block.fill || "transparent",
      borderRadius: block.radius ? px(block.radius) : null,
      boxShadow: block.shadow || null,
      overflow: block.clip || block.bars || block.label ? "hidden" : "visible",
      display: "block"
    });
    if (block.stroke) node.style.border = `${block.stroke.width}px solid ${block.stroke.color}`;
  }

  function renderText(node, block) {
    const text = block.text;
    style(node, {
      fontFamily: text.family,
      fontSize: px(text.size),
      fontWeight: String(text.weight),
      lineHeight: px(text.lineHeight),
      letterSpacing: text.spacing ? px(text.spacing) : "normal",
      textAlign: text.align === "start" ? "left" : text.align === "end" ? "right" : text.align,
      textTransform: text.transform,
      fontStyle: text.style,
      textDecoration: text.decoration === "none" ? "none" : text.decoration,
      color: text.color,
      whiteSpace: "pre-wrap",
      overflowWrap: "break-word",
      overflow: "visible"
    });
    node.append(document.createTextNode(text.value));
  }

  function renderBars(node, block) {
    for (const bar of block.bars) {
      const barNode = el("div");
      style(barNode, {
        position: "absolute", left: px(bar.x), top: px(bar.y),
        width: px(bar.w), height: px(bar.h),
        backgroundColor: bar.color, borderRadius: px(2)
      });
      node.append(barNode);
    }
  }

  function renderMarks(node) {
    for (const vertical of [false, true]) {
      const mark = el("div");
      style(mark, {
        position: "absolute", backgroundColor: "#c8c8c8",
        left: vertical ? "50%" : px(12), right: vertical ? null : px(12),
        top: vertical ? px(12) : "50%", bottom: vertical ? px(12) : null,
        width: vertical ? px(1) : null, height: vertical ? null : px(1)
      });
      node.append(mark);
    }
  }

  function renderLabel(node, block) {
    const label = el("div", block.label);
    style(label, {
      position: "absolute", left: px(12), right: px(12), top: "50%", marginTop: px(-9),
      height: px(18), lineHeight: px(18), fontFamily: Core.NEUTRAL_FONT, fontSize: px(11), fontWeight: "500",
      color: "#8c8c8c", textAlign: "center", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"
    });
    node.append(label);
  }

  const slug = (name, used) => {
    const base = String(name || "layer").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 42) || "layer";
    if (!used.has(base)) { used.set(base, 1); return base; }
    const next = (used.get(base) || 1) + 1;
    used.set(base, next);
    return `${base}-${next}`;
  };

  function renderPlan(plan, ownerDocument = document) {
    const used = new Map();
    const root = ownerDocument.createElement("div");
    root.id = slug("wireframe", used);
    root.setAttribute("data-wireframe-root", "");
    style(root, {
      position: "absolute", left: "0px", top: "0px",
      width: px(plan.width), height: px(plan.height),
      margin: "0", padding: "0", border: "0", boxSizing: "border-box",
      backgroundColor: plan.root.fill || "#ffffff",
      overflow: "hidden", display: "block", colorScheme: "light"
    });

    const nodes = [root];
    for (const block of plan.root.children) root.append(renderBlock(block, ownerDocument, used, nodes));
    return root;
  }

  function renderBlock(block, ownerDocument, used, nodes) {
    const node = ownerDocument.createElement("div");
    node.id = slug(block.name, used);
    node.setAttribute("data-wireframe-layer", "");
    node.className = "wireframe-layer";
    applyBlockStyle(node, block);
    if (block.text) renderText(node, block);
    if (block.bars) renderBars(node, block);
    if (block.marks) renderMarks(node);
    if (block.label) renderLabel(node, block);
    nodes.push(node);
    for (const child of block.children) node.append(renderBlock(child, ownerDocument, used, nodes));
    return node;
  }

  /* ---------------------------------------------------------- board + copy */

  function createBoard(plan, mount, options = {}) {
    const frame = document.createElement("iframe");
    frame.setAttribute("data-wireframe-frame", "");
    frame.setAttribute("data-h2d-ignore", "true");
    frame.setAttribute("sandbox", "allow-same-origin");
    frame.setAttribute("referrerpolicy", "no-referrer");
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    frame.title = "Wireframe rendering";
    style(frame, {
      all: "initial", display: "block", border: "0", margin: "0", padding: "0",
      boxSizing: "content-box", position: options.hidden === false ? "absolute" : "fixed",
      left: options.hidden === false ? "0px" : "-20000px", top: "0px",
      width: px(plan.width), height: px(plan.height),
      opacity: options.hidden === false ? "1" : "0",
      pointerEvents: "none", visibility: "visible", backgroundColor: "transparent",
      transformOrigin: "top left"
    });
    mount.append(frame);
    const isolated = frame.contentDocument;
    if (!isolated?.body) throw new Error("Could not create an isolated wireframe.");
    const policy = document.createElement("meta");
    policy.httpEquiv = "Content-Security-Policy";
    policy.content = "default-src 'none'; style-src 'none'; font-src 'none'; img-src 'none'; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";
    isolated.head.append(policy);
    Object.assign(isolated.documentElement.style, { margin: "0", padding: "0", overflow: "hidden", colorScheme: "light" });
    Object.assign(isolated.body.style, { margin: "0", padding: "0", backgroundColor: "transparent", overflow: "hidden" });
    const board = renderPlan(plan, document);
    isolated.body.append(board);
    return { frame, board };
  }

  const wait = signal => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); resolve(); }, 40);
    const abort = () => { cleanup(); reject(signal.reason || new DOMException("Cancelled", "AbortError")); };
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); };
    if (signal.aborted) return abort();
    signal.addEventListener("abort", abort, { once: true });
  });

  async function copyPlan(plan, helpers, { mount, signal, onPhase } = {}) {
    const Board = globalThis.PageCaptureDesignBoard;
    if (!Board?.makeClipboardHtml) throw new Error("Reload the extension and refresh this page before copying.");
    if (!mount?.isConnected) throw new Error("The wireframe panel is no longer open.");
    if (typeof navigator.clipboard?.write !== "function" || typeof ClipboardItem !== "function") {
      throw new Error("The rich clipboard is unavailable on this page.");
    }
    signal?.throwIfAborted();
    const operation = new AbortController();
    const active = signal ? AbortSignal.any([signal, operation.signal]) : operation.signal;
    const timer = setTimeout(() => operation.abort(new DOMException("Wireframe preparation timed out", "TimeoutError")), 12000);
    let frame, board;
    const cleanup = () => { frame?.remove(); frame = null; board = null; };
    active.addEventListener("abort", cleanup, { once: true });
    try {
      ({ frame, board } = createBoard(plan, mount, { hidden: true }));
      active.throwIfAborted();
      // One layout pass so the isolated document has been sized before measuring.
      await wait(active);
      active.throwIfAborted();
      const result = await helpers.capture(board, {
        timeoutSignal: active, extractCssVariables: false, captureSourceProps: false,
        skipRemoteAssetSerialization: true, skipScrollbarHiding: true, assertLayoutValid: false
      });
      active.throwIfAborted();
      if (!result?.document || result.document.assets?.size !== 0) throw new Error("The wireframe contains unexpected assets.");
      const captured = result.document.root?.rect;
      if (!captured || Math.abs(captured.width - plan.width) > 2 || captured.height <= 0) throw new Error("The wireframe could not be laid out.");
      result.document.documentTitle = `${plan.title || "Page"} — Wireframe (${plan.level})`;
      const serialized = await helpers.serialize(result.document, active);
      active.throwIfAborted();
      const html = await Board.makeClipboardHtml(serialized, helpers.encode, active);
      active.throwIfAborted();
      const blob = new Blob([html], { type: "text/html" });
      if (blob.size > MAX_CLIPBOARD_BYTES) throw new Error("This wireframe is too large to copy. Try Low, or capture the visible area.");
      cleanup();
      if (!mount.isConnected) throw new DOMException("Panel closed", "AbortError");
      onPhase?.("writing");
      active.throwIfAborted();
      clearTimeout(timer);
      await navigator.clipboard.write([new ClipboardItem({ "text/html": blob })]);
      return { summary: Core.summarize(plan) };
    } catch (error) {
      active.throwIfAborted();
      throw error;
    } finally {
      clearTimeout(timer);
      active.removeEventListener("abort", cleanup);
      cleanup();
      operation.abort();
    }
  }

  /* ----------------------------------------------------------------- panel */

  function create(controller, helpers) {
    let host, root, dialog, stage, statusHost, statsHost, stageWrap;
    let scan = null, plan = null, level = "medium", area = "page";
    let scanToken = 0, scanning = false, job = null, status = "", statusError = false, disposed = false, resizeTimer = 0;

    const signal = controller.lifecycleAbort.signal;
    const config = controller.config;
    const previousOnEvent = config?.onEvent;
    const featureOnEvent = event => {
      if (event.type === "action-run") close(false);
      previousOnEvent?.(event);
    };

    function ensureHost() {
      if (host?.isConnected) return;
      host = document.createElement("page-capture-wireframe");
      host.id = HOST_ID;
      host.setAttribute("data-h2d-ignore", "true");
      root = host.attachShadow({ mode: "closed" });
      const sheet = document.createElement("style");
      sheet.textContent = CSS;
      root.append(sheet);
      try { host.style.setProperty("--ui-font", getComputedStyle(controller.toolbarEl).fontFamily, "important"); } catch {}
      (document.body || document.documentElement).append(host);
    }

    function button(label, action, variant = "", icon) {
      const node = el("button", null, variant);
      node.type = "button";
      if (icon) node.append(svg(icons[icon]));
      if (label) node.append(el("span", label));
      node.addEventListener("click", event => { event.preventDefault(); action(); });
      return node;
    }

    function close(restoreFocus = true) {
      cancelCopy();
      if (dialog) { dialog.close?.(); dialog.remove(); }
      dialog = null; stage = null; stageWrap = null; statusHost = null; statsHost = null;
      host?.remove(); host = null; root = null;
      if (restoreFocus) controller.focus?.();
    }

    function cancelCopy(announce = false) {
      const current = job;
      if (!current) return;
      current.abort.abort();
      job = null;
      if (announce && dialog?.open) { status = "Wireframe copy cancelled."; statusError = false; render(); }
    }

    function friendly(error) {
      if (error?.name === "TimeoutError") return "Preparing the wireframe timed out. Keep this tab visible and try again.";
      if (error?.name === "AbortError") return "";
      return error?.message || "Could not read this page as a wireframe. Try again after it settles.";
    }

    function updateStats() {
      if (!statsHost) return;
      if (!plan) { statsHost.textContent = ""; return; }
      const summary = Core.summarize(plan);
      const parts = [`${summary.blocks} blocks`, `${summary.textLayers} text layers`];
      if (summary.placeholders) parts.push(`${summary.placeholders} placeholders`);
      if (summary.bars) parts.push(`${summary.bars} text bars`);
      parts.push(`${Math.round(plan.width)}×${Math.round(plan.height)}`);
      if (summary.truncated) parts.push("cut at the size limit");
      statsHost.textContent = parts.join(" · ");
    }

    function updateStatus() {
      if (!statusHost) return;
      statusHost.textContent = status;
      statusHost.classList.toggle("error", !!statusError);
    }

    function setLevel(next) {
      if (level === next || !Core.LEVELS.some(entry => entry.id === next)) return;
      level = next;
      if (scan) {
        try { plan = Core.buildPlan(scan, { level, area }); status = ""; statusError = false; }
        catch (error) { plan = null; status = friendly(error); statusError = true; }
      }
      render();
      focusControl(`level-${level}`);
    }

    async function setArea(next) {
      if (area === next) return;
      area = next;
      render();
      await refresh();
    }

    async function refresh() {
      const token = ++scanToken;
      scanning = true;
      plan = null; scan = null;
      status = "Reading the page…"; statusError = false;
      render();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      if (token !== scanToken || disposed) return;
      try {
        const result = scanPage({ area });
        if (!result.nodes.length) throw new Error("This page has no visible layout to rebuild.");
        scan = result;
        plan = Core.buildPlan(scan, { level, area });
        status = scan.stats.truncated ? "The page is very large; the wireframe stops at the size limit." : "";
        statusError = false;
      } catch (error) {
        scan = null; plan = null;
        status = friendly(error); statusError = true;
      }
      if (token !== scanToken || disposed) return;
      scanning = false;
      render();
    }

    function paintPreview() {
      if (!stage) return;
      stage.replaceChildren();
      if (!plan) {
        if (!statusError) {
          const loading = el("div", null, "loading");
          loading.append(el("div", null, "spinner"), el("p", "Building the preview…"));
          stage.append(loading);
        }
        return;
      }
      const available = Math.max(80, stage.clientWidth - 32);
      const scale = Math.min(1, available / plan.width);
      const board = el("div", null, "board");
      style(board, {
        width: px(Math.max(1, plan.width * scale)),
        height: px(Math.max(1, plan.height * scale))
      });
      // The preview is a real, unscaled render scaled by CSS: measuring inside it
      // is never affected by the zoom.
      const { frame } = createBoard(plan, board, { hidden: false });
      style(frame, { transform: `scale(${scale})`, transformOrigin: "top left", left: "0px", top: "0px" });
      stage.append(board);
      stage.scrollTop = 0;
    }

    function focusControl(key) {
      if (!root) return;
      root.querySelector(`[data-focus="${key}"]`)?.focus({ preventScroll: true });
    }

    function render() {
      if (!dialog) return;
      const focused = root?.activeElement?.getAttribute?.("data-focus") || "";
      dialog.replaceChildren();
      const shell = el("div", null, "shell");

      const header = el("header", null, "header");
      header.append(svg(icons.wireframe), el("h1", "Wireframe"), el("span", "LOCAL", "local"));
      header.append(el("div", null, "spacer"));
      const closeButton = button("", () => close(), "icon", "close");
      closeButton.setAttribute("aria-label", "Close wireframe panel");
      header.append(closeButton);
      shell.append(header);

      const intro = el("div", null, "intro");
      intro.append(el("p", "Rebuild this page as editable greyscale layers: measured boxes, text and placeholders. No screenshots, images or page styles are copied."));
      const levels = el("div", null, "levels");
      for (const entry of Core.LEVELS) {
        const card = button("", () => setLevel(entry.id));
        card.className = "level";
        card.setAttribute("aria-pressed", String(level === entry.id));
        card.setAttribute("aria-label", `${entry.label}, ${entry.title}. ${entry.description}`);
        card.setAttribute("data-focus", `level-${entry.id}`);
        card.title = `${entry.label} · ${entry.title} — ${entry.description}`;
        card.append(el("strong", `${entry.label} · ${entry.title}`), el("span", entry.description));
        levels.append(card);
      }
      intro.append(levels);

      const row = el("div", null, "row");
      const group = el("div", null, "group");
      const seg = el("div", null, "seg");
      for (const [id, label] of [["page", "Full page"], ["viewport", "Visible area"]]) {
        const option = button(label, () => setArea(id));
        option.setAttribute("aria-pressed", String(area === id));
        option.setAttribute("data-focus", `area-${id}`);
        seg.append(option);
      }
      const rescan = button("Rescan", () => refresh(), "secondary", "refresh");
      rescan.setAttribute("data-focus", "rescan");
      group.append(seg, rescan);
      row.append(group);
      intro.append(row);
      shell.append(intro);

      stageWrap = el("div", null, "stage-wrap");
      stage = el("div", null, "stage");
      stage.setAttribute("role", "img");
      stage.setAttribute("aria-label", plan ? `Wireframe preview of ${plan.title || "this page"}` : "Wireframe preview");
      stageWrap.append(stage);
      shell.append(stageWrap);

      const footer = el("footer", null, "footer");
      const actions = el("div", null, "actions");
      statsHost = el("span", null, "stats");
      actions.append(statsHost);
      const copy = button(job ? "Copying…" : "Copy wireframe", () => copyPlanToClipboard(), "primary", "copy");
      copy.setAttribute("data-focus", "copy");
      copy.disabled = !plan || !!job || !!scanning;
      copy.title = "Copy as editable Figma layers, then paste onto a Figma Design canvas.";
      actions.append(copy);
      if (job) {
        const cancel = button("Cancel", () => cancelCopy(true), "secondary");
        cancel.setAttribute("data-focus", "cancel");
        cancel.disabled = job.phase === "writing";
        cancel.title = "Cancel preparation; a clipboard write already started cannot be undone.";
        actions.append(cancel);
      }
      statusHost = el("div", null, "status");
      statusHost.setAttribute("role", "status");
      statusHost.setAttribute("aria-live", "polite");
      footer.append(actions, statusHost,
        el("p", "Rebuilding happens in this tab. Placeholder marks are real vectors, images are never loaded, and nothing is uploaded.", "footnote"));
      shell.append(footer);

      dialog.append(shell);
      dialog.setAttribute("aria-busy", String(!!job || !!scanning));
      updateStats();
      updateStatus();
      paintPreview();
      // Re-rendering replaces the controls, so put the keyboard back where it
      // was (or on Cancel while a copy is in flight).
      if (job) focusControl("cancel");
      else if (focused) focusControl(focused);
    }

    function open() {
      if (dialog?.open) { focusControl("copy"); return; }
      ensureHost();
      dialog = document.createElement("dialog");
      dialog.setAttribute("aria-label", "Wireframe generator");
      dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
      root.append(dialog);
      status = ""; statusError = false;
      render();
      dialog.showModal();
      if (scan) render();
      else refresh();
    }

    async function copyPlanToClipboard() {
      if (job || !plan || scanning) return;
      const current = { abort: new AbortController(), phase: "preparing" };
      job = current;
      status = "Preparing editable wireframe…"; statusError = false;
      render();
      try {
        const result = await copyPlan(plan, helpers, {
          mount: root,
          signal: AbortSignal.any([current.abort.signal, signal]),
          onPhase: phase => {
            if (job !== current) return;
            current.phase = phase;
            status = phase === "writing" ? "Writing the wireframe to the clipboard…" : "Preparing editable wireframe…";
            updateStatus();
          }
        });
        if (job !== current) return;
        status = `${result.summary.blocks} blocks copied as editable layers. Switch to Figma Design and paste onto the canvas.`;
        statusError = false;
        controller.showTransientMessage?.("Wireframe copied to clipboard");
      } catch (error) {
        if (job !== current) return;
        if (error?.name === "AbortError") { status = ""; statusError = false; return; }
        status = error?.message || "Could not copy the wireframe. Keep this tab visible and try again.";
        statusError = true;
      } finally {
        if (job === current) {
          job = null;
          if (!disposed && dialog?.open) { render(); focusControl("copy"); }
        }
      }
    }

    function dispose() {
      disposed = true;
      scanToken++;
      scanning = false;
      clearTimeout(resizeTimer);
      cancelCopy();
      close(false);
      if (config?.onEvent === featureOnEvent) config.onEvent = previousOnEvent;
      if (root) root = null;
    }

    try {
      if (config) config.onEvent = featureOnEvent;
      signal.addEventListener("abort", dispose, { once: true });
      window.addEventListener("resize", () => {
        if (!dialog?.open || !plan) return;
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => { if (dialog?.open) paintPreview(); }, 120);
      }, { signal });
      window.addEventListener("keydown", event => {
        if (!dialog?.open) return;
        if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); close(); }
        else if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
          event.preventDefault(); event.stopImmediatePropagation();
          if (!job && plan) copyPlanToClipboard();
        }
      }, { capture: true, signal });
    } catch { dispose(); }
    return { open, dispose };
  }

  const instances = new WeakMap();
  let active = null;

  function attach(controller, helpers) {
    if (!controller || instances.has(controller)) return;
    if (!["capture", "serialize", "encode"].every(name => typeof helpers?.[name] === "function")) return;
    const instance = create(controller, helpers);
    instances.set(controller, instance);
    active = instance;
  }

  globalThis.PageCaptureWireframe = Object.freeze({
    attach,
    openPanel: () => active?.open(),
    scanPage,
    renderPlan,
    copyPlan,
    limits: SCAN
  });
})();
