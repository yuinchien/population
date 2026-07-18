import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAgingMilestoneInsight,
  buildCountryDemographicNarrative,
} from "../country-aging-narrative.mjs";

function seriesFor(values) {
  return (key) => values[key] ?? [];
}

function silverDeclineSeries(overrides = {}) {
  return seriesFor({
    population: [100, 99, 98, 97],
    fertility: [1.5, 1.4, 1.3, 1.2],
    netMigrationRate: [0, 0, 0, 0],
    populationGrowth: [-0.5, -0.6, -0.7, -0.8],
    lifeExpectancy: [80, 81, 82, 83],
    olderPopulationShare: [13.9, 14, 19.9, 20.1],
    ...overrides,
  });
}

test("does not add an aging-stage sentence, even for a Silver Decline country", () => {
  // The aging narrative moved to buildAgingMilestoneInsight; this function is
  // now migration-only, so a Silver Decline country gets no sentence here.
  const narrative = buildCountryDemographicNarrative({
    country: { name: "Japan", populations: [100, 99, 98, 97] },
    years: [2005, 2006, 2007, 2008],
    currentYearIndex: 3,
    historicalCutoffYear: 2023,
    seriesFor: silverDeclineSeries(),
  });
  assert.equal(narrative, "");
});

test("does not add an aging-stage sentence outside Silver Decline", () => {
  const narrative = buildCountryDemographicNarrative({
    country: { name: "Example", populations: [100, 101] },
    years: [2024, 2025],
    currentYearIndex: 1,
    historicalCutoffYear: 2023,
    seriesFor: seriesFor({
      population: [100, 101],
      fertility: [2.5, 2.5],
      netMigrationRate: [0, 0],
      populationGrowth: [1, 1],
      lifeExpectancy: [70, 71],
      olderPopulationShare: [20, 21],
    }),
  });
  assert.equal(narrative, "");
});

test("surfaces selected-year migration for Migrant Momentum from 1990", () => {
  const narrative = buildCountryDemographicNarrative({
    country: {
      name: "United States",
      _incomeLabel: "High-income countries",
      populations: [100, 101],
    },
    years: [1989, 1990],
    currentYearIndex: 1,
    historicalCutoffYear: 2023,
    seriesFor: seriesFor({
      population: [100, 101],
      fertility: [1.8, 1.8],
      netMigrationRate: [2.6, 2.8],
      populationGrowth: [0.2, 0.2],
      lifeExpectancy: [75, 75],
    }),
  });
  assert.equal(
    narrative,
    "Net migration was 2.8 per 1,000 people in 1990, helping sustain its Migrant Momentum trajectory.",
  );
});

test("uses forecast migration copy for Migrant Momentum", () => {
  const narrative = buildCountryDemographicNarrative({
    country: {
      name: "United States",
      _incomeLabel: "High-income countries",
      populations: [100, 101],
    },
    years: [2059, 2060],
    currentYearIndex: 1,
    historicalCutoffYear: 2023,
    seriesFor: seriesFor({
      population: [100, 101],
      fertility: [1.6, 1.6],
      netMigrationRate: [3.3, 3.4],
      populationGrowth: [0.1, 0.1],
      lifeExpectancy: [85, 85],
    }),
  });
  assert.equal(
    narrative,
    "Net migration is forecast at 3.4 per 1,000 people in 2060, helping sustain its Migrant Momentum trajectory.",
  );
});

test("does not surface Migrant Momentum migration before 1990", () => {
  const narrative = buildCountryDemographicNarrative({
    country: {
      name: "United States",
      _incomeLabel: "High-income countries",
      populations: [100],
    },
    years: [1989],
    currentYearIndex: 0,
    historicalCutoffYear: 2023,
    seriesFor: seriesFor({
      population: [100],
      fertility: [1.8],
      netMigrationRate: [2.8],
      populationGrowth: [0.2],
      lifeExpectancy: [75],
    }),
  });
  assert.equal(narrative, "");
});

test("aging milestone reports the selected-year UN aging stage", () => {
  const insight = buildAgingMilestoneInsight({
    country: { name: "Nicaragua" },
    years: [2068, 2076],
    currentYearIndex: 1,
    historicalCutoffYear: 2023,
    olderPopulationShare: [14, 16.2],
  });
  assert.equal(insight.value, "16.2% 65+");
  assert.match(insight.text, /expected to become an aged society in 2068/);
  assert.match(insight.text, /By 2076/);
});

test("aging milestone handles countries below the aging threshold", () => {
  const insight = buildAgingMilestoneInsight({
    country: { name: "Example" },
    years: [2020, 2030, 2040],
    currentYearIndex: 0,
    historicalCutoffYear: 2023,
    olderPopulationShare: [5, 6, 6.5],
  });
  assert.equal(insight.value, "5.0% 65+");
  assert.match(insight.text, /remains below the aging-society threshold/);
});
