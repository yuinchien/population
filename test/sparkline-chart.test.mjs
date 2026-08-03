import assert from "node:assert/strict";
import test from "node:test";
import { createSparklineGeometry } from "../sparkline-chart.mjs";

test("createSparklineGeometry derives min/range/baseline from the series when there's no reference value", () => {
  const geometry = createSparklineGeometry({
    series: [2, 4, 6, 8],
    cutoffIndex: 2,
    width: 100,
    height: 50,
  });
  assert.equal(geometry.min, 2);
  assert.equal(geometry.range, 6);
  assert.equal(geometry.baselineValue, 2);
  assert.equal(geometry.baselineY, 50);
  assert.equal(geometry.cutoffIndex, 2);
});

test("a reference value widens the range and becomes the baseline", () => {
  const geometry = createSparklineGeometry({
    series: [3, 5, 7],
    cutoffIndex: 0,
    width: 100,
    height: 100,
    referenceValue: 2.1,
  });
  assert.equal(geometry.min, 2.1);
  assert.equal(geometry.range, 4.9);
  assert.equal(geometry.baselineValue, 2.1);
  assert.equal(geometry.baselineY, 100);
});

test("rangeValues widens min/range beyond the plotted series alone", () => {
  const geometry = createSparklineGeometry({
    series: [5, 10],
    rangeValues: [5, 10, 20],
    cutoffIndex: 0,
    width: 100,
    height: 50,
  });
  assert.equal(geometry.min, 5);
  assert.equal(geometry.range, 15);
});

test("toXY maps an index/value pair the same way chartXFor/chartYFor would", () => {
  const geometry = createSparklineGeometry({
    series: [2, 4, 6, 8],
    cutoffIndex: 0,
    width: 100,
    height: 50,
  });
  assert.deepEqual(geometry.toXY(0, 2), [0, 50]);
  assert.deepEqual(geometry.toXY(3, 8), [100, 0]);
});

test("pathFor draws the line and areaFor closes it against the baseline", () => {
  const geometry = createSparklineGeometry({
    series: [2, 4, 6, 8],
    cutoffIndex: 0,
    width: 100,
    height: 50,
  });
  assert.equal(
    geometry.pathFor(0, 3),
    "M 0.0 50.0 L 33.3 33.3 L 66.7 16.7 L 100.0 0.0",
  );
  assert.equal(
    geometry.areaFor(0, 3),
    "M 0.0 50.0 L 33.3 33.3 L 66.7 16.7 L 100.0 0.0 L 100.0 50.0 L 0.0 50.0 Z",
  );
});

test("areaFor returns an empty string when every value in range is missing", () => {
  const geometry = createSparklineGeometry({
    series: [null, null],
    cutoffIndex: 0,
    width: 100,
    height: 50,
  });
  assert.equal(geometry.areaFor(0, 1), "");
});

test("pathFor accepts a custom valueToY, overriding the geometry's own yFor", () => {
  const geometry = createSparklineGeometry({
    series: [2, 4, 6, 8],
    cutoffIndex: 0,
    width: 100,
    height: 50,
  });
  const flatY = () => 25;
  assert.equal(
    geometry.pathFor(0, 1, flatY),
    "M 0.0 25.0 L 33.3 25.0",
  );
});
