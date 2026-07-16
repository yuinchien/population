import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyCountry,
  contractionAgeIntensity,
  forceStrengthFor,
  radiusForPopulation,
} from "../cluster-model.mjs";

test("classifyCountry sorts by fertility first, then migration", () => {
  assert.equal(
    classifyCountry({ fertility: 2.1, netMigrationRate: -10 }),
    "growth",
  );
  assert.equal(
    classifyCountry({ fertility: 5, netMigrationRate: -10 }),
    "growth",
    "high fertility is Growth regardless of migration sign",
  );
  assert.equal(
    classifyCountry({ fertility: 1.5, netMigrationRate: 0 }),
    "resilient",
  );
  assert.equal(
    classifyCountry({ fertility: 1.5, netMigrationRate: 3 }),
    "resilient",
  );
  assert.equal(
    classifyCountry({ fertility: 1.5, netMigrationRate: -0.1 }),
    "contraction",
  );
});

test("classifyCountry returns null when it can't place a country", () => {
  assert.equal(
    classifyCountry({ fertility: null, netMigrationRate: 5 }),
    null,
  );
  assert.equal(
    classifyCountry({ fertility: 1.5, netMigrationRate: null }),
    null,
    "a below-replacement country can't be placed without migration data",
  );
  // Above replacement, migration doesn't matter at all — including missing.
  assert.equal(
    classifyCountry({ fertility: 2.5, netMigrationRate: null }),
    "growth",
  );
});

test("contractionAgeIntensity clamps to [0,1] and handles degenerate domains", () => {
  const domain = { min: 20, max: 40 };
  assert.equal(contractionAgeIntensity(30, domain), 0.5);
  assert.equal(contractionAgeIntensity(10, domain), 0, "clamps below 0");
  assert.equal(contractionAgeIntensity(50, domain), 1, "clamps above 1");
  assert.equal(contractionAgeIntensity(null, domain), 0);
  assert.equal(contractionAgeIntensity(30, null), 0);
  assert.equal(
    contractionAgeIntensity(30, { min: 20, max: 20 }),
    0,
    "a zero-width domain shouldn't divide by zero",
  );
});

test("forceStrengthFor only lets medianAge modulate the contraction archetype", () => {
  const domain = { min: 20, max: 40 };
  assert.equal(forceStrengthFor("growth", 40, domain), 0.05);
  assert.equal(forceStrengthFor("resilient", 40, domain), 0.05);
  const young = forceStrengthFor("contraction", 20, domain);
  const old = forceStrengthFor("contraction", 40, domain);
  assert.equal(young, 0.05);
  assert.ok(
    old > young,
    "an older contraction-cluster country should pull stronger toward its well",
  );
  assert.equal(old, 0.05 + 0.12);
});

test("radiusForPopulation sqrt-scales so area, not diameter, tracks population", () => {
  const domainMax = 1_000_000_000;
  const small = radiusForPopulation(10_000_000, domainMax);
  const quadrupled = radiusForPopulation(40_000_000, domainMax);
  const ratio = (quadrupled - 3) / (small - 3);
  assert.ok(
    Math.abs(ratio - 2) < 0.01,
    `quadrupling population should ~double the radius above the floor, got ratio ${ratio}`,
  );
  assert.equal(radiusForPopulation(null, domainMax), 3);
  assert.equal(radiusForPopulation(-5, domainMax), 3);
  assert.equal(radiusForPopulation(10_000, 0), 3, "no domain, no crash");
});
