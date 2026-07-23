import { currentAgingStage } from "./country-aging-narrative.mjs";

// Curated groupings beyond region/income, for the detail panel's nav — each
// computed from a country's current-year metrics rather than a static field
// like region/income. `key` is what a legend must match against (via
// matchesAgeCategory/matchesMigrationCategory below); `label` is nav text.
export const AGE_CATEGORIES = [
  { key: "superAged", label: "Super-aged society", color: "var(--color-orange)" },
  { key: "aged", label: "Aged society", color: "var(--color-pink)" },
  { key: "aging", label: "Aging society", color: "var(--color-purple)" },
  { key: "youngDependency", label: "Young dependency", color: "var(--color-teal)" },
];

export const MIGRATION_CATEGORIES = [
  { key: "inflow", label: "Migration inflow", color: "var(--color-blue)" },
  { key: "outflow", label: "Migration outflow", color: "var(--color-yellow)" },
];

// A youth-dependency ratio above this many children per 100 working-age
// adults counts as "Young dependency" — the one age category that isn't one
// of the shared AGING_STAGES thresholds.
export const YOUNG_DEPENDENCY_THRESHOLD = 60;

// Age-grouping columns: age-structure metrics instead of the full detail set.
export const AGE_COLUMN_KEYS = [
  "population",
  "ageDependencyRatio",
  "oldAgeDependencyRatio",
  "youthDependencyRatio",
  "medianAge",
];

// Migration-grouping columns: growth/migration metrics instead of the full
// detail set.
export const MIGRATION_COLUMN_KEYS = [
  "population",
  "populationGrowth",
  "netMigrationRate",
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
