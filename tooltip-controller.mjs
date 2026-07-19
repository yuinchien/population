export function createTooltipLine(text, color = null) {
  const line = document.createElement("div");
  line.className = "tooltip-line";
  if (color) {
    const swatch = document.createElement("span");
    swatch.className = "legend-swatch";
    swatch.style.setProperty("--color-legend", color);
    line.append(swatch);
  }
  const label = document.createElement("span");
  label.textContent = text;
  line.append(label);
  return line;
}

export function showTooltipLine(tooltip, event, text, color = null) {
  if (!tooltip || !text) return;
  tooltip.hidden = false;
  tooltip.replaceChildren(createTooltipLine(text, color));
  tooltip.style.left = `${event.clientX}px`;
  tooltip.style.top = `${event.clientY}px`;
}

export function showTooltipContent(tooltip, event, content) {
  if (!tooltip || !content) return;
  tooltip.hidden = false;
  tooltip.replaceChildren(content);
  tooltip.style.left = `${event.clientX}px`;
  tooltip.style.top = `${event.clientY}px`;
}

export function hideTooltip(tooltip) {
  if (!tooltip) return;
  tooltip.hidden = true;
}
