/**
 * Shared DOM and SVG element creation utilities.
 */

export const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Creates an SVG element with given namespace, attributes, and optional text content.
 * @param {string} tag - SVG tag name (e.g. 'line', 'path', 'circle', 'text')
 * @param {Record<string, string | number>} [attrs={}] - Attribute key-value map
 * @param {string | number | null} [text=null] - Optional text content
 * @returns {SVGElement}
 */
export function svgEl(tag, attrs = {}, text = null) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== null && value !== undefined) {
      el.setAttribute(key, String(value));
    }
  }
  if (text !== null && text !== undefined) {
    el.textContent = String(text);
  }
  return el;
}

/**
 * Helper to build SVG text nodes.
 * @param {string} tag - SVG text tag name ('text', 'tspan')
 * @param {Record<string, string | number>} [attrs={}] - Attributes
 * @param {string} [text=""] - Text string
 * @returns {SVGElement}
 */
export function svgText(tag, attrs = {}, text = "") {
  return svgEl(tag, attrs, text);
}

// Single reusable probe element for resolving CSS color expressions without repeatedly polluting DOM
let colorProbe = null;

/**
 * Resolves any valid CSS <color> value (var(), color-mix(), etc.) to computed rgb/rgba.
 * Uses a single static probe element to prevent DOM thrashing.
 * @param {string} cssColorValue 
 * @returns {string}
 */
export function resolveComputedColor(cssColorValue) {
  if (typeof document === "undefined" || !document.body) {
    return cssColorValue;
  }
  if (!colorProbe) {
    colorProbe = document.createElement("span");
    colorProbe.style.display = "none";
    document.body.appendChild(colorProbe);
  }
  colorProbe.style.color = cssColorValue;
  return getComputedStyle(colorProbe).color;
}
