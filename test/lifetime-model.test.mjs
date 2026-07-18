import assert from "node:assert/strict";
import test from "node:test";
import {
  ageAt,
  projectedLifespanEnd,
  populationMilestones,
  milestonesInLifespan,
} from "../lifetime-model.mjs";

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
