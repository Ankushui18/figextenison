/* Wireframe planning: rewrite a captured page as editable greyscale layers.
 * Pure functions only — no DOM, no network, no storage — so the transform can be
 * reasoned about (and tested) without a browser. */
(() => {
  "use strict";
  if (globalThis.PageCaptureWireframeCore) return;

  // Bounded so a pathological capture cannot freeze the copy, but generous
  // enough for a full-page capture of a heavy product page.
  const LIMITS = Object.freeze({ nodes: 20000, depth: 60, lines: 40, nameLength: 48 });
  const STORAGE_KEY = "pc_wireframe_v1";

  // The three levels the user picks between, in the Viewports popover next to the
  // width presets. `title`/`description` explain what the level does.
  const LEVELS = Object.freeze([
    Object.freeze({ id: "low", label: "Low", title: "Skeleton", description: "Outlined boxes and text bars. Structure only." }),
    Object.freeze({ id: "medium", label: "Medium", title: "Structure", description: "Real text, neutral type, labelled placeholders." }),
    Object.freeze({ id: "high", label: "High", title: "Detail", description: "Type hierarchy, radii and greyscale tones." })
  ]);
  const LEVEL_IDS = new Set(LEVELS.map(level => level.id));

  const NEUTRAL_FONT = 'Inter, "Helvetica Neue", Helvetica, Arial, sans-serif';
  const PAPER = "#ffffff";

  // One fixed grey ramp per level keeps a wireframe coherent: page colours become
  // one of these tones instead of being invented.
  const FILL_RAMP = Object.freeze({
    low: [[0.35, "#e7e7e7"], [1.01, "#f4f4f4"]],
    medium: [[0.22, "#d9d9d9"], [0.55, "#e8e8e8"], [0.88, "#f4f4f4"], [1.01, "#fafafa"]],
    high: [[0.14, "#c9c9c9"], [0.3, "#d8d8d8"], [0.5, "#e4e4e4"], [0.7, "#efefef"], [0.9, "#f7f7f7"], [1.01, "#fbfbfb"]]
  });

  // Property names in the capture model are camelCase CSS properties.
  const DROPPED_STYLES = Object.freeze([
    "backgroundImage", "maskImage", "maskPosition", "maskSize", "maskRepeat", "maskMode", "maskOrigin",
    "filter", "backdropFilter", "transform", "translate", "rotate", "scale", "willChange", "mixBlendMode",
    "isolation", "clipPath", "listStyleImage", "content", "backgroundAttachment", "backgroundClip",
    "backgroundOrigin", "webkitTextFillColor", "transitionProperty", "borderImageSource", "outlineStyle",
    "outlineWidth", "outlineColor", "outlineOffset", "textShadow"
  ]);
  const URL_ATTRIBUTES = new Set([
    "src", "srcset", "currentsrc", "poster", "href", "xlink:href", "data-src", "data-srcset", "data-lazy-src",
    "data-original", "data-url", "style", "srcdoc", "data", "codebase", "background", "nonce", "integrity"
  ]);
  const KEPT_ATTRIBUTES = new Set(["id", "role", "type", "alt", "title", "aria-label", "data-name", "placeholder"]);
  const MEDIA_TAGS = new Set(["IMG", "PICTURE", "VIDEO", "AUDIO", "CANVAS", "IFRAME", "EMBED", "OBJECT", "SVG", "MAP"]);

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const round = value => Math.round(value * 2) / 2;
  const number = (value, fallback = 0) => {
    const parsed = typeof value === "number" ? value : parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  function parseColor(value) {
    if (typeof value !== "string") return null;
    const text = value.trim().toLowerCase();
    if (!text || text === "transparent" || text === "currentcolor" || text === "none") return null;
    if (text === "white") return { r: 255, g: 255, b: 255, a: 1 };
    if (text === "black") return { r: 0, g: 0, b: 0, a: 1 };
    const hex = /^#([0-9a-f]{3,8})$/.exec(text);
    if (hex) {
      const digits = hex[1];
      const pair = value => parseInt(value.length === 1 ? value + value : value, 16);
      if (digits.length === 3 || digits.length === 4) {
        return { r: pair(digits[0]), g: pair(digits[1]), b: pair(digits[2]), a: digits.length === 4 ? pair(digits[3]) / 255 : 1 };
      }
      if (digits.length === 6 || digits.length === 8) {
        return {
          r: parseInt(digits.slice(0, 2), 16), g: parseInt(digits.slice(2, 4), 16), b: parseInt(digits.slice(4, 6), 16),
          a: digits.length === 8 ? parseInt(digits.slice(6, 8), 16) / 255 : 1
        };
      }
      return null;
    }
    const functional = /^(rgba?|hsla?)\(([^)]*)\)$/.exec(text);
    if (functional) {
      if (functional[1].startsWith("hsl")) return null; // computed styles are serialised as rgb()
      const parts = functional[2].replace(/\//g, " ").split(/[\s,]+/).filter(Boolean);
      if (parts.length < 3) return null;
      const channel = part => {
        const value = parseFloat(part);
        if (!Number.isFinite(value)) return 0;
        return part.endsWith("%") ? value * 2.55 : value;
      };
      const alpha = parts[3] == null ? 1 : (parts[3].endsWith("%") ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]));
      return {
        r: clamp(channel(parts[0]), 0, 255), g: clamp(channel(parts[1]), 0, 255), b: clamp(channel(parts[2]), 0, 255),
        a: clamp(Number.isFinite(alpha) ? alpha : 1, 0, 1)
      };
    }
    // Chrome can serialise computed colours as color(srgb 0.1 0.2 0.3 / 0.5).
    const srgb = /^color\(srgb\s+([^)]*)\)$/.exec(text);
    if (srgb) {
      const parts = srgb[1].replace(/\//g, " ").split(/[\s,]+/).filter(Boolean);
      if (parts.length < 3) return null;
      const channel = part => clamp(parseFloat(part) * 255, 0, 255);
      const alpha = parts[3] == null ? 1 : parseFloat(parts[3]);
      return { r: channel(parts[0]), g: channel(parts[1]), b: channel(parts[2]), a: clamp(Number.isFinite(alpha) ? alpha : 1, 0, 1) };
    }
    return null;
  }

  function luminance(color) {
    if (!color) return 1;
    const channel = value => {
      const unit = clamp(value, 0, 255) / 255;
      return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
  }

  const grayHex = value => {
    const byte = Math.round(clamp(value, 0, 1) * 255).toString(16).padStart(2, "0");
    return `#${byte}${byte}${byte}`;
  };

  const contrast = (left, right) => {
    const a = luminance(left), b = luminance(right);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  };

  function fillTone(color, level) {
    if (!color || color.a < 0.04) return null;
    const value = luminance(color);
    for (const [limit, tone] of FILL_RAMP[level]) if (value <= limit) return tone;
    return null;
  }

  function textTone(color, backdrop, level) {
    const background = parseColor(backdrop) || parseColor(PAPER);
    const darkBackdrop = luminance(background) < 0.5;
    if (level === "high") {
      // Keep the page's own contrast relationships, then enforce readability.
      let value = clamp(color ? luminance(color) : (darkBackdrop ? 0.92 : 0.12), 0.06, 0.95);
      for (let attempt = 0; attempt < 8 && contrast(parseColor(grayHex(value)), background) < 3.4; attempt++) {
        value = darkBackdrop ? Math.min(0.97, value + 0.1) : Math.max(0.05, value - 0.1);
      }
      return grayHex(value);
    }
    if (darkBackdrop) return "#ededed";
    return level === "medium" ? "#3c3c3c" : "#2f2f2f";
  }

  function barTone(size, backdrop) {
    const dark = luminance(parseColor(backdrop) || parseColor(PAPER)) < 0.5;
    if (dark) return size >= 24 ? "#c4c4c4" : size >= 16 ? "#b6b6b6" : "#a8a8a8";
    return size >= 24 ? "#9b9b9b" : size >= 16 ? "#adadad" : "#c3c3c3";
  }

  function borderTone(color, fallback) {
    const parsed = parseColor(color);
    if (!parsed || parsed.a < 0.04) return fallback;
    return grayHex(clamp(luminance(parsed), 0.3, 0.85));
  }

  function shadowTone(value) {
    if (typeof value !== "string" || !value.trim() || value === "none") return null;
    // Re-colour rather than re-author: offsets, blur and spread stay as observed.
    const toned = value.replace(/(rgba?|hsla?)\([^)]*\)|#[0-9a-f]{3,8}\b/gi, "rgba(0, 0, 0, 0.12)");
    return /rgba?\(\s*0,\s*0,\s*0/i.test(toned) ? toned : null;
  }

  const pxNumber = value => /px$/.test(String(value || "")) ? number(value) : null;

  function normalizeOptions(options = {}) {
    return { level: LEVEL_IDS.has(options.level) ? options.level : "medium" };
  }

  function normalizeSettings(settings) {
    return {
      on: settings?.on === true,
      level: LEVEL_IDS.has(settings?.level) ? settings.level : "medium"
    };
  }

  function validateDocument(doc) {
    if (!doc || typeof doc !== "object") throw new Error("There is no capture to rebuild as a wireframe.");
    if (doc.version !== 2 || !doc.root || doc.root.nodeType !== 1) throw new Error("This capture cannot be rebuilt as a wireframe. Capture the page again.");
    if (!doc.root.rect || !Number.isFinite(doc.root.rect.width) || !Number.isFinite(doc.root.rect.height) || doc.root.rect.width <= 0) {
      throw new Error("This capture has no layout to rebuild.");
    }
    return doc;
  }

  // Attribute names only: the model stores `attributes` as a plain object of
  // string values. URLs and inline styles are dropped so nothing can be fetched.
  function cleanAttributes(attributes) {
    const result = {};
    if (!attributes || typeof attributes !== "object") return result;
    for (const [name, value] of Object.entries(attributes)) {
      const key = String(name).toLowerCase();
      if (URL_ATTRIBUTES.has(key)) continue;
      if (!KEPT_ATTRIBUTES.has(key)) continue;
      if (typeof value !== "string" || !value) continue;
      result[key] = value.slice(0, 120);
    }
    return result;
  }

  function radiusValue(styles, rect, level) {
    const raw = String(styles.borderTopLeftRadius || "");
    const isPercent = /%$/.test(raw);
    let radius = isPercent ? Math.min(rect.width, rect.height) * number(raw) / 100 : (pxNumber(raw) || 0);
    radius = Math.max(radius, pxNumber(styles.borderBottomRightRadius) || 0, pxNumber(styles.borderTopRightRadius) || 0);
    if (level === "low") return "0px";
    if (level === "medium") return `${round(clamp(radius, 0, 6))}px`;
    if (isPercent && radius >= Math.min(rect.width, rect.height) / 2 - 1) return "50%";
    return `${round(clamp(radius, 0, 64))}px`;
  }

  function isRounded(styles, rect) {
    const raw = String(styles.borderTopLeftRadius || "");
    const radius = /%$/.test(raw) ? Math.min(rect.width, rect.height) * number(raw) / 100 : (pxNumber(raw) || 0);
    return radius >= Math.min(rect.width, rect.height) / 2 - 1;
  }

  function borderWidth(styles) {
    return Math.max(
      pxNumber(styles.borderTopWidth) || 0, pxNumber(styles.borderRightWidth) || 0,
      pxNumber(styles.borderBottomWidth) || 0, pxNumber(styles.borderLeftWidth) || 0
    );
  }

  function rewriteStyles(styles, context) {
    const { level, rect, backdrop, tag } = context;
    if (!styles || typeof styles !== "object") return {};
    const gradient = typeof styles.backgroundImage === "string" && /gradient\(/i.test(styles.backgroundImage);
    const paintedBorder = borderWidth(styles) > 0 && styles.borderTopStyle !== "none";
    for (const name of DROPPED_STYLES) delete styles[name];
    delete styles.boxShadow;

    const fill = fillTone(parseColor(styles.backgroundColor), level);
    if (fill) styles.backgroundColor = fill;
    else if (gradient && level !== "low") styles.backgroundColor = "#f3f3f3";
    else if (gradient) styles.backgroundColor = "#f1f1f1";
    else delete styles.backgroundColor;

    const borderColor = borderTone(styles.borderTopColor, "#d0d0d0");
    if (level === "low") {
      styles.borderTopLeftRadius = radiusValue(styles, rect, level);
      styles.borderBottomRightRadius = styles.borderTopLeftRadius;
      styles.borderTopRightRadius = styles.borderBottomLeftRadius = styles.borderTopLeftRadius;
      if (paintedBorder) {
        for (const side of ["Top", "Right", "Bottom", "Left"]) {
          styles[`border${side}Style`] = "solid";
          styles[`border${side}Width`] = "1px";
          styles[`border${side}Color`] = borderColor;
        }
      }
    } else if (level === "medium") {
      styles.borderTopLeftRadius = radiusValue(styles, rect, level);
      styles.borderBottomRightRadius = styles.borderTopLeftRadius;
      styles.borderTopRightRadius = styles.borderBottomLeftRadius = styles.borderTopLeftRadius;
      if (paintedBorder) {
        for (const side of ["Top", "Right", "Bottom", "Left"]) {
          styles[`border${side}Style`] = "solid";
          styles[`border${side}Width`] = "1px";
          styles[`border${side}Color`] = borderColor;
        }
      }
    } else {
      styles.borderTopLeftRadius = radiusValue(styles, rect, level);
      styles.borderBottomRightRadius = radiusValue({ borderTopLeftRadius: styles.borderBottomRightRadius }, rect, level);
      styles.borderTopRightRadius = radiusValue({ borderTopLeftRadius: styles.borderTopRightRadius }, rect, level);
      styles.borderBottomLeftRadius = radiusValue({ borderTopLeftRadius: styles.borderBottomLeftRadius }, rect, level);
      if (paintedBorder) {
        const width = `${round(clamp(borderWidth(styles), 0.5, 3))}px`;
        for (const side of ["Top", "Right", "Bottom", "Left"]) {
          styles[`border${side}Style`] = styles[`border${side}Style`] || "solid";
          styles[`border${side}Width`] = width;
          styles[`border${side}Color`] = borderTone(styles[`border${side}Color`], "#cfcfcf");
        }
      }
      const shadow = shadowTone(styles.boxShadow || context.shadow);
      if (shadow) styles.boxShadow = shadow;
    }

    if (level !== "high") styles.opacity = "1";
    if (styles.color != null) styles.color = textTone(parseColor(styles.color), backdrop, level);
    if (level !== "high") {
      // Low has no editable text left, but keeping one neutral family on the
      // boxes means any text layer created by hand inherits something sane.
      if (styles.fontFamily) styles.fontFamily = NEUTRAL_FONT;
      styles.letterSpacing = "normal";
    }
    if (styles.textDecorationColor != null) styles.textDecorationColor = borderTone(styles.textDecorationColor, "#8a8a8a");
    if (styles.backgroundImage === "") delete styles.backgroundImage;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") styles.opacity = "1";
    return styles;
  }

  function rewriteComputed(computed, context) {
    if (!computed || typeof computed !== "object") return undefined;
    return rewriteStyles({ ...computed }, context);
  }

  function barNodes(textNode, parentStyles, backdrop, level, stats) {
    const rect = textNode.rect || {};
    const width = number(rect.width), height = number(rect.height);
    if (width < 1 || height < 1) return [];
    const lineHeight = Math.max(1, pxNumber(parentStyles?.lineHeight) || number(parentStyles?.fontSize, 16) * 1.4);
    const declaredLines = Math.max(1, Math.round(number(textNode.lineCount, 0)) || Math.round(height / lineHeight) || 1);
    const lines = clamp(declaredLines, 1, LIMITS.lines);
    const size = number(parentStyles?.fontSize, 16);
    const barHeight = round(clamp(Math.min(lineHeight * 0.62, size * 0.62), 3, 24));
    const step = height / lines;
    const color = barTone(size, backdrop);
    const nodeTag = "DIV";
    const nodes = [];
    for (let index = 0; index < lines; index++) {
      const last = index === lines - 1 && lines > 1;
      const barWidth = last ? Math.max(4, width * 0.62) : width;
      nodes.push({
        nodeType: 1,
        id: `${textNode.id || `wf-bar-${stats.bars}`}-l${index + 1}`,
        tag: nodeTag,
        attributes: {},
        styles: { display: "block", backgroundColor: color, borderRadius: "2px", opacity: "1" },
        rect: {
          x: round(number(rect.x)),
          y: round(number(rect.y) + index * step + Math.max(0, (step - barHeight) / 2)),
          width: Math.max(1, round(barWidth)),
          height: Math.max(1, barHeight)
        },
        childNodes: []
      });
      stats.bars++;
    }
    return nodes;
  }

  function mediaLabel(tag, attributes) {
    const label = (attributes?.["aria-label"] || attributes?.alt || attributes?.title || "").trim();
    if (label) return label.slice(0, 40);
    if (tag === "SVG") return "Icon";
    if (tag === "IMG" || tag === "PICTURE") return "Image";
    if (tag === "VIDEO") return "Video";
    if (tag === "CANVAS") return "Canvas";
    if (tag === "IFRAME" || tag === "EMBED" || tag === "OBJECT") return "Embedded content";
    return "Media";
  }

  function placeholderStyles(tag, originalStyles, rect, level) {
    const avatar = (tag === "IMG" || tag === "PICTURE") && Math.abs(rect.width - rect.height) <= 8 &&
      rect.width <= 160 && isRounded(originalStyles, rect);
    const icon = tag === "SVG" && rect.width <= 40 && rect.height <= 40;
    const styles = {
      backgroundColor: level === "low" ? "#ededed" : "#e9e9e9",
      borderTopStyle: "solid", borderRightStyle: "solid", borderBottomStyle: "solid", borderLeftStyle: "solid",
      borderTopWidth: "1px", borderRightWidth: "1px", borderBottomWidth: "1px", borderLeftWidth: "1px",
      borderTopColor: "#d5d5d5", borderRightColor: "#d5d5d5", borderBottomColor: "#d5d5d5", borderLeftColor: "#d5d5d5",
      opacity: "1", color: "#8c8c8c", fontFamily: NEUTRAL_FONT, fontSize: "12px", fontWeight: "500",
      lineHeight: "16px", textAlign: "center", letterSpacing: "normal", display: "block"
    };
    const radius = avatar ? "50%" : icon || level === "low" ? "4px" : radiusValue(originalStyles, rect, level);
    styles.borderTopLeftRadius = radius;
    styles.borderTopRightRadius = radius;
    styles.borderBottomLeftRadius = radius;
    styles.borderBottomRightRadius = radius;
    return { styles, avatar, icon };
  }

  function transformDocument(doc, options = {}) {
    const { level } = normalizeOptions(options);
    validateDocument(doc);
    const stats = { nodes: 0, text: 0, bars: 0, placeholders: 0, truncated: false, dropped: 0 };
    // A wireframe carries no page assets at all: images, masks and background
    // pictures are removed before anything can be embedded.
    doc.assets = {};
    if (Array.isArray(doc.fonts)) doc.fonts = level === "high" ? doc.fonts : [];

    function walkElement(node, context) {
      stats.nodes++;
      const rect = {
        x: number(node.rect?.x), y: number(node.rect?.y),
        width: Math.max(0, number(node.rect?.width)), height: Math.max(0, number(node.rect?.height))
      };
      const tag = String(node.tag || "").toUpperCase();
      const isMedia = MEDIA_TAGS.has(tag);
      node.rect = rect;
      node.attributes = cleanAttributes(node.attributes);
      const originalShadow = typeof node.styles?.boxShadow === "string" ? node.styles.boxShadow : "";

      if (isMedia) {
        stats.placeholders++;
        const placeholder = placeholderStyles(tag, node.styles || {}, rect, level);
        node.childNodes = [];
        node.styles = placeholder.styles;
        delete node.computedStyles;
        delete node.variableStyles;
        delete node.sourceProps;
        delete node.placeholderUrl;
        delete node.content;
        delete node.pseudoElementNodes;
        delete node.pseudoElementStyles;
        delete node.scrollRect;
        delete node.figmaComponentMetadata;
        if (level !== "low" && !placeholder.icon && !placeholder.avatar && rect.width >= 96 && rect.height >= 64) {
          const label = mediaLabel(tag, node.attributes);
          const fontSize = 12, labelWidth = Math.min(rect.width - 16, 200);
          node.childNodes.push({
            nodeType: 3,
            id: `${node.id || "wf-media"}-label`,
            text: label,
            rect: {
              x: round(rect.x + (rect.width - labelWidth) / 2),
              y: round(rect.y + rect.height / 2 - fontSize * 0.8),
              width: Math.max(1, round(labelWidth)),
              height: round(fontSize * 1.6)
            },
            lineCount: 1
          });
        }
        return node;
      }

      node.styles = rewriteStyles(node.styles || {}, { level, rect, backdrop: context.backdrop, tag, shadow: originalShadow });
      if (node.computedStyles) node.computedStyles = rewriteComputed(node.computedStyles, { level, rect, backdrop: context.backdrop, tag });
      delete node.variableStyles;
      delete node.sourceProps;
      delete node.placeholderUrl;
      delete node.content;
      delete node.pseudoElementNodes;
      delete node.pseudoElementStyles;
      delete node.scrollRect;
      delete node.figmaComponentMetadata;

      const fill = parseColor(node.styles?.backgroundColor) ? node.styles.backgroundColor : null;
      const childBackdrop = fill || context.backdrop;
      const fontStyles = node.styles || {};
      const children = [];
      for (const child of Array.isArray(node.childNodes) ? node.childNodes : []) {
        if (stats.nodes + children.length >= LIMITS.nodes || context.depth >= LIMITS.depth) { stats.truncated = true; break; }
        if (!child || typeof child !== "object") continue;
        if (child.nodeType === 3) {
          stats.text++;
          if (level === "low") children.push(...barNodes(child, fontStyles, childBackdrop, level, stats));
          else {
            child.rect = {
              x: number(child.rect?.x), y: number(child.rect?.y),
              width: Math.max(0, number(child.rect?.width)), height: Math.max(0, number(child.rect?.height))
            };
            child.text = typeof child.text === "string" ? child.text : "";
            children.push(child);
          }
        } else if (child.nodeType === 1) {
          children.push(walkElement(child, { level, backdrop: childBackdrop, depth: context.depth + 1 }));
        } else stats.dropped++;
      }
      node.childNodes = children;
      return node;
    }

    doc.root = walkElement(doc.root, { level, backdrop: PAPER, depth: 0 });
    // Deterministic: the same capture and level always produce the same payload.
    doc.wireframe = { level };
    return { document: doc, stats, level };
  }

  function summarize(result) {
    const stats = result?.stats || {};
    return {
      level: result?.level || "medium",
      nodes: stats.nodes || 0,
      text: stats.text || 0,
      bars: stats.bars || 0,
      placeholders: stats.placeholders || 0,
      truncated: stats.truncated === true,
      blocks: (stats.nodes || 0) - (stats.text || 0)
    };
  }

  globalThis.PageCaptureWireframeCore = Object.freeze({
    LEVELS, LIMITS, STORAGE_KEY, NEUTRAL_FONT,
    normalizeOptions, normalizeSettings, validateDocument, transformDocument, summarize,
    parseColor, luminance, contrast, fillTone, textTone, barTone, grayHex
  });
})();
