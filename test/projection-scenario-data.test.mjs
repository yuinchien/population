import assert from "node:assert/strict";
import test from "node:test";
import {
  createProjectionScenarioData,
  isProjectionScenario,
} from "../projection-scenario-data.mjs";

test("projection scenario data centralizes country population variants", () => {
  const projectionData = createProjectionScenarioData();
  const country = {
    populations: [1, 2, 3],
    populationsHigh: [2, 4, 6],
    populationsLow: [0.5, 1, 1.5],
  };

  projectionData.configure({ years: [2000, 2001, 2002] });
  assert.deepEqual(projectionData.populationSeries(country), [1, 2, 3]);
  assert.equal(projectionData.populationAt(country, 1), 2);

  assert.equal(projectionData.setScenario("high"), true);
  assert.deepEqual(projectionData.populationSeries(country), [2, 4, 6]);
  assert.equal(projectionData.peakYear(country), null);

  assert.equal(projectionData.setScenario("low"), true);
  assert.equal(projectionData.populationAt(country, 2), 1.5);
});

test("projection scenario data overlays global variant metrics", () => {
  const projectionData = createProjectionScenarioData();
  projectionData.configure({
    globalMetricsByYear: new Map([
      [2050, { population: 10, fertility: 1.8 }],
      [2051, { population: 11, fertility: 1.7 }],
    ]),
    highMetricsByYear: new Map([[2050, { population: 12 }]]),
  });

  assert.deepEqual(projectionData.globalMetricsForYear(2050), {
    population: 10,
    fertility: 1.8,
  });

  projectionData.setScenario("high");
  assert.deepEqual(projectionData.globalMetricsForYear(2050), {
    population: 12,
    fertility: 1.8,
  });
  assert.deepEqual([...projectionData.globalMetricsMap().entries()], [
    [2050, { population: 12, fertility: 1.8 }],
    [2051, { population: 11, fertility: 1.7 }],
  ]);
});

test("projection scenario validation rejects unknown variants", () => {
  const projectionData = createProjectionScenarioData();

  assert.equal(isProjectionScenario("medium"), true);
  assert.equal(isProjectionScenario("wild"), false);
  assert.equal(projectionData.setScenario("wild"), false);
  assert.equal(projectionData.scenario(), "medium");
});
