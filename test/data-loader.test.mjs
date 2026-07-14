import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGlobalMetricsIndex,
  buildVariantIndex,
  convertAlpha3ToAlpha2,
  computePeakYear,
  loadPopulationData,
} from "../data-loader.mjs";

test("convertAlpha3ToAlpha2 normalizes and converts shared country codes", () => {
  assert.equal(convertAlpha3ToAlpha2("civ"), "CI");
  assert.equal(convertAlpha3ToAlpha2("XXX"), null);
  assert.equal(convertAlpha3ToAlpha2(null), null);
});

test("computePeakYear returns only interior population peaks", () => {
  const years = [2000, 2001, 2002, 2003];

  assert.equal(computePeakYear([1, 4, 2, 1], years), 2001);
  assert.equal(computePeakYear([4, 3, 2, 1], years), null);
  assert.equal(computePeakYear([1, 2, 3, 4], years), null);
});

test("buildGlobalMetricsIndex indexes metric rows by year", () => {
  const index = buildGlobalMetricsIndex({
    population: [
      { year: 2000, value: 1 },
      { year: 2001, value: 2 },
    ],
    fertility: [{ year: 2001, value: 3 }],
    variants: { high: { population: [{ year: 2001, value: 4 }] } },
  });

  assert.deepEqual(index.get(2000), { population: 1 });
  assert.deepEqual(index.get(2001), { population: 2, fertility: 3 });
  assert.equal(index.get(2001).variants, undefined);
});

test("buildVariantIndex indexes a projection variant by year", () => {
  const index = buildVariantIndex({
    population: [{ year: 2050, value: 9 }],
    fertility: [{ year: 2050, value: 1.8 }],
  });

  assert.deepEqual(index.get(2050), { population: 9, fertility: 1.8 });
});

test("loadPopulationData fetches and prepares app data", async () => {
  const urls = {
    dots: "/dots",
    globalMetrics: "/global",
    incomeGroups: "/income",
    countryDemographics: "/country-demographics",
  };
  const responses = {
    [urls.dots]: {
      years: [2000, 2001, 2002],
      historicalCutoffYear: 2001,
      countries: [{ name: "Aland", populations: [1, 3, 2] }],
    },
    [urls.globalMetrics]: {
      population: [
        { year: 2000, value: 1 },
        { year: 2001, value: 2 },
        { year: 2002, value: 1 },
      ],
      fertility: [{ year: 2001, value: 2.0 }],
      populationGrowth: [{ year: 2001, value: 0.4 }],
      lifeExpectancy: [{ year: 2001, value: 80 }],
      variants: {
        high: { population: [{ year: 2002, value: 3 }] },
        low: { population: [{ year: 2002, value: 1 }] },
      },
    },
    [urls.incomeGroups]: { incomeCodes: {}, countryIncomeCodes: {} },
    [urls.countryDemographics]: { countries: {} },
  };

  const data = await loadPopulationData({
    urls,
    fetchImpl: async (url) => ({
      ok: true,
      json: async () => responses[url],
    }),
  });

  assert.equal(data.countries[0].peakYear, 2001);
  assert.deepEqual(data.years, [2000, 2001, 2002]);
  assert.equal(data.historicalCutoffYear, 2001);
  assert.equal(data.globalMetricsByYear.get(2001).population, 2);
  assert.equal(data.highMetricsByYear.get(2002).population, 3);
  assert.equal(data.lowMetricsByYear.get(2002).population, 1);
  assert.equal(data.globalTrendMilestones.get(2001).title, "Peak Humanity");
});
