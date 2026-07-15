import assert from "node:assert/strict";
import test from "node:test";
import { createCountryChartGeometry } from "../country-chart.mjs";
import { createSparklineGeometry } from "../sparkline-chart.mjs";

test("country chart geometry derives its cutoff, baseline, and coordinates", () => {
  const geometry = createCountryChartGeometry({
    country: {
      populations: [10, 20, 30],
      populationsHigh: [10, 25, 40],
    },
    years: [2000, 2001, 2002],
    historicalCutoffYear: 2001,
    width: 300,
    height: 100,
    padding: { top: 10, right: 20, bottom: 10, left: 20 },
  });
  assert.equal(geometry.cutoffIndex, 1);
  assert.equal(geometry.maxPopulation, 40);
  assert.equal(geometry.baselineY, 90);
  assert.deepEqual(geometry.xyFor(0, 0), [20, 90]);
});

test("sparkline geometry builds line and closed area paths from one scale", () => {
  const geometry = createSparklineGeometry({
    series: [1, 2, 3],
    cutoffIndex: 1,
    width: 100,
    height: 40,
    referenceValue: 1,
  });
  assert.match(geometry.pathFor(0, 2), /^M /);
  assert.match(geometry.areaFor(0, 2), / Z$/);
  assert.equal(geometry.baselineValue, 1);
});
