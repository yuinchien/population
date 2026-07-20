import assert from "node:assert/strict";
import test from "node:test";
import {
  ageAt,
  buildLifetimeStoryAct,
  countryPopulationPeakYearBetween,
  lifetimeAgeStructureShareYoungerThan,
  lifetimeLifeExpectancyComparison,
  lifetimePresentYear,
  lifetimeSuperAgedCount,
  projectedLifespanEnd,
  populationMilestones,
  milestonesInLifespan,
} from "../lifetime-model.mjs";

test("lifetimeLifeExpectancyComparison pins the highlighted country above region means", () => {
  const countries = [
    { iso3: "TWN", name: "Taiwan", region: "East Asia & Pacific" },
    { iso3: "JPN", name: "Japan", region: "East Asia & Pacific" },
    { iso3: "DEU", name: "Germany", region: "Europe & Central Asia" },
  ];
  const demographicMetrics = {
    countries: {
      TWN: { lifeExpectancy: [73.3] },
      JPN: { lifeExpectancy: [76.9] },
      DEU: { lifeExpectancy: [74.1] },
    },
  };
  const rows = lifetimeLifeExpectancyComparison({
    country: countries[0],
    countries,
    demographicMetrics,
    yearIndex: 0,
  });
  // Country pinned first and highlighted.
  assert.deepEqual(rows[0], { label: "Taiwan", value: 73.3, highlight: true });
  // Regions follow, alphabetical by display label, unweighted country means.
  assert.deepEqual(
    rows.slice(1).map((r) => r.label),
    ["East Asia & Pacific", "Europe & Central Asia"],
  );
  assert.equal(rows[1].value, (73.3 + 76.9) / 2); // East Asia mean incl. Taiwan
  assert.equal(rows[1].highlight, false);
});

test("lifetimeLifeExpectancyComparison returns empty when the year is out of range", () => {
  assert.deepEqual(
    lifetimeLifeExpectancyComparison({
      country: { iso3: "TWN", name: "Taiwan", region: "East Asia & Pacific" },
      countries: [],
      demographicMetrics: { countries: {} },
      yearIndex: -1,
    }),
    [],
  );
});

test("ageAt returns your age, or null before you're born", () => {
  assert.equal(ageAt(1990, 2024), 34);
  assert.equal(ageAt(1990, 1990), 0);
  assert.equal(ageAt(1990, 1985), null);
  assert.equal(ageAt(null, 2024), null);
});

test("projectedLifespanEnd rounds birth year + life expectancy", () => {
  assert.equal(projectedLifespanEnd(1990, 72.4), 2062);
  assert.equal(projectedLifespanEnd(1990, 72.6), 2063);
  assert.equal(projectedLifespanEnd(1990, null), null);
  assert.equal(projectedLifespanEnd(null, 72), null);
});

const GLOBAL_ROWS = [
  { year: 2020, value: 7.8e9 },
  { year: 2022, value: 8.0e9 },
  { year: 2037, value: 9.0e9 },
  { year: 2058, value: 9.7e9 },
  { year: 2084, value: 10.2e9 },
  { year: 2100, value: 10.1e9 },
];

test("populationMilestones finds first crossings and the peak", () => {
  const milestones = populationMilestones(GLOBAL_ROWS, [8e9, 9e9, 10e9]);
  assert.deepEqual(milestones, [
    { year: 2022, label: "World population passes 8B" },
    { year: 2037, label: "World population passes 9B" },
    { year: 2084, label: "World population passes 10B" },
    { year: 2084, label: "World population peaks" },
  ]);
});

test("populationMilestones skips thresholds never reached", () => {
  const rows = [
    { year: 2020, value: 7.8e9 },
    { year: 2050, value: 8.5e9 },
    { year: 2080, value: 8.2e9 },
  ];
  const milestones = populationMilestones(rows, [8e9, 9e9, 10e9]);
  // 9B and 10B never reached; only the 8B crossing and the peak remain.
  assert.deepEqual(milestones, [
    { year: 2050, label: "World population passes 8B" },
    { year: 2050, label: "World population peaks" },
  ]);
});

