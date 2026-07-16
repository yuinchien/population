// Pure classification/scaling logic for the Cluster view — no DOM, no
// d3-force import, so this stays trivially unit-testable independent of the
// physics/rendering wiring in script.js.

// UN-defined global replacement-level fertility rate — matches
// METRICS.fertility.referenceValue in metrics.mjs.
export const FERTILITY_REPLACEMENT_THRESHOLD = 2.1;
// Net-zero migration (inflow exactly offsetting outflow) — matches
// METRICS.netMigrationRate.referenceValue in metrics.mjs.
export const MIGRATION_BALANCE_THRESHOLD = 0;

// Which of the three demographic "gravity wells" a country belongs to this
// year. Returns null when there isn't enough data to place it — the caller
// hides/fades that country's particle for the year rather than guessing.
export function classifyCountry({ fertility, netMigrationRate }) {
  if (fertility == null) return null;
  if (fertility >= FERTILITY_REPLACEMENT_THRESHOLD) return "growth";
  if (netMigrationRate == null) return null;
  return netMigrationRate >= MIGRATION_BALANCE_THRESHOLD
    ? "resilient"
    : "contraction";
}

// Phase 1 window — see refineGrowthArchetype.
export const PHASE_ONE_START_YEAR = 1950;
export const PHASE_ONE_END_YEAR = 1980;
// Life expectancy dividing line for Phase 1's two "growth" stories. Western
// Europe/North America were already ~65-72 years across 1950-1980 (the
// post-war "Golden Age"); most of the Global South was still ~35-55 and
// climbing fast over the same period — this threshold sits between them.
export const GOLDEN_BOOM_LIFE_EXPECTANCY_THRESHOLD = 65;

// Splits the coarse "growth" archetype into two Phase 1 (1950-1980)
// narratives using life expectancy as the distinguishing axis: "goldenBoom"
// (post-war affluent nations — the Baby Boom atop already-high life
// expectancy) vs. "emergingSurge" (the Global South — extreme fertility
// atop rapidly-falling mortality, still climbing toward that same level).
// Both require above-replacement fertility (see classifyCountry), so this
// only ever touches "growth" nodes; every other archetype, any year outside
// the window, and missing life-expectancy data all pass through unchanged
// rather than guessing.
export function refineGrowthArchetype(archetype, year, lifeExpectancy) {
  if (archetype !== "growth") return archetype;
  if (
    year == null ||
    year < PHASE_ONE_START_YEAR ||
    year > PHASE_ONE_END_YEAR
  ) {
    return archetype;
  }
  if (lifeExpectancy == null) return archetype;
  return lifeExpectancy >= GOLDEN_BOOM_LIFE_EXPECTANCY_THRESHOLD
    ? "goldenBoom"
    : "emergingSurge";
}

// t in [0,1] for how far into the (global, percentile-clipped) median-age
// range a value sits — not a gate, just an intensity used to modulate force
// strength (see forceStrengthFor).
export function contractionAgeIntensity(medianAge, domain) {
  if (medianAge == null || !domain || domain.max === domain.min) return 0;
  return Math.min(
    1,
    Math.max(0, (medianAge - domain.min) / (domain.max - domain.min)),
  );
}

// Modulates the pull *strength* toward a country's current archetype
// anchor, not its target position — a higher median age settles a
// Contraction-cluster country deeper/more centrally in that well purely
// through the physics, rather than needing a separate "how severely aged"
// archetype or a per-country placement hack.
export function forceStrengthFor(
  archetype,
  medianAge,
  domain,
  { base = 0.05, ageBoost = 0.12 } = {},
) {
  if (archetype !== "contraction") return base;
  return base + ageBoost * contractionAgeIntensity(medianAge, domain);
}

// Sqrt/area scaling (not linear) — circle *area*, not diameter, is what
// reads as "size" to the eye, the standard bubble-chart convention.
// domainMax is the global max population across every country/year, so a
// circle's size change year to year reflects real population change, not a
// shifting denominator.
export function radiusForPopulation(
  population,
  domainMax,
  { minRadius = 3, maxRadius = 40 } = {},
) {
  if (!Number.isFinite(population) || !domainMax || population <= 0) {
    return minRadius;
  }
  const t = Math.sqrt(Math.min(1, population / domainMax));
  return minRadius + (maxRadius - minRadius) * t;
}
