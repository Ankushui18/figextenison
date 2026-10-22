/* Sanitized capture-model -> standalone inline HTML projection. No Chrome APIs. */
(() => {
  "use strict";
  if (globalThis.PageCaptureHtmlExport) return;

  const BLOCKED = new Set([
    "script", "style", "link", "meta", "base", "noscript", "template",
    "iframe", "frame", "frameset", "object", "embed", "applet", "head"
  ]);
  const TRANSPARENT = new Set(["html", "body", "slot", "picture"]);
  const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
  const STANDARD = new Set([
    "a", "abbr", "address", "article", "aside", "b", "bdi", "bdo", "blockquote",
    "br", "button", "caption", "cite", "code", "col", "colgroup", "data", "dd",
    "del", "details", "dfn", "div", "dl", "dt", "em", "figcaption", "figure",
    "footer", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hgroup", "hr",
    "i", "img", "input", "ins", "kbd", "label", "legend", "li", "main", "mark",
    "menu", "nav", "ol", "optgroup", "option", "output", "p", "pre", "q", "rp",
    "rt", "ruby", "s", "samp", "section", "select", "small", "span", "strong",
    "sub", "summary", "sup", "table", "tbody", "td", "textarea", "tfoot", "th",
    "thead", "time", "tr", "u", "ul", "var", "wbr"
  ]);
  const BOOLEAN_ATTRIBUTES = new Set(["checked", "disabled", "multiple", "open", "readonly", "required", "reversed", "selected"]);
  const URL_ATTRIBUTES = new Set(["href"]);
  const MOTION_PROPERTIES = /^(?:animation|transition)(?:-|$)/i;
  const DANGEROUS_CSS = /(?:expression\s*\(|(?:javascript|vbscript)\s*:|@import|-moz-binding)/i;
  const MAX_NODES = 100000;
  const MAX_OUTPUT_CHARS = 24 * 1024 * 1024;

  function abortError(signal) {
    if (signal?.reason) return signal.reason;
    const error = new Error("Capture cancelled"); error.name = "AbortError"; return error;
  }
  function check(signal) { if (signal?.aborted) throw abortError(signal); }
  function yieldTask(signal) {
    check(signal);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(done, 0);
      const abort = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); reject(abortError(signal)); };
      function done() { signal?.removeEventListener("abort", abort); resolve(); }
      signal?.addEventListener("abort", abort, { once: true });
    });
  }
  function escapeText(value) {
    return String(value ?? "").replace(/[&<>]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[character]);
  }
  function escapeAttribute(value) {
    return escapeText(value).replace(/["']/g, character => ({ '"': "&quot;", "'": "&#39;" })[character]);
  }
  function cssName(value) {
    return String(value).replace(/[A-Z]/g, character => `-${character.toLowerCase()}`);
  }
  function safeDataUrl(value, type = "") {
    if (typeof value !== "string") return "";
    let data = value.trim();
    const match = /^data:([^,;]+)?(;base64)?,/i.exec(data);
    if (!match) return "";
    const normalizedType = String(type || "").toLowerCase();
    // Capture assets historically store bytes as application/octet-stream even
    // when their authoritative asset type is image/*. Restore that image MIME.
    if (normalizedType.startsWith("image/") && match[2] && !String(match[1] || "").toLowerCase().startsWith("image/")) {
      data = `data:${normalizedType};base64,${data.slice(match[0].length)}`;
    }
    return /^data:image\/[a-z0-9.+-]+(?:;base64)?,/i.test(data) ? data : "";
  }
  function embeddedAsset(assets, key) {
    if (!key || !assets || !Object.prototype.hasOwnProperty.call(assets, key)) return "";
    const asset = assets[key];
    return safeDataUrl(asset?.blob?.base64Blob || asset?.base64Blob || asset?.dataUrl,
      asset?.blob?.type || asset?.type || "");
  }
  function safeUrl(value, assets, image = false) {
    if (typeof value !== "string") return "";
    const url = value.trim();
    const embedded = embeddedAsset(assets, url);
    if (embedded) return embedded;
    if (image) return safeDataUrl(url) || (/^https?:\/\//i.test(url) ? url : "");
    return /^(?:https?:\/\/|mailto:|tel:|#)/i.test(url) && !/^(?:javascript|vbscript|data):/i.test(url) ? url : "";
  }
  function safeCssUrl(value, assets) {
    const unquoted = value.trim().replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, (_, double, single) => double ?? single ?? "");
    return safeUrl(unquoted.replace(/\\([\\"')])/g, "$1"), assets, true);
  }
  function styleText(styles, assets) {
    if (!styles || typeof styles !== "object" || Array.isArray(styles)) return "";
    const declarations = [];
    for (const [name, raw] of Object.entries(styles)) {
      if (!/^[a-zA-Z][a-zA-Z0-9-]*$/.test(name) || name.startsWith("--")) continue;
      const property = cssName(name);
      if (MOTION_PROPERTIES.test(property) || property === "content") continue;
      if (raw === null || raw === undefined || typeof raw === "object") continue;
      let value = String(raw).trim();
      if (!value || DANGEROUS_CSS.test(value)) continue;
      if (/url\s*\(/i.test(value)) {
        let valid = true;
        value = value.replace(/url\(\s*(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^)'"\s]+)\s*\)/gi, match => {
          const inner = match.slice(match.indexOf("(") + 1, match.lastIndexOf(")"));
          const url = safeCssUrl(inner, assets);
          if (!url) { valid = false; return "none"; }
          return `url("${url.replace(/["\\]/g, "\\$&")}")`;
        });
        if (!valid) continue;
      }
      declarations.push(`${property}:${value}`);
    }
    return declarations.join(";");
  }
  function plainText(value) {
    return value.replace(/[\t\f\r ]*\n[\t\f\r ]*/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  async function project(model, options = {}) {
    if (!model || typeof model !== "object" || model.version !== 2 || model.root?.nodeType !== 1) {
      throw new Error("A version 2 capture model is required for HTML export");
    }
    if (model.assets !== undefined && (!model.assets || typeof model.assets !== "object" || Array.isArray(model.assets))) {
      throw new Error("Capture assets are invalid");
    }
    const signal = options.signal, assets = model.assets || {}, text = [];
    const wrapper = options.wrapper == null || options.wrapper === false ? "" : String(options.wrapper).toLowerCase();
    if (wrapper && (!/^[a-z][a-z0-9-]*$/.test(wrapper) || BLOCKED.has(wrapper))) throw new Error("Invalid HTML export wrapper");
    let nodes = 0, embeddedAssets = 0;

    function bounded(html) {
      // Check the actual fragment size, not the sum of every ancestor's
      // subtree (which would reject deeply nested but otherwise small output).
      if (html.length > MAX_OUTPUT_CHARS) throw new Error("HTML export is too large to copy");
      return html;
    }
    function attributesFor(node, tag) {
      const source = node.attributes && typeof node.attributes === "object" ? node.attributes : {};
      const attributes = [];
      for (const [rawName, rawValue] of Object.entries(source)) {
        const name = rawName.toLowerCase();
        if (name.startsWith("on") || name === "style" || name === "srcdoc" || name === "currentsrc" || name === "poster") continue;
        if (rawValue === null || rawValue === undefined || typeof rawValue === "object") continue;
        let value = String(rawValue);
        if (name === "value" && tag !== "input") continue;
        if (tag === "input" && ["password", "hidden", "file", "image", "checkbox", "radio"].includes(String(source.type || "text").toLowerCase()) && name === "value") continue;
        if (BOOLEAN_ATTRIBUTES.has(name)) {
          if (value === "true" || value === "" || value === name) attributes.push(`${name}=""`);
          continue;
        }
        if (URL_ATTRIBUTES.has(name)) {
          value = safeUrl(value, assets);
          if (!value) continue;
        } else if (name !== "id" && name !== "alt" && name !== "title" && name !== "type" &&
          name !== "placeholder" && name !== "role" && name !== "for" && name !== "label" &&
          name !== "target" && name !== "rel" && name !== "colspan" && name !== "rowspan" &&
          name !== "start" && name !== "value" && !/^aria-[a-z0-9_-]+$/.test(name)) continue;
        if (name === "rel" && tag === "a" && String(source.target || "").toLowerCase() === "_blank") continue;
        attributes.push(`${name}="${escapeAttribute(value)}"`);
      }
      if (tag === "input") {
        const type = String(source.type || "text").toLowerCase();
        if (!["checkbox", "radio"].includes(type) && !source.readonly) attributes.push('readonly=""');
      }
      if (tag === "button" && !source.type) attributes.push('type="button"');
      if (tag === "a" && String(source.target || "").toLowerCase() === "_blank") attributes.push('rel="noopener noreferrer"');
      const style = styleText(node.styles, assets);
      if (style) attributes.push(`style="${escapeAttribute(style)}"`);
      return attributes.length ? ` ${attributes.join(" ")}` : "";
    }
    function media(node, tag) {
      const source = node.attributes && typeof node.attributes === "object" ? node.attributes : {};
      const candidates = [node.placeholderUrl, source.currentSrc, source.src, source.poster];
      let src = "";
      for (const candidate of candidates) {
        src = safeUrl(candidate, assets, true);
        if (src) {
          if (embeddedAsset(assets, candidate)) embeddedAssets++;
          break;
        }
      }
      if (!src) return "";
      const clone = { ...node, tag: "IMG", attributes: { alt: source.alt || "", title: source.title, id: source.id } };
      const attrs = attributesFor(clone, "img");
      return bounded(`<img${attrs} src="${escapeAttribute(src)}">`);
    }

    async function render(node, depth = 0) {
      check(signal);
      if (!node || typeof node !== "object") return "";
      if (depth > 512) throw new Error("HTML export is too deeply nested");
      if (++nodes > MAX_NODES) throw new Error("HTML export contains too many nodes");
      if (nodes % 200 === 0) await yieldTask(signal);
      if (node.nodeType === 3) {
        const value = String(node.text ?? "");
        text.push(value);
        return bounded(escapeText(value));
      }
      if (node.nodeType !== 1) return "";
      let tag = String(node.tag || "").toLowerCase();
      if (!/^[a-z][a-z0-9-]*$/.test(tag) || BLOCKED.has(tag) || tag.startsWith("x-paper-")) return "";
      if (["canvas", "video", "img"].includes(tag)) return media(node, tag);
      // node.content for SVG is serialized source markup, not a sanitized node
      // tree. Do not inject it into an HTML clipboard payload.
      if (tag === "svg" || (node.content && !STANDARD.has(tag))) return "";
      if (tag === "form") tag = "div";
      if (tag === "html" || tag === "body") tag = "div";
      const transparent = TRANSPARENT.has(String(node.tag || "").toLowerCase()) && !["html", "body"].includes(String(node.tag || "").toLowerCase());
      if (!STANDARD.has(tag) && !transparent) tag = "";

      const source = node.attributes && typeof node.attributes === "object" ? node.attributes : {};
      if (tag === "input" && ["hidden", "file"].includes(String(source.type || "text").toLowerCase())) return "";
      let content = "";
      if (tag === "textarea") {
        const value = String(source.value ?? ""); text.push(value);
        content = bounded(escapeText(value));
      } else {
        if (node.pseudoElementNodes?.before) content += await render(node.pseudoElementNodes.before, depth + 1);
        for (const child of Array.isArray(node.childNodes) ? node.childNodes : []) {
          const rendered = await render(child, depth + 1);
          content += rendered;
          if (child?.nodeType === 1 && /^(?:br|p|div|section|article|li|tr|h[1-6])$/i.test(String(child.tag || ""))) text.push("\n");
        }
        if (node.pseudoElementNodes?.after) content += await render(node.pseudoElementNodes.after, depth + 1);
      }
      if (!tag) return content;
      const attrs = attributesFor(node, tag);
      if (VOID.has(tag)) return bounded(`<${tag}${attrs}>`);
      if (/^(?:p|div|section|article|li|tr|h[1-6])$/.test(tag)) text.push("\n");
      return bounded(`<${tag}${attrs}>${content}</${tag}>`);
    }

    const body = await render(model.root);
    const html = bounded(wrapper ? `<${wrapper}>${body}</${wrapper}>` : body);
    check(signal);
    return { html, text: plainText(text.join("")), stats: { nodes, embeddedAssets } };
  }

  globalThis.PageCaptureHtmlExport = Object.freeze({ project });
})();
