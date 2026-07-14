import assert from "node:assert/strict";
import test from "node:test";
import { buildCountrySummary } from "../country-summary.mjs";

test("country summary describes a future selected year and peak", () => {
  const summary = buildCountrySummary({
    country: { name: "India", peakYear: 2061, populations: [1_600, 1_700] },
    year: 2036,
    years: [2036, 2061],
    historicalCutoffYear: 2023,
    formatPopulation: (value) => `${value}M`,
  });
  assert.match(summary, /Projected/);
  assert.match(summary, /India/);
  assert.match(summary, /peaks near 1700M/);
  assert.match(summary, /2061/);
});

test("country summary uses historical tense for past years", () => {
  const summary = buildCountrySummary({
    country: { name: "Example", peakYear: 2000, populations: [10, 9] },
    year: 2000,
    years: [2000, 2001],
    historicalCutoffYear: 2023,
    formatPopulation: String,
  });
  assert.match(summary, /Historical/);
  assert.match(summary, /was home/);
  assert.match(summary, /This was its peak/);
});
