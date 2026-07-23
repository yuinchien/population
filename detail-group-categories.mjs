import { currentAgingStage } from "./country-aging-narrative.mjs";

// Curated groupings beyond region/income, for the detail panel's nav — each
// computed from a country's current-year metrics rather than a static field
// like region/income. `key` is what a legend must match against (via
// matchesAgeCategory/matchesMigrationCategory below); `label` is nav text.
// `sortKey`/`sortDirection` are the metric and direction each category's
// table should default-sort by when selected (see selectDetailGroup in
// script.js) — the metric that actually explains why a country landed in
// that category, rather than always falling back to population. Direction
// is explicit per category rather than read off the metric's own
// defaultDirection: "outflow" needs ascending (most-negative first) to rank
// the *strongest* outflows on top, the opposite of every other category
// here, where descending already puts the most extreme value first.
export const AGE_CATEGORIES = [
  {
    mode: "age",
    key: "superAged",
    label: "Super-aged society",
    color: "var(--color-orange)",
    sortKey: "olderPopulationShare",
    sortDirection: "desc",
  },
  {
    mode: "age",
    key: "aged",
    label: "Aged society",
    color: "var(--color-pink)",
    sortKey: "olderPopulationShare",
    sortDirection: "desc",
  },
  {
    mode: "age",
    key: "aging",
    label: "Aging society",
    color: "var(--color-purple)",
    sortKey: "olderPopulationShare",
    sortDirection: "desc",
  },
  {
    mode: "age",
    key: "youngDependency",
    label: "Young dependency",
    color: "var(--color-teal)",
    sortKey: "youthDependencyRatio",
    sortDirection: "desc",
  },
];

export const MIGRATION_CATEGORIES = [
  {
    mode: "migration",
    key: "inflow",
    label: "Migration inflow",
    color: "var(--color-blue)",
    sortKey: "netMigrationRate",
    sortDirection: "desc",
  },
  {
    mode: "migration",
    key: "outflow",
    label: "Migration outflow",
    color: "var(--color-yellow)",
    sortKey: "netMigrationRate",
    // Ascending — outflow rates are negative, so the most negative (the
    // strongest outflow) sorts first, instead of desc's "closest to zero".
    sortDirection: "asc",
  },
];

// A youth-dependency ratio above this many children per 100 working-age
// adults counts as "Young dependency" — the one age category that isn't one
// of the shared AGING_STAGES thresholds.
export const YOUNG_DEPENDENCY_THRESHOLD = 0;

// Age-grouping columns: age-structure metrics instead of the full detail set.
export const AGE_COLUMN_KEYS = [
  "population",
  "olderPopulationShare",
  "youthDependencyRatio",
  "ageDependencyRatio",
  "oldAgeDependencyRatio",
  "medianAge",
];

// Migration-grouping columns: growth/migration metrics instead of the full
// detail set.
export const MIGRATION_COLUMN_KEYS = [
  "population",
  "netMigrationRate",
  "populationGrowth",
  "fertility",
];

// Whether a country's current-year older-population-share/youth-dependency
// values put it in the given age category. Reuses the same AGING_STAGES
// thresholds as the rest of the app's aging narrative, so a country
// classified "aged" here is the same one called "aged" everywhere else.
export function matchesAgeCategory(
  categoryKey,
  { olderPopulationShare, youthDependencyRatio },
) {
  if (categoryKey === "youngDependency") {
    return (
      Number.isFinite(youthDependencyRatio) &&
      youthDependencyRatio > YOUNG_DEPENDENCY_THRESHOLD
    );
  }
  return currentAgingStage(olderPopulationShare)?.key === categoryKey;
}

// Whether a country's current-year net migration rate puts it in the given
// migration category — positive is inflow, negative is outflow, zero is
// neither.
export function matchesMigrationCategory(categoryKey, { netMigrationRate }) {
  if (!Number.isFinite(netMigrationRate)) return false;
  return categoryKey === "inflow"
    ? netMigrationRate > 0
    : netMigrationRate < 0;
}

// The curated tables' Population column reads as "how many people this row
// actually contributes to the category", not the country's total headcount
// — e.g. Super-aged society shows the 65+ headcount, not the whole country.
// Derived entirely from metrics already loaded in bulk (no per-country
// age-structure fetch): youth/old-age dependency ratios are both defined
// against the working-age population, and ageDependencyRatio is exactly
// their sum, so workingAgePop = population / (1 + ageDependencyRatio/100)
// and pop-in-band = workingAgePop * ratio/100.
export function subgroupPopulationFor(legend, metrics) {
  const {
    population,
    olderPopulationShare,
    youthDependencyRatio,
    ageDependencyRatio,
    netMigrationRate,
  } = metrics;
  if (!Number.isFinite(population)) return null;
  if (legend?.mode === "age") {
    if (legend.key === "youngDependency") {
      if (
        !Number.isFinite(youthDependencyRatio) ||
        !Number.isFinite(ageDependencyRatio)
      ) {
        return null;
      }
      return (population * youthDependencyRatio) / (100 + ageDependencyRatio);
    }
    if (!Number.isFinite(olderPopulationShare)) return null;
    return (population * olderPopulationShare) / 100;
  }
  if (legend?.mode === "migration") {
    if (!Number.isFinite(netMigrationRate)) return null;
    return (population * netMigrationRate) / 1000;
  }
  return population;
}

// Header text for the Population column above — must name the subgroup
// subgroupPopulationFor actually computed, not just say "Population" as if
// it were the country's total.
export function subgroupPopulationLabelFor(legend) {
  if (legend?.mode === "age") {
    return legend.key === "youngDependency"
      ? "Young population"
      : "Older population";
  }
  if (legend?.mode === "migration") return "Net migration";
  return "Population";
}
