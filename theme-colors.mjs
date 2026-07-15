function rootStyles() {
  return getComputedStyle(document.documentElement);
}

export function resolveCssColor(color, styles = rootStyles()) {
  const variable = /^var\(\s*(--[^),\s]+)(?:\s*,[^)]*)?\s*\)$/.exec(color)?.[1];
  if (!variable) return color.trim();
  return styles.getPropertyValue(variable).trim();
}

function parseColor(color, styles) {
  const resolved = resolveCssColor(color, styles);
  const hex = /^#([\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/i.exec(resolved);
  if (hex) {
    let value = hex[1];
    if (value.length === 3) value = value.replace(/./g, (digit) => digit + digit);
    if (value.length === 8) value = value.slice(0, 6);
    return [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16) / 255);
  }
  const rgb = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(resolved);
  if (rgb) return rgb.slice(1, 4).map((channel) => Number(channel) / 255);
  throw new TypeError(`Unsupported CSS color: ${resolved}`);
}

export function relativeLuminance(color, styles = rootStyles()) {
  const channels = parseColor(color, styles).map((channel) =>
    channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

export function contrastRatio(first, second, styles = rootStyles()) {
  const firstLuminance = relativeLuminance(first, styles);
  const secondLuminance = relativeLuminance(second, styles);
  const lighter = Math.max(firstLuminance, secondLuminance);
  const darker = Math.min(firstLuminance, secondLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

export function foregroundForColor(
  background,
  {
    dark = "var(--color-bg)",
    light = "var(--color-text)",
    styles = rootStyles(),
  } = {},
) {
  return contrastRatio(background, dark, styles) >=
    contrastRatio(background, light, styles)
    ? dark
    : light;
}
