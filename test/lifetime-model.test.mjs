import assert from "node:assert/strict";
import test from "node:test";
import {
  ageAt,
  buildLifetimeStoryAct,
  countryPopulationPeakYearBetween,
  countryTrajectorySummary,
  createLifetimeAggregateCache,
  lifetimeAgeStructureShareYoungerThan,
  lifetimeAgingSocietyCount,
  lifetimeLifeExpectancyComparison,
  lifetimePresentYear,
  lifetimeSuperAgedCount,
  projectedLifespanEnd,
  populationMilestones,
  milestonesInLifespan,
} from "../lifetime-model.mjs";

test("countryTrajectorySummary replaces the selected country's name", () => {
  const summary = countryTrajectorySummary(
    {
      demographic_trajectories: [
        {
          summary_template:
            "Sustained growth will reshape [COUNTRY] through 2100.",
          iso3_list: ["COD", "ETH"],
        },
      ],
    },
    { iso3: "COD", name: "Congo, Dem. Rep." },
  );

  assert.equal(
    summary,
    "Sustained growth will reshape Congo, Dem. Rep. through 2100.",
  );
});

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
      startYear: 1985,
      endYear: 2010,
    }),
    null,
  );
  assert.equal(
    countryPopulationPeakYearBetween({
      country,
      years,
      startYear: 1985,
      endYear: 2020,
      includeStart: false,
    }),
    2020,
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

test("lifetimeAgingSocietyCount counts countries at any UN aging stage", () => {
  assert.equal(
    lifetimeAgingSocietyCount({
      countries: [{ iso3: "AAA" }, { iso3: "BBB" }, { iso3: "CCC" }],
      yearIndex: 1,
      demographicMetrics: {
        countries: {
          AAA: { olderPopulationShare: [5, 6.9] },
          BBB: { olderPopulationShare: [5, 7] },
          CCC: { olderPopulationShare: [5, 20.1] },
        },
      },
    }),
    2,
  );
});

test("createLifetimeAggregateCache reuses aggregate scans per year and scenario", () => {
  const cache = createLifetimeAggregateCache();
  const years = [2000, 2100];
  const countries = [
    {
      iso3: "AAA",
      _incomeLabel: "High-income countries",
      populations: [100, 90],
    },
    {
      iso3: "BBB",
      _incomeLabel: "Low-income countries",
      populations: [100, 200],
    },
  ];
  const demographicMetrics = {
    countries: {
      AAA: {
        fertility: [1.3, 1.2],
        netMigrationRate: [0, -1],
        populationGrowth: [-0.1, -0.5],
        lifeExpectancy: [80, 90],
        olderPopulationShare: [21, 35],
      },
      BBB: {
        fertility: [3, 2.5],
        netMigrationRate: [0, 0],
        populationGrowth: [2, 1.5],
        lifeExpectancy: [60, 70],
        olderPopulationShare: [4, 6],
      },
    },
  };
  let populationSeriesReads = 0;
  const getPopulationSeries = (country) => {
    populationSeriesReads += 1;
    return country.populations;
  };

  const first = cache.get({
    countries,
    years,
    yearIndex: 1,
    demographicMetrics,
    getPopulationSeries,
    scenarioKey: "medium",
  });
  const readsAfterFirst = populationSeriesReads;
  const second = cache.get({
    countries,
    years,
    yearIndex: 1,
    demographicMetrics,
    getPopulationSeries,
    scenarioKey: "medium",
  });

  assert.equal(second, first);
  assert.equal(populationSeriesReads, readsAfterFirst);
  assert.equal(first.agingSocietyCount, 1);
  assert.equal(first.agingStageCounts.get("superAged"), 1);

  const third = cache.get({
    countries,
    years,
    yearIndex: 1,
    demographicMetrics,
    getPopulationSeries,
    scenarioKey: "high",
  });

  assert.notEqual(third, first);
  assert.ok(populationSeriesReads > readsAfterFirst);
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
        youthDependencyRatio: [82.4, 50, 40, 30],
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
    /Since your birth in 1990, global life expectancy has risen to 79.1 yrs from 60.3 yrs/,
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
  assert.deepEqual(act.stats[2], { value: "1", label: "Aging societies" });

  const arrivalAct = buildLifetimeStoryAct({
    country: countries[0],
    actIndex: 0,
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
  assert.match(
    arrivalAct.text,
    /In Testland, the average life expectancy at birth was 80 yrs — that same year,/,
  );
  assert.match(
    arrivalAct.text,
    /that same year, it had officially become an aging society and youth dependency was high at 82\.4 children per 100 working-age adults\./,
  );
});

test("arrival lifetime copy omits the aging note for countries below the threshold at birth", () => {
  const years = [2010, 2026, 2077, 2100];
  const country = {
    iso3: "IND",
    name: "India",
    region: "South Asia",
    populations: [1.2e9, 1.4e9, 1.6e9, 1.5e9],
  };
  const act = buildLifetimeStoryAct({
    country,
    actIndex: 0,
    birthYear: 2010,
    years,
    countries: [country],
    globalMetricsByYear: new Map([
      [2010, { population: 7e9, lifeExpectancy: 70.1 }],
      [2026, { population: 8.3e9, lifeExpectancy: 73 }],
      [2077, { population: 10.3e9, lifeExpectancy: 79.7 }],
      [2100, { population: 10.1e9, lifeExpectancy: 82 }],
    ]),
    demographicMetrics: {
      countries: {
        IND: {
          lifeExpectancy: [67.2, 71, 80, 85],
          fertility: [2.5, 2, 1.7, 1.6],
          netMigrationRate: [0, 0, 0, 0],
          populationGrowth: [1, 0.8, 0, -0.2],
          olderPopulationShare: [5, 8, 20, 25],
          youthDependencyRatio: [55, 65, 50, 40],
        },
      },
    },
    countryAgeStructure: null,
    currentDate: new Date(2026, 0, 1),
    formatPopulation: (value) => `${(value / 1e9).toFixed(1)}B`,
    formatLifeExpectancy: (value) => `${value} yrs`,
  });

  // Below the threshold there is no aging clause — the sentence goes straight
  // from the country name to life expectancy.
  assert.match(
    act.text,
    /In India,\s+the average life expectancy at birth was 67.2 yrs\./,
  );
  assert.doesNotMatch(act.text, /aging society|aging-society threshold/);
  assert.doesNotMatch(act.text, /youth dependency ratio was high/);
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
    /You have already lived through Taiwan's population peak in 2020\./,
  );
  // The generic global milestone (world population passing 8B) is
  // deliberately omitted — it applies to everyone and isn't personal.
  assert.doesNotMatch(act.text, /world population passing/);
});

test("horizon lifetime copy includes projected country population peak before 2100", () => {
  const years = [1985, 2026, 2058, 2070, 2100];
  const country = {
    iso3: "TWN",
    name: "Taiwan",
    populations: [19e6, 23.1e6, 23.5e6, 24e6, 18e6],
  };
  const act = buildLifetimeStoryAct({
    country,
    actIndex: 2,
    birthYear: 1985,
    years,
    countries: [country],
    globalMetricsByYear: new Map([
      [1985, { population: 4.9e9, lifeExpectancy: 62 }],
      [2026, { population: 8.3e9, lifeExpectancy: 73 }],
      [2058, { population: 9.9e9, lifeExpectancy: 77.9 }],
      [2070, { population: 10.1e9, lifeExpectancy: 79 }],
      [2100, { population: 10.1e9, lifeExpectancy: 82 }],
    ]),
    demographicMetrics: {
      countries: {
        TWN: {
          lifeExpectancy: [73, 80, 82, 84, 86],
          fertility: [2, 1, 1, 1, 1],
          netMigrationRate: [0, 0, 0, 0, 0],
          populationGrowth: [1, 0, 0, -0.1, -1],
          olderPopulationShare: [5, 18, 22, 25, 35],
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
    /Taiwan is projected to reach its population peak in 2070\./,
  );
  // Taiwan was already named in the peak sentence above, so the aging
  // sentence refers back to it with a pronoun instead of repeating the name.
  assert.match(
    act.text,
    /It will be among 1 nation classified as super-aged societies, with 65\+ share reaching 22.0% of its population\./,
  );
});

test("horizon lifetime copy preserves the selected country's UN aging stage", () => {
  const years = [2005, 2010, 2026, 2093, 2100];
  const japan = {
    iso3: "JPN",
    name: "Japan",
    populations: [128e6, 128e6, 123e6, 80e6, 75e6],
  };
  const peer = {
    iso3: "PEER",
    name: "Peerland",
    populations: [10e6, 11e6, 12e6, 13e6, 14e6],
  };
  const act = buildLifetimeStoryAct({
    country: japan,
    actIndex: 2,
    birthYear: 2010,
    years,
    countries: [japan, peer],
    globalMetricsByYear: new Map([
      [2005, { population: 6.5e9, lifeExpectancy: 68 }],
      [2010, { population: 7e9, lifeExpectancy: 70.1 }],
      [2026, { population: 8.3e9, lifeExpectancy: 73 }],
      [2093, { population: 10.3e9, lifeExpectancy: 81.1 }],
      [2100, { population: 10.1e9, lifeExpectancy: 82 }],
    ]),
    demographicMetrics: {
      countries: {
        JPN: {
          lifeExpectancy: [82, 83.2, 85, 88, 89],
          fertility: [1.3, 1.3, 1.2, 1.2, 1.2],
          netMigrationRate: [0, 0, 0, 0, 0],
          populationGrowth: [-0.1, -0.1, -0.4, -1, -1],
          olderPopulationShare: [20.1, 23, 30, 38, 40],
        },
        PEER: {
          olderPopulationShare: [5, 6, 10, 22, 23],
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
    /Japan will be among 2 nations classified as super-aged societies, with 65\+ share reaching 38.0% of its population\./,
  );
  assert.doesNotMatch(act.text, /Japan became a super-aged society in 2005/);
  assert.doesNotMatch(act.text, /Japan will be among .* aging societies/);
});

test("arrival copy names the country population peak when it predates the birth year", () => {
  const years = [2000, 2010, 2020, 2030];
  const country = {
    iso3: "PKL",
    name: "Peakland",
    _incomeLabel: "High-income countries",
    populations: [90, 100, 95, 90], // all-time peak at 2010, before birth
  };
  const act = buildLifetimeStoryAct({
    country,
    actIndex: 0,
    birthYear: 2020,
    years,
    countries: [country],
    globalMetricsByYear: new Map(
      years.map((year) => [year, { population: 8e9, lifeExpectancy: 75 }]),
    ),
    demographicMetrics: {
      countries: {
        PKL: {
          lifeExpectancy: [80, 81, 82, 83],
          fertility: [1.5, 1.4, 1.3, 1.2],
          netMigrationRate: [0, 0, 0, 0],
          populationGrowth: [0.1, 0, -0.2, -0.3],
          olderPopulationShare: [10, 14, 18, 22],
          youthDependencyRatio: [30, 28, 26, 24],
        },
      },
    },
    countryAgeStructure: null,
    currentDate: new Date(2020, 0, 1),
    formatPopulation: (value) => `${(value / 1e9).toFixed(1)}B`,
    formatLifeExpectancy: (value) => `${value} yrs`,
  });
  assert.match(
    act.text,
    /that same year, its population had already peaked in 2010 and it had officially become an aged society\./,
  );
});

test("arrival copy omits the population peak when it does not predate birth", () => {
  const years = [2000, 2010, 2020, 2030];
  const country = {
    iso3: "GRW",
    name: "Growland",
    _incomeLabel: "Middle-income countries",
    populations: [90, 100, 110, 120], // still growing — peak is not before birth
  };
  const act = buildLifetimeStoryAct({
    country,
    actIndex: 0,
    birthYear: 2000,
    years,
    countries: [country],
    globalMetricsByYear: new Map(
      years.map((year) => [year, { population: 8e9, lifeExpectancy: 70 }]),
    ),
    demographicMetrics: {
      countries: {
        GRW: {
          lifeExpectancy: [70, 71, 72, 73],
          fertility: [2.5, 2.4, 2.3, 2.2],
          netMigrationRate: [0, 0, 0, 0],
          populationGrowth: [1, 1, 1, 1],
          olderPopulationShare: [5, 6, 7, 8],
          youthDependencyRatio: [40, 40, 40, 40],
        },
      },
    },
    countryAgeStructure: null,
    currentDate: new Date(2020, 0, 1),
    formatPopulation: (value) => `${(value / 1e9).toFixed(1)}B`,
    formatLifeExpectancy: (value) => `${value} yrs`,
  });
  assert.doesNotMatch(act.text, /peaked in/);
});
