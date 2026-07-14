import assert from "node:assert/strict";
import test from "node:test";
import { buildCountrySummary } from "../country-summary-model.mjs";

const summaryText = (summary) =>
  summary.segments.map((segment) => segment.text).join("");

test("country summary describes a future selected year and peak", () => {
  const summary = buildCountrySummary({
    country: {
      iso3: "IND",
      name: "India",
      peakYear: 2061,
      populations: [1_600, 1_700],
    },
    year: 2036,
    years: [2036, 2061],
    historicalCutoffYear: 2023,
    formatPopulation: (value) => `${value}M`,
  });
  assert.equal(summary.caption, "Projected");
  assert.equal(summary.flagUrl, "./flags/4x3/in.svg");
  assert.match(summaryText(summary), /India/);
  assert.match(summaryText(summary), /peaks near 1700M/);
  assert.match(summaryText(summary), /2061/);
  assert.deepEqual(summary.segments[0], {
    text: "India",
    className: "country-capsule",
  });
});

test("country summary uses historical tense for past years", () => {
  const summary = buildCountrySummary({
    country: { name: "Example", peakYear: 2000, populations: [10, 9] },
    year: 2000,
    years: [2000, 2001],
    historicalCutoffYear: 2023,
    formatPopulation: String,
  });
  assert.equal(summary.caption, "Historical");
  assert.match(summaryText(summary), /was home/);
  assert.match(summaryText(summary), /This was its peak/);
});
