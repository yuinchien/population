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

  assert.deepEqual(
    [...milestones.keys()].sort((a, b) => a - b),
    [2037, 2047, 2050, 2061, 2063, 2070, 2080, 2081, 2084],
  );
  assert.match(milestones.get(2037).text, /^The Next Billion\..*crosses 9B/s);
  assert.match(
    milestones.get(2047).text,
    /^Slower Growth Era\..*falls below 0\.5%/s,
  );
  assert.match(
    milestones.get(2050).text,
    /^Below Replacement\..*below replacement/s,
  );
  assert.match(milestones.get(2061).text, /^Ten Billion World\..*above 10B/s);
  assert.match(
    milestones.get(2063).text,
    /^The Great Age Inversion\..*65 and older outnumber children under 15/s,
  );
  assert.match(
    milestones.get(2070).text,
    /^A Super-Aged Planet\..*super-aged society/s,
  );
  assert.match(
    milestones.get(2080).text,
    /^Seniors Outnumber Youth\..*permanently outnumber all children and teenagers under 18/s,
  );
  assert.match(
    milestones.get(2081).text,
    /^Longer Lives\..*life expectancy reaches 80 years/s,
  );
  assert.match(milestones.get(2084).text, /^Peak Humanity\..*turning point/s);
  assert.deepEqual(
    prioritizedMilestoneYears(milestones),
    [2084, 2037, 2050, 2061, 2063, 2070, 2080, 2047, 2081],
  );
  assert.deepEqual(
    prioritizedMilestoneYears(milestones, { limit: 3 }),
    [2084, 2037, 2050],
  );
  assert.deepEqual(
    prioritizedMilestoneYears(milestones, { minYear: 2050, maxYear: 2081 }),
    [2050, 2061, 2063, 2070, 2080, 2081],
  );
});

test("computeGlobalTrendMilestones adds The African Century when country data is provided", async () => {
  const globalData = JSON.parse(
    await readFile(
      new URL("../public/data/population-global.json", import.meta.url),
      "utf8",
    ),
  );
  const dotsData = JSON.parse(
    await readFile(
      new URL("../public/data/population-dots.json", import.meta.url),
      "utf8",
    ),
  );

  const milestones = computeGlobalTrendMilestones(
    globalData,
    dotsData.countries,
    dotsData.years,
    dotsData.historicalCutoffYear,
  );

  const africanCentury = [...milestones.entries()].find(
    ([, milestone]) => milestone.text.startsWith("The African Century."),
  );
  assert.ok(africanCentury, "expected an African Century milestone");
  const [year, milestone] = africanCentury;
  assert.equal(year, 2036);
  assert.match(milestone.text, /Sub-Saharan Africa's share of global population growth/);

  // Omitting country data (e.g. the plain globalData-only call above)
  // shouldn't add or crash on this milestone — it simply can't be computed.
  const withoutCountries = computeGlobalTrendMilestones(globalData);
  assert.ok(
    ![...withoutCountries.values()].some((m) =>
      m.text.startsWith("The African Century."),
    ),
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

  const status = buildDetailStatus({
    year: 2050,
    countries: highIncome,
    allCountries: [...highIncome, ...others],
    currentYearIndex,
    isProjected: true,
    legend: { mode: "income", label: "High-income countries" },
    metricFor,
  });

  assert.equal(status.period, "projection");
  assert.match(status.text, /^High-income has the oldest age profile/);
  assert.match(status.text, /Borduria is highest at 49\.0 yrs/);
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

  const status = buildDetailStatus({
    year: 2026,
    countries: selected,
    allCountries: [...selected, ...others],
    currentYearIndex: 0,
    isProjected: false,
    legend: { mode: "region", label: "South Asia" },
    metricFor,
  });

  assert.equal(status.period, "historical");
  assert.match(status.text, /^South Asia still leans toward growth/);
  assert.match(status.text, /Deltora has the fastest rate at 1\.20%/);
});

test("displayGroupLabel removes income suffixes and shortens long MENA labels", () => {
  assert.equal(displayGroupLabel("Low-income countries"), "Low-income");
  assert.equal(
    displayGroupLabel("Middle East, North Africa, Afghanistan & Pakistan"),
    "Middle East & North Africa",
  );
});

test("METRICS centralizes shared metric order, labels, and formatters", () => {
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
