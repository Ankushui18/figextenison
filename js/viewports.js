/* Responsive copies of the current DOM. No tab/window creation or URL navigation. */
(() => {
  "use strict";
  if (globalThis.PageCaptureViewports) return;
  const LIMITS = Object.freeze({ minWidth: 200, maxWidth: 3840, maxHeight: 4000, nodes: 50000, cssBytes: 5 * 1024 * 1024, timeout: 20000 });

  function dimensions(width, height) {
    width = Math.round(Number(width)); height = Math.round(Number(height));
    if (!Number.isFinite(width) || width < LIMITS.minWidth || width > LIMITS.maxWidth || !Number.isFinite(height) || height < 200 || height > LIMITS.maxHeight) {
      throw new Error("Invalid responsive capture size.");
    }
    return { width, height };
  }
  function assetUrl(value, base) {
    if (!value || value.startsWith("#")) return value;
    try {
      const url = new URL(value, base).href;
      return globalThis.PageCapturePrivacy?.isAllowedAssetUrl(url, base) ? url : "data:,";
    } catch { return "data:,"; }
  }
  const unescapeCss = value => value.replace(/\\([0-9a-f]{1,6})\s?|\\(.)/gi, (_, hex, char) => hex ? String.fromCodePoint(Math.min(parseInt(hex, 16) || 65533, 1114111)) : char);
  function cssUrls(text, base) {
    const quote = value => JSON.stringify(assetUrl(unescapeCss(value.trim()), base));
    return text.replace(/url\(\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|((?:\\.|[^)\\])*))\s*\)/gi, (_, a, b, c) => `url(${quote(a ?? b ?? c)})`)
      .replace(/(@import\s+)(["'])((?:\\.|[^"'\\])*)\2/gi, (_, prefix, _quote, value) => prefix + quote(value));
  }
  function srcsetUrls(text, base) {
    const candidates = []; let index = 0;
    while (index < text.length) {
      while (/[\s,]/.test(text[index] || "") && index < text.length) index++;
      if (index >= text.length) break;
      let url = "";
      while (index < text.length && !/\s/.test(text[index])) url += text[index++];
      if (url.endsWith(",")) { candidates.push(assetUrl(url.replace(/,+$/, ""), base)); continue; }
      let descriptor = "", parentheses = 0;
      while (index < text.length) {
        const char = text[index++];
        if (char === "," && parentheses === 0) break;
        if (char === "(") parentheses++; if (char === ")") parentheses--;
        descriptor += char;
      }
      candidates.push(assetUrl(url, base) + (descriptor.trim() ? " " + descriptor.trim() : ""));
    }
    return candidates.join(", ");
  }
  function readSheet(sheet, base, seen = new Set()) {
    if (seen.has(sheet)) return { css: "", complete: true };
    seen.add(sheet);
    let css = "", complete = true;
    try {
      for (const rule of sheet.cssRules) {
        if (rule.type === 3) {
          if (!rule.styleSheet) { complete = false; continue; }
          const nested = readSheet(rule.styleSheet, rule.href || base, seen);
          complete &&= nested.complete;
          let text = nested.css;
          if (rule.media?.mediaText) text = `@media ${rule.media.mediaText}{${text}}`;
          if (rule.supportsText) text = `@supports (${rule.supportsText}){${text}}`;
          if (rule.layerName != null) text = `@layer ${rule.layerName}{${text}}`;
          css += text;
        } else css += cssUrls(rule.cssText, sheet.href || base) + "\n";
        if (css.length > LIMITS.cssBytes) throw new RangeError("Page styles are too large for responsive copying.");
      }
    } catch (error) {
      if (error instanceof RangeError) throw error;
      return { css: "", complete: false };
    }
    return { css, complete };
  }
  function activeSheetCss(sheet, css) {
    return sheet.media?.mediaText ? `@media ${sheet.media.mediaText}{${css}}` : css;
  }
  function wait(promise, signal) {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
      Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    });
  }
  async function settleLinks(links, view, signal) {
    await Promise.all(links.map(link => {
      if (link.disabled || !view.matchMedia(link.media || "all").matches || link.sheet) return;
      return wait(new Promise((resolve, reject) => {
        const cleanup = () => { link.removeEventListener("load", loaded); link.removeEventListener("error", failed); signal.removeEventListener("abort", cleanup); };
        const loaded = () => { cleanup(); resolve(); };
        const failed = () => { cleanup(); reject(new Error("A page stylesheet could not load in the responsive copy.")); };
        link.addEventListener("load", loaded, { once: true }); link.addEventListener("error", failed, { once: true }); signal.addEventListener("abort", cleanup, { once: true });
      }), signal);
    }));
  }

  function createCapturer(helpers) {
    if (![helpers?.capture, helpers?.serialize, helpers?.createId].every(fn => typeof fn === "function")) return null;
    return async function captureResponsive({ width, height, signal, mount, source = document } = {}) {
      ({ width, height } = dimensions(width, height));
      signal?.throwIfAborted();
      if (!source.documentElement || !source.body || !mount?.isConnected) throw new Error("The page or capture toolbar is no longer available.");
      const operation = new AbortController(), active = signal ? AbortSignal.any([signal, operation.signal]) : operation.signal;
      const timer = setTimeout(() => operation.abort(new DOMException("Responsive capture timed out. Try fewer viewport sizes or wait for the page to finish loading.", "TimeoutError")), LIMITS.timeout);
      let frame;
      const cleanup = () => frame?.remove();
      active.addEventListener("abort", cleanup, { once: true });
      try {
        // Import into an inert parent-realm document: no custom-element constructors
        // or scripts run, and the existing engine's instanceof Element checks work.
        let inspected = 0;
        const pending = [source.documentElement];
        while (pending.length) {
          const walker = source.createTreeWalker(pending.pop(), 0xFFFFFFFF);
          do {
            if (++inspected > LIMITS.nodes) throw new Error("This page is too large for responsive copying. Use Browser only.");
            if (walker.currentNode.nodeType === 1 && walker.currentNode.shadowRoot) pending.push(walker.currentNode.shadowRoot);
          } while (walker.nextNode());
        }
        const inert = source.implementation.createHTMLDocument("");
        const root = inert.importNode(source.documentElement, true), pairs = [], mapping = new Map(), scopes = [{ source, target: null }];
        function visit(original, copy) {
          active.throwIfAborted();
          if (pairs.length >= LIMITS.nodes) throw new Error("This page is too large for responsive copying. Use Browser only.");
          pairs.push([original, copy]); mapping.set(original, copy);
          const children = [...original.childNodes], copies = [...copy.childNodes];
          for (let index = 0; index < children.length; index++) visit(children[index], copies[index]);
          if (original.nodeType === 1 && original.shadowRoot) {
            const shadow = copy.shadowRoot || copy.attachShadow({ mode: "open" }); shadow.replaceChildren();
            scopes.push({ source: original.shadowRoot, target: shadow });
            for (const child of original.shadowRoot.childNodes) { const cloned = inert.importNode(child, true); shadow.append(cloned); visit(child, cloned); }
          }
        }
        visit(source.documentElement, root);
        const base = source.baseURI, styles = [], links = [];
        for (const [original, copy] of pairs) {
          if (copy.nodeType !== 1) continue;
          const tag = copy.localName.toLowerCase();
          if (original.getAttribute("data-h2d-ignore") === "true" || ["script", "noscript", "base"].includes(tag) || tag === "meta" && ["refresh", "content-security-policy", "content-security-policy-report-only"].includes((copy.getAttribute("http-equiv") || "").toLowerCase())) { copy.remove(); continue; }
          for (const attribute of [...copy.attributes]) if (/^on/i.test(attribute.name) || attribute.name === "autofocus") copy.removeAttribute(attribute.name);
          if (tag === "iframe" || tag === "frame" || tag === "embed" || tag === "object") {
            for (const attribute of ["src", "srcdoc", "data", "codebase"]) copy.removeAttribute(attribute);
            if (tag === "iframe") copy.setAttribute("sandbox", "");
          } else {
            for (const attribute of ["src", "poster", "background"]) if (copy.hasAttribute(attribute)) copy.setAttribute(attribute, assetUrl(copy.getAttribute(attribute), base));
          }
          if (tag === "link") {
            if (!copy.relList.contains("stylesheet")) { copy.remove(); continue; }
            copy.href = assetUrl(original.href, base); copy.disabled = original.disabled;
          }
          if (tag === "style" && original.nonce) copy.nonce = original.nonce;
          if (copy.hasAttribute("srcset")) copy.setAttribute("srcset", srcsetUrls(copy.getAttribute("srcset"), base));
          if (tag === "img") { copy.loading = "eager"; copy.decoding = "sync"; }
          if (tag === "video" || tag === "audio") { copy.removeAttribute("autoplay"); copy.removeAttribute("src"); for (const child of copy.querySelectorAll("source")) child.remove(); }
          if (tag === "source" && original.parentElement?.localName !== "picture") copy.remove();
          if (tag === "input") { copy.value = original.value; copy.checked = original.checked; copy.indeterminate = original.indeterminate; }
          if (tag === "textarea") copy.value = original.value;
          if (tag === "select") for (let i = 0; i < copy.options.length; i++) copy.options[i].selected = original.options[i].selected;
          if (tag === "canvas") { try { copy.getContext("2d")?.drawImage(original, 0, 0); } catch {} }
          if (copy.style?.cssText) copy.style.cssText = cssUrls(copy.style.cssText, base);
        }
        let cssBytes = 0;
        for (const scope of scopes) {
          const sheets = [...scope.source.styleSheets].map(sheet => ({ sheet, ...readSheet(sheet, base) }));
          const adopted = [...scope.source.adoptedStyleSheets].map(sheet => ({ sheet, ...readSheet(sheet, base) }));
          const owners = new Set(sheets.map(record => record.sheet.ownerNode));
          for (const original of scope.source.querySelectorAll("style,link[rel~=stylesheet]")) if (!owners.has(original)) {
            const copy = mapping.get(original); if (!copy) continue;
            if (copy.localName === "link") copy.removeAttribute("href"); else { copy.textContent = ""; copy.type = "text/plain"; }
          }
          const complete = [...sheets, ...adopted].every(record => record.complete);
          if (complete) {
            let css = "";
            for (const record of [...sheets, ...adopted]) {
              const owner = mapping.get(record.sheet.ownerNode);
              if (owner) { if (owner.localName === "link") owner.removeAttribute("href"); else { owner.textContent = ""; owner.type = "text/plain"; } }
              if (!record.sheet.disabled) css += activeSheetCss(record.sheet, record.css) + "\n";
            }
            if (css.length > LIMITS.cssBytes) throw new Error("Page styles are too large for responsive copying.");
            styles.push({ scope, css });
          } else {
            // Cross-origin sheets may be CSSOM-unreadable. Keep their ordinary
            // stylesheet links/order; these are asset reads, never page navigation.
            for (const record of sheets) {
              const owner = mapping.get(record.sheet.ownerNode);
              if (!owner) continue;
              if (owner.localName === "link") links.push(owner);
              else if (record.complete) { owner.textContent = record.css; owner.disabled = record.sheet.disabled; }
            }
            styles.push({ scope, css: adopted.filter(record => !record.sheet.disabled).map(record => activeSheetCss(record.sheet, record.css)).join("\n"), mixed: true, nativeSheets: sheets });
          }
          cssBytes += new Blob([[...sheets, ...adopted].map(record => record.css).join("\n")]).size;
          if (cssBytes > LIMITS.cssBytes) throw new Error("Page styles are too large for responsive copying. Use Browser only.");
        }
        active.throwIfAborted();
        frame = source.createElement("iframe");
        frame.setAttribute("data-page-capture-viewport-frame", ""); frame.setAttribute("data-h2d-ignore", "true"); frame.setAttribute("aria-hidden", "true"); frame.tabIndex = -1;
        frame.title = `Temporary ${width}px responsive capture`;
        frame.setAttribute("sandbox", "allow-same-origin"); frame.setAttribute("referrerpolicy", "no-referrer");
        for (const [property, value] of Object.entries({ all: "initial", position: "fixed", left: "-20000px", top: "0", width: `${width}px`, height: `${height}px`, display: "block", visibility: "visible", opacity: "0", pointerEvents: "none", border: "0", margin: "0", padding: "0", boxSizing: "content-box" })) frame.style.setProperty(property.replace(/[A-Z]/g, char => `-${char.toLowerCase()}`), value, "important");
        // No src or srcdoc: this is the initial blank frame, not a visit to a URL.
        mount.append(frame);
        const isolated = frame.contentDocument;
        if (!isolated) throw new Error("Could not create an isolated responsive copy.");
        // Static literal only. Establish standards mode before adopting inert DOM;
        // never parse/write the website's HTML or execute its scripts.
        isolated.open(); isolated.write("<!DOCTYPE html><html><head></head><body></body></html>"); isolated.close();
        if (source.compatMode === "CSS1Compat" && isolated.compatMode !== "CSS1Compat") throw new Error("The responsive copy could not enter standards mode.");
        const policy = source.createElement("meta"); policy.httpEquiv = "Content-Security-Policy";
        policy.content = "script-src 'none'; connect-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'";
        const baseElement = source.createElement("base"); baseElement.href = base;
        root.querySelector("head").prepend(baseElement, policy);
        isolated.replaceChild(root, isolated.documentElement);
        scopes[0].target = isolated;
        for (const { scope, css, mixed } of styles) {
          if (scope.target !== isolated && !scope.target.host.isConnected) continue;
          const sheet = new frame.contentWindow.CSSStyleSheet(); sheet.replaceSync(css);
          scope.target.adoptedStyleSheets = [sheet];
          if (mixed) for (const originalSheet of scope.source.styleSheets) {
            const owner = mapping.get(originalSheet.ownerNode);
            if (owner?.localName === "style" && !owner.sheet && !originalSheet.disabled) throw new Error("The page's stylesheet policy prevents a faithful responsive copy. Browser capture is still available.");
          }
        }
        // Hide only the copy's scrollbar; never touch source viewport or styling.
        root.style.setProperty("scrollbar-width", "none", "important");
        for (const [original, copy] of pairs) if (copy.nodeType === 1 && copy.isConnected && original !== source.documentElement && original !== source.body) { copy.scrollLeft = original.scrollLeft; copy.scrollTop = original.scrollTop; }
        await settleLinks(links.filter(link => link.isConnected), frame.contentWindow, active);
        // Preserve runtime CSSOM edits even when mixed-origin sheets require
        // native links. Readable links can be updated after their asset load.
        for (const record of styles.flatMap(style => style.nativeSheets || [])) {
          const owner = mapping.get(record.sheet.ownerNode);
          if (!record.complete || !owner?.isConnected || owner.localName !== "link" || !owner.sheet || record.sheet.disabled) continue;
          const replacement = new frame.contentWindow.CSSStyleSheet(); replacement.replaceSync(record.css);
          const target = owner.sheet;
          while (target.cssRules.length) target.deleteRule(0);
          for (const rule of replacement.cssRules) target.insertRule(rule.cssText, target.cssRules.length);
        }
        const fonts = isolated.fonts?.ready;
        if (fonts) await wait(Promise.race([fonts, new Promise(resolve => setTimeout(resolve, 1500))]), active);
        await wait(new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))), active);
        active.throwIfAborted();
        const actualWidth = frame.contentWindow.innerWidth;
        if (Math.abs(actualWidth - width) > 1 || !root.isConnected || root.getBoundingClientRect().height <= 0) throw new Error("The responsive copy has invalid viewport bounds.");
        const result = await wait(helpers.capture(root, { timeoutSignal: active, extractCssVariables: false, captureSourceProps: false, skipScrollbarHiding: true, assertLayoutValid: false }), active);
        active.throwIfAborted();
        const snapshot = result?.document;
        if (!snapshot?.root || snapshot.root.nodeType !== 1) throw new Error("The responsive copy could not be captured.");
        snapshot.documentTitle = `${source.title || "Page"} — ${width}px`;
        snapshot.viewportRect = { x: 0, y: 0, width: actualWidth, height };
        snapshot.documentRect = { x: 0, y: 0, width: Math.max(actualWidth, root.scrollWidth), height: root.scrollHeight };
        const h2dJson = await wait(helpers.serialize(snapshot, active), active);
        active.throwIfAborted();
        return { capture: { type: "snapshot", id: helpers.createId(), h2dJson, previewUrl: "" }, actualWidth };
      } catch (error) {
        active.throwIfAborted(); throw error;
      } finally {
        clearTimeout(timer); active.removeEventListener("abort", cleanup); cleanup(); operation.abort();
      }
    };
  }
  globalThis.PageCaptureViewports = Object.freeze({ createCapturer, dimensions, cssUrls, srcsetUrls, limits: LIMITS });
})();
