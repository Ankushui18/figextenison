/* Local editable board + the existing rich design clipboard format. No uploads. */
(() => {
  "use strict";
  if (globalThis.PageCaptureDesignBoard) return;
  const Core = globalThis.PageCaptureDesignSystemCore;
  if (!Core) return;
  const WIDTH = 1120;
  const MAX_HEIGHT = 200000;
  const MAX_CLIPBOARD_BYTES = 16 * 1024 * 1024;
  const FONT = "Arial, sans-serif";
  const validBounds = rect => rect && Number.isFinite(rect.width) && Number.isFinite(rect.height) && Math.abs(rect.width - WIDTH) <= 1 && rect.height > 0 && rect.height <= MAX_HEIGHT;
  const descriptions = {
    colors: "Palette swatches · transparency shown over editable checkerboard tiles",
    typography: "Scaled Arial specimens · all six original typography values are listed",
    spacing: "Signed observed values · rulers are scaled to fit, not a new spacing scale",
    radii: "Corner samples · percentage and elliptical values are retained",
    shadows: "Shadow samples · full observed values are listed below each shape",
    borders: "Border samples · original width, style and color are retained"
  };

  function buildBoard(system, ownerDocument = document) {
    const errors = Core.validate(system);
    if (errors.length) throw new Error(errors[0]);
    const included = system.tokens.filter(token => token.included);
    if (included.length > 480 || included.some(token => !Core.categories.some(category => category.id === token.category))) {
      throw new Error("This board exceeds the supported token categories or count.");
    }
    // Create every captured node in the parent realm. The snapshot engine uses
    // instanceof Element; nodes created inside an iframe belong to another realm.
    const node = (tag, text, styles = {}) => {
      const result = ownerDocument.createElement(tag);
      Object.assign(result.style, { boxSizing: "border-box", margin: "0", padding: "0", minWidth: "0" }, styles);
      if (text != null) result.textContent = String(text);
      return result;
    };
    const text = (value, styles = {}) => node("div", value, { overflowWrap: "anywhere", ...styles });
    const muted = value => text(value, { color: "#aaaaaa", fontSize: "11px", lineHeight: "16px" });
    const board = node("main", null, {
      width: `${WIDTH}px`, padding: "40px", backgroundColor: "#202020", color: "#eeeeee",
      fontFamily: FONT, fontSize: "13px", fontWeight: "400", fontStyle: "normal", lineHeight: "20px",
      letterSpacing: "normal", textAlign: "left", direction: "ltr", writingMode: "horizontal-tb",
      colorScheme: "light", display: "block", position: "relative"
    });
    board.id = "design-system";
    board.setAttribute("aria-label", "Design system reference board");
    const header = node("header", null, { padding: "24px", border: "1px solid #444444", borderRadius: "13px", backgroundColor: "#2c2c2c", display: "grid", gap: "10px" });
    header.append(text("PAGE CAPTURE / DESIGN SYSTEM", { color: "#0d99ff", fontSize: "11px", lineHeight: "16px", letterSpacing: "1px", fontWeight: "700" }));
    header.append(text(system.source.title || "Website design system", { fontSize: "28px", lineHeight: "36px", fontWeight: "700" }));
    const source = Core.sourceUrl(system.source.url);
    if (source) header.append(muted(source));
    const viewport = Number(system.source.viewport?.width) || 0;
    header.append(text(`${included.length} reviewed tokens · ${viewport}px source viewport · editable reference board`, { color: "#cccccc", fontSize: "12px", lineHeight: "18px" }));
    header.append(muted("Observed website styles, not a reconstructed original system. Names and roles need review. This board does not create or apply shared variables, styles or components."));
    board.append(header);

    function sample(token) {
      const preview = node("div", null, {
        height: token.category === "typography" ? "104px" : "88px", backgroundColor: "#303030",
        border: "1px solid #555555", borderRadius: "5px", position: "relative", overflow: "hidden",
        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: "0"
      });
      preview.setAttribute("aria-label", `${token.name} sample`);
      if (token.category === "colors") {
        const color = Core.parseSrgb(token.value);
        if (!color || color.a < 1) {
          const checker = node("div", null, { position: "absolute", inset: "0", display: "grid", gridTemplateColumns: "repeat(8,1fr)", gridTemplateRows: "repeat(4,1fr)" });
          // Real rectangles, not a raster/gradient asset: alpha stays inspectable.
          for (let index = 0; index < 32; index++) checker.append(node("div", null, { backgroundColor: (Math.floor(index / 8) + index % 8) % 2 ? "#cccccc" : "#ffffff" }));
          preview.append(checker);
        }
        preview.append(node("div", null, { position: "absolute", inset: "0", backgroundColor: token.value }));
      } else if (token.category === "typography") {
        const specimen = text("Aa Bb 0123", { ...Core.typographyPreview(token.value), fontFamily: FONT, color: "#eeeeee", padding: "12px", whiteSpace: "normal" });
        preview.append(specimen);
      } else if (token.category === "spacing") {
        const width = Math.max(2, Math.min(184, Math.abs(parseFloat(token.value)) || 0));
        preview.append(node("div", null, { width: `${width}px`, height: "12px", backgroundColor: "#0d99ff", borderRadius: "2px" }));
      } else {
        const shape = node("div", null, { width: "76px", height: "48px", backgroundColor: "#b8b8b8", flexShrink: "0" });
        if (token.category === "radii") {
          const parts = String(token.value).trim().split(/\s+/);
          shape.style.borderRadius = parts.length === 2 ? `${parts[0]} / ${parts[1]}` : token.value;
        }
        if (token.category === "shadows") { shape.style.borderRadius = "5px"; shape.style.boxShadow = token.value; }
        if (token.category === "borders") { shape.style.backgroundColor = "transparent"; shape.style.border = Core.valueText(token); }
        preview.append(shape);
      }
      return preview;
    }
    let sectionIndex = 0;
    for (const category of Core.categories) {
      const tokens = included.filter(token => token.category === category.id);
      if (!tokens.length) continue;
      const section = node("section", null, { marginTop: "32px" });
      section.id = `section-${category.id}`;
      section.setAttribute("aria-label", category.label);
      section.append(text(`${String(++sectionIndex).padStart(2, "0")} / ${category.label} · ${tokens.length}`, { fontSize: "18px", lineHeight: "26px", fontWeight: "700" }));
      const description = muted(descriptions[category.id]); description.style.marginTop = "4px"; description.style.marginBottom = "16px"; section.append(description);
      const grid = node("div", null, { display: "grid", gridTemplateColumns: `repeat(${category.id === "typography" ? 2 : 4},minmax(0,1fr))`, gap: "12px", alignItems: "stretch" });
      for (const token of tokens) {
        const card = node("article", null, { backgroundColor: "#2c2c2c", border: "1px solid #444444", borderRadius: "8px", padding: "16px", display: "flex", flexDirection: "column", gap: "10px" });
        card.id = `token-${token.name}`;
        card.setAttribute("aria-label", token.name);
        card.append(sample(token), text(token.name, { fontSize: "13px", lineHeight: "18px", fontWeight: "700" }));
        if (category.id === "typography") {
          const metrics = node("div", null, { display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: "10px 12px" });
          for (const property of Core.typeProperties) {
            const field = node("div");
            field.append(muted(property.replace(/[A-Z]/g, char => ` ${char.toLowerCase()}`)), text(token.value[property], { fontSize: "12px", lineHeight: "18px" })); metrics.append(field);
          }
          card.append(metrics);
        } else card.append(text(Core.valueText(token), { fontFamily: "monospace", fontSize: "11px", lineHeight: "16px", color: "#cccccc" }));
        const origin = token.nameOrigin === "user" ? "Reviewed name" : token.aliases.length ? "CSS-variable evidence" : "Suggested name";
        card.append(muted(`${token.count} property observations · ${origin}${token.merged ? " · Merged" : ""}`));
        grid.append(card);
      }
      section.append(grid); board.append(section);
    }
    const footer = node("footer", null, { marginTop: "32px", paddingTop: "16px", borderTop: "1px solid #444444", display: "grid", gap: "6px" });
    footer.append(muted("Created locally from included, reviewed tokens. Text and shapes remain separate editable layers; no website screenshot is used."),
      muted("Typography specimens use scaled Arial, not downloaded website fonts. Original family, size, weight, line height, tracking and style are listed. Preview rulers are scaled to fit."));
    for (const warning of system.warnings || []) footer.append(muted(warning));
    board.append(footer);
    return board;
  }

  async function makeClipboardHtml(snapshotJson, encode, signal) {
    signal?.throwIfAborted();
    // Same version-2 snapshot array and figmeta/figh2d HTML markers as the
    // established Capture design path. This is not an SVG or a variable import.
    const snapshot = JSON.parse(snapshotJson);
    if (snapshot.version !== 2 || snapshot.root?.nodeType !== 1 || Object.keys(snapshot.assets || {}).length) {
      throw new Error("The editable board snapshot is invalid or contains unexpected assets.");
    }
    const metadata = { dataType: "h2d", source: "chrome-extension", capturedAtIso: new Date().toISOString() };
    const [meta, data] = await Promise.all([encode(JSON.stringify(metadata), signal), encode(JSON.stringify([{ ...snapshot, type: "snapshot" }]), signal)]);
    // Encoded fields must remain base64, even if a helper unexpectedly changes.
    if (![meta, data].every(value => typeof value === "string" && /^[A-Za-z0-9+/]*={0,2}$/.test(value))) throw new Error("Could not encode the editable board.");
    return `<span data-metadata="<!--(figmeta)${meta}(/figmeta)-->"></span><span data-h2d="<!--(figh2d)${data}(/figh2d)-->"></span>`;
  }

  function createCopier(helpers) {
    if (![helpers?.capture, helpers?.serialize, helpers?.encode].every(helper => typeof helper === "function")) return null;
    return async function copyDesignSystem(system, { mount, signal, onPhase } = {}) {
      signal?.throwIfAborted();
      if (!mount?.isConnected) throw new Error("The generator is no longer open.");
      if ((!globalThis.PageCaptureClipboard?.write && typeof navigator.clipboard?.write !== "function") || typeof ClipboardItem !== "function") throw new Error("The rich clipboard is unavailable on this page.");
      const operation = new AbortController();
      const active = signal ? AbortSignal.any([signal, operation.signal]) : operation.signal;
      const timer = setTimeout(() => operation.abort(new DOMException("Board preparation timed out", "TimeoutError")), 12000);
      let frame;
      const cleanup = () => frame?.remove();
      active.addEventListener("abort", cleanup, { once: true });
      try {
        const board = buildBoard(system);
        const title = `${system.source.title || "Website"} — Design system`;
        const count = system.tokens.filter(token => token.included).length;
        active.throwIfAborted();
        frame = document.createElement("iframe");
        frame.setAttribute("data-design-system-board-frame", "");
        frame.setAttribute("data-h2d-ignore", "true");
        frame.setAttribute("aria-hidden", "true"); frame.tabIndex = -1;
        frame.title = "Temporary editable design-system board";
        frame.setAttribute("sandbox", "allow-same-origin");
        frame.setAttribute("referrerpolicy", "no-referrer");
        Object.assign(frame.style, { all: "initial", position: "fixed", left: "-20000px", top: "0", width: `${WIDTH}px`, height: "800px", display: "block", visibility: "visible", opacity: "0", pointerEvents: "none", border: "0", margin: "0", padding: "0", boxSizing: "content-box" });
        // No src/srcdoc navigation, scripts, resource URLs or inherited site CSS.
        // Use CSSOM assignments, which also work on pages forbidding inline CSS.
        mount.append(frame);
        const isolated = frame.contentDocument;
        if (!isolated?.body) throw new Error("Could not create the isolated board.");
        const policy = document.createElement("meta"); policy.httpEquiv = "Content-Security-Policy";
        policy.content = "default-src 'none'; style-src 'none'; font-src 'none'; img-src 'none'; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";
        isolated.head.append(policy);
        Object.assign(isolated.documentElement.style, { margin: "0", padding: "0", overflow: "hidden", colorScheme: "light" });
        Object.assign(isolated.body.style, { margin: "0", padding: "0", backgroundColor: "transparent" });
        // Same-origin frame documents can be enumerated by a site's scripts.
        // Keep the reviewed DOM inside a closed root as well, not in that public
        // document tree. The frame policy also forbids font/resource loads.
        const island = document.createElement("div");
        Object.assign(island.style, { all: "initial", display: "block", margin: "0", padding: "0" });
        const privateRoot = island.attachShadow({ mode: "closed" }); privateRoot.append(board);
        isolated.body.append(island);
        const bounds = board.getBoundingClientRect();
        if (!validBounds(bounds)) throw new Error("This board is too large or could not be laid out. Exclude some tokens and retry.");
        const result = await helpers.capture(board, {
          timeoutSignal: active, extractCssVariables: false, captureSourceProps: false,
          skipRemoteAssetSerialization: true, skipScrollbarHiding: true, assertLayoutValid: false
        });
        active.throwIfAborted();
        if (!result?.document || result.document.assets?.size !== 0) throw new Error("The board snapshot contains unexpected assets.");
        const capturedBounds = result.document.root?.rect;
        if (!validBounds(capturedBounds)) throw new Error("The board snapshot has invalid layout.");
        // The engine's default title is the current web document's title. Replace
        // it with the reviewed model's title; nothing else from the site is copied.
        result.document.documentTitle = title;
        const serialized = await helpers.serialize(result.document, active);
        active.throwIfAborted();
        const html = await makeClipboardHtml(serialized, helpers.encode, active);
        active.throwIfAborted();
        const blob = new Blob([html], { type: "text/html" });
        if (blob.size > MAX_CLIPBOARD_BYTES) throw new Error("This board is too large to copy. Exclude some tokens and retry.");
        cleanup();
        if (!mount.isConnected) throw new DOMException("Generator closed", "AbortError");
        // Native clipboard writes cannot be revoked once handed to the browser.
        // The panel disables preparation cancellation during this final phase.
        onPhase?.("writing");
        active.throwIfAborted();
        clearTimeout(timer);
        const item = new ClipboardItem({ "text/html": blob });
        if (globalThis.PageCaptureClipboard?.write) await globalThis.PageCaptureClipboard.write([item]);
        else await navigator.clipboard.write([item]);
        return { count };
      } catch (error) {
        active.throwIfAborted(); throw error;
      } finally {
        clearTimeout(timer); active.removeEventListener("abort", cleanup); cleanup(); operation.abort();
      }
    };
  }
  globalThis.PageCaptureDesignBoard = Object.freeze({ buildBoard, makeClipboardHtml, createCopier });
})();
