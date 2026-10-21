/* Wireframe planning: rewrite a captured page as editable greyscale layers.
 * Pure functions only — no DOM, no network, no storage — so the transform can be
 * reasoned about (and tested) without a browser. */
(() => {
  "use strict";
  if (globalThis.PageCaptureWireframeCore) return;

  // Bounded so a pathological capture cannot freeze the copy, but generous
  // enough for a full-page capture of a heavy product page.
  // `textLength` and `span` bound one node; `nodes`/`depth` bound the whole tree.
  // Everything here is also listed in the README limits table.
  // Shown in the popover so it is obvious which build is actually loaded: a stale
  // release ZIP that still exposes the checkbox but not the transform is the one
  // failure mode the user cannot otherwise see.
  const BUILD = Object.freeze({ version: "1.8.3" });

  const LIMITS = Object.freeze({
    nodes: 20000, depth: 60, lines: 40, nameLength: 48, textLength: 2000,
    // Measured coordinates of a real page stay far inside this; a capture with a
    // 1e9px rect would otherwise be pasted as an unselectable, off-canvas blob.
    span: 1000000, size: 200000
  });
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
  // Luminance -> grey. Each band is [upper bound of relative luminance, tone], from
  // the darkest band to the lightest, so a black footer stays dark, a hero photo
  // reads mid grey and a white card keeps the palest tone. Low is flatter on
  // purpose: structure only, and print-like.
  const FILL_RAMP = Object.freeze({
    low: [[0.3, "#c9c9c9"], [0.7, "#e4e4e4"], [1.01, "#f6f6f6"]],
    medium: [[0.08, "#7a7a7a"], [0.25, "#a8a8a8"], [0.5, "#d2d2d2"], [0.8, "#ececec"], [1.01, "#f8f8f8"]],
    high: [[0.02, "#5f5f5f"], [0.08, "#808080"], [0.2, "#a3a3a3"], [0.4, "#c6c6c6"], [0.6, "#dedede"], [0.8, "#eeeeee"], [1.01, "#f9f9f9"]]
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

  // Alpha is composited over what is actually behind the element before a tone is
  // chosen. Without this a 6% black overlay would map to a dark slab, because its
  // own luminance is black even though the page looks white there.
  function blend(color, backdrop) {
    const base = parseColor(backdrop) || parseColor(PAPER);
    const alpha = clamp(color.a, 0, 1);
    return {
      r: color.r * alpha + base.r * (1 - alpha),
      g: color.g * alpha + base.g * (1 - alpha),
      b: color.b * alpha + base.b * (1 - alpha),
      a: 1
    };
  }

  // Every tone this transform can produce, so re-building a wireframe (the same
  // capture copied twice, or a level changed in place) does not drift a second time.
  const OUR_TONES = new Set(Object.values(FILL_RAMP).flat().map(([, tone]) => tone));

  const isNeutral = color => Math.round(color.r) === Math.round(color.g) && Math.round(color.g) === Math.round(color.b);
  const channelHex = color => {
    const byte = Math.round(clamp(color.r, 0, 255)).toString(16).padStart(2, "0");
    return `#${byte}${byte}${byte}`;
  };

  function toneFor(value, level) {
    for (const [limit, tone] of FILL_RAMP[level]) if (value <= limit) return tone;
    return FILL_RAMP[level][FILL_RAMP[level].length - 1][1];
  }

  function fillTone(color, level, backdrop = PAPER) {
    if (!color || color.a < 0.02) return null;
    const seen = blend(color, backdrop);
    // A tone that is already one of ours is final; re-quantising it would shift a
    // rebuilt wireframe (Medium #a8a8a8 would become #d2d2d2).
    if (isNeutral(seen) && OUR_TONES.has(channelHex(seen))) return channelHex(seen);
    return toneFor(luminance(seen), level);
  }

  function textTone(color, backdrop, level) {
    const background = parseColor(backdrop) || parseColor(PAPER);
    const darkBackdrop = luminance(background) < 0.5;
    if (level === "high") {
      // Keep the page's own contrast relationships, then enforce readability.
      const seen = color ? luminance(blend(color, backdrop)) : (darkBackdrop ? 0.92 : 0.12);
      let value = clamp(seen, 0.06, 0.95);
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

  function borderTone(color, fallback, backdrop = PAPER) {
    const parsed = parseColor(color);
    if (!parsed || parsed.a < 0.02) return fallback;
    const seen = blend(parsed, backdrop);
    // A grey hairline keeps its own lightness (a pale input border should not turn
    // into a dark rule, and its own tone must not drift when rebuilt).
    const base = isNeutral(seen) ? clamp(seen.r / 255, 0.3, 0.95) : clamp(luminance(seen), 0.3, 0.85);
    // An edge only reads if it separates from what it sits on: on a dark band a
    // dark hairline is invisible, so it is lightened until it shows. A pale
    // hairline on a light page is the page's own choice and is left alone -
    // darkening it would invent a border that was not there.
    const surface = parseColor(backdrop) || parseColor(PAPER);
    const surfaceLuminance = luminance(surface);
    if (surfaceLuminance >= 0.5) return grayHex(base);
    let value = base;
    for (let attempt = 0; attempt < 6 && contrast(parseColor(grayHex(value)), surface) < 1.6; attempt++) {
      value = Math.min(0.95, Math.max(value, surfaceLuminance) + 0.12);
    }
    return grayHex(value);
  }

  function shadowTone(value) {
    if (typeof value !== "string" || !value.trim() || value === "none") return null;
    // Re-colour rather than re-author: offsets, blur and spread stay as observed.
    const toned = value.replace(/(rgba?|hsla?)\([^)]*\)|#[0-9a-f]{3,8}\b/gi, "rgba(0, 0, 0, 0.12)");
    return /rgba?\(\s*0,\s*0,\s*0/i.test(toned) ? toned : null;
  }

  const pxNumber = value => /px$/.test(String(value || "")) ? number(value) : null;

  // One rect shape for every node: finite, rounded, and bounded so a pathological
  // capture cannot be pasted as an off-canvas, unselectable blob.
  function boundedRect(rect) {
    return {
      x: clamp(round(number(rect?.x)), -LIMITS.span, LIMITS.span),
      y: clamp(round(number(rect?.y)), -LIMITS.span, LIMITS.span),
      width: clamp(round(number(rect?.width)), 0, LIMITS.size),
      height: clamp(round(number(rect?.height)), 0, LIMITS.size)
    };
  }

  const safeId = value => typeof value === "string" && value
    ? value.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, LIMITS.nameLength) || undefined
    : undefined;

  // Text is copied verbatim except for characters that cannot survive a clipboard
  // round trip (control codes, lone surrogates) and a length bound, so one giant
  // <pre> cannot bloat the payload past what a paste can handle.
  function cleanText(value) {
    const text = typeof value === "string" ? value : "";
    const stripped = text
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
      .replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, "\ufffd");
    return stripped.length > LIMITS.textLength ? `${stripped.slice(0, LIMITS.textLength - 1)}\u2026` : stripped;
  }

  // `fonts` is a family -> face map in the capture model. Names are kept at High so
  // the type stack still reads, but a face URL is never shipped: an http(s), data:
  // or url() value is a page asset, and assets do not belong in a wireframe.
  function sanitizeFonts(fonts, level) {
    const safe = value => {
      if (typeof value !== "string") return undefined;
      if (/url\(|https?:|^data:|\/\//i.test(value)) return undefined;
      return value.slice(0, 80);
    };
    if (level !== "high") return {};
    const FACE_FIELDS = ["family", "name", "style", "weight", "stretch"];
    const cleanFace = face => {
      if (typeof face === "string") return safe(face);
      if (!face || typeof face !== "object") return undefined;
      const out = {};
      for (const field of FACE_FIELDS) {
        const value = safe(face[field]);
        if (value !== undefined) out[field] = value;
      }
      return out;
    };
    if (Array.isArray(fonts)) {
      return fonts.slice(0, 32).map(cleanFace).filter(face => face !== undefined);
    }
    if (fonts && typeof fonts === "object") {
      const out = {};
      for (const [family, face] of Object.entries(fonts).slice(0, 32)) {
        const name = safe(family);
        if (name === undefined) continue;
        const value = cleanFace(face);
        out[name] = value === undefined ? {} : value;
      }
      return out;
    }
    return {};
  }

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

  // Every colour-bearing property in the capture model. Anything matching this
  // is rewritten to a grey; nothing in a wireframe may carry a hue, which is what
  // let brand colours (Dribbble pink, red focus rings) survive into Figma.
  const COLOUR_KEY = /color$/i;
  const COLOUR_KEYS = new Set(["fill", "stroke", "stopColor", "floodColor", "lightingColor", "caretColor"]);
  const TEXT_COLOUR_KEYS = new Set(["color", "webkitTextFillColor", "textDecorationColor", "textEmphasisColor"]);

  function greyValue(value, context, kind) {
    const { level, backdrop } = context;
    // Keywords and unparseable values are dropped so the destination applies its
    // own default instead of inheriting a colour we could not read.
    const parsed = parseColor(value);
    if (!parsed) return undefined;
    if (kind === "text") return textTone(parsed, backdrop, level);
    if (kind === "border") return borderTone(parsed, "#d0d0d0", backdrop);
    if (parsed.a < 0.02) return undefined;
    return toneFor(luminance(blend(parsed, backdrop)), level);
  }

  function rewriteStyles(input, context) {
    const { level, rect, backdrop, tag } = context;
    if (!input || typeof input !== "object") return {};
    const styles = { ...input };
    // A gradient can arrive through backgroundImage or through the background
    // shorthand; either way it is a surface that must survive as a light tone.
    const gradient = ["backgroundImage", "background"].some(key =>
      typeof styles[key] === "string" && /gradient\(/i.test(styles[key]));
    const paintedBorder = borderWidth(styles) > 0 && styles.borderTopStyle !== "none";
    for (const name of DROPPED_STYLES) delete styles[name];
    delete styles.boxShadow;

    // 1. Normalise every colour the page supplied, before any tone of our own is
    //    chosen, so our ramp values are final and never re-quantised.
    const pageFill = fillTone(parseColor(styles.backgroundColor), level, backdrop);
    // A border is drawn on the element's own box, so it must read against that
    // surface, not against the section behind it.
    const edgeBackdrop = pageFill || backdrop;
    const sideColours = {};
    for (const side of ["Top", "Right", "Bottom", "Left"]) {
      sideColours[side] = borderTone(styles[`border${side}Color`], "#d0d0d0", edgeBackdrop);
    }
    // Text inherits the colour of the element that paints the surface, so its tone
    // must be judged against that surface, not against the section behind it. A
    // dark quote band would otherwise get dark ink and lose its label entirely.
    const textContext = pageFill && pageFill !== "none" ? { ...context, backdrop: pageFill } : context;
    for (const key of Object.keys(styles)) {
      const value = styles[key];
      if (typeof value !== "string" || key === "backgroundColor") continue;
      if (/url\(/i.test(value)) { delete styles[key]; continue; }
      const isText = TEXT_COLOUR_KEYS.has(key);
      const isBorder = /^border(Top|Right|Bottom|Left|Block|Inline)?Color$/.test(key) || key === "outlineColor";
      if (isText) {
        const grey = greyValue(value, textContext, "text");
        if (grey) styles[key] = grey; else delete styles[key];
      } else if (isBorder) {
        const grey = greyValue(value, { ...context, backdrop: edgeBackdrop }, "border");
        if (grey) styles[key] = grey; else delete styles[key];
      } else if (COLOUR_KEY.test(key) || COLOUR_KEYS.has(key)) {
        const grey = greyValue(value, context, "shape");
        if (grey) styles[key] = grey; else delete styles[key];
      }
    }

    // 2. Surfaces. A gradient cannot be reproduced as a flat tone, but the fact
    //    that the section had a surface should survive as the lightest grey.
    if (pageFill) styles.backgroundColor = pageFill;
    else if (gradient) styles.backgroundColor = "#f3f3f3";
    else delete styles.backgroundColor;

    // 3. Edges and corners.
    if (level === "high") {
      styles.borderTopLeftRadius = radiusValue(styles, rect, level);
      styles.borderBottomRightRadius = radiusValue({ borderTopLeftRadius: styles.borderBottomRightRadius }, rect, level);
      styles.borderTopRightRadius = radiusValue({ borderTopLeftRadius: styles.borderTopRightRadius }, rect, level);
      styles.borderBottomLeftRadius = radiusValue({ borderTopLeftRadius: styles.borderBottomLeftRadius }, rect, level);
      if (paintedBorder) {
        const width = `${round(clamp(borderWidth(styles), 0.5, 3))}px`;
        for (const side of ["Top", "Right", "Bottom", "Left"]) {
          styles[`border${side}Style`] = styles[`border${side}Style`] || "solid";
          styles[`border${side}Width`] = width;
          styles[`border${side}Color`] = sideColours[side];
        }
      }
      const shadow = shadowTone(context.shadow || input.boxShadow);
      if (shadow) styles.boxShadow = shadow;
    } else {
      // Low and Medium keep one hairline where the page had a visible edge, which
      // is what makes buttons and cards read as interactive.
      const radius = radiusValue(styles, rect, level);
      styles.borderTopLeftRadius = radius;
      styles.borderTopRightRadius = styles.borderBottomLeftRadius = styles.borderBottomRightRadius = radius;
      if (paintedBorder) {
        for (const side of ["Top", "Right", "Bottom", "Left"]) {
          styles[`border${side}Style`] = "solid";
          styles[`border${side}Width`] = "1px";
          styles[`border${side}Color`] = sideColours[side];
        }
      }
    }

    // 4. A wireframe is flat and opaque: alpha is already folded into each tone.
    styles.opacity = "1";
    if (styles.mixBlendMode) delete styles.mixBlendMode;
    if (level !== "high") {
      // Low has no editable text left, but keeping one neutral family on the boxes
      // means any text layer created by hand inherits something sane.
      if (styles.fontFamily) styles.fontFamily = NEUTRAL_FONT;
      styles.letterSpacing = "normal";
    }
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") delete styles.caretColor;
    for (const key of Object.keys(styles)) {
      if (styles[key] === undefined) delete styles[key];
      else if (typeof styles[key] === "string" && /url\(/i.test(styles[key])) delete styles[key];
    }
    return styles;
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
    if (tag === "VIDEO") return "Video";
    if (tag === "CANVAS") return "Canvas";
    if (tag === "IFRAME" || tag === "EMBED" || tag === "OBJECT") return "Embedded content";
    // Anything else that painted an image (a thumbnail div, a picture) is an image.
    return "Image";
  }

  function placeholderStyles(tag, originalStyles, rect, level) {
    const avatar = (tag === "IMG" || tag === "PICTURE") && Math.abs(rect.width - rect.height) <= 8 &&
      rect.width <= 160 && isRounded(originalStyles, rect);
    const icon = tag === "SVG" && rect.width <= 40 && rect.height <= 40;
    const styles = {
      backgroundColor: level === "low" ? "#ededed" : level === "high" ? "#dcdcdc" : "#e3e3e3",
      borderTopStyle: "solid", borderRightStyle: "solid", borderBottomStyle: "solid", borderLeftStyle: "solid",
      borderTopWidth: "1px", borderRightWidth: "1px", borderBottomWidth: "1px", borderLeftWidth: "1px",
      borderTopColor: level === "high" ? "#c2c2c2" : "#d0d0d0", borderRightColor: level === "high" ? "#c2c2c2" : "#d0d0d0",
      borderBottomColor: level === "high" ? "#c2c2c2" : "#d0d0d0", borderLeftColor: level === "high" ? "#c2c2c2" : "#d0d0d0",
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
    const stats = { nodes: 0, emitted: 0, text: 0, bars: 0, placeholders: 0, truncated: false, dropped: 0, hidden: 0, flattened: 0 };
    // The captured document is never edited: the caller keeps the original, so the
    // copy is reversible and a second pass cannot inherit the first one's output.
    const fonts = sanitizeFonts(doc.fonts, level);

    // Nodes are rebuilt from a whitelist, never patched in place. The snapshot also
    // carries computedStyles, variableStyles, sourceProps, pseudo-element styles and
    // asset pointers; any of those could hand the destination a colour, an image or
    // a URL we did not intend to ship.
    const element = (node, styles, childNodes) => ({
      nodeType: 1,
      id: safeId(node.id),
      tag: String(node.tag || "DIV").toUpperCase(),
      attributes: cleanAttributes(node.attributes),
      styles,
      rect: boundedRect(node.rect),
      childNodes
    });

    const textNode = (node, text) => ({
      nodeType: 3,
      id: safeId(node.id),
      text: cleanText(text),
      rect: boundedRect(node.rect),
      lineCount: Math.max(1, Math.round(number(node.lineCount, 1)))
    });

    // Children are transformed once, for both ordinary boxes and image-backed
    // boxes: text becomes real text (Medium/High) or bars (Low), and elements are
    // rebuilt from the whitelist.
    // A paint-only layer with almost no alpha and no content is a hover veil or a
    // tint over a photo. Re-toned it becomes a grey slab; kept as-is it washes out
    // whatever it covers. If it sits inside another element that already paints,
    // drop it - the shape survives, the veil does not.
    function isRedundantVeil(node, siblings) {
      const styles = node.styles || {};
      if (Array.isArray(node.childNodes) && node.childNodes.length > 0) return false;
      if (borderWidth(styles) > 0 && styles.borderTopStyle !== "none") return false;
      const paint = parseColor(styles.backgroundColor);
      if (!paint || paint.a >= 0.12) return false;
      const rect = node.rect || {};
      const x = number(rect.x), y = number(rect.y);
      const w = number(rect.width), h = number(rect.height);
      if (!(w > 0 && h > 0)) return false;
      return siblings.some(other => {
        if (other === node || other.nodeType !== 1) return false;
        const otherPaint = parseColor(other.styles?.backgroundColor);
        const otherImage = /url\(/i.test(String(other.styles?.backgroundImage || ""));
        const large = number(other.rect?.width) * number(other.rect?.height) >= 400;
        if (!(otherPaint && otherPaint.a > 0.12) && !(otherImage && large)) return false;
        const ox = number(other.rect?.x), oy = number(other.rect?.y);
        return x >= ox - 1 && y >= oy - 1
          && x + w <= ox + number(other.rect?.width) + 1
          && y + h <= oy + number(other.rect?.height) + 1;
      });
    }

    function transformChildren(node, styles, depth, inherited) {
      const backdrop = styles.backgroundColor || inherited || PAPER;
      const children = [];
      const siblings = Array.isArray(node.childNodes) ? node.childNodes : [];
      for (const child of siblings) {
        // The budget counts layers that actually ship: visited-but-dropped nodes
        // (hidden, flattened, veils) must not eat into it.
        if (stats.emitted >= LIMITS.nodes || depth >= LIMITS.depth) { stats.truncated = true; break; }
        if (!child || typeof child !== "object") { stats.dropped++; continue; }
        if (child.nodeType === 3) {
          stats.text++;
          if (level === "low") {
            const bars = barNodes(child, styles, backdrop, level, stats);
            children.push(...bars);
            stats.emitted += bars.length;
          } else {
            children.push(textNode(child, typeof child.text === "string" ? child.text : ""));
            stats.emitted++;
          }
        } else if (child.nodeType === 1) {
          if (isRedundantVeil(child, siblings)) { stats.dropped++; continue; }
          const transformed = walkElement(child, { level, backdrop, depth: depth + 1 });
          if (!transformed) continue;
          // A zero-area wrapper (display:contents, a collapsed flex item) is not a
          // layer; its children still are, so lift them into its place.
          if (transformed.rect.width < 1 && transformed.rect.height < 1) {
            if (transformed.childNodes.length) {
              children.push(...transformed.childNodes);
              stats.emitted += transformed.childNodes.length;
              stats.flattened++;
            } else stats.dropped++;
            continue;
          }
          children.push(transformed);
          stats.emitted++;
        } else stats.dropped++;
      }
      return children;
    }

    function labelNode(attributes, rect, id) {
      const fontSize = 12, width = Math.max(1, Math.min(rect.width - 16, 200));
      return {
        nodeType: 3,
        id: `${id || "wf-media"}-label`,
        text: mediaLabel(String(attributes.__tag || ""), attributes),
        rect: {
          x: round(rect.x + (rect.width - width) / 2),
          y: round(rect.y + rect.height / 2 - fontSize * 0.8),
          width: round(width),
          height: round(fontSize * 1.6)
        },
        lineCount: 1
      };
    }

    function walkElement(node, context) {
      stats.nodes++;
      const original = node.styles || {};
      const display = String(original.display || "").toLowerCase();
      // Nothing on the page paints these, so nothing of them may be pasted: a
      // display:none menu or a 0-opacity backdrop would otherwise appear as very
      // real grey boxes with very real (hidden) text in them.
      if (display === "none" || String(original.opacity ?? "") !== "" && number(original.opacity, 1) === 0) {
        stats.hidden++;
        return null;
      }
      // visibility:hidden keeps its box but paints nothing, so the whole subtree is
      // dropped just like display:none. content-visibility:hidden still paints the
      // box itself; only its contents are skipped.
      const visibility = String(original.visibility || "").toLowerCase();
      if (visibility === "hidden" || visibility === "collapse") {
        stats.hidden++;
        return null;
      }
      const contentHidden = String(original.contentVisibility || "").toLowerCase() === "hidden";
      const tag = String(node.tag || "DIV").toUpperCase();
      const rect = boundedRect(node.rect);
      const attributes = cleanAttributes(node.attributes);
      const isMediaTag = MEDIA_TAGS.has(tag);
      // A card thumbnail is usually a div with a background image, not an <img>,
      // so any sizeable element that paints a URL image becomes a placeholder too.
      const paintedImage = /url\(/i.test(String(node.styles?.backgroundImage || "")) ||
        /url\(/i.test(String(node.styles?.maskImage || ""));

      if (isMediaTag || (paintedImage && rect.width * rect.height >= 400)) {
        stats.placeholders++;
        const placeholder = placeholderStyles(tag, node.styles || {}, rect, level);
        const large = rect.width >= 96 && rect.height >= 64;
        const labelled = level !== "low" && large && !placeholder.icon && !placeholder.avatar;
        if (!isMediaTag) {
          // An image-backed box may still hold real content (badges, captions).
          // Keep it, and skip the label so the two cannot collide.
          const kept = contentHidden ? [] : transformChildren(node, placeholder.styles, context.depth, context.backdrop);
          if (kept.length) return element(node, placeholder.styles, kept);
        }
        const children = labelled ? [labelNode({ ...attributes, __tag: tag }, rect, node.id)] : [];
        return element(node, placeholder.styles, children);
      }

      const originalShadow = typeof node.styles?.boxShadow === "string" ? node.styles.boxShadow : "";
      const styles = rewriteStyles(node.styles || {}, { level, rect, backdrop: context.backdrop, tag, shadow: originalShadow });
      const children = contentHidden ? [] : transformChildren(node, styles, context.depth, context.backdrop);
      return element(node, styles, children);
    }

    const root = walkElement(doc.root, { level, backdrop: PAPER, depth: 0 });
    if (!root) throw new Error("This capture has nothing visible to rebuild.");
    // Deterministic: the same capture and level always produce the same payload.
    // A fresh document, so the capture handed in is left exactly as it was.
    const document = { ...doc, assets: {}, fonts, root, wireframe: { level } };
    return { document, stats, level };
  }

  function summarize(result) {
    const stats = result?.stats || {};
    return {
      level: result?.level || "medium",
      nodes: stats.emitted ?? stats.nodes ?? 0,
      text: stats.text || 0,
      bars: stats.bars || 0,
      placeholders: stats.placeholders || 0,
      hidden: stats.hidden || 0,
      truncated: stats.truncated === true,
      blocks: (stats.nodes || 0) - (stats.text || 0)
    };
  }

  globalThis.PageCaptureWireframeCore = Object.freeze({
    LEVELS, LIMITS, BUILD, STORAGE_KEY, NEUTRAL_FONT,
    normalizeOptions, normalizeSettings, validateDocument, transformDocument, summarize,
    parseColor, luminance, contrast, fillTone, textTone, barTone, grayHex
  });
})();
