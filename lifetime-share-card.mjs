import { resolveCssColor } from "./theme-colors.mjs";
import { METRICS } from "./metrics.mjs";

// Renders a section of the Lifetime story to a downloadable PNG.
//
// This draws everything with plain Canvas 2D primitives rather than
// rasterizing the live DOM (e.g. via an SVG <foreignObject> + drawImage）:
// browsers treat any canvas a foreignObject-based image was drawn onto as
// tainted, permanently blocking toBlob()/toDataURL() — confirmed empirically
// (SecurityError) before writing this. Hand-drawing avoids that entirely,
// matching how every other chart in this app (trend chart, sparklines,
// country chart) is already built.
//
// Layout mirrors the live two-column grid (.lifetime-story-section /
// .is-horizon in styles.css): Arrival puts its comparison bars on the left
// and the copy on the right; Horizon puts the copy on the left and the chart
// on the right; Present has no second column live (its population bar sits
// below the copy, both centered), so its card stays single-column too.

const CARD_WIDTH = 1200;
const CARD_HEIGHT = 675;
const CARD_PADDING = 64;
const COLUMN_GAP = 48;
const CONTENT_TOP = 174;
const FOOTER_RESERVED = 70;
const EXPORT_SCALE = 2; // retina-quality output at a fixed CSS-pixel layout
const SERIF = `"Young Serif", serif`;
const SANS = `"DM Sans", sans-serif`;

const CONTENT_WIDTH = CARD_WIDTH - CARD_PADDING * 2;

// Canvas text can't render HTML — METRICS formatters wrap their unit in
// <span class="suffix"> (metrics.mjs) for live-DOM spacing, which
// ctx.fillText would otherwise draw as literal markup. These turn that back
// into plain text: one keeps the unit (restoring the space CSS normally
// adds), the other drops it entirely for a bare number.
function withPlainSuffix(formatted) {
  return formatted.replace(/<span[^>]*>/, " ").replace(/<\/span>/, "");
}
function withoutSuffix(formatted) {
  return formatted.replace(/\s*<span[^>]*>.*<\/span>/, "");
}
const COLUMN_WIDTH = (CONTENT_WIDTH - COLUMN_GAP) / 2;
const LEFT_X = CARD_PADDING;
const RIGHT_X = CARD_PADDING + COLUMN_WIDTH + COLUMN_GAP;
const CONTENT_BOTTOM = CARD_HEIGHT - FOOTER_RESERVED;

function themeColors() {
  const styles = getComputedStyle(document.documentElement);
  const at = (name) => resolveCssColor(`var(${name})`, styles);
  return {
    bg: at("--color-bg"),
    text: at("--color-text"),
    muted: at("--color-muted"),
    yellow: at("--color-yellow"),
  };
}

function wrapText(ctx, text, maxWidth) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// The card's own persistent header — mirrors the app's fixed "Born {year} in
// {country}." title that stays put while sections scroll beneath it.
function drawTitle(ctx, title, colors) {
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.fillStyle = colors.text;
  ctx.font = `400 30px ${SERIF}`;
  ctx.fillText(title, CARD_PADDING, 76);
}

// One act's own label ("THE ARRIVAL" etc.) + wrapped body copy, confined to
// a single column (x/width) — used for both the two-column layouts' text
// side and Present's single, full-width column.
function drawTextColumn(ctx, { x, width, label, text, colors }) {
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = colors.muted;
  ctx.font = `500 15px ${SANS}`;
  ctx.fillText(label.toUpperCase(), x, CONTENT_TOP);

  ctx.fillStyle = colors.text;
  ctx.font = `400 21px ${SANS}`;
  const lineHeight = 31;
  const lines = wrapText(ctx, text, width);
  let y = CONTENT_TOP + 40;
  lines.forEach((line) => {
    ctx.fillText(line, x, y);
    y += lineHeight;
  });
  return y;
}

function drawFooter(ctx, colors) {
  ctx.textAlign = "right";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = colors.muted;
  ctx.font = `400 14px ${SANS}`;
  ctx.fillText(
    "yuinchien.com/population/?view=lifetime",
    CARD_WIDTH - CARD_PADDING,
    CARD_HEIGHT - 32,
  );
}

// --- Arrival: life-expectancy comparison bars ------------------------------

