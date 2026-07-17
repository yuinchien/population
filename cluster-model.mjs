// Pure classification/scaling logic for the Cluster view — no DOM, no
// d3-force import, so this stays trivially unit-testable independent of the
// physics/rendering wiring in script.js.
import {
  CLUSTER_PHASES,
  clusterPhaseForYear,
} from "./cluster-config.mjs";

export const PHASE_ONE_START_YEAR = CLUSTER_PHASES.historical.years[0];
export const PHASE_ONE_END_YEAR = CLUSTER_PHASES.historical.years[1];

// UN-defined global replacement-level fertility rate — matches
// METRICS.fertility.referenceValue in metrics.mjs.
export const FERTILITY_REPLACEMENT_THRESHOLD = 2.1;
// Net-zero migration (inflow exactly offsetting outflow) — matches
// METRICS.netMigrationRate.referenceValue in metrics.mjs.
export const MIGRATION_BALANCE_THRESHOLD = 0;
// netMigrationRate is expressed per 1,000 people while populationGrowth is
// percent, so divide migration by 10 before comparing their contributions.
export const MIGRATION_PER_THOUSAND_TO_PERCENT = 10;
// Small negative rates can read as broadly stable across a long projection
// horizon. This tolerance keeps gently contracting immigration destinations
// distinct from sustained decline such as Japan's late-century trajectory.
export const STABLE_TOTAL_GROWTH_FLOOR = -0.35;
// Natural change at or below this level is effectively flat enough for
// immigration to be the meaningful demographic buffer.
export const NEAR_ZERO_NATURAL_CHANGE = 0.2;
// Also recognize countries where immigration supplies a material share of
// positive total growth even while natural increase remains above the
// near-zero band (notably Australia and Gulf migration hubs).
export const IMMIGRATION_GROWTH_SHARE_THRESHOLD = 0.2;
// Avoid treating tiny positive migration values as a demographic buffer.
// Nigeria is at 0.123 per 1,000 in 2100, while the listed immigration
// destinations clear this floor in the years where they enter the cluster.
export const HIGH_NET_MIGRATION_RATE_THRESHOLD = 0.3;
// When natural increase is still clearly positive, immigration must clear a
// higher bar before it can be called the engine of growth. This keeps modest
// inflows such as Japan's 1990 rate out of Migrant Momentum while preserving
// true near-zero-natural-change buffers at the lower floor above.
export const MATERIAL_NET_MIGRATION_RATE_THRESHOLD = 1.1;
export const SILVER_DECLINE_FERTILITY_THRESHOLD = 1.7;
export const HIGH_INCOME_LABEL = "High-income countries";
export const SIGNIFICANT_PEAK_LOSS_THRESHOLD = 0.1;
export const LONG_TERM_DECLINE_YEARS = 90;

export function estimatedNaturalIncrease(
  populationGrowth,
  netMigrationRate,
) {
  if (
    !Number.isFinite(populationGrowth) ||
    !Number.isFinite(netMigrationRate)
  ) {
    return null;
  }
  return (
    populationGrowth -
    netMigrationRate / MIGRATION_PER_THOUSAND_TO_PERCENT
  );
}

export function immigrationGrowthShare(
  populationGrowth,
  netMigrationRate,
) {
  if (
    !Number.isFinite(populationGrowth) ||
    populationGrowth <= 0 ||
    !Number.isFinite(netMigrationRate) ||
    netMigrationRate <= 0
  ) {
    return 0;
  }
  return (
    netMigrationRate /
    MIGRATION_PER_THOUSAND_TO_PERCENT /
    populationGrowth
  );
}

export function populationDeclineContext(
  populationSeries,
  years,
  yearIndex,
  population,
) {
  if (!populationSeries?.length || !Number.isFinite(population)) {
    return { populationLossFromPeak: null, yearsSincePeak: null };
  }
  const endIndex = Math.min(
    populationSeries.length - 1,
    Math.floor(yearIndex),
  );
  let peakPopulation = -Infinity;
  let peakIndex = -1;
  for (let index = 0; index <= endIndex; index++) {
    const value = populationSeries[index];
    if (Number.isFinite(value) && value > peakPopulation) {
      peakPopulation = value;
      peakIndex = index;
    }
  }
  if (peakIndex === -1 || peakPopulation <= 0) {
    return { populationLossFromPeak: null, yearsSincePeak: null };
  }
  const lowerIndex = Math.floor(yearIndex);
  const upperIndex = Math.min(years.length - 1, Math.ceil(yearIndex));
  const fraction = yearIndex - lowerIndex;
  const currentYear =
    years[lowerIndex] + (years[upperIndex] - years[lowerIndex]) * fraction;
  return {
    populationLossFromPeak: Math.max(
      0,
      (peakPopulation - population) / peakPopulation,
    ),
    yearsSincePeak: currentYear - years[peakIndex],
  };
}

