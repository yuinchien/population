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

// Largest band total (male+female of a single band, any grid year) — the
// vertical scale for the stacked variant, where each column's height is its
// band's combined share.
export function maxBandTotal(countryData) {
  if (!countryData) return 0;
  const { male = [], female = [] } = countryData;
  let max = 0;
  const n = Math.min(male.length, female.length);
  for (let i = 0; i < n; i++) {
    const total = (male[i] ?? 0) + (female[i] ?? 0);
    if (total > max) max = total;
  }
  return max;
}

// Bar rectangles for the population pyramid. Two variants, both returning each
// bar's male/female as full {x,y,width,height} rects plus an ageLabel anchor,
// so the renderer stays variant-agnostic:
//   "default"  two-sided silhouette — male grows left, female right from the
//              center axis, oldest band on top, age labels down the left.
//   "stacked"  age bands run left→right along the bottom; male + female stack
//              upward within each column, age labels along the bottom.
// Bars come back in ageGroups order (youngest first).
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
  variant = "default",
}) {
  const bands = ageGroups.length;
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;

  if (variant === "stacked") {
    const bandWidth = innerWidth / bands;
    const barWidth = bandWidth * (1 - bandGap);
    const baselineY = padding.top + innerHeight;
    // maxShare is the largest band total here, so the tallest column just
    // fills the height.
    const scale = maxShare > 0 ? innerHeight / maxShare : 0;
    const bars = ageGroups.map((label, bi) => {
      const x = padding.left + bi * bandWidth + (bandWidth - barWidth) / 2;
      const maleHeight = (male[bi] ?? 0) * scale;
      const femaleHeight = (female[bi] ?? 0) * scale;
      return {
        bandIndex: bi,
        label,
        isOld: ageBandStart(label) >= OLD_AGE_THRESHOLD,
        // Male sits on the baseline, female stacks on top of it.
        male: { x, y: baselineY - maleHeight, width: barWidth, height: maleHeight },
        female: {
          x,
          y: baselineY - maleHeight - femaleHeight,
          width: barWidth,
          height: femaleHeight,
        },
        ageLabel: { x: x + barWidth / 2, y: baselineY },
      };
    });
    return { variant, baselineY, bandWidth, bars };
  }

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
      male: { x: centerX - centerGap / 2 - maleWidth, y, width: maleWidth, height: barHeight },
      female: { x: centerX + centerGap / 2, y, width: femaleWidth, height: barHeight },
      ageLabel: { x: padding.left, y: y + barHeight / 2 },
    };
  });

  return { variant: "default", centerX, bandHeight, innerHeight, bars };
}
