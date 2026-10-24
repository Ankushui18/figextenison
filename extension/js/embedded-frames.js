"use strict";
/* Embedded documents (iframes) that belong to the same origin as the page are
 * part of the design: exported boards, dashboard cards, embedded editors. The
 * capture engine walks the document it was injected into and stops at the
 * frame element, so a pasted capture shows empty boxes where those screens
 * are.
 *
 * This module fills those frames in. For every frame the page is allowed to
 * read it re-uses the responsive-copy capturer (already tested, already
 * inlines CSS, resolves assets and shadow roots) against the frame's own
 * document, translates the result into the parent's coordinate space and hangs
 * it under the frame node the engine produced. Nothing in the engine changes:
 * install() only decorates two globals the engine already reads.
 *
 * Frames the browser keeps private stay untouched: cross-origin frames,
 * sandboxed frames without same-origin, and blob: documents with an opaque
 * origin (a saved page opened from file:// gives every frame origin "null").
 * No permission or allFrames injection can read those - the frame's document
 * is not available to any script in the page. Capture keeps working and simply
 * leaves them as they are.
 */
(() => {
  if (globalThis.PageCaptureEmbedded) return;

  // Enough frames for a board or a dashboard, and a per-frame ceiling so one
  // pathological document cannot hold the clipboard write open.
  const LIMITS = Object.freeze({ frames: 8, timeout: 15000 });
  const FRAME_TAGS = new Set(["IFRAME", "FRAME"]);

  // The engine hands its own capture/serialize functions to the design board on
  // every toolbar mount, which is the one place a readable module can see them.
  let engine = null;
  let capturer = null;

  function rememberEngine(helpers) {
    if (helpers?.capture && helpers?.serialize) engine = { capture: helpers.capture, serialize: helpers.serialize };
  }

  function wrapDesignBoard() {
    const Board = globalThis.PageCaptureDesignBoard;
    if (!Board || typeof Board.createCopier !== "function" || Board.__embeddedFrames === true) return false;
    globalThis.PageCaptureDesignBoard = Object.freeze({
      ...Board,
      __embeddedFrames: true,
      createCopier(helpers) {
        rememberEngine(helpers);
        return Board.createCopier(helpers);
      }
    });
    return true;
  }

  // Same signature and behaviour as the Viewports capturer; we only need its
  // record's h2dJson, so the id it mints is discarded with the rest.
  function embeddedCapturer() {
    if (capturer !== null) return capturer || null;
    const Viewports = globalThis.PageCaptureViewports;
    if (!engine || typeof Viewports?.createCapturer !== "function") { capturer = false; return null; }
    let counter = 0;
    capturer = Viewports.createCapturer({
      capture: (root, options) => engine.capture(root, options),
      serialize: (snapshot, signal) => engine.serialize(snapshot, signal),
      createId: () => `embedded-frame-${++counter}`
    }) || false;
    return capturer || null;
  }

  function walk(node, visit) {
    const stack = [node];
    while (stack.length) {
      const current = stack.pop();
      if (!current || typeof current !== "object") continue;
      visit(current);
      const pseudo = current.pseudoElementNodes;
      if (pseudo) for (const key of ["before", "after"]) if (pseudo[key]) stack.push(pseudo[key]);
      const children = current.childNodes;
      if (Array.isArray(children)) for (let index = children.length - 1; index >= 0; index--) stack.push(children[index]);
    }
  }

  function translate(node, dx, dy) {
    walk(node, current => {
      if (current.rect) current.rect = { ...current.rect, x: current.rect.x + dx, y: current.rect.y + dy };
      if (current.scrollRect) current.scrollRect = { ...current.scrollRect, x: current.scrollRect.x + dx, y: current.scrollRect.y + dy };
    });
  }

  // The responsive capturer imports the source into an inert document built by
  // `source.implementation`. Reading a frame's document through this facade
  // hands it the parent's implementation on purpose: the imported nodes then
  // belong to this realm and the engine's instanceof Element checks work, which
  // is exactly how the top document's own copies are built.
  function frameSource(child) {
    return {
      get documentElement() { return child.documentElement; },
      get body() { return child.body; },
      get title() { return child.title || ""; },
      get baseURI() { return child.baseURI; },
      get compatMode() { return child.compatMode; },
      get styleSheets() { return child.styleSheets; },
      get adoptedStyleSheets() { return child.adoptedStyleSheets; },
      get implementation() { return document.implementation; },
      createTreeWalker: (...args) => child.createTreeWalker(...args),
      createElement: (...args) => document.createElement(...args),
      querySelectorAll: (...args) => child.querySelectorAll(...args)
    };
  }

  // A frame is usable only when this page can actually read its document. A
  // cross-origin frame answers null, and reading it is not an error worth
  // surfacing: it is the browser's normal protection, not a capture failure.
  function readableFrames() {
    const frames = [];
    for (const frame of document.querySelectorAll("iframe, frame")) {
      if (!frame.isConnected || frame.getAttribute("data-h2d-ignore") === "true") continue;
      const rect = frame.getBoundingClientRect();
      if (rect.width < 8 || rect.height < 8) continue;
      let child = null;
      try { child = frame.contentDocument; } catch { child = null; }
      if (!child?.body || !child.documentElement) continue;
      if (!child.body.children.length && !child.body.textContent.trim()) continue;
      frames.push({ frame, document: child, rect });
    }
    return frames;
  }

  function frameNodes(doc) {
    const nodes = [];
    walk(doc.root, node => { if (node.nodeType === 1 && FRAME_TAGS.has(String(node.tag).toUpperCase())) nodes.push(node); });
    return nodes;
  }

  function near(node, rect) {
    return Math.abs(node.rect.x - rect.x) <= 2 && Math.abs(node.rect.y - rect.y) <= 2 &&
      Math.abs(node.rect.width - rect.width) <= 2 && Math.abs(node.rect.height - rect.height) <= 2;
  }

  // Model frames and live frames are both in document order, but a capture may
  // cover only part of the page, so prefer an exact rectangle match and fall
  // back to order only when the two lists line up.
  function pair(nodes, frames) {
    const pairs = [], used = new Set();
    for (const node of nodes) {
      const index = frames.findIndex((entry, position) => !used.has(position) && near(node, entry.rect));
      if (index !== -1) { used.add(index); pairs.push([node, frames[index]]); }
    }
    if (pairs.length === nodes.length) return pairs;
    if (nodes.length === frames.length) return nodes.map((node, index) => [node, frames[index]]);
    const spare = frames.filter((entry, index) => !used.has(index));
    for (const node of nodes) {
      if (pairs.some(([paired]) => paired === node)) continue;
      const entry = spare.shift();
      if (!entry) break;
      pairs.push([node, entry]);
    }
    return pairs;
  }

  // Only the record taken from this live document can be matched against its
  // frames. Responsive copies live in a temporary frame with their own width
  // and must never receive the page's embedded documents.
  function fromLiveDocument(doc) {
    const rect = doc?.root?.rect;
    if (!rect || doc.version !== 2) return false;
    return Math.abs(rect.x) <= 1 && Math.abs(rect.width - window.innerWidth) <= 1;
  }

  async function expandRecord(record, options) {
    if (!record || record.type !== "snapshot" || typeof record.h2dJson !== "string") return record;
    if (window.self !== window.top) return record;
    const frames = readableFrames();
    if (!frames.length) return record;
    let doc;
    try { doc = JSON.parse(record.h2dJson); } catch { return record; }
    if (!fromLiveDocument(doc)) return record;
    const nodes = frameNodes(doc);
    if (!nodes.length) return record;
    const capture = embeddedCapturer();
    if (!capture) return record;

    let changed = false, done = 0;
    for (const [node, entry] of pair(nodes, frames)) {
      if (done >= LIMITS.frames) break;
      if (options?.signal?.aborted) break;
      done++;
      try {
        const signal = options?.signal
          ? AbortSignal.any([options.signal, AbortSignal.timeout(LIMITS.timeout)])
          : AbortSignal.timeout(LIMITS.timeout);
        const result = await capture({
          width: Math.max(1, Math.round(entry.rect.width)),
          height: Math.max(1, Math.round(entry.rect.height)),
          signal,
          mount: document.body || document.documentElement,
          source: frameSource(entry.document)
        });
        const child = JSON.parse(result?.capture?.h2dJson);
        if (!child?.root?.rect) continue;
        translate(child.root, node.rect.x - child.root.rect.x, node.rect.y - child.root.rect.y);
        node.childNodes = [child.root];
        doc.assets = { ...(doc.assets || {}), ...(child.assets || {}) };
        doc.fonts = { ...(doc.fonts || {}), ...(child.fonts || {}) };
        changed = true;
      } catch (error) {
        if (options?.signal?.aborted) throw error;
        // A frame that cannot be rebuilt stays exactly as the engine left it.
      }
    }
    return changed ? { ...record, h2dJson: JSON.stringify(doc) } : record;
  }

  function install() {
    const Safety = globalThis.PageCaptureSafety;
    if (!Safety || typeof Safety.prepareClipboard !== "function" || Safety.__embeddedFrames === true) return !!Safety;
    const prepare = Safety.prepareClipboard;
    globalThis.PageCaptureSafety = Object.freeze({
      ...Safety,
      __embeddedFrames: true,
      async prepareClipboard(records, options) {
        if (!Array.isArray(records) || records.length === 0) return prepare(records, options);
        const output = [];
        for (const record of records) output.push(await expandRecord(record, options));
        return prepare(output, options);
      }
    });
    return true;
  }

  wrapDesignBoard();
  install();
  globalThis.PageCaptureEmbedded = Object.freeze({ install, expandRecord, readableFrames, limits: LIMITS });
})();