// Which of the three demographic "gravity wells" a country belongs to this
// year. When complete change data exists, classification is driven by what
// actually changes population size:
// - immigration materially buffering a near-stable population -> Buffered
//   Growth
// - remaining negative total growth -> Silver Decline
// - remaining positive total growth -> Growth
// Fertility and migration sign are only a fallback for incomplete rows.
export function classifyCountry({
  fertility,
  netMigrationRate,
  populationGrowth,
  incomeLabel,
  populationLossFromPeak,
  yearsSincePeak,
}) {
  if (
    Number.isFinite(populationLossFromPeak) &&
    populationLossFromPeak >= SIGNIFICANT_PEAK_LOSS_THRESHOLD &&
    Number.isFinite(yearsSincePeak) &&
    yearsSincePeak >= LONG_TERM_DECLINE_YEARS
  ) {
    return "silverDecline";
  }
  const naturalIncrease = estimatedNaturalIncrease(
    populationGrowth,
    netMigrationRate,
  );
  if (naturalIncrease != null) {
    if (populationGrowth < STABLE_TOTAL_GROWTH_FLOOR) {
      return "silverDecline";
    }
    const migrationIsHigh =
      netMigrationRate >= HIGH_NET_MIGRATION_RATE_THRESHOLD;
    const migrationShare = immigrationGrowthShare(
      populationGrowth,
      netMigrationRate,
    );
    const fertilityIsSubReplacement =
      Number.isFinite(fertility) &&
      fertility < FERTILITY_REPLACEMENT_THRESHOLD;
    const migrationIsMaterial =
      (naturalIncrease <= NEAR_ZERO_NATURAL_CHANGE && migrationIsHigh) ||
      (migrationShare >= IMMIGRATION_GROWTH_SHARE_THRESHOLD &&
        netMigrationRate >= MATERIAL_NET_MIGRATION_RATE_THRESHOLD);
    const profileMatchesBufferedGrowth =
      fertilityIsSubReplacement ||
      migrationShare >= IMMIGRATION_GROWTH_SHARE_THRESHOLD;
    if (
      incomeLabel === HIGH_INCOME_LABEL &&
      migrationIsHigh &&
      migrationIsMaterial &&
      profileMatchesBufferedGrowth
    ) {
      return "bufferedGrowth";
    }
    if (populationGrowth < 0) return "silverDecline";
    return Number.isFinite(fertility) &&
      fertility >= SILVER_DECLINE_FERTILITY_THRESHOLD
      ? "growth"
      : "silverDecline";
  }
  if (!Number.isFinite(fertility)) return null;
  if (fertility >= SILVER_DECLINE_FERTILITY_THRESHOLD) return "growth";
  if (!Number.isFinite(netMigrationRate)) return null;
  return incomeLabel === HIGH_INCOME_LABEL &&
    netMigrationRate >= HIGH_NET_MIGRATION_RATE_THRESHOLD
    ? "bufferedGrowth"
    : "silverDecline";
}

// Life expectancy dividing line for Phase 1's two "growth" stories. Western
// Europe/North America were already ~65-72 years across 1950-1980 (the
// post-war "Golden Age"); most of the Global South was still ~35-55 and
// climbing fast over the same period — this threshold sits between them.
export const GOLDEN_BOOM_LIFE_EXPECTANCY_THRESHOLD = 65;

// The historical phase deliberately exposes only two narratives. During the
// 1990s transition, Migrant Momentum and Silver Decline can surface when the
// underlying data supports them while growth profiles retain the historical
// split. From 2000 onward, the coarse classifier's full result passes through.
export function refineArchetypeForPhase(archetype, year, lifeExpectancy) {
  if (archetype == null) return null;
  const phase = clusterPhaseForYear(year);
  if (phase === CLUSTER_PHASES.projection) return archetype;
  if (
    phase === CLUSTER_PHASES.transition &&
    (archetype === "bufferedGrowth" || archetype === "silverDecline")
  ) {
    return archetype;
  }
  if (lifeExpectancy == null) return null;
  return lifeExpectancy >= GOLDEN_BOOM_LIFE_EXPECTANCY_THRESHOLD
    ? "goldenBoom"
    : "emergingSurge";
}

// t in [0,1] for how far into the (global, percentile-clipped) median-age
// range a value sits — not a gate, just an intensity used to modulate force
// strength (see forceStrengthFor).
export function silverDeclineAgeIntensity(medianAge, domain) {
  if (medianAge == null || !domain || domain.max === domain.min) return 0;
  return Math.min(
    1,
    Math.max(0, (medianAge - domain.min) / (domain.max - domain.min)),
  );
}

// Modulates the pull *strength* toward a country's current archetype
// anchor, not its target position — a higher median age settles a
// Silver Decline country deeper/more centrally in that well purely
// through the physics, rather than needing a separate "how severely aged"
// archetype or a per-country placement hack.
export function forceStrengthFor(
  archetype,
  medianAge,
  domain,
  { base = 0.05, ageBoost = 0.12 } = {},
) {
  if (archetype !== "silverDecline") return base;
  return base + ageBoost * silverDeclineAgeIntensity(medianAge, domain);
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
