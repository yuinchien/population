import assert from "node:assert/strict";
import test from "node:test";
import {
  AGE_CATEGORIES,
  AGE_COLUMN_KEYS,
  MIGRATION_CATEGORIES,
  MIGRATION_COLUMN_KEYS,
  YOUNG_DEPENDENCY_THRESHOLD,
  matchesAgeCategory,
  matchesMigrationCategory,
  subgroupPopulationFor,
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

test("AGE_CATEGORIES and MIGRATION_CATEGORIES each tag their own legend mode", () => {
  assert.ok(AGE_CATEGORIES.every((category) => category.mode === "age"));
  assert.ok(
    MIGRATION_CATEGORIES.every((category) => category.mode === "migration"),
  );
});

test("AGE_CATEGORIES and MIGRATION_CATEGORIES each name the metric their table should default-sort by", () => {
  assert.deepEqual(
    AGE_CATEGORIES.map((category) => category.sortKey),
    [
      "olderPopulationShare",
      "olderPopulationShare",
      "olderPopulationShare",
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
    matchesAgeCategory("youngDependency", {
      youthDependencyRatio: YOUNG_DEPENDENCY_THRESHOLD + 1,
    }),
    true,
  );
  assert.equal(
    matchesAgeCategory("youngDependency", {
      youthDependencyRatio: YOUNG_DEPENDENCY_THRESHOLD,
    }),
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

test("subgroupPopulationFor returns the 65+ headcount for super-aged/aged/aging", () => {
  const metrics = { population: 1_000_000, olderPopulationShare: 21 };
  assert.equal(
    subgroupPopulationFor({ mode: "age", key: "superAged" }, metrics),
    210_000,
  );
  assert.equal(
    subgroupPopulationFor({ mode: "age", key: "aged" }, metrics),
    210_000,
  );
  assert.equal(
    subgroupPopulationFor({ mode: "age", key: "aging" }, metrics),
    210_000,
  );
});

test("subgroupPopulationFor derives the under-15 headcount for young dependency from youth/age dependency ratios", () => {
  // workingAgePop = population / (1 + ageDependencyRatio/100); under15 =
  // workingAgePop * youthDependencyRatio/100. USA-like figures: pop 1M,
  // youthDependencyRatio 42.178, ageDependencyRatio 54.482.
  const value = subgroupPopulationFor(
    { mode: "age", key: "youngDependency" },
    {
      population: 1_000_000,
      youthDependencyRatio: 42.178,
      ageDependencyRatio: 54.482,
    },
  );
  assert.ok(Math.abs(value - 273_028.57) < 1);
});

test("subgroupPopulationFor returns null when the metric it needs is missing", () => {
  assert.equal(
    subgroupPopulationFor(
      { mode: "age", key: "superAged" },
      { population: 1_000_000, olderPopulationShare: null },
    ),
    null,
  );
  assert.equal(
    subgroupPopulationFor(
      { mode: "age", key: "youngDependency" },
      { population: 1_000_000, youthDependencyRatio: null, ageDependencyRatio: 50 },
    ),
    null,
  );
  assert.equal(
    subgroupPopulationFor(
      { mode: "migration", key: "inflow" },
      { population: 1_000_000, netMigrationRate: null },
    ),
    null,
  );
});

test("subgroupPopulationFor scales population by the net migration rate per 1,000", () => {
  assert.equal(
    subgroupPopulationFor(
      { mode: "migration", key: "inflow" },
      { population: 1_000_000, netMigrationRate: 2.5 },
    ),
    2_500,
  );
  assert.equal(
    subgroupPopulationFor(
      { mode: "migration", key: "outflow" },
      { population: 1_000_000, netMigrationRate: -3.7 },
    ),
    -3_700,
  );
});

test("AGE_COLUMN_KEYS and MIGRATION_COLUMN_KEYS are curated per grouping", () => {
  assert.deepEqual(AGE_COLUMN_KEYS, [
    "population",
    "olderPopulationShare",
    "youthDependencyRatio",
    "ageDependencyRatio",
    "oldAgeDependencyRatio",
    "medianAge",
  ]);
  assert.deepEqual(MIGRATION_COLUMN_KEYS, [
    "population",
    "netMigrationRate",
    "populationGrowth",
  ]);
});
