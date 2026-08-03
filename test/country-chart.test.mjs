import assert from "node:assert/strict";
import test from "node:test";
import { createCountryChartGeometry } from "../country-chart.mjs";

const padding = { top: 10, right: 10, bottom: 10, left: 10 };

test("createCountryChartGeometry computes count, cutoffIndex, maxPopulation, and layout metrics", () => {
  const geometry = createCountryChartGeometry({
    country: { populations: [10, 20, 30], populationsHigh: [12, 22, 35] },
    years: [2000, 2001, 2002],
    historicalCutoffYear: 2001,
    width: 300,
    height: 100,
    padding,
  });
  assert.equal(geometry.count, 3);
  assert.equal(geometry.cutoffIndex, 1);
  // Widened by populationsHigh (35), not just the plotted series' own max (30).
  assert.equal(geometry.maxPopulation, 35);
  assert.equal(geometry.innerWidth, 280);
  assert.equal(geometry.innerHeight, 80);
  assert.equal(geometry.baselineY, 90);
});

test("createCountryChartGeometry clamps cutoffIndex to 0 when historicalCutoffYear isn't in years", () => {
  const geometry = createCountryChartGeometry({
    country: { populations: [10, 20, 30], populationsHigh: [10, 20, 30] },
    years: [2000, 2001, 2002],
    historicalCutoffYear: 1999,
    width: 300,
    height: 100,
    padding,
  });
  assert.equal(geometry.cutoffIndex, 0);
});

test("createCountryChartGeometry defaults populationSeries to country.populations", () => {
  const withDefault = createCountryChartGeometry({
    country: { populations: [10, 20, 30], populationsHigh: [10, 20, 30] },
    years: [2000, 2001, 2002],
    historicalCutoffYear: 2000,
    width: 300,
    height: 100,
    padding,
  });
  const withOverride = createCountryChartGeometry({
    country: { populations: [10, 20, 30], populationsHigh: [10, 20, 30] },
    populationSeries: [10, 20, 999],
    years: [2000, 2001, 2002],
    historicalCutoffYear: 2000,
    width: 300,
    height: 100,
    padding,
  });
  assert.equal(withDefault.maxPopulation, 30);
  assert.equal(withOverride.maxPopulation, 999);
});

test("xyFor maps an index/value pair to chart pixel coordinates", () => {
  const geometry = createCountryChartGeometry({
    country: { populations: [10, 20, 30], populationsHigh: [12, 22, 35] },
    years: [2000, 2001, 2002],
    historicalCutoffYear: 2001,
    width: 300,
    height: 100,
    padding,
  });
  const [x0, y0] = geometry.xyFor(0, 10);
  const [x2, y2] = geometry.xyFor(2, 30);
  assert.equal(x0, 10);
  assert.equal(Math.round(y0 * 100) / 100, 67.14);
  assert.equal(x2, 290);
  assert.equal(Math.round(y2 * 100) / 100, 21.43);
});
