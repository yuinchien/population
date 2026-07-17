import {
  classifyCountry,
  populationDeclineContext,
  refineArchetypeForPhase,
} from "./cluster-model.mjs";
import { formatMigrationRate } from "./metrics.mjs";

export const MIGRANT_MOMENTUM_START_YEAR = 1990;

export const AGEING_STAGES = [
  {
    key: "superAged",
    label: "super-aged society",
    threshold: 20,
    includesThreshold: false,
    thresholdCopy: "20%",
    historicalThresholdVerb: "exceeded",
    projectedThresholdVerb: "are expected to exceed",
  },
  {
    key: "aged",
    label: "aged society",
    threshold: 14,
    includesThreshold: true,
    thresholdCopy: "14%",
    historicalThresholdVerb: "reached",
    projectedThresholdVerb: "are expected to reach",
  },
  {
    key: "ageing",
    label: "ageing society",
    threshold: 7,
    includesThreshold: true,
    thresholdCopy: "7%",
    historicalThresholdVerb: "reached",
    projectedThresholdVerb: "are expected to reach",
  },
];

function valueAt(seriesFor, key, index) {
  return seriesFor(key)?.[index] ?? null;
}

function meetsStage(share, stage) {
  if (!Number.isFinite(share)) return false;
  return stage.includesThreshold
    ? share >= stage.threshold
    : share > stage.threshold;
}

export function currentAgeingStage(share) {
  return AGEING_STAGES.find((stage) => meetsStage(share, stage)) ?? null;
}

function currentArchetype({ country, years, currentYearIndex, seriesFor }) {
  const population = valueAt(seriesFor, "population", currentYearIndex);
  const rawArchetype = classifyCountry({
    fertility: valueAt(seriesFor, "fertility", currentYearIndex),
    netMigrationRate: valueAt(seriesFor, "netMigrationRate", currentYearIndex),
    populationGrowth: valueAt(seriesFor, "populationGrowth", currentYearIndex),
    incomeLabel: country._incomeLabel,
    ...populationDeclineContext(
      seriesFor("population"),
      years,
      currentYearIndex,
      population,
    ),
  });
  return refineArchetypeForPhase(
    rawArchetype,
    years[currentYearIndex],
    valueAt(seriesFor, "lifeExpectancy", currentYearIndex),
  );
}

export function buildCountryDemographicNarrative({
  country,
  years,
  currentYearIndex,
  historicalCutoffYear,
  seriesFor,
}) {
  if (!country || currentYearIndex < 0 || !years[currentYearIndex]) return "";
  const year = years[currentYearIndex];
  const archetype = currentArchetype({
    country,
    years,
    currentYearIndex,
    seriesFor,
  });

  if (archetype === "bufferedGrowth" && year >= MIGRANT_MOMENTUM_START_YEAR) {
    const migrationRate = valueAt(
      seriesFor,
      "netMigrationRate",
      currentYearIndex,
    );
    if (!Number.isFinite(migrationRate)) return "";
    const formattedRate = formatMigrationRate(migrationRate);
    const rateCopy =
      year > historicalCutoffYear
        ? `Net migration is projected at ${formattedRate} per 1,000 people in ${year}`
        : `Net migration was ${formattedRate} per 1,000 people in ${year}`;
    return `${rateCopy}, helping sustain its Migrant Momentum trajectory.`;
  }

  if (archetype !== "silverDecline") {
    return "";
  }

  const olderPopulationShare = seriesFor("olderPopulationShare");
  const stage = currentAgeingStage(olderPopulationShare?.[currentYearIndex]);
  if (!stage) return "";

  const entryIndex = olderPopulationShare.findIndex((share, index) =>
    index <= currentYearIndex && meetsStage(share, stage),
  );
  if (entryIndex < 0) return "";

  const entryYear = years[entryIndex];
  const article = stage.label.startsWith("a") ? "an" : "a";
  if (entryYear > historicalCutoffYear) {
    return `Its transition to ${article} ${stage.label} is expected in ${entryYear}, when people aged 65 and older ${stage.projectedThresholdVerb} ${stage.thresholdCopy} of its population.`;
  }
  return `${country.name} became ${article} ${stage.label} in ${entryYear}, when people aged 65 and older ${stage.historicalThresholdVerb} ${stage.thresholdCopy} of its population.`;
}
