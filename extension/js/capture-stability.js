/* Freeze running Web Animations during capture, then restore their live state. */
(() => {
  "use strict";
  if (globalThis.PageCaptureStability) return;

  function documentFor(target) {
    if (target?.nodeType === 9) return target;
    return target?.ownerDocument || null;
  }

  function animationRoots(target) {
    const document = documentFor(target);
    if (!document) return [];
    const roots = [document], domRoots = [document], seen = new Set(roots);
    // Document.getAnimations() does not consistently include every open shadow
    // tree across supported Chromium versions, so discover those roots too.
    for (let index = 0; index < domRoots.length; index++) {
      const root = domRoots[index];
      let elements;
      try { elements = root.querySelectorAll?.("*") || []; } catch { continue; }
      for (const element of elements) {
        let shadow;
        try { shadow = element.shadowRoot; } catch { continue; }
        if (shadow && !seen.has(shadow)) {
          seen.add(shadow); roots.push(shadow); domRoots.push(shadow);
        }
      }
    }
    return roots;
  }

  function animationsIn(root) {
    try {
      if (typeof root.getAnimations === "function") return Array.from(root.getAnimations() || []);
    } catch { /* Fall through to the per-element compatibility path. */ }
    const animations = [];
    let elements;
    try { elements = root.querySelectorAll?.("*") || []; } catch { return animations; }
    for (const element of elements) {
      try {
        if (typeof element.getAnimations === "function") animations.push(...element.getAnimations());
      } catch { /* A detached element must not abort capture. */ }
    }
    return animations;
  }

  function pause(target) {
    const records = [], seen = new Set();
    let roots;
    try { roots = animationRoots(target); } catch { roots = []; }
    for (const root of roots) {
      let animations;
      try { animations = animationsIn(root); } catch { continue; }
      for (const animation of animations) {
        if (!animation || seen.has(animation)) continue;
        seen.add(animation);
        let state;
        try { state = animation.playState; } catch { continue; }
        // Pausing an idle animation would apply its first keyframe and change
        // the page. Only freeze animations that were actually advancing.
        if (state !== "running") continue;
        let currentTime = null;
        try { currentTime = animation.currentTime; } catch { /* Still pause it. */ }
        try {
          animation.pause();
          records.push({ animation, currentTime });
          // pause() can settle on a later frame. Seek back to the capture-start
          // frame so a long serialization still captures one stable instant.
          if (currentTime !== null) {
            try { animation.currentTime = currentTime; } catch { /* Best effort. */ }
          }
        } catch { /* Unsupported animation implementations are left alone. */ }
      }
    }

    let restored = false;
    return Object.freeze({
      count: records.length,
      restore() {
        if (restored) return;
        restored = true;
        for (const { animation, currentTime } of records) {
          try {
            // Do not undo a play/cancel decision made by page code while the
            // capture was in progress. Our own pause leaves this state paused.
            if (animation.playState !== "paused") continue;
            if (currentTime !== null) {
              try { animation.currentTime = currentTime; } catch { /* Continue. */ }
            }
            animation.play();
          } catch { /* Restore every other animation even if one fails. */ }
        }
      }
    });
  }

  globalThis.PageCaptureStability = Object.freeze({ pause });
})();
