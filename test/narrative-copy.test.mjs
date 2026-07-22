import assert from "node:assert/strict";
import test from "node:test";
import {
  agingSocietiesSentence,
  countryPopulationLeadSegments,
  countryPopulationTrendSegments,
  legacyClusterSentence,
  lifetimeArrivalCopy,
  lifetimeArrivalFactsSentence,
  lifetimeGlobalLifeExpectancySentence,
  lifetimeHorizonCopy,
  lifetimePresentCopy,
  lifetimePresentPivotSentence,
  lifetimeProjectedCountryPeakSentence,
  migrationMomentumSentence,
  superAgedSocietiesSentence,
} from "../narrative-copy.mjs";

const segmentText = (segments) => segments.map((segment) => segment.text).join("");

test("countryPopulationLeadSegments keeps country and population styling metadata", () => {
  assert.deepEqual(
    countryPopulationLeadSegments({
      countryName: "Japan",
      population: "123.4M",
      year: 2050,
      isProjected: true,
    }),
    [
      { text: "Japan", className: "country-capsule" },
      { text: " is projected to be home to " },
      { text: "123.4M", className: "underlined" },
      { text: " people in 2050. " },
    ],
  );
});

test("countryPopulationTrendSegments centralizes peak/no-peak copy", () => {
  assert.equal(
    segmentText(
      countryPopulationTrendSegments({
        year: 2060,
        finalYear: 2100,
        peakYear: null,
        peakPopulation: null,
        isProjected: true,
        peakIsProjected: false,
      }),
    ),
    "Its population should keep growing through 2100, with no peak yet in sight.",
  );
  assert.equal(
    segmentText(
      countryPopulationTrendSegments({
        year: 2050,
        finalYear: 2100,
        peakYear: 2070,
        peakPopulation: "200M",
        isProjected: true,
        peakIsProjected: true,
      }),
    ),
    "That number should keep climbing until it peaks near 200M in 2070.",
  );
});

test("migrationMomentumSentence handles historical and projected tenses", () => {
  assert.equal(
    migrationMomentumSentence({
      year: 1990,
      historicalCutoffYear: 2024,
      formattedRate: "2.8",
    }),
    "Net migration was 2.8 per 1,000 people in 1990, helping sustain its Migrant Momentum trajectory.",
  );
  assert.equal(
    migrationMomentumSentence({
      year: 2060,
      historicalCutoffYear: 2024,
      formattedRate: "3.4",
    }),
    "Net migration is forecast at 3.4 per 1,000 people in 2060, helping sustain its Migrant Momentum trajectory.",
  );
});

test("superAgedSocietiesSentence and legacyClusterSentence format lifetime copy", () => {
  assert.equal(
    superAgedSocietiesSentence({
      countryName: "Japan",
      selectedCountryIsSuperAged: true,
      count: 4,
    }),
    "Japan will be among 4 nations classified as super-aged societies, grappling with shrinking, aging populations.",
  );
  assert.equal(
    agingSocietiesSentence({
      countryName: "India",
      selectedCountryIsAging: true,
      count: 64,
    }),
    "India will be among 64 nations classified as aging societies, navigating the needs of a rapidly aging population.",
  );
  assert.equal(
    agingSocietiesSentence({
      countryName: "Japan",
      selectedCountryIsAging: true,
      selectedStage: { key: "superAged", label: "super-aged society" },
      olderShare: 37.6,
      count: 142,
    }),
    "Japan will be among 142 nations classified as super-aged societies, with 65+ share reaching 37.6% of its population.",
  );
  assert.equal(
    legacyClusterSentence({ silverDeclineCount: 12, growthCount: 34 }),
    " 12 countries are projected to be in Silver Decline, adjusting to shrinking, super-aged societies",
  );
});

test("lifetime arrival copy joins birth context facts without model data", () => {
  const facts = lifetimeArrivalFactsSentence({
    olderShareAtBirth: 15,
    youthDependencyRatioAtBirth: 82.4,
    peakYear: 2005,
    birthYear: 2010,
  });

  assert.equal(
    facts,
    "it had already reached its population peak in 2005 and officially become an aged society and youth dependency was high at 82.4 children per 100 working-age adults",
  );
  assert.equal(
    lifetimeArrivalCopy({
      birthYear: 2010,
      countryName: "Japan",
      birthPopulation: 7e9,
      countryLifeAtBirth: 83.2,
      arrivalFactsSentence: facts,
      formatPopulation: (value) => `${(value / 1e9).toFixed(1)}B`,
      formatLifeExpectancy: (value) => `${value} yrs`,
    }),
    "When you were born in 2010, you joined a global population of 7.0B people. In Japan, the average life expectancy at birth was 83.2 yrs — it had already reached its population peak in 2005 and officially become an aged society and youth dependency was high at 82.4 children per 100 working-age adults.",
  );
});

test("lifetime present copy keeps personal population peak wording centralized", () => {
  const pivot = lifetimePresentPivotSentence({
    countryName: "Italy",
    countryPeakYear: 2014,
  });

  assert.equal(
    pivot,
    " You have already lived through Italy's population peak in 2014.",
  );
  assert.equal(
    lifetimePresentCopy({
      countryName: "Italy",
      addedSinceBirth: 2.1e9,
      youngerShare: 23,
      presentPivotCopy: pivot,
      formatPopulation: (value) => `${(value / 1e9).toFixed(1)}B`,
    }),
    "Fast forward to today. The world has added 2.1B people since your birth year. In Italy, about 23% of people alive now are younger than you. You have already lived through Italy's population peak in 2014.",
  );
});

test("lifetime horizon copy combines global life, peak, aging, and trajectory sentences", () => {
  assert.equal(
    lifetimeGlobalLifeExpectancySentence({
      birthYear: 2000,
      globalLifeAtBirth: 66.4,
      globalLifeAtFinal: 80,
      formatLifeExpectancy: (value) => `${value.toFixed(1)} yrs`,
    }),
    " Since your birth in 2000, global life expectancy has risen to 80.0 yrs from 66.4 yrs.",
  );
  assert.equal(
    lifetimeProjectedCountryPeakSentence({
      countryName: "India",
      projectedCountryPeakYear: 2061,
    }),
    "India is projected to reach its population peak in 2061.",
  );
  assert.equal(
    lifetimeHorizonCopy({
      finalYear: 2080,
      finalAge: 80,
      finalPopulation: 10.3e9,
      globalLifeChangeCopy:
        " Since your birth in 2000, global life expectancy has risen to 80.0 yrs from 66.4 yrs.",
      projectedCountryPeakCopy:
        "India is projected to reach its population peak in 2061.",
      horizonAgingCopy:
        "India will be among 130 nations classified as aging societies.",
      trajectoryCopy: "Its long-term trajectory is shifting.",
      formatPopulation: (value) => `${(value / 1e9).toFixed(1)}B`,
    }),
    "By 2080, you will be 80 years old in a world of roughly 10.3B people. Since your birth in 2000, global life expectancy has risen to 80.0 yrs from 66.4 yrs. India is projected to reach its population peak in 2061. India will be among 130 nations classified as aging societies. Its long-term trajectory is shifting.",
  );
});
