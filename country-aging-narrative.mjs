import {
  classifyCountry,
  populationDeclineContext,
  refineArchetypeForPhase,
} from "./cluster-model.mjs";
import { formatMigrationRate } from "./metrics.mjs";
import {
  agingMilestoneSentence,
  belowAgingThresholdSentence,
  migrationMomentumSentence,
} from "./narrative-copy.mjs";

export const MIGRANT_MOMENTUM_START_YEAR = 1990;

export const AGING_STAGES = [
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
    key: "aging",
    label: "aging society",
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

export function currentAgingStage(share) {
  return AGING_STAGES.find((stage) => meetsStage(share, stage)) ?? null;
}

function formatOlderShare(share) {
  return Number.isFinite(share) ? `${share.toFixed(1)}%` : "";
}

function agingStageArticle(stage) {
  return stage.label.startsWith("a") ? "an" : "a";
}

function firstStageCrossingIndex(olderPopulationShare, stage, maxIndex) {
  return olderPopulationShare.findIndex(
    (share, index) => index <= maxIndex && meetsStage(share, stage),
  );
}

export function buildAgingMilestoneInsight({
  country,
  years,
  currentYearIndex,
  historicalCutoffYear,
  olderPopulationShare,
}) {
  if (!country || currentYearIndex < 0 || !years?.[currentYearIndex]) {
    return null;
  }

  const year = years[currentYearIndex];
  const share = olderPopulationShare?.[currentYearIndex];
  if (!Number.isFinite(share)) return null;

  const stage = currentAgingStage(share);
  const shareCopy = formatOlderShare(share);
  if (stage) {
    const entryIndex = firstStageCrossingIndex(
      olderPopulationShare,
      stage,
      currentYearIndex,
    );
    const entryYear = years[entryIndex] ?? year;
    const article = agingStageArticle(stage);
    return {
      value: `${shareCopy} 65+`,
      text: agingMilestoneSentence({
        countryName: country.name,
        stage,
        article,
        entryYear,
        year,
        shareCopy,
        historicalCutoffYear,
      }),
    };
  }

  const agingStage = AGING_STAGES[AGING_STAGES.length - 1];
  const nextIndex = olderPopulationShare.findIndex(
    (nextShare, index) =>
      index > currentYearIndex && meetsStage(nextShare, agingStage),
  );

  if (nextIndex >= 0) {
    const nextYear = years[nextIndex];
    return {
      value: `${shareCopy} 65+`,
      text: belowAgingThresholdSentence({
        countryName: country.name,
        year,
        shareCopy,
        nextYear,
        historicalCutoffYear,
      }),
    };
  }

  return {
    value: `${shareCopy} 65+`,
    text: belowAgingThresholdSentence({
      countryName: country.name,
      year,
      shareCopy,
      nextYear: null,
      historicalCutoffYear,
    }),
  };
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
    return migrationMomentumSentence({
      year,
      historicalCutoffYear,
      formattedRate,
    });
  }

  // Aging narrative now lives entirely in buildAgingMilestoneInsight (surfaced
  // in the country summary); this function only adds the migration context
  // unique to the Migrant Momentum archetype.
  return "";
}
