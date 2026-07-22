import assert from "node:assert/strict";
import test from "node:test";
import { computeGrowthDecomposition } from "../growth-decomposition-model.mjs";

test("computeGrowthDecomposition splits growth into migration and the natural-increase residual", () => {
  const result = computeGrowthDecomposition({
    populationGrowth: [1.5, -0.2],
    netMigrationRate: [5, -3],
  });
  // 5 per 1,000 -> 0.5%; residual = 1.5 - 0.5 = 1.0.
  assert.deepEqual(result.migration, [0.5, -0.3]);
  assert.equal(result.naturalIncrease[0], 1.0);
  assert.ok(Math.abs(result.naturalIncrease[1] - 0.1) < 1e-9);
});

test("computeGrowthDecomposition marks an index null when either input is missing", () => {
  const result = computeGrowthDecomposition({
    populationGrowth: [1.5, null, 0.8],
    netMigrationRate: [5, 2, undefined],
  });
  assert.deepEqual(result.migration, [0.5, null, null]);
  assert.deepEqual(result.naturalIncrease, [1.0, null, null]);
});

test("computeGrowthDecomposition truncates to the shorter of the two series", () => {
  const result = computeGrowthDecomposition({
    populationGrowth: [1, 2, 3],
    netMigrationRate: [0, 0],
  });
  assert.equal(result.migration.length, 2);
  assert.equal(result.naturalIncrease.length, 2);
});

test("computeGrowthDecomposition handles empty/undefined series", () => {
  assert.deepEqual(computeGrowthDecomposition({}), {
    naturalIncrease: [],
    migration: [],
  });
});
