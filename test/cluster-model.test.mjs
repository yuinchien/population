import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyCountry,
  estimatedNaturalIncrease,
  immigrationGrowthShare,
  forceStrengthFor,
  radiusForPopulation,
  refineArchetypeForPhase,
  PHASE_ONE_START_YEAR,
  PHASE_ONE_END_YEAR,
  GOLDEN_BOOM_LIFE_EXPECTANCY_THRESHOLD,
  silverDeclineAgeIntensity,
} from "../cluster-model.mjs";

test("classifyCountry uses measured change before fallback indicators", () => {
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
    "silverDecline",
  );
  assert.equal(
    classifyCountry({ fertility: 1.5, netMigrationRate: 3 }),
    "silverDecline",
  );
  assert.equal(
    classifyCountry({ fertility: 1.5, netMigrationRate: -0.1 }),
    "silverDecline",
  );
  assert.equal(
    classifyCountry({
      fertility: 1.47,
      netMigrationRate: 0.96,
      populationGrowth: -0.5,
    }),
    "silverDecline",
    "decline takes precedence when migration does not prevent contraction",
  );
  assert.equal(
    classifyCountry({
      fertility: 1.91,
      netMigrationRate: 0.123,
      populationGrowth: 0.023,
    }),
    "growth",
    "Nigeria still has positive natural increase in 2100",
  );
  assert.equal(
    classifyCountry({
      fertility: 1.88,
      netMigrationRate: 0.362,
      populationGrowth: 0.484,
    }),
    "growth",
    "Ethiopia still has positive natural increase in 2100",
  );
  assert.equal(
    classifyCountry({
      fertility: 1.6,
      netMigrationRate: 4,
      populationGrowth: 0.2,
      incomeLabel: "High-income countries",
    }),
    "bufferedGrowth",
    "migration-supported growth is buffered rather than natural growth",
  );
  assert.equal(
    classifyCountry({
      fertility: 3,
      netMigrationRate: 1,
      populationGrowth: -0.2,
    }),
    "silverDecline",
    "measured decline takes precedence over above-replacement fertility",
  );
});

test("Migrant Momentum recognizes immigration-buffered country profiles", () => {
  const profiles = [
    ["United States", 1.622, 3.723, 0.548],
    ["Canada", 1.343, 9.275, 1.026],
    ["Australia", 1.638, 5.185, 0.986],
    ["New Zealand", 1.659, 3.599, 0.753],
    ["Germany", 1.448, 0.437, -0.339],
    ["United Kingdom", 1.551, 6.033, 0.622],
    ["Sweden", 1.434, 4.725, 0.489],
    ["Norway", 1.41, 7.954, 0.964],
    ["Switzerland", 1.438, 4.494, 0.536],
    ["Austria", 1.321, 0.966, -0.086],
    ["Saudi Arabia", 2.308, 3.597, 1.776],
    ["United Arab Emirates", 1.213, 25.25, 3.41],
    ["Qatar", 1.717, 15.124, 2.36],
    ["Kuwait", 1.515, 12.488, 2.041],
    ["Bahrain", 1.805, 14.125, 2.395],
  ];
  profiles.forEach(([name, fertility, netMigrationRate, populationGrowth]) => {
    assert.equal(
      classifyCountry({
        fertility,
        netMigrationRate,
        populationGrowth,
        incomeLabel: "High-income countries",
      }),
      "bufferedGrowth",
      name,
    );
  });
});

test("calibrated profiles place Russia, Malaysia, and Libya as intended", () => {
  assert.equal(
    classifyCountry({
      fertility: 1.457,
      netMigrationRate: -1.229,
      populationGrowth: -0.532,
      incomeLabel: "High-income countries",
    }),
    "silverDecline",
    "Russia",
  );
  assert.equal(
    classifyCountry({
      fertility: 1.543,
      netMigrationRate: 4.915,
      populationGrowth: 1.2,
      incomeLabel: "Middle-income countries",
    }),
    "silverDecline",
    "Malaysia",
  );
  assert.equal(
    classifyCountry({
      fertility: 2.298,
      netMigrationRate: 0.467,
      populationGrowth: 1.043,
      incomeLabel: "Middle-income countries",
    }),
    "growth",
    "Libya",
  );
});

