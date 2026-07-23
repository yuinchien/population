import assert from "node:assert/strict";
import test from "node:test";
import {
  AGE_CATEGORIES,
  AGE_COLUMN_KEYS,
  MIGRATION_CATEGORIES,
  MIGRATION_COLUMN_KEYS,
  matchesAgeCategory,
  matchesMigrationCategory,
} from "../detail-group-categories.mjs";

test("AGE_CATEGORIES and MIGRATION_CATEGORIES list the expected keys", () => {
  assert.deepEqual(
    AGE_CATEGORIES.map((category) => category.key),
    ["superAged", "aged", "aging", "youngDependency"],
  );
  assert.deepEqual(
    MIGRATION_CATEGORIES.map((category) => category.key),
    ["inflow", "outflow"],
  );
});

test("AGE_CATEGORIES and MIGRATION_CATEGORIES each name the metric their table should default-sort by", () => {
  assert.deepEqual(
    AGE_CATEGORIES.map((category) => category.sortKey),
    [
      "oldAgeDependencyRatio",
      "oldAgeDependencyRatio",
      "oldAgeDependencyRatio",
      "youthDependencyRatio",
    ],
  );
  assert.deepEqual(
    MIGRATION_CATEGORIES.map((category) => category.sortKey),
    ["netMigrationRate", "netMigrationRate"],
  );
});

test("Migration outflow sorts ascending (most negative first); everything else sorts descending", () => {
  assert.deepEqual(
    AGE_CATEGORIES.map((category) => category.sortDirection),
    ["desc", "desc", "desc", "desc"],
  );
  assert.deepEqual(
    MIGRATION_CATEGORIES.map((category) => category.sortDirection),
    ["desc", "asc"],
  );
});

test("matchesAgeCategory classifies by the shared aging-stage thresholds", () => {
  assert.equal(
    matchesAgeCategory("superAged", { olderPopulationShare: 21 }),
    true,
  );
  assert.equal(
    matchesAgeCategory("superAged", { olderPopulationShare: 19 }),
    false,
  );
  assert.equal(matchesAgeCategory("aged", { olderPopulationShare: 15 }), true);
  assert.equal(
    matchesAgeCategory("aged", { olderPopulationShare: 21 }),
    false,
    "a super-aged country isn't also counted under aged",
  );
  assert.equal(matchesAgeCategory("aging", { olderPopulationShare: 8 }), true);
  assert.equal(matchesAgeCategory("aging", { olderPopulationShare: 5 }), false);
});

test("matchesAgeCategory classifies young dependency above the threshold", () => {
  assert.equal(
    matchesAgeCategory("youngDependency", { youthDependencyRatio: 61 }),
    true,
  );
  assert.equal(
    matchesAgeCategory("youngDependency", { youthDependencyRatio: 60 }),
    false,
  );
  assert.equal(
    matchesAgeCategory("youngDependency", { youthDependencyRatio: null }),
    false,
  );
});

test("matchesMigrationCategory splits on the sign of net migration rate", () => {
  assert.equal(
    matchesMigrationCategory("inflow", { netMigrationRate: 2.5 }),
    true,
  );
  assert.equal(
    matchesMigrationCategory("inflow", { netMigrationRate: -0.1 }),
    false,
  );
  assert.equal(
    matchesMigrationCategory("outflow", { netMigrationRate: -0.1 }),
    true,
  );
  assert.equal(
    matchesMigrationCategory("outflow", { netMigrationRate: 0 }),
    false,
  );
  assert.equal(
    matchesMigrationCategory("inflow", { netMigrationRate: null }),
    false,
  );
});

test("AGE_COLUMN_KEYS and MIGRATION_COLUMN_KEYS are curated per grouping", () => {
  assert.deepEqual(AGE_COLUMN_KEYS, [
    "population",
    "ageDependencyRatio",
    "oldAgeDependencyRatio",
    "youthDependencyRatio",
    "medianAge",
  ]);
  assert.deepEqual(MIGRATION_COLUMN_KEYS, [
    "population",
    "populationGrowth",
    "netMigrationRate",
  ]);
});
