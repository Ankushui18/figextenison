/* Wireframe planning: turn a scanned page tree into editable greyscale blocks.
 * Pure functions only — no DOM, no network, no storage — so every level can be
 * reasoned about (and tested) without a browser. */
(() => {
  "use strict";
  if (globalThis.PageCaptureWireframeCore) return;

  const LIMITS = Object.freeze({
    width: 4000, height: 20000, blocks: 4000, textBlocks: 2500, lines: 40, nameLength: 48
  });

  // The three levels the user picks between. `title` is the plain-language name
  // shown in the panel; `description` explains what changes, so the choice is
  // never a guess.
  const LEVELS = Object.freeze([
    Object.freeze({ id: "low", label: "Low", title: "Skeleton", description: "Outlined boxes and text bars. Structure only." }),
    Object.freeze({ id: "medium", label: "Medium", title: "Structure", description: "Real text, neutral type, labelled placeholders." }),
    Object.freeze({ id: "high", label: "High", title: "Detail", description: "Type hierarchy, radii and greyscale tones." })
  ]);
  const LEVEL_IDS = new Set(LEVELS.map(level => level.id));

  const NEUTRAL_FONT = 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
  const PAPER = "#ffffff";

  // A single fixed grey ramp per level keeps a wireframe coherent: colours from
  // the page are reduced to one of these tones instead of being invented.
  const FILL_RAMP = Object.freeze({
    low: [[0.35, "#e3e3e3"], [1, "#f5f5f5"]],
    medium: [[0.22, "#d6d6d6"], [0.55, "#e7e7e7"], [0.88, "#f4f4f4"], [1.01, null]],
    high: [[0.14, "#c7c7c7"], [0.3, "#d7d7d7"], [0.5, "#e4e4e4"], [0.7, "#efefef"], [0.9, "#f7f7f7"], [1.01, null]]
  });

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const round = value => Math.round(value * 2) / 2;

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
      if (functional[1].startsWith("hsl")) return null; // Computed styles use rgb(), see the comment below.
      const parts = functional[2].replace(/\//g, " ").split(/[\s,]+/).filter(Boolean);
      if (parts.length < 3) return null;
      const channel = part => {
        const number = parseFloat(part);
        if (!Number.isFinite(number)) return 0;
        return part.endsWith("%") ? number * 2.55 : number;
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
      let value = color ? clamp(luminance(color), 0, 1) : (darkBackdrop ? 0.92 : 0.14);
      value = clamp(value, 0.08, 0.95);
      for (let attempt = 0; attempt < 8 && contrast(parseColor(grayHex(value)), background) < 3.2; attempt++) {
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

  const number = (value, fallback = 0) => {
    const parsed = typeof value === "number" ? value : parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  function normalizeOptions(options = {}) {
    return {
      level: LEVEL_IDS.has(options.level) ? options.level : "medium",
      area: options.area === "viewport" ? "viewport" : "page"
    };
  }

  function validatePage(page) {
    if (!page || typeof page !== "object") throw new Error("There is no scanned page to convert.");
    const area = page.area;
    if (!area || !Number.isFinite(area.width) || !Number.isFinite(area.height) || area.width < 1 || area.height < 1) {
      throw new Error("The scanned page has no capture area.");
    }
    if (area.width > LIMITS.width || area.height > LIMITS.height) throw new Error("The scanned page is larger than a wireframe can hold.");
    if (!Array.isArray(page.nodes)) throw new Error("The scanned page has no layers.");
    return {
      area: { width: Math.min(area.width, LIMITS.width), height: Math.min(area.height, LIMITS.height) },
      viewport: page.viewport && Number.isFinite(page.viewport.width) ? { width: page.viewport.width, height: page.viewport.height || 0 } : { width: 0, height: 0 }
    };
  }

  const KINDS = new Set(["box", "text", "media", "field", "control", "rule"]);

  function sanitizeNode(raw, index) {
    if (!raw || typeof raw !== "object" || !KINDS.has(raw.kind)) return null;
    const x = number(raw.x), y = number(raw.y), w = number(raw.w), h = number(raw.h);
    if (w < 1 || h < 1) return null;
    const text = typeof raw.text === "string" ? raw.text.slice(0, 4000) : "";
    if (raw.kind === "text" && !text.trim()) return null;
    return {
      kind: raw.kind,
      parent: Number.isInteger(raw.parent) && raw.parent >= 0 && raw.parent < index ? raw.parent : -1,
      x, y, w, h, text,
      name: typeof raw.name === "string" ? raw.name.slice(0, LIMITS.nameLength) : "",
      label: typeof raw.label === "string" ? raw.label.slice(0, 80) : "",
      clip: raw.clip === true,
      painted: raw.painted === true,
      image: raw.image === true,
      gradient: raw.gradient === true,
      link: raw.link === true,
      radius: clamp(number(raw.radius), 0, 2000),
      borderWidth: clamp(number(raw.borderWidth), 0, 12),
      borderColor: typeof raw.borderColor === "string" ? raw.borderColor : "",
      shadow: typeof raw.shadow === "string" ? raw.shadow : "",
      background: typeof raw.background === "string" ? raw.background : "",
      color: typeof raw.color === "string" ? raw.color : "",
      avatar: raw.avatar === true,
      icon: raw.icon === true,
      font: raw.font && typeof raw.font === "object" ? raw.font : null
    };
  }

  function normalizeFont(font) {
    if (!font) return null;
    const size = clamp(number(font.size, 14), 9, 120);
    const weightNumber = number(font.weight, 400);
    const weight = clamp(Math.round(weightNumber / 100) * 100, 300, 800);
    const lineHeight = clamp(number(font.lineHeight, size * 1.4), size * 0.8, size * 4);
    return {
      size, weight, lineHeight,
      family: typeof font.family === "string" && font.family.trim() ? font.family.trim().slice(0, 200) : NEUTRAL_FONT,
      align: ["left", "right", "center", "justify", "start", "end"].includes(font.align) ? font.align : "left",
      transform: ["none", "uppercase", "lowercase", "capitalize"].includes(font.transform) ? font.transform : "none",
      style: font.style === "italic" || font.style === "oblique" ? "italic" : "normal",
      decoration: typeof font.decoration === "string" && /underline|line-through/.test(font.decoration) ? font.decoration : "none",
      spacing: clamp(number(font.spacing, 0), -2, 20)
    };
  }

  function hash(text) {
    let value = 2166136261;
    for (let index = 0; index < text.length; index++) {
      value ^= text.charCodeAt(index);
      value = Math.imul(value, 16777619);
    }
    return Math.abs(value);
  }

  function makeBlock(props = {}) {
    return {
      x: 0, y: 0, w: 0, h: 0, name: "Layer",
      fill: null, stroke: null, radius: 0, shadow: null, clip: false,
      text: null, bars: null, marks: null, label: null,
      children: [],
      ...props
    };
  }

  function makeBars(node, font, backdrop) {
    const size = font ? font.size : 14;
    const lineHeight = font ? font.lineHeight : size * 1.4;
    const lines = clamp(Math.round(node.h / lineHeight) || 1, 1, LIMITS.lines);
    const height = round(clamp(size * 0.52, 4, 26));
    const tone = barTone(size, backdrop);
    const seed = hash(node.text || node.name || "text");
    const ratios = [1, 0.96, 0.9, 0.84];
    const bars = [];
    for (let index = 0; index < lines; index++) {
      const ratio = index === lines - 1 && lines > 1
        ? 0.42 + ((seed + index * 37) % 28) / 100
        : ratios[(seed + index) % ratios.length];
      bars.push({
        x: 0,
        y: round(index * lineHeight + (lineHeight - height) / 2),
        w: Math.max(2, round(node.w * ratio)),
        h: height,
        color: tone
      });
    }
    return bars;
  }

  function buildPlan(page, options = {}) {
    const settings = normalizeOptions(options);
    const level = settings.level;
    const { area, viewport } = validatePage(page);
    const stats = { blocks: 0, textLayers: 0, placeholders: 0, bars: 0, skipped: 0, truncated: false };
    const names = new Map();
    const limit = Math.min(page.nodes.length, LIMITS.blocks * 2);

    // The board itself is always paper white: every other tone in the plan is a
    // grey that was chosen against it, so a page background cannot tint it.
    const rootEntry = {
      block: makeBlock({ x: 0, y: 0, w: area.width, h: area.height, name: "Wireframe", fill: PAPER, clip: true }),
      abs: { x: 0, y: 0, w: area.width, h: area.height }
    };
    const entries = [];
    let textBudget = LIMITS.textBlocks;

    const uniqueName = base => {
      const clean = (base || "Layer").replace(/\s+/g, " ").trim().slice(0, LIMITS.nameLength) || "Layer";
      const count = (names.get(clean) || 0) + 1;
      names.set(clean, count);
      return count === 1 ? clean : `${clean} ${count}`;
    };

    // Dropped nodes never become layers, so children attach to the nearest
    // ancestor that survived (or to the board itself).
    const parentFor = index => {
      const seen = new Set();
      let cursor = index;
      while (cursor >= 0 && cursor < limit && !seen.has(cursor)) {
        seen.add(cursor);
        const entry = entries[cursor];
        if (entry) return entry;
        const parent = page.nodes[cursor]?.parent;
        cursor = Number.isInteger(parent) ? parent : -1;
      }
      return rootEntry;
    };

    for (let index = 0; index < limit; index++) {
      const node = sanitizeNode(page.nodes[index], index);
      if (!node) { stats.skipped++; continue; }
      if (node.x + node.w <= 0 || node.y + node.h <= 0 || node.x >= area.width || node.y >= area.height) { stats.skipped++; continue; }
      if (stats.blocks >= LIMITS.blocks || (node.kind === "text" && textBudget <= 0)) { stats.truncated = true; stats.skipped++; continue; }

      const parent = parentFor(node.parent);
      // Content that cannot be seen inside a clipping parent must not become a
      // layer that floats outside it.
      if (parent.block.clip && (node.x + node.w <= parent.abs.x || node.y + node.h <= parent.abs.y ||
        node.x >= parent.abs.x + parent.abs.w || node.y >= parent.abs.y + parent.abs.h)) {
        stats.skipped++; continue;
      }

      const font = normalizeFont(node.font);
      const backdrop = parent.block.fill || PAPER;
      const block = makeBlock({
        x: round(node.x - parent.abs.x),
        y: round(node.y - parent.abs.y),
        w: Math.max(1, round(node.w)),
        h: Math.max(1, round(node.h)),
        name: uniqueName(node.name),
        clip: node.clip
      });

      if (node.kind === "text") {
        stats.textLayers++; textBudget--;
        if (level === "low") {
          block.bars = makeBars(node, font, backdrop);
          stats.bars += block.bars.length;
        } else {
          block.text = {
            value: node.text,
            color: textTone(parseColor(node.color), backdrop, level),
            family: level === "high" ? (font?.family || NEUTRAL_FONT) : NEUTRAL_FONT,
            size: font?.size || 14,
            weight: font?.weight || 400,
            lineHeight: font?.lineHeight || 20,
            align: font?.align || "left",
            transform: font?.transform || "none",
            style: font?.style || "normal",
            decoration: node.link && (font?.decoration || "none") === "none" ? "underline" : (font?.decoration || "none"),
            spacing: level === "high" ? (font?.spacing || 0) : 0
          };
        }
      } else if (node.kind === "media") {
        stats.placeholders++;
        block.fill = node.avatar ? "#dedede" : (level === "low" ? "#ededed" : "#efefef");
        block.radius = node.avatar ? 9999 : clamp(node.radius, 0, level === "low" ? 0 : 24);
        if (level !== "low" && !node.avatar && !node.icon) block.marks = "plus";
        // Only places big enough to read a label get one; icons stay shapes.
        if (level !== "low" && !node.avatar && !node.icon && block.w >= 64 && block.h >= 28) {
          block.label = node.label || "Image";
        }
      } else if (node.kind === "rule") {
        block.fill = level === "low" ? "#c9c9c9" : "#d5d5d5";
        block.h = Math.max(1, block.h);
        block.name = uniqueName("Divider");
      } else {
        const painted = node.painted || node.image || node.gradient || node.borderWidth > 0;
        block.fill = fillTone(parseColor(node.background), level);
        // A gradient cannot be reproduced as a flat tone, but the fact that the
        // section had a surface should survive as the lightest grey.
        if (!block.fill && node.gradient && level !== "low") block.fill = "#f3f3f3";
        if (node.image) block.image = true;
        if (level === "low") {
          block.fill = block.fill ? "#f2f2f2" : null;
          block.stroke = painted || node.kind === "control" || node.kind === "field"
            ? { color: node.kind === "field" ? "#a8a8a8" : node.kind === "control" ? "#9e9e9e" : "#cfcfcf", width: 1 }
            : null;
          block.radius = 0;
        } else if (level === "medium") {
          block.stroke = painted || node.kind === "control" || node.kind === "field"
            ? { color: node.kind === "field" ? "#b7b7b7" : "#d2d2d2", width: 1 }
            : null;
          block.radius = clamp(node.radius, 0, 6);
        } else {
          const width = clamp(node.borderWidth, 0, 3);
          block.stroke = width > 0
            ? { color: borderTone(node.borderColor, "#cfcfcf"), width }
            : (painted || node.kind === "control" || node.kind === "field" ? { color: "#d0d0d0", width: 1 } : null);
          block.radius = clamp(node.radius, 0, 64);
          block.shadow = shadowTone(node.shadow);
        }
        if (node.image && level !== "low") block.marks = "plus";
      }

      stats.blocks++;
      const entry = { block, abs: { x: node.x, y: node.y, w: node.w, h: node.h } };
      entries[index] = entry;
      parent.block.children.push(block);
    }

    return {
      level,
      spec: LEVELS.find(entry => entry.id === level),
      width: area.width,
      height: area.height,
      viewport,
      title: typeof page.title === "string" ? page.title : "",
      url: typeof page.url === "string" ? page.url : "",
      root: rootEntry.block,
      stats
    };
  }

  function summarize(plan) {
    if (!plan) return { blocks: 0, textLayers: 0, placeholders: 0, bars: 0 };
    const total = plan.stats.blocks;
    return {
      blocks: total,
      textLayers: plan.stats.textLayers,
      placeholders: plan.stats.placeholders,
      bars: plan.stats.bars,
      truncated: plan.stats.truncated === true,
      level: plan.level,
      width: plan.width,
      height: plan.height
    };
  }

  globalThis.PageCaptureWireframeCore = Object.freeze({
    LEVELS, LIMITS, NEUTRAL_FONT,
    normalizeOptions, validatePage, buildPlan, summarize,
    parseColor, luminance, contrast, fillTone, textTone, grayHex, normalizeFont
  });
})();
