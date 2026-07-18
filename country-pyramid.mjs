// Pure age-structure / population-pyramid geometry — no DOM, no fetching, so
// it stays unit-testable independent of the render wiring in script.js.
// Consumes the country-age-structure.json shape: per country, `male` and
// `female` flat arrays of shares in parts-per-10,000 of total population,
// laid out year-major over a 5-year grid (male+female across all bands sum to
// SHARE_SCALE for each grid year). The viz interpolates to the selected year
// and draws a two-sided pyramid.

export const SHARE_SCALE = 10000; // shares stored as parts per myriad
export const OLD_AGE_THRESHOLD = 65; // bands starting here get the aging accent

// Start age of a 5-year band label ("0-4" -> 0, "65-69" -> 65, "100+" -> 100).
export function ageBandStart(label) {
  const match = String(label).match(/^(\d+)/);
  return match ? Number(match[1]) : NaN;
}

// Linear-interpolate the 5-year grid to an arbitrary year, returning per-band
// male/female shares. Years outside the grid clamp to its ends. Returns null
// when the country/year can't be resolved — the caller hides the pyramid
// rather than guessing, matching the app's precedent for missing data.
export function interpolateAgeStructure(countryData, gridYears, year) {
  if (!countryData || !Array.isArray(gridYears) || gridYears.length === 0) {
    return null;
  }
  const { male, female } = countryData;
  if (!Array.isArray(male) || !Array.isArray(female)) return null;
  const bands = male.length / gridYears.length;
  if (!Number.isInteger(bands) || bands <= 0) return null;
  if (female.length !== male.length) return null;

  const clamped = Math.min(
    Math.max(year, gridYears[0]),
    gridYears[gridYears.length - 1],
  );
  let hi = gridYears.findIndex((gy) => gy >= clamped);
  if (hi < 0) hi = gridYears.length - 1;
  const lo = hi === 0 ? 0 : hi - 1;
  const yLo = gridYears[lo];
  const yHi = gridYears[hi];
  const t = yHi === yLo ? 0 : (clamped - yLo) / (yHi - yLo);

  const at = (arr, gi, bi) => arr[gi * bands + bi];
  const lerp = (a, b) => a + (b - a) * t;
  const maleOut = [];
  const femaleOut = [];
  for (let bi = 0; bi < bands; bi++) {
    maleOut.push(lerp(at(male, lo, bi), at(male, hi, bi)));
    femaleOut.push(lerp(at(female, lo, bi), at(female, hi, bi)));
  }
  return { male: maleOut, female: femaleOut };
}

// Largest single-band share (either sex, any grid year) — a stable x-axis
// scale so scrubbing years reads as bands genuinely growing/shrinking rather
// than the axis rescaling underfoot.
export function maxBandShare(countryData) {
  if (!countryData) return 0;
  const { male = [], female = [] } = countryData;
  let max = 0;
  for (const v of male) if (v > max) max = v;
  for (const v of female) if (v > max) max = v;
  return max;
}

// Bar rectangles for a two-sided pyramid: male grows leftward from the center
// axis, female rightward, oldest band on top (the conventional silhouette).
// Pure geometry — the caller draws the rects. Bars come back in ageGroups
// order (youngest first); each carries its final x/y/width/height so the
// per-year update only has to touch x and width.
export function buildPyramidGeometry({
  male,
  female,
  ageGroups,
  maxShare,
  width,
  height,
  padding,
  bandGap = 0.2,
  centerGap = 0,
}) {
  const bands = ageGroups.length;
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const centerX = padding.left + innerWidth / 2;
  // A center gutter reserves room for age labels between the two sides; each
  // half then scales within whatever width is left.
  const halfWidth = (innerWidth - centerGap) / 2;
  const bandHeight = innerHeight / bands;
  const barHeight = bandHeight * (1 - bandGap);
  const scale = maxShare > 0 ? halfWidth / maxShare : 0;

  const bars = ageGroups.map((label, bi) => {
    const rowFromTop = bands - 1 - bi; // oldest (highest index) at the top
    const y = padding.top + rowFromTop * bandHeight + (bandHeight - barHeight) / 2;
    const maleWidth = (male[bi] ?? 0) * scale;
    const femaleWidth = (female[bi] ?? 0) * scale;
    return {
      bandIndex: bi,
      label,
      isOld: ageBandStart(label) >= OLD_AGE_THRESHOLD,
      y,
      height: barHeight,
      male: { x: centerX - centerGap / 2 - maleWidth, width: maleWidth },
      female: { x: centerX + centerGap / 2, width: femaleWidth },
    };
  });

  return { centerX, bandHeight, innerHeight, bars };
}
