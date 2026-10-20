/* Pure, local design-token extraction/export helpers. No DOM or network access. */
(() => {
  "use strict";
  if (globalThis.PageCaptureDesignSystemCore) return;
  const categories = Object.freeze([
    { id: "colors", label: "Colors", prefix: "color", type: "color" },
    { id: "typography", label: "Typography", prefix: "type", type: "typography" },
    { id: "spacing", label: "Spacing", prefix: "space", type: "dimension" },
    { id: "radii", label: "Radii", prefix: "radius", type: "dimension" },
    { id: "shadows", label: "Shadows", prefix: "shadow", type: "shadow" },
    { id: "borders", label: "Borders", prefix: "border", type: "border" }
  ]);
  const colorProperties = ["color", "backgroundColor", "borderTopColor", "borderRightColor", "borderBottomColor", "borderLeftColor", "outlineColor", "textDecorationColor", "fill", "stroke"];
  const spaceProperties = ["marginTop", "marginRight", "marginBottom", "marginLeft", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "rowGap", "columnGap"];
  const radiusProperties = ["borderTopLeftRadius", "borderTopRightRadius", "borderBottomRightRadius", "borderBottomLeftRadius"];
  const typeProperties = ["fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "fontStyle"];
  const safeValue = value => typeof value === "string" && value.length <= 2048 && !/[;{}<>\u0000-\u001f]/.test(value) && !/url\s*\(|expression\s*\(|@import/i.test(value);
  const tidy = value => String(value ?? "").trim().replace(/\s+/g, " ");
  const slug = value => String(value).toLowerCase().replace(/^--/, "").replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 56);
  const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

  function normalizeColor(input) {
    const value = tidy(input).toLowerCase();
    if (!safeValue(value) || ["none", "transparent", "currentcolor", "inherit", "initial"].includes(value)) return null;
    const hex = value.match(/^#([a-f0-9]{3,8})$/);
    if (hex) {
      let code = hex[1];
      if (code.length === 3 || code.length === 4) code = [...code].map(char => char + char).join("");
      if (![6, 8].includes(code.length) || code.endsWith("00") && code.length === 8) return null;
      return code.length === 8 && code.endsWith("ff") ? `#${code.slice(0, 6)}` : `#${code}`;
    }
    const rgb = value.match(/^rgba?\(([^)]+)\)$/);
    if (rgb) {
      const parts = rgb[1].split(/[\s,\/]+/).filter(Boolean);
      if (parts.length < 3 || parts.length > 4) return null;
      const channels = parts.slice(0, 3).map(part => part.endsWith("%") ? parseFloat(part) * 2.55 : Number(part));
      const alpha = parts[3] == null ? 1 : parts[3].endsWith("%") ? parseFloat(parts[3]) / 100 : Number(parts[3]);
      if (![...channels, alpha].every(Number.isFinite) || alpha <= 0) return null;
      const byte = number => Math.max(0, Math.min(255, Math.round(number))).toString(16).padStart(2, "0");
      return `#${channels.map(byte).join("")}${alpha < 1 ? byte(alpha * 255) : ""}`;
    }
    // Modern color functions remain exact rather than being guessed or rounded.
    if (/^(?:hsl|hsla|lab|lch|oklab|oklch|color|color-mix)\(/.test(value)) return value;
    return null;
  }

  // Review calculations intentionally support only explicit sRGB colors.
  // Other color spaces remain intact in tokens rather than being approximated.
  function parseSrgb(input) {
    const value = tidy(input).toLowerCase();
    if (!safeValue(value)) return null;
    if (value === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
    const hex = value.match(/^#([a-f0-9]{3}|[a-f0-9]{4}|[a-f0-9]{6}|[a-f0-9]{8})$/);
    if (hex) {
      let code = hex[1];
      if (code.length < 5) code = [...code].map(char => char + char).join("");
      return { r: parseInt(code.slice(0, 2), 16) / 255, g: parseInt(code.slice(2, 4), 16) / 255,
        b: parseInt(code.slice(4, 6), 16) / 255, a: code.length === 8 ? parseInt(code.slice(6, 8), 16) / 255 : 1 };
    }
    const rgb = value.match(/^rgba?\(([^)]+)\)$/);
    if (!rgb) return null;
    const body = rgb[1].trim();
    let parts;
    if (body.includes(",")) {
      if (body.includes("/")) return null;
      parts = body.split(",").map(part => part.trim());
    } else {
      const sections = body.split("/");
      if (sections.length > 2) return null;
      parts = sections[0].trim().split(/\s+/);
      if (parts.length !== 3) return null;
      if (sections.length === 2) parts.push(sections[1].trim());
    }
    if (parts.length < 3 || parts.length > 4 || parts.some(part => !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)%?$/.test(part))) return null;
    const clamp = number => Math.max(0, Math.min(1, number));
    const channels = parts.slice(0, 3).map(part => clamp(parseFloat(part) / (part.endsWith("%") ? 100 : 255)));
    const alpha = parts[3] == null ? 1 : clamp(parseFloat(parts[3]) / (parts[3].endsWith("%") ? 100 : 1));
    if (![...channels, alpha].every(Number.isFinite)) return null;
    return { r: channels[0], g: channels[1], b: channels[2], a: alpha };
  }
  const linearChannel = value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  const luminanceOf = color => .2126 * linearChannel(color.r) + .7152 * linearChannel(color.g) + .0722 * linearChannel(color.b);
  function colorLuminance(value) {
    const color = parseSrgb(value);
    return color && color.a === 1 ? luminanceOf(color) : null;
  }
  function colorContrast(foreground, background) {
    const fg = parseSrgb(foreground), bg = parseSrgb(background);
    // A translucent background has no unique contrast without its underlay.
    if (!fg || !bg || bg.a !== 1) return null;
    const composite = { r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a) };
    const first = luminanceOf(composite), second = luminanceOf(bg);
    const ratio = (Math.max(first, second) + .05) / (Math.min(first, second) + .05);
    return { ratio, aaNormal: ratio >= 4.5, aaLarge: ratio >= 3, aaaNormal: ratio >= 7, aaaLarge: ratio >= 4.5, foregroundAlpha: fg.a };
  }
  function oklab(color) {
    const r = linearChannel(color.r), g = linearChannel(color.g), b = linearChannel(color.b);
    const l = Math.cbrt(.4122214708 * r + .5363325363 * g + .0514459929 * b);
    const m = Math.cbrt(.2119034982 * r + .6806995451 * g + .1073969566 * b);
    const s = Math.cbrt(.0883024619 * r + .2817188376 * g + .6299787005 * b);
    return [.2104542553 * l + .793617785 * m - .0040720468 * s, 1.9779984951 * l - 2.428592205 * m + .4505937099 * s,
      .0259040371 * l + .7827717662 * m - .808675766 * s];
  }
  function nearColor(first, second) {
    const a = parseSrgb(first), b = parseSrgb(second);
    if (!a || !b || Math.abs(a.a - b.a) > .025) return null;
    const left = oklab(a), right = oklab(b);
    const distance = Math.hypot(...left.map((value, index) => value - right[index]));
    return distance <= .03 ? Math.max(distance / .03, Math.abs(a.a - b.a) / .025) : null;
  }
  function nearDimension(first, second, absolute = 2, relative = .15) {
    if (first === second) return 0;
    const pattern = /^(-?\d+(?:\.\d+)?)(px|%)$/;
    const a = String(first).match(pattern), b = String(second).match(pattern);
    if (!a || !b || a[2] !== b[2]) return null;
    const left = Number(a[1]), right = Number(b[1]), difference = Math.abs(left - right);
    if (Math.sign(left) !== Math.sign(right)) return null;
    const limit = a[2] === "%" ? Math.min(absolute, 1) : absolute;
    const proportion = difference / Math.max(Math.abs(left), Math.abs(right), 1);
    return difference <= limit && proportion <= relative ? Math.max(difference / limit, proportion / relative) : null;
  }
  function shadowParts(value) {
    const colors = [];
    const geometry = tidy(value).replace(/\brgba?\([^)]*\)|#[a-f0-9]{3,8}\b/gi, match => { colors.push(match); return "__color__"; });
    return colors.length && colors.every(color => parseSrgb(color)) ? { colors, geometry } : null;
  }
  function similarScore(category, a, b) {
    if (JSON.stringify(a) === JSON.stringify(b)) return null;
    if (category === "colors") {
      const score = nearColor(a, b); return score == null ? null : { score, reason: "Close sRGB colors and opacity" };
    }
    if (category === "spacing" || category === "radii") {
      const left = tidy(a).split(" "), right = tidy(b).split(" ");
      if (left.length !== right.length) return null;
      const scores = left.map((value, index) => nearDimension(value, right[index]));
      return scores.some(score => score == null) ? null : { score: Math.max(...scores), reason: "Small difference; matching units and direction" };
    }
    if (category === "typography") {
      if (["fontFamily", "fontWeight", "fontStyle", "letterSpacing"].some(key => tidy(a[key]).toLowerCase() !== tidy(b[key]).toLowerCase())) return null;
      const size = nearDimension(a.fontSize, b.fontSize, 1, .08), line = nearDimension(a.lineHeight, b.lineHeight, 2, .1);
      return size == null || line == null ? null : { score: Math.max(size, line), reason: "Near text size / line height; other text styles match" };
    }
    if (category === "borders") {
      if (a.style !== b.style) return null;
      if (a.width === b.width) { const score = nearColor(a.color, b.color); return score == null ? null : { score, reason: "Same width and style; close border colors" }; }
      if (a.color !== b.color) return null;
      const score = nearDimension(a.width, b.width, .5, .2);
      return score == null ? null : { score, reason: "Same color and style; close border widths" };
    }
    if (category === "shadows") {
      const left = shadowParts(a), right = shadowParts(b);
      if (!left || !right || left.geometry !== right.geometry || left.colors.length !== right.colors.length) return null;
      const scores = left.colors.map((color, index) => nearColor(color, right.colors[index]));
      return scores.some(score => score == null) ? null : { score: Math.max(...scores), reason: "Same geometry; close shadow colors and opacity" };
    }
    return null;
  }
  function suggestSimilar(system, category, limit = 12) {
    const maximum = Math.min(20, Math.max(0, Math.floor(Number(limit) || 0)));
    if (!maximum || !categories.some(item => item.id === category)) return [];
    const tokens = system.tokens.filter(token => token.included && token.category === category).slice(0, 80);
    const pairs = [];
    for (let first = 0; first < tokens.length; first++) for (let second = first + 1; second < tokens.length; second++) {
      const result = similarScore(category, tokens[first].value, tokens[second].value);
      if (result) pairs.push({ ids: [tokens[first].id, tokens[second].id], score: result.score, reason: result.reason });
    }
    return pairs.sort((a, b) => a.score - b.score || a.ids.join(" ").localeCompare(b.ids.join(" "))).slice(0, maximum);
  }
  function typographyPreview(value) {
    const measured = parseFloat(value.fontSize), tracking = parseFloat(value.letterSpacing);
    const observed = Number.isFinite(measured) ? Math.max(1, measured) : 16;
    const size = Math.max(10, Math.min(48, observed)), scale = size / observed;
    const line = parseFloat(value.lineHeight), spacing = Number.isFinite(tracking) ? tracking : 0;
    const weight = Number(value.fontWeight);
    return { fontSize: `${Number(size.toFixed(2))}px`, lineHeight: String(Number((Number.isFinite(line) ? Math.max(.9, Math.min(1.8, line / observed)) : 1.4).toFixed(3))),
      fontWeight: String(Number.isFinite(weight) ? Math.max(1, Math.min(1000, weight)) : 400),
      fontStyle: /^(?:normal|italic|oblique(?: -?\d+(?:\.\d+)?deg)?)$/.test(value.fontStyle) ? value.fontStyle : "normal",
      letterSpacing: `${Number(Math.max(-2, Math.min(4, spacing * scale)).toFixed(2))}px` };
  }

  function dimension(value, max = 10000) {
    const text = tidy(value);
    const match = text.match(/^(-?\d+(?:\.\d+)?)px$/);
    if (!match) return null;
    const number = Number(match[1]);
    return number && Math.abs(number) <= max ? `${number}px` : null;
  }
  function sourceUrl(value) {
    try {
      const url = new URL(value);
      if (url.protocol === "file:") return `file:///${url.pathname.split("/").pop()}`;
      if (!["http:", "https:"].includes(url.protocol)) return "";
      return `${url.origin}${url.pathname}`;
    } catch { return ""; }
  }
  function aliasFor(category, value, variables) {
    if (category === "typography") return [];
    const hints = { spacing: /space|spacing|gap|padding|margin/i, radii: /radius|round/i, shadows: /shadow|elevation/i, borders: /border|stroke/i };
    return variables.filter(variable => {
      if (!/^--[a-zA-Z][a-zA-Z0-9_-]{0,80}$/.test(variable.name)) return false;
      if (category === "colors") return normalizeColor(variable.value) === value;
      const target = category === "borders" ? `${value.width} ${value.style} ${value.color}` : value;
      let candidate = tidy(variable.value);
      if (category === "borders") {
        const parts = candidate.match(/^(\S+) (\S+) (.+)$/);
        if (parts) candidate = `${parts[1]} ${parts[2]} ${normalizeColor(parts[3]) || parts[3]}`;
      }
      return category !== "typography" && hints[category]?.test(variable.name) && candidate === target;
    }).map(variable => variable.name).sort((a, b) => a.length - b.length || a.localeCompare(b));
  }

  function buildSystem(records, metadata = {}) {
    const buckets = Object.fromEntries(categories.map(category => [category.id, new Map()]));
    const variables = metadata.variables || [];
    function add(category, value, property) {
      if (value == null) return;
      const key = JSON.stringify(value);
      let token = buckets[category].get(key);
      if (!token) {
        token = { category, value, count: 0, properties: [], included: true };
        buckets[category].set(key, token);
      }
      token.count++;
      if (!token.properties.includes(property)) token.properties.push(property);
    }
    for (const record of records) {
      const styles = record.styles;
      for (const property of colorProperties) {
        if (property.startsWith("border")) {
          const side = property.slice(6, -5);
          if (parseFloat(styles[`border${side}Width`]) === 0 || ["none", "hidden"].includes(styles[`border${side}Style`])) continue;
        }
        if (property === "outlineColor" && (!parseFloat(styles.outlineWidth) || ["none", "hidden"].includes(styles.outlineStyle))) continue;
        if (property === "textDecorationColor" && (!styles.textDecorationLine || styles.textDecorationLine === "none")) continue;
        add("colors", normalizeColor(styles[property]), property);
      }
      for (const property of spaceProperties) add("spacing", dimension(styles[property], 512), property);
      for (const property of radiusProperties) {
        const value = tidy(styles[property]);
        if (/^\d+(?:\.\d+)?(?:px|%)(?: \d+(?:\.\d+)?(?:px|%))?$/.test(value) && value.split(" ").some(part => parseFloat(part) > 0) && value.split(" ").every(part => parseFloat(part) <= 10000)) add("radii", value, property);
      }
      if (safeValue(styles.boxShadow) && !["", "none"].includes(tidy(styles.boxShadow))) add("shadows", tidy(styles.boxShadow), "boxShadow");
      for (const side of ["Top", "Right", "Bottom", "Left"]) {
        const width = dimension(styles[`border${side}Width`]);
        const style = styles[`border${side}Style`];
        const color = normalizeColor(styles[`border${side}Color`]);
        if (width && color && /^(solid|dashed|dotted|double|groove|ridge|inset|outset)$/.test(style)) add("borders", { width, style, color }, `border${side}`);
      }
      if (record.hasText && typeProperties.every(property => safeValue(styles[property]))) {
        add("typography", Object.fromEntries(typeProperties.map(property => [property, tidy(styles[property])])), "text");
      }
    }
    const usedNames = new Set();
    const tokens = [];
    const warnings = [...(metadata.warnings || [])];
    for (const category of categories) {
      let entries = [...buckets[category.id].values()].sort((a, b) => b.count - a.count || JSON.stringify(a.value).localeCompare(JSON.stringify(b.value)));
      if (entries.length > 80) warnings.push(`${category.label}: showing the 80 most frequently observed values.`);
      entries = entries.slice(0, 80);
      for (let index = 0; index < entries.length; index++) {
        const token = entries[index];
        // Resolve aliases only after the category cap, keeping work bounded
        // even when a page contains thousands of one-off computed values.
        token.aliases = aliasFor(category.id, token.value, variables);
        const preferred = token.aliases.length ? slug(token.aliases[0]) : `${category.prefix}-${String(index + 1).padStart(2, "0")}`;
        const base = /^[a-z]/.test(preferred) ? preferred : `${category.prefix}-${preferred}`;
        let name = base, counter = 2;
        while (usedNames.has(name)) name = `${base}-${counter++}`;
        usedNames.add(name);
        tokens.push({ ...token, id: `${category.id}-${index + 1}`, name, nameOrigin: token.aliases.length ? "css-variable-reference" : "suggested",
          observations: [{ value: token.value, count: token.count, properties: [...token.properties], cssVariables: [...token.aliases] }] });
      }
    }
    return { schemaVersion: 1, source: { title: String(metadata.title || "Website design system"), url: sourceUrl(metadata.url),
      viewport: metadata.viewport || {}, scope: metadata.scope || "rendered", analyzedAt: metadata.analyzedAt || new Date().toISOString(),
      elements: records.length, truncated: !!metadata.truncated }, warnings, tokens };
  }

  function cssEntries(token) {
    if (token.category === "typography") return typeProperties.map(property => [
      `--${token.name}-${property.replace(/[A-Z]/g, char => `-${char.toLowerCase()}`)}`, token.value[property]
    ]);
    return [[`--${token.name}`, valueText(token)]];
  }
  function validate(system) {
    const errors = [];
    const names = new Set(), tokenNames = new Set();
    for (const token of system.tokens.filter(token => token.included)) {
      if (!/^[a-z][a-z0-9-]{0,63}$/.test(token.name)) {
        errors.push(`${token.name || "Empty token name"}: use lowercase letters, numbers and hyphens; begin with a letter.`);
        continue;
      }
      if (tokenNames.has(token.name)) errors.push(`Duplicate token name: ${token.name}`);
      tokenNames.add(token.name);
      for (const [name] of cssEntries(token)) {
        if (names.has(name)) errors.push(`Duplicate exported variable: ${name}`);
        names.add(name);
      }
    }
    if (!system.tokens.some(token => token.included)) errors.push("Include at least one token to export.");
    return errors;
  }
  function valueText(token) {
    if (token.category === "typography") return `${token.value.fontSize} / ${token.value.lineHeight} · ${token.value.fontWeight} · ${token.value.fontFamily}`;
    if (token.category === "borders") return `${token.value.width} ${token.value.style} ${token.value.color}`;
    return String(token.value);
  }
  function mergeTokens(system, ids, keepId) {
    const selected = system.tokens.filter(token => ids.includes(token.id));
    const target = selected.find(token => token.id === keepId);
    if (selected.length < 2 || !target || selected.some(token => token.category !== target.category)) throw new Error("Select at least two tokens in the same category.");
    const clone = JSON.parse(JSON.stringify(system));
    const keep = clone.tokens.find(token => token.id === keepId);
    const merged = clone.tokens.filter(token => ids.includes(token.id));
    keep.count = merged.reduce((sum, token) => sum + token.count, 0);
    keep.properties = [...new Set(merged.flatMap(token => token.properties))];
    keep.aliases = [...new Set(merged.flatMap(token => token.aliases))];
    keep.observations = merged.flatMap(token => token.observations);
    keep.included = true;
    keep.merged = true;
    clone.tokens = clone.tokens.filter(token => !ids.includes(token.id) || token.id === keepId);
    return clone;
  }
  function requireValid(system) {
    const errors = validate(system);
    if (errors.length) throw new Error(errors[0]);
  }
  function toJson(system) {
    requireValid(system);
    const output = { schemaVersion: 1, generator: "Page Capture — local design-system starter", source: system.source,
      notes: ["Values were observed at one viewport, not reconstructed from an original design system.", "Names without CSS-variable evidence are suggestions. Font files are not embedded."],
      warnings: system.warnings, tokens: Object.create(null) };
    for (const category of categories) {
      const group = Object.create(null);
      for (const token of system.tokens.filter(token => token.included && token.category === category.id)) {
        group[token.name] = { $type: category.type, $value: token.value,
          $extensions: { pageCapture: { uses: token.count, cssVariables: token.aliases, nameOrigin: token.nameOrigin || (token.aliases.length ? "css-variable-reference" : "suggested"), merged: !!token.merged, observations: token.observations } } };
      }
      if (Object.keys(group).length) output.tokens[category.id] = group;
    }
    return JSON.stringify(output, null, 2) + "\n";
  }
  function toCss(system) {
    requireValid(system);
    const lines = ["/* Page Capture — observed website tokens. Review before use.", " * Typography tokens expand into individual CSS properties.", " * No font files or remote resources are included. */", ":root {"];
    for (const category of categories) {
      const tokens = system.tokens.filter(token => token.included && token.category === category.id);
      if (!tokens.length) continue;
      lines.push(`  /* ${category.label} */`);
      for (const token of tokens) for (const [name, value] of cssEntries(token)) lines.push(`  ${name}: ${value};`);
    }
    lines.push("}", "");
    return lines.join("\n");
  }
  function toHtml(system) {
    requireValid(system);
    const included = system.tokens.filter(token => token.included);
    const preview = token => {
      if (token.category === "colors") return `<div class="sample swatch"><span style="background:${escapeHtml(token.value)}"></span></div>`;
      if (token.category === "spacing") return `<div class="sample"><i style="width:${Math.min(96, Math.abs(parseFloat(token.value)))}px"></i></div>`;
      if (token.category === "radii") return `<div class="sample"><b style="border-radius:${escapeHtml(token.value)}"></b></div>`;
      if (token.category === "shadows") return `<div class="sample"><b style="box-shadow:${escapeHtml(token.value)}"></b></div>`;
      if (token.category === "borders") return `<div class="sample"><b style="border:${escapeHtml(valueText(token))}"></b></div>`;
      const specimen = Object.entries(typographyPreview(token.value)).map(([property, value]) => `${property.replace(/[A-Z]/g, char => `-${char.toLowerCase()}`)}:${value}`).join(";");
      return `<div class="sample type" style="${escapeHtml(specimen)}">Aa 123</div>`;
    };
    const sections = categories.map(category => {
      const tokens = included.filter(token => token.category === category.id);
      return tokens.length ? `<section><h2>${category.label} <small>${tokens.length}</small></h2><div class="grid">${tokens.map(token => `<article>${preview(token)}<h3>${escapeHtml(token.name)}</h3><code>${escapeHtml(valueText(token))}</code><p>${token.count} uses · ${token.nameOrigin === "user" ? "User-supplied name" : token.aliases.length ? "CSS-variable evidence" : "Suggested name"}${token.merged ? " · Merged" : ""}</p></article>`).join("")}</div></section>` : "";
    }).join("");
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><title>${escapeHtml(system.source.title)} — Design system</title><style>
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#202020;color:rgba(255,255,255,.9);font:13px/1.5 system-ui,sans-serif}main{max-width:1120px;margin:auto;padding:40px 24px}header{border:1px solid #444;border-radius:13px;background:#2c2c2c;padding:24px}h1{font-size:24px;margin:8px 0}p,code,small{color:#aaa}header span{color:#0d99ff;font-size:11px;letter-spacing:.08em}h2{font-size:16px;margin:32px 0 16px}small{font-size:12px;font-weight:400}h3{font-size:13px;overflow-wrap:anywhere}code{font-size:12px;white-space:normal;overflow-wrap:anywhere}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}article{padding:16px;border:1px solid #444;border-radius:8px;background:#2c2c2c}.sample{height:64px;border:1px solid #555;border-radius:5px;display:flex;align-items:center;justify-content:center;background:#303030}.swatch{position:relative;overflow:hidden;background-color:#fff;background-image:conic-gradient(#ccc 25%,#fff 0 50%,#ccc 0 75%,#fff 0);background-size:12px 12px;background-clip:padding-box}.swatch>span{position:absolute;inset:0}.sample b{display:block;width:40px;height:32px;background:#777}.sample i{display:block;height:12px;background:#0d99ff;min-width:2px}.type{font-size:28px;color:#eee;font-family:system-ui,sans-serif;overflow:hidden}footer{margin-top:32px;color:#999}.source{overflow-wrap:anywhere}
</style></head><body><main><header><span>PAGE CAPTURE / LOCAL EXPORT</span><h1>${escapeHtml(system.source.title)}</h1><p class="source">${escapeHtml(system.source.url)}</p><p>${included.length} tokens · ${Number(system.source.viewport.width) || 0}px viewport · ${system.source.elements} rendered elements</p><p>Observed styles, not a reconstructed original design system. Review names and roles. Typography previews use scaled system-font specimens; observed values are listed, and font files are not embedded.</p></header>${sections}<footer>Created locally. No scripts, external stylesheets, images, or font downloads. ${system.warnings.map(escapeHtml).join(" ")}</footer></main></body></html>\n`;
  }
  globalThis.PageCaptureDesignSystemCore = Object.freeze({ categories, colorProperties, spaceProperties, radiusProperties, typeProperties,
    safeValue, normalizeColor, parseSrgb, colorLuminance, colorContrast, suggestSimilar, typographyPreview, sourceUrl, slug, buildSystem, valueText, cssEntries, validate, mergeTokens, toJson, toCss, toHtml });
})();