test("populationMilestones handles an empty series", () => {
  assert.deepEqual(populationMilestones([]), []);
});

test("milestonesInLifespan keeps only milestones within your lifespan", () => {
  const milestones = [
    { year: 2022, label: "8B" },
    { year: 2037, label: "9B" },
    { year: 2084, label: "peak" },
  ];
  // Born 2000, projected to 2072 → drops the 2084 peak.
  assert.deepEqual(milestonesInLifespan(milestones, 2000, 2072), [
    { year: 2022, label: "8B" },
    { year: 2037, label: "9B" },
  ]);
  // Born 2030 → drops the 2022 milestone (before you existed).
  assert.deepEqual(milestonesInLifespan(milestones, 2030, 2100), [
    { year: 2037, label: "9B" },
    { year: 2084, label: "peak" },
  ]);
});

test("milestonesInLifespan with no end year includes everything from birth on", () => {
  const milestones = [
    { year: 2022, label: "8B" },
    { year: 2084, label: "peak" },
  ];
  assert.deepEqual(milestonesInLifespan(milestones, 2000, null), milestones);
});

test("countryPopulationPeakYearBetween finds active-series peaks during lifetime present", () => {
  const years = [1985, 2020, 2026, 2100];
  const country = {
    iso3: "TWN",
    name: "Taiwan",
    populations: [19e6, 23.6e6, 23.1e6, 16e6],
  };
  assert.equal(
    countryPopulationPeakYearBetween({
      country,
      years,
      birthYear: 1985,
      presentYear: 2026,
    }),
    2020,
  );
  assert.equal(
    countryPopulationPeakYearBetween({
      country,
      years,
      birthYear: 1985,
      presentYear: 2010,
    }),
    null,
  );
});

test("lifetimePresentYear clamps today's calendar year to available data", () => {
  assert.equal(
    lifetimePresentYear([1950, 1951, 1952], new Date(1940, 0, 1)),
    1950,
  );
  assert.equal(
    lifetimePresentYear([1950, 1951, 1952], new Date(1951, 0, 1)),
    1951,
  );
  assert.equal(
    lifetimePresentYear([1950, 1951, 1952], new Date(2100, 0, 1)),
    1952,
  );
  assert.equal(
    lifetimePresentYear([1990, 2026, 2037], new Date(2025, 0, 1)),
    2026,
  );
});

test("lifetimeAgeStructureShareYoungerThan estimates partial age bands", () => {
  const share = lifetimeAgeStructureShareYoungerThan({
    country: { iso3: "TST" },
    year: 2000,
    age: 7,
    countryAgeStructure: {
      years: [2000],
      ageGroups: ["0-4", "5-9", "10-14"],
      countries: {
        TST: {
          // Band totals: 4000, 4000, 2000. Age 7 includes all 0-4 and 2/5
          // of 5-9 -> 4000 + 1600 = 56%.
          male: [2000, 2000, 1000],
          female: [2000, 2000, 1000],
        },
      },
    },
  });
  assert.equal(Math.round(share), 56);
});

test("lifetimeSuperAgedCount counts countries above the 20% 65+ threshold", () => {
  assert.equal(
    lifetimeSuperAgedCount({
      countries: [{ iso3: "AAA" }, { iso3: "BBB" }, { iso3: "CCC" }],
      yearIndex: 1,
      demographicMetrics: {
        countries: {
          AAA: { olderPopulationShare: [10, 20.1] },
          BBB: { olderPopulationShare: [10, 20] },
          CCC: { olderPopulationShare: [10, 30] },
        },
      },
    }),
    2,
  );
});

