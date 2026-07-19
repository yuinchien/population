export function trackEvent(eventName, props = {}) {
  if (typeof window === "undefined") return;
  window.umami?.track?.(eventName, props);
}