function drawComparison(ctx, rows, { x, width, top, bottom }, colors) {
  if (!rows?.length) return;
  const format = METRICS.lifeExpectancy.format;
  const values = rows.map((row) => row.value);
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const rowHeight = 34;
  const gap = 10;
  const maxRows = Math.max(1, Math.floor((bottom - top) / (rowHeight + gap)));
  // Value text sits after the bar (matching the live pill + label layout),
  // so the bar's own max width has to leave room for it — otherwise a long
  // country/region name and its value collide inside a short bar.
  const valueReserve = 76;
  const maxBarWidth = Math.max(60, width - valueReserve);

  rows.slice(0, maxRows).forEach((row, index) => {
    const rowY = top + index * (rowHeight + gap);
    const barWidth = Math.max(
      maxBarWidth * 0.3,
      Math.min(maxBarWidth, (0.3 + 0.6 * ((row.value - min) / range)) * maxBarWidth),
    );
    ctx.fillStyle = row.highlight ? colors.yellow : colors.muted;
    ctx.beginPath();
    ctx.roundRect(x, rowY, barWidth, rowHeight, rowHeight / 2);
    ctx.fill();

    ctx.fillStyle = colors.bg;
    ctx.font = `500 15px ${SANS}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(row.label, x + 14, rowY + rowHeight / 2 + 1, barWidth - 24);

    ctx.fillStyle = row.highlight ? colors.yellow : colors.muted;
    ctx.font = `500 14px ${SANS}`;
    ctx.textAlign = "left";
    ctx.fillText(
      withPlainSuffix(format(row.value)),
      x + barWidth + 12,
      rowY + rowHeight / 2 + 1,
    );
  });
}

// --- Present: birth/added population split ---------------------------------

function drawPopulationBar(ctx, change, top, colors) {
  if (!change) return;
  const x = CARD_PADDING;
  const width = CONTENT_WIDTH;
  const barHeight = 56;
  const minAddedWidth = 130;
  const birthShare = Number.isFinite(change.birthShare) ? change.birthShare : 0.5;
  const addedShare = Number.isFinite(change.addedShare) ? change.addedShare : 0.5;
  const addedWidth = Math.min(width, Math.max(minAddedWidth, addedShare * width));
  const birthWidth = Math.max(0, width - addedWidth);

  ctx.globalAlpha = 0.5;
  ctx.fillStyle = colors.yellow;
  ctx.fillRect(x, top, birthWidth, barHeight);
  ctx.globalAlpha = 1;

  ctx.fillStyle = colors.yellow;
  ctx.beginPath();
  ctx.roundRect(x + birthWidth, top, addedWidth, barHeight, barHeight / 2);
  ctx.fill();

  ctx.font = `500 17px ${SANS}`;
  ctx.textBaseline = "middle";
  ctx.fillStyle = colors.bg;
  ctx.textAlign = "right";
  ctx.fillText(
    change.birthPopulation ?? "N/A",
    x + Math.max(60, birthWidth - 14),
    top + barHeight / 2 + 1,
  );
  ctx.textAlign = "center";
  ctx.fillText(
    change.addedPopulation ?? "N/A",
    x + birthWidth + addedWidth / 2,
    top + barHeight / 2 + 1,
  );

  ctx.font = `500 15px ${SANS}`;
  ctx.fillStyle = colors.yellow;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.fillText(String(change.birthYear ?? ""), x, top + barHeight + 30);
  ctx.textAlign = "right";
  ctx.fillText(String(change.presentYear ?? ""), x + width, top + barHeight + 30);
}

// --- Horizon: global life-expectancy line chart -----------------------------

function drawGlobalLifeChart(ctx, chart, { x, width, top, bottom }, colors) {
  const rows = chart?.rows ?? [];
  if (rows.length < 2) return;
  const height = bottom - top;

  const years = rows.map((row) => row.year);
  const values = rows.map((row) => row.value);
  const minYear = Math.min(...years);
  const maxYear = Math.max(chart.maxYear ?? years.at(-1), ...years);
  const maxValue = Math.max(...values);
  const valuePadding = Math.max(2, maxValue * 0.08);
  const rangeYear = maxYear - minYear || 1;
  const rangeValue = maxValue + valuePadding || 1;
  const xFor = (year) => x + ((year - minYear) / rangeYear) * width;
  const yFor = (value) => top + height - (value / rangeValue) * height;

  ctx.strokeStyle = colors.muted;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, top);
  ctx.lineTo(x, top + height);
  ctx.lineTo(x + width, top + height);
  ctx.stroke();

  const highlighted = rows.filter(
    (row) => row.year >= chart.birthYear && row.year <= chart.finalYear,
  );
  if (highlighted.length >= 2) {
    ctx.beginPath();
    ctx.moveTo(xFor(highlighted[0].year), yFor(highlighted[0].value));
    highlighted.forEach((row) => ctx.lineTo(xFor(row.year), yFor(row.value)));
    ctx.lineTo(xFor(highlighted.at(-1).year), top + height);
    ctx.lineTo(xFor(highlighted[0].year), top + height);
    ctx.closePath();
    ctx.globalAlpha = 0.23;
    ctx.fillStyle = colors.yellow;
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  ctx.beginPath();
  rows.forEach((row, index) => {
    const px = xFor(row.year);
    const py = yFor(row.value);
    if (index === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.strokeStyle = colors.yellow;
  ctx.lineWidth = 3;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke();

  const format = METRICS.lifeExpectancy.format;
  const markers = [
    { year: chart.birthYear, value: chart.birthValue },
    { year: chart.finalYear, value: chart.finalValue },
  ].filter(
    (marker, index, all) =>
      Number.isFinite(marker.year) &&
      Number.isFinite(marker.value) &&
      all.findIndex((item) => item.year === marker.year) === index,
  );
  markers.forEach((marker) => {
    const px = xFor(marker.year);
    const py = yFor(marker.value);
    ctx.beginPath();
    ctx.arc(px, py, 5, 0, Math.PI * 2);
    ctx.fillStyle = colors.yellow;
    ctx.fill();

    ctx.font = `500 16px ${SANS}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(withoutSuffix(format(marker.value)), px, py - 16);
    ctx.font = `400 14px ${SANS}`;
    ctx.fillText(String(marker.year), px, top + height + 26);
  });
}

