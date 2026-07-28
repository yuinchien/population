const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export function nextOverlayFocusIndex(current, shiftKey, count) {
  if (!count) return -1;
  if (shiftKey) return current <= 0 ? count - 1 : current - 1;
  return current < 0 || current >= count - 1 ? 0 : current + 1;
}

export function createOverlayController({
  panel,
  trigger = null,
  scrim = null,
  initialFocus = () => panel.querySelector(FOCUSABLE_SELECTOR),
  labelledBy = null,
  requestClose = null,
  getBackgroundElements = () =>
    [...document.body.children].filter(
      (element) =>
        element !== panel &&
        element !== scrim &&
        !element.contains(panel),
    ),
  onVisibilityChange = null,
}) {
  let returnFocus = null;
  let inerted = [];

  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  if (labelledBy) panel.setAttribute("aria-labelledby", labelledBy);
  if (!panel.hasAttribute("tabindex")) panel.tabIndex = -1;

  function setBackgroundInert(inert) {
    if (inert) {
      inerted = getBackgroundElements().filter(
        (element) => !element.hidden && !element.inert,
      );
      inerted.forEach((element) => {
        element.inert = true;
      });
    } else {
      inerted.forEach((element) => {
        element.inert = false;
      });
      inerted = [];
    }
  }

  function open({ focus = true, returnFocusTo = null } = {}) {
    if (panel.hidden) {
      returnFocus = returnFocusTo ?? document.activeElement;
      panel.hidden = false;
      setBackgroundInert(true);
    }
    trigger?.setAttribute("aria-expanded", "true");
    onVisibilityChange?.(true);
    if (focus) (initialFocus() ?? panel).focus();
  }

  function close({ restoreFocus = true } = {}) {
    if (!panel.hidden) {
      panel.hidden = true;
      setBackgroundInert(false);
    }
    trigger?.setAttribute("aria-expanded", "false");
    onVisibilityChange?.(false);
    if (restoreFocus && returnFocus?.isConnected) returnFocus.focus();
    returnFocus = null;
  }

  function handleKeydown(event) {
    if (panel.hidden) return;
    if (event.key === "Escape" && requestClose) {
      event.preventDefault();
      requestClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...panel.querySelectorAll(FOCUSABLE_SELECTOR)].filter(
      (element) => !element.hidden,
    );
    if (!focusable.length) {
      event.preventDefault();
      panel.focus();
      return;
    }
    const current = focusable.indexOf(document.activeElement);
    const next = nextOverlayFocusIndex(current, event.shiftKey, focusable.length);
    if (
      current < 0 ||
      (event.shiftKey && current === 0) ||
      (!event.shiftKey && current === focusable.length - 1)
    ) {
      event.preventDefault();
      focusable[next].focus();
    }
  }

  function handleScrimClick() {
    if (!panel.hidden) requestClose?.();
  }

  document.addEventListener("keydown", handleKeydown);
  scrim?.addEventListener("click", handleScrimClick);

  return {
    open,
    close,
    isOpen: () => !panel.hidden,
    destroy() {
      close({ restoreFocus: false });
      document.removeEventListener("keydown", handleKeydown);
      scrim?.removeEventListener("click", handleScrimClick);
    },
  };
}