test("sustained peak loss moves late-century Russia into Silver Decline", () => {
  assert.equal(
    classifyCountry({
      fertility: 1.592,
      netMigrationRate: 2.164,
      populationGrowth: -0.083,
      incomeLabel: "High-income countries",
      populationLossFromPeak: 0.154,
      yearsSincePeak: 109,
    }),
    "silverDecline",
  );
  assert.equal(
    classifyCountry({
      fertility: 1.597,
      netMigrationRate: 1.994,
      populationGrowth: -0.049,
      incomeLabel: "High-income countries",
      populationLossFromPeak: 0.161,
      yearsSincePeak: 76,
    }),
    "bufferedGrowth",
    "Germany has not been declining for the long-duration override",
  );
});

test("estimatedNaturalIncrease reconciles percent and per-thousand units", () => {
  assert.equal(estimatedNaturalIncrease(0.5, 2), 0.3);
  assert.equal(estimatedNaturalIncrease(0.2, 4), -0.2);
  assert.equal(estimatedNaturalIncrease(null, 1), null);
  assert.equal(estimatedNaturalIncrease(1, null), null);
});

test("immigrationGrowthShare measures immigration's contribution to growth", () => {
  assert.equal(immigrationGrowthShare(1, 5), 0.5);
  assert.equal(immigrationGrowthShare(0, 5), 0);
  assert.equal(immigrationGrowthShare(-0.1, 5), 0);
  assert.equal(immigrationGrowthShare(1, -2), 0);
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

test("silverDeclineAgeIntensity clamps to [0,1] and handles degenerate domains", () => {
  const domain = { min: 20, max: 40 };
  assert.equal(silverDeclineAgeIntensity(30, domain), 0.5);
  assert.equal(silverDeclineAgeIntensity(10, domain), 0, "clamps below 0");
  assert.equal(silverDeclineAgeIntensity(50, domain), 1, "clamps above 1");
  assert.equal(silverDeclineAgeIntensity(null, domain), 0);
  assert.equal(silverDeclineAgeIntensity(30, null), 0);
  assert.equal(
    silverDeclineAgeIntensity(30, { min: 20, max: 20 }),
    0,
    "a zero-width domain shouldn't divide by zero",
  );
});

test("forceStrengthFor only lets medianAge modulate Silver Decline", () => {
  const domain = { min: 20, max: 40 };
  assert.equal(forceStrengthFor("growth", 40, domain), 0.05);
  assert.equal(forceStrengthFor("bufferedGrowth", 40, domain), 0.05);
  const young = forceStrengthFor("silverDecline", 20, domain);
  const old = forceStrengthFor("silverDecline", 40, domain);
  assert.equal(young, 0.05);
  assert.ok(
    old > young,
    "an older Silver Decline country should pull stronger toward its well",
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

test("Phase 1 routes every classified archetype into its phase narratives", () => {
  assert.equal(
    refineArchetypeForPhase("bufferedGrowth", 1960, 70),
    "goldenBoom",
  );
  assert.equal(
    refineArchetypeForPhase("silverDecline", 1960, 30),
    "emergingSurge",
  );
  assert.equal(refineArchetypeForPhase(null, 1960, 70), null);
});

test("Phase 1 splits countries by life expectancy", () => {
  assert.equal(
    refineArchetypeForPhase(
      "growth",
      1960,
      GOLDEN_BOOM_LIFE_EXPECTANCY_THRESHOLD,
    ),
    "goldenBoom",
    "at-threshold life expectancy counts as Golden Boom",
  );
  assert.equal(
    refineArchetypeForPhase("growth", 1960, 70),
    "goldenBoom",
    "high life expectancy is the post-war Golden Age story",
  );
  assert.equal(
    refineArchetypeForPhase("growth", 1960, 40),
    "emergingSurge",
    "low life expectancy is the Global South story",
  );
});

test("the year 2000 switches from Phase 1 to Phase 2", () => {
  assert.equal(
    refineArchetypeForPhase("growth", PHASE_ONE_START_YEAR, 70),
    "goldenBoom",
    "window start is inclusive",
  );
  assert.equal(
    refineArchetypeForPhase("growth", PHASE_ONE_END_YEAR, 70),
    "goldenBoom",
    "window end is inclusive",
  );
  assert.equal(
    refineArchetypeForPhase("growth", PHASE_ONE_START_YEAR - 1, 70),
    "growth",
    "before the window, plain growth is unchanged",
  );
  assert.equal(
    refineArchetypeForPhase("growth", 2000, 40),
    "growth",
    "2000 is the first Phase 2 year",
  );
  assert.equal(refineArchetypeForPhase("growth", null, 70), "growth");
});

test("Phase 1 hides countries without life expectancy rather than surfacing a Phase 2 cluster", () => {
  assert.equal(refineArchetypeForPhase("growth", 1965, null), null);
});
