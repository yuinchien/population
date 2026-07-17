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
  assert.equal(summary.caption, 2036);
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
  assert.equal(summary.caption, 2000);
  assert.match(summaryText(summary), /was home/);
  assert.match(summaryText(summary), /This was its peak/);
});

test("country summary appends the demographic narrative", () => {
  const summary = buildCountrySummary({
    country: { name: "Japan", peakYear: 2000, populations: [10, 9] },
    year: 2001,
    years: [2000, 2001],
    historicalCutoffYear: 2023,
    formatPopulation: String,
    demographicNarrative:
      "Japan became a super-aged society in 2001, when people aged 65 and older reached more than 20% of its population.",
  });
  assert.match(summaryText(summary), /became a super-aged society/);
});

test("projected country summary avoids repeating projected", () => {
  const summary = buildCountrySummary({
    country: {
      iso3: "BGD",
      name: "Bangladesh",
      peakYear: 2071,
      populations: [226.1, 226],
    },
    year: 2073,
    years: [2071, 2073],
    historicalCutoffYear: 2023,
    formatPopulation: (value) => `${value}M`,
    demographicNarrative:
      "Bangladesh is expected to become an aged society in 2071.",
  });
  const copy = summaryText(summary);
  assert.equal(copy.match(/projected/g)?.length, 1);
  assert.match(copy, /down from its peak/);
  assert.match(copy, /is expected to become an aged society/);
});
