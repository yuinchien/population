import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildDetailStatus,
  computeGlobalTrendMilestones,
  displayGroupLabel,
  prioritizedMilestoneYears,
} from "../status-insights.mjs";
import {
  DETAIL_METRIC_KEYS,
  GLOBAL_METRIC_KEYS,
  METRICS,
} from "../metrics.mjs";

test("computeGlobalTrendMilestones finds the expected WPP global trend years", async () => {
  const globalData = JSON.parse(
    await readFile(
      new URL("../public/data/population-global.json", import.meta.url),
      "utf8",
    ),
  );
  const milestones = computeGlobalTrendMilestones(globalData);

  assert.deepEqual([...milestones.keys()].sort((a, b) => a - b), [
    2037, 2047, 2050, 2061, 2063, 2070, 2080, 2081, 2084,
  ]);
  assert.equal(milestones.get(2037).title, "The Next Billion");
  assert.match(milestones.get(2037).text, /crosses 9B/);
  assert.equal(milestones.get(2047).title, "Slower Growth Era");
  assert.match(milestones.get(2047).text, /falls below 0\.5%/);
  assert.equal(milestones.get(2050).title, "Below Replacement");
  assert.match(milestones.get(2050).text, /below replacement/);
  assert.equal(milestones.get(2061).title, "Ten Billion World");
  assert.match(milestones.get(2061).text, /above 10B/);
  assert.equal(milestones.get(2063).title, "The Great Age Inversion");
  assert.match(
    milestones.get(2063).text,
    /65 and older outnumber children under 15/,
  );
  assert.equal(milestones.get(2070).title, "A Super-Aged Planet");
  assert.match(milestones.get(2070).text, /super-aged society/);
  assert.equal(milestones.get(2080).title, "Seniors Outnumber Youth");
  assert.match(
    milestones.get(2080).text,
    /permanently outnumber all children and teenagers under 18/,
  );
  assert.equal(milestones.get(2081).title, "Longer Lives");
  assert.match(milestones.get(2081).text, /life expectancy reaches 80 years/);
  assert.equal(milestones.get(2084).title, "Population Plateau");
  assert.match(milestones.get(2084).text, /turning point/);
  assert.deepEqual(prioritizedMilestoneYears(milestones), [
    2084, 2037, 2050, 2061, 2063, 2070, 2080, 2047, 2081,
  ]);
  assert.deepEqual(prioritizedMilestoneYears(milestones, { limit: 3 }), [
    2084, 2037, 2050,
  ]);
  assert.deepEqual(
    prioritizedMilestoneYears(milestones, { minYear: 2050, maxYear: 2081 }),
    [2050, 2061, 2063, 2070, 2080, 2081],
  );
});

test("computeGlobalTrendMilestones keeps the highest-priority copy when milestones overlap", () => {
  const milestones = computeGlobalTrendMilestones({
    population: [
      { year: 2000, value: 9_900_000_000 },
      { year: 2001, value: 10_200_000_000 },
      { year: 2002, value: 10_100_000_000 },
    ],
    fertility: [{ year: 2001, value: 2.0 }],
    populationGrowth: [{ year: 2001, value: 0.4 }],
    lifeExpectancy: [{ year: 2001, value: 80 }],
  });

  assert.equal(milestones.get(2001).priority, 5);
  assert.match(milestones.get(2001).text, /turning point/);
});

test("buildDetailStatus highlights older income-group age profiles", () => {
  const currentYearIndex = 0;
  const highIncome = [
    country("Aland", "High-income countries", "Europe", {
      populationGrowth: 0.1,
      fertility: 1.7,
      lifeExpectancy: 82,
      medianAge: 47,
    }),
    country("Borduria", "High-income countries", "Europe", {
      populationGrowth: -0.2,
      fertility: 1.5,
      lifeExpectancy: 84,
      medianAge: 49,
    }),
  ];
  const others = [
    country("Calistan", "Middle-income countries", "Asia", {
      populationGrowth: 0.8,
      fertility: 2.3,
      lifeExpectancy: 74,
      medianAge: 34,
    }),
  ];

  const text = buildDetailStatus({
    year: 2050,
    countries: highIncome,
    allCountries: [...highIncome, ...others],
    currentYearIndex,
    isProjected: true,
    legend: { mode: "income", label: "High-income countries" },
    metricFor,
  });

  assert.match(text, /^2050 projection:/);
  assert.match(text, /High-income has the oldest age profile/);
  assert.match(text, /Borduria is highest at 49\.0 yrs/);
});

test("buildDetailStatus highlights regional growth when growth dominates", () => {
  const selected = [
    country("Deltora", "Middle-income countries", "South Asia", {
      populationGrowth: 1.2,
      fertility: 2.6,
      lifeExpectancy: 72,
      medianAge: 30,
    }),
    country("Estalia", "Middle-income countries", "South Asia", {
      populationGrowth: 0.7,
      fertility: 2.4,
      lifeExpectancy: 73,
      medianAge: 31,
    }),
  ];
  const others = [
    country("Freedonia", "High-income countries", "Europe", {
      populationGrowth: -0.2,
      fertility: 1.5,
      lifeExpectancy: 82,
      medianAge: 45,
    }),
  ];

  const text = buildDetailStatus({
    year: 2026,
    countries: selected,
    allCountries: [...selected, ...others],
    currentYearIndex: 0,
    isProjected: false,
    legend: { mode: "region", label: "South Asia" },
    metricFor,
  });

  assert.match(text, /^2026:/);
  assert.match(text, /South Asia still leans toward growth/);
  assert.match(text, /Deltora has the fastest rate at 1\.20%/);
});

test("displayGroupLabel removes income suffixes and shortens long MENA labels", () => {
  assert.equal(displayGroupLabel("Low-income countries"), "Low-income");
  assert.equal(
    displayGroupLabel("Middle East, North Africa, Afghanistan & Pakistan"),
    "Middle East & North Africa",
  );
});

test("METRICS centralizes shared metric order, labels, and formatters", () => {
  assert.deepEqual(GLOBAL_METRIC_KEYS, [
    "population",
    "fertility",
    "lifeExpectancy",
    "medianAge",
    "populationGrowth",
  ]);
  assert.deepEqual(DETAIL_METRIC_KEYS, [
    "population",
    "populationGrowth",
    "fertility",
    "lifeExpectancy",
    "medianAge",
  ]);
  assert.equal(METRICS.population.detailLabel, "Population");
  assert.equal(METRICS.populationGrowth.detailLabel, "Growth rate");
  assert.equal(METRICS.population.formatPanel(10_234_567_890), "10.23B");
  assert.equal(METRICS.fertility.formatPanel(1.987), "2.0 births/woman");
  assert.equal(METRICS.lifeExpectancy.format(80.123), "80.1 yrs");
});

function country(name, incomeLabel, region, metrics) {
  return {
    name,
    _incomeLabel: incomeLabel,
    region,
    populations: [1_000_000],
    metrics,
  };
}

function metricFor(testCountry, key) {
  return testCountry.metrics[key];
}
