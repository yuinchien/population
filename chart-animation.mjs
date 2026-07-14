export function prefersReducedMotion(matchMediaImpl = globalThis.matchMedia) {
  return typeof matchMediaImpl === "function"
    ? matchMediaImpl.call(
        globalThis,
        "(prefers-reduced-motion: reduce)",
      ).matches
    : false;
}

export function runChartAnimation({
  duration,
  easing = (value) => value,
  onFrame,
  onFinish = () => {},
  reduceMotion = prefersReducedMotion(),
  now = () => performance.now(),
  requestFrame = (callback) => globalThis.requestAnimationFrame(callback),
  cancelFrame = (frameId) => globalThis.cancelAnimationFrame(frameId),
}) {
  let frameId = null;
  let cancelled = false;

  if (reduceMotion || duration <= 0) {
    onFrame(1, 1);
    onFinish();
    return { cancel() {}, get cancelled() { return false; } };
  }

  const start = now();
  const step = (timestamp) => {
    if (cancelled) return;
    const progress = Math.min(1, Math.max(0, (timestamp - start) / duration));
    onFrame(easing(progress), progress);
    if (progress < 1) frameId = requestFrame(step);
    else onFinish();
  };
  frameId = requestFrame(step);

  return {
    cancel() {
      if (cancelled) return;
      cancelled = true;
      if (frameId != null) cancelFrame(frameId);
    },
    get cancelled() {
      return cancelled;
    },
  };
}

export function cancelChartAnimations(handles) {
  handles.forEach((handle) => handle?.cancel());
  handles.length = 0;
}
