export function createMobileStorySheet({
  sheet,
  handle,
  media = window.matchMedia("(max-width: 720px)"),
}) {
  let initialized = false;
  let expanded = false;
  let drag = null;
  let eventController = null;

  const collapsedOffset = () =>
    Math.max(0, sheet.getBoundingClientRect().height - 164);

  function render({ offset = null } = {}) {
    sheet.classList.toggle("is-expanded", expanded);
    sheet.classList.toggle("is-dragging", offset != null);
    handle.setAttribute("aria-expanded", String(expanded));
    if (offset == null) sheet.style.removeProperty("--mobile-sheet-offset");
    else sheet.style.setProperty("--mobile-sheet-offset", `${offset}px`);
  }

  function setExpanded(nextExpanded) {
    expanded = Boolean(nextExpanded);
    drag = null;
    render();
  }

  function handlePointerDown(event) {
    if (!media.matches || event.button !== 0) return;
    const offset = expanded ? 0 : collapsedOffset();
    drag = { pointerId: event.pointerId, startY: event.clientY, offset };
    handle.setPointerCapture(event.pointerId);
    render({ offset });
  }

  function handlePointerMove(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const offset = Math.max(
      0,
      Math.min(collapsedOffset(), drag.offset + event.clientY - drag.startY),
    );
    render({ offset });
  }

  function finishDrag(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const offset = Math.max(
      0,
      Math.min(collapsedOffset(), drag.offset + event.clientY - drag.startY),
    );
    const moved = Math.abs(event.clientY - drag.startY) > 6;
    drag = null;
    if (moved) setExpanded(offset < collapsedOffset() / 2);
    else setExpanded(!expanded);
  }

  function handleKeydown(event) {
    if (!media.matches) return;
    if (event.key === "Escape" && expanded) {
      event.preventDefault();
      setExpanded(false);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setExpanded(!expanded);
    }
  }

  function init() {
    if (initialized) return false;
    initialized = true;
    eventController = new AbortController();
    const { signal } = eventController;
    handle.addEventListener("pointerdown", handlePointerDown, { signal });
    handle.addEventListener("pointermove", handlePointerMove, { signal });
    handle.addEventListener("pointerup", finishDrag, { signal });
    handle.addEventListener("pointercancel", finishDrag, { signal });
    handle.addEventListener("keydown", handleKeydown, { signal });
    window.addEventListener("resize", () => render(), { signal });
    render();
    return true;
  }

  function dispose() {
    if (!initialized) return false;
    eventController.abort();
    eventController = null;
    initialized = false;
    drag = null;
    return true;
  }

  return { init, dispose, isExpanded: () => expanded, setExpanded };
}
