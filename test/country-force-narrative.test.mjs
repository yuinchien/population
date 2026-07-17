import assert from "node:assert/strict";
import test from "node:test";
import { buildCountryForceNarrative } from "../country-force-narrative.mjs";

function seriesFor(values) {
  return (key) => values[key] ?? [];
}

test("country force narrative identifies entry into Silver Decline", () => {
  const narrative = buildCountryForceNarrative({
    country: { name: "Japan", populations: [100, 99, 98] },
    years: [2000, 2001, 2002],
    currentYearIndex: 2,
    historicalCutoffYear: 2023,
    seriesFor: seriesFor({
      population: [100, 99, 98],
      fertility: [2.5, 1.5, 1.4],
      netMigrationRate: [0, 0, 0],
      populationGrowth: [1, -0.5, -0.7],
      lifeExpectancy: [80, 80, 81],
    }),
  });
  assert.match(narrative, /Japan entered Silver Decline around 2001/);
  assert.match(narrative, /natural decrease/);
});

test("country force narrative describes projected Migrant Momentum", () => {
  const narrative = buildCountryForceNarrative({
    country: {
      name: "Example",
      _incomeLabel: "High-income countries",
      populations: [100, 101],
    },
    years: [2023, 2024],
    currentYearIndex: 1,
    historicalCutoffYear: 2023,
    seriesFor: seriesFor({
      population: [100, 101],
      fertility: [2.5, 1.4],
      netMigrationRate: [0, 5],
      populationGrowth: [1, 0.1],
      lifeExpectancy: [80, 80],
    }),
  });
  assert.match(narrative, /is projected to enter Migrant Momentum around 2024/);
  assert.match(narrative, /immigration offset/);
});

test("a long-running growth-family country reports its real entry year, not the Phase 1/Phase 2 boundary", () => {
  // Constant high fertility/growth on both sides of 2000 — the Cluster
  // view's own Phase 1/Phase 2 split (see CLUSTER_PHASES) forces every
  // pre-2000 year through Golden Boom/Emerging Surge regardless of this
  // data, so a naive walk-back would stop dead at 2000 even though the
  // country's actual classification never changes.
  const years = [1985, 1990, 1995, 2000, 2005, 2010];
  const narrative = buildCountryForceNarrative({
    country: { name: "Nigeria", populations: [80, 95, 110, 125, 140, 155] },
    years,
    currentYearIndex: years.length - 1,
    historicalCutoffYear: 2023,
    seriesFor: seriesFor({
      population: [80, 95, 110, 125, 140, 155],
      fertility: [6.5, 6.4, 6.3, 6.2, 6.1, 6.0],
      netMigrationRate: [0, 0, 0, 0, 0, 0],
      populationGrowth: [2.8, 2.8, 2.8, 2.8, 2.8, 2.8],
      lifeExpectancy: [46, 47, 48, 50, 51, 52],
    }),
  });
  assert.doesNotMatch(narrative, /around 2000/);
  assert.match(narrative, /Nigeria's trajectory reflects Natural Expansion/);
});