test("buildLifetimeStoryAct returns DOM-free act copy and stats", () => {
  const years = [1990, 2026, 2037, 2084];
  const countries = [
    {
      iso3: "AAA",
      name: "Testland",
      _incomeLabel: "High-income countries",
      populations: [10, 12, 13, 14],
    },
  ];
  const globalMetricsByYear = new Map([
    [1990, { population: 5e9, lifeExpectancy: 60.3 }],
    [2026, { population: 8.2e9, lifeExpectancy: 73.8 }],
    [2037, { population: 9e9, lifeExpectancy: 75.4 }],
    [2084, { population: 10e9, lifeExpectancy: 80.3 }],
    [2070, { population: 9.8e9, lifeExpectancy: 79.1 }],
  ]);
  const demographicMetrics = {
    countries: {
      AAA: {
        lifeExpectancy: [80, 82, 84, 86],
        fertility: [2.1, 1.8, 1.7, 1.6],
        netMigrationRate: [0, 2, 2, 2],
        populationGrowth: [1, 0.2, 0.1, 0],
        olderPopulationShare: [10, 18, 21, 30],
      },
    },
  };
  const act = buildLifetimeStoryAct({
    country: countries[0],
    actIndex: 2,
    birthYear: 1990,
    years,
    countries,
    globalMetricsByYear,
    demographicMetrics,
    countryAgeStructure: null,
    currentDate: new Date(2026, 0, 1),
    formatPopulation: (value) => `${value / 1e9}B`,
    formatLifeExpectancy: (value) => `${value} yrs`,
  });

  assert.equal(act.year, 2070);
  assert.match(act.text, /By 2070, you will be 80 years old/);
  assert.match(
    act.text,
    /Global life expectancy at birth has risen to 79.1 yrs from 60.3 yrs since 1990/,
  );
  assert.equal(act.globalLifeExpectancy.birthYear, 1990);
  assert.equal(act.globalLifeExpectancy.finalYear, 2070);
  assert.equal(act.globalLifeExpectancy.birthValue, 60.3);
  assert.equal(act.globalLifeExpectancy.finalValue, 79.1);
  assert.deepEqual(
    act.globalLifeExpectancy.rows.map((row) => row.year),
    [1990, 2026, 2037, 2070, 2084],
  );
  assert.deepEqual(act.stats[0], { value: "80", label: "Your age then" });
});

test("present lifetime copy includes country population peak when it happened since birth", () => {
  const years = [1985, 2020, 2022, 2026, 2100];
  const country = {
    iso3: "TWN",
    name: "Taiwan",
    populations: [19e6, 23.6e6, 23.2e6, 23.1e6, 16e6],
  };
  const act = buildLifetimeStoryAct({
    country,
    actIndex: 1,
    birthYear: 1985,
    years,
    countries: [country],
    globalMetricsByYear: new Map([
      [1985, { population: 4.9e9, lifeExpectancy: 62 }],
      [2020, { population: 7.8e9, lifeExpectancy: 72 }],
      [2022, { population: 8e9, lifeExpectancy: 72.5 }],
      [2026, { population: 8.3e9, lifeExpectancy: 73 }],
      [2100, { population: 10.1e9, lifeExpectancy: 82 }],
    ]),
    demographicMetrics: {
      countries: {
        TWN: {
          lifeExpectancy: [73, 80, 81, 82, 86],
          fertility: [2, 1, 1, 1, 1],
          netMigrationRate: [0, 0, 0, 0, 0],
          populationGrowth: [1, 0, -0.1, -0.1, -1],
          olderPopulationShare: [5, 15, 16, 18, 35],
        },
      },
    },
    countryAgeStructure: null,
    currentDate: new Date(2026, 0, 1),
    formatPopulation: (value) => `${(value / 1e9).toFixed(1)}B`,
    formatLifeExpectancy: (value) => `${value} yrs`,
  });

  assert.match(
    act.text,
    /major pivots, including the moment World population passes 8B in 2022 and Taiwan reaching its population peak in 2020\./,
  );
});
