// Shared coordinate math for this app's SVG line/bar charts — the country
// detail chart, its metric sparklines, and the multi-country trend chart
// each plot a value series against a year axis, and used to each
// reimplement these same formulas slightly differently. Kept here as pure
// functions so a fix to how a point gets positioned only has to be made
// once.

// Evenly spaces `n` points across `innerWidth`, starting at `padLeft`.
export function chartXFor(index, n, innerWidth, padLeft = 0) {
  return padLeft + (index / (n - 1)) * innerWidth;
}

// Maps a value in [min, min+range] to a y pixel within
// [padTop, padTop+innerHeight], inverted so higher values draw higher up
// (SVG's y axis points down).
export function chartYFor(value, min, range, innerHeight, padTop = 0) {
  return padTop + innerHeight - ((value - min) / (range || 1)) * innerHeight;
}

// Widens a series' own [min, max] to also include a fixed reference value
// (fertility's 2.1 replacement line, 0% growth, etc.) so that reference is
// never clipped off the top/bottom of the chart — a no-op when
// referenceValue is null/undefined.
export function computeValueRange(values, referenceValue) {
  const finite = values.filter(Number.isFinite);
  let min = finite.length ? Math.min(...finite) : 0;
  let max = finite.length ? Math.max(...finite) : 1;
  if (referenceValue != null) {
    min = Math.min(min, referenceValue);
    max = Math.max(max, referenceValue);
  }
  return { min, max, range: max - min || 1 };
}

// Builds an SVG path "d" string (M/L commands) from a value series over
// [from, to], skipping null/undefined entries.
export function buildLinePath(series, from, to, xFor, yFor) {
  let d = "";
  for (let i = from; i <= to; i++) {
    const value = series[i];
    if (value == null) continue;
    d += `${d ? " L " : "M "}${xFor(i).toFixed(1)} ${yFor(value).toFixed(1)}`;
  }
  return d;
}