// Builds the export canvas for one act and resolves to a PNG Blob. `title` is
// the "Born {year} in {country}." header; `label`/`act` are the story
// section's own label and data (act.comparison/populationChange/
// globalLifeExpectancy select which visual gets drawn and, for the two acts
// with a real two-column layout live, which side it goes on — mirroring
// createStorySection's own branching in lifetime-controller.mjs).
export async function renderLifetimeShareCard({ title, label, act }) {
  const colors = themeColors();
  const canvas = document.createElement("canvas");
  canvas.width = CARD_WIDTH * EXPORT_SCALE;
  canvas.height = CARD_HEIGHT * EXPORT_SCALE;
  const ctx = canvas.getContext("2d");
  ctx.scale(EXPORT_SCALE, EXPORT_SCALE);

  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
  drawTitle(ctx, title, colors);

  if (act.comparison?.length) {
    // Bars left, copy right — matches .has-comparison live.
    drawComparison(
      ctx,
      act.comparison,
      { x: LEFT_X, width: COLUMN_WIDTH, top: CONTENT_TOP, bottom: CONTENT_BOTTOM },
      colors,
    );
    drawTextColumn(ctx, {
      x: RIGHT_X,
      width: COLUMN_WIDTH,
      label,
      text: act.text ?? "",
      colors,
    });
  } else if (act.globalLifeExpectancy) {
    // Copy left, chart right — matches .is-horizon live.
    drawTextColumn(ctx, {
      x: LEFT_X,
      width: COLUMN_WIDTH,
      label,
      text: act.text ?? "",
      colors,
    });
    drawGlobalLifeChart(
      ctx,
      act.globalLifeExpectancy,
      { x: RIGHT_X, width: COLUMN_WIDTH, top: CONTENT_TOP, bottom: CONTENT_BOTTOM - 30 },
      colors,
    );
  } else if (act.populationChange) {
    // No second column live — copy above, bar below, both full-width.
    const textBottom = drawTextColumn(ctx, {
      x: CARD_PADDING,
      width: CONTENT_WIDTH,
      label,
      text: act.text ?? "",
      colors,
    });
    drawPopulationBar(ctx, act.populationChange, textBottom + 30, colors);
  } else {
    drawTextColumn(ctx, {
      x: CARD_PADDING,
      width: CONTENT_WIDTH,
      label,
      text: act.text ?? "",
      colors,
    });
  }

  drawFooter(ctx, colors);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Failed to render canvas to PNG"));
    }, "image/png");
  });
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
