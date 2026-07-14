import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLinePath,
  chartXFor,
  chartYFor,
  computeValueRange,
} from "../chart-math.mjs";

test("chartXFor evenly spaces points across the inner width, offset by padding", () => {
  assert.equal(chartXFor(0, 5, 100), 0);
  assert.equal(chartXFor(4, 5, 100), 100);
  assert.equal(chartXFor(2, 5, 100), 50);
  assert.equal(chartXFor(0, 5, 100, 20), 20);
  assert.equal(chartXFor(4, 5, 100, 20), 120);
});

test("chartYFor inverts value into pixel space and falls back to a range of 1", () => {
  assert.equal(chartYFor(0, 0, 10, 100), 100);
  assert.equal(chartYFor(10, 0, 10, 100), 0);
  assert.equal(chartYFor(5, 0, 10, 100), 50);
  assert.equal(chartYFor(0, 0, 10, 100, 20), 120);
  // A zero range (e.g. a single-value series) shouldn't divide by zero.
  assert.equal(chartYFor(5, 5, 0, 100), 100);
});

test("computeValueRange widens min/max to include a reference value", () => {
  assert.deepEqual(computeValueRange([2, 5, 8], null), { min: 2, max: 8, range: 6 });
  assert.deepEqual(computeValueRange([2, 5, 8], 10), { min: 2, max: 10, range: 8 });
  assert.deepEqual(computeValueRange([2, 5, 8], 0), { min: 0, max: 8, range: 8 });
  // Non-finite entries (null/undefined/NaN) are ignored, same as the
  // series data these charts actually plot (missing years).
  assert.deepEqual(computeValueRange([null, 3, undefined, 7], null), {
    min: 3,
    max: 7,
    range: 4,
  });
  // Empty/all-missing series still returns a usable, non-zero range.
  assert.deepEqual(computeValueRange([], null), { min: 0, max: 1, range: 1 });
});

test("buildLinePath draws M/L commands and skips missing values", () => {
  const series = [1, null, 3, undefined, 5];
  const path = buildLinePath(series, 0, 4, (i) => i * 10, (v) => v);
  assert.equal(path, "M 0.0 1.0 L 20.0 3.0 L 40.0 5.0");
});

test("buildLinePath returns an empty string when every value in range is missing", () => {
  const series = [null, null, null];
  assert.equal(buildLinePath(series, 0, 2, (i) => i, (v) => v), "");
});
