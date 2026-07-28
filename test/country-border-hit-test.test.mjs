import test from "node:test";
import assert from "node:assert/strict";
import {
  createCountryBorderHitTester,
  pointInBorderRing,
} from "../country-border-hit-test.mjs";

test("pointInBorderRing distinguishes interior and exterior coordinates", () => {
  const ring = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
  assert.equal(pointInBorderRing(5, 5, ring), true);
  assert.equal(pointInBorderRing(15, 5, ring), false);
});

test("country border hit testing handles polygons crossing the dateline", () => {
  const tester = createCountryBorderHitTester({
    DAT: [[[170, 0], [-170, 0], [-170, 10], [170, 10], [170, 0]]],
  });
  assert.equal(tester.countryAt(179, 5), "DAT");
  assert.equal(tester.countryAt(-179, 5), "DAT");
  assert.equal(tester.countryAt(0, 5), null);
});

test("smaller containing countries win overlapping border hits", () => {
  const tester = createCountryBorderHitTester({
    BIG: [[[0, 0], [20, 0], [20, 20], [0, 20], [0, 0]]],
    SMALL: [[[5, 5], [7, 5], [7, 7], [5, 7], [5, 5]]],
  });
  assert.equal(tester.countryAt(6, 6), "SMALL");
});
