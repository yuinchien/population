import assert from "node:assert/strict";
import test from "node:test";
import {
  agingSocietiesSentence,
  countryPopulationLeadSegments,
  countryPopulationTrendSegments,
  legacyClusterSentence,
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
