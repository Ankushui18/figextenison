/* Composed-DOM keyboard traversal for the existing element picker. */
(() => {
  "use strict";
  if (globalThis.PageCapturePickerNavigation) return;

  function parentOf(element) {
    if (!element) return null;
    if (element.parentElement) return element.parentElement;
    const root = element.getRootNode?.();
    return root?.host || null;
  }

  function childrenOf(element) {
    if (!element) return [];
    // A host's rendered children are in its open shadow root. For a slot, its
    // assigned elements are the useful keyboard destination, not fallback text.
    if (element.shadowRoot) return Array.from(element.shadowRoot.children);
    if (typeof element.assignedElements === "function") {
      const assigned = element.assignedElements({ flatten: true });
      if (assigned.length) return assigned;
    }
    return Array.from(element.children || []);
  }

  function usable(element, ignore) {
    return !!element && element.nodeType === 1 && !ignore(element);
  }

  function parent(element, ignore = () => false) {
    let candidate = parentOf(element);
    while (candidate && ignore(candidate)) candidate = parentOf(candidate);
    return usable(candidate, ignore) ? candidate : null;
  }

  function childOrSibling(element, ignore = () => false) {
    if (!usable(element, ignore)) return null;
    // Ignored hosts (our own UI, for example) are skipped as whole subtrees;
    // traversal must never enter them to find a selectable descendant.
    const child = childrenOf(element).find(candidate => usable(candidate, ignore));
    if (child) return child;
    let sibling = element.nextElementSibling;
    while (sibling && ignore(sibling)) sibling = sibling.nextElementSibling;
    return usable(sibling, ignore) ? sibling : null;
  }

  globalThis.PageCapturePickerNavigation = Object.freeze({ parent, childOrSibling });
})();
