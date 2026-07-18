import assert from "node:assert/strict";
import test from "node:test";
import {
  ageBandStart,
  interpolateAgeStructure,
  maxBandShare,
  maxBandTotal,
  buildPyramidGeometry,
  OLD_AGE_THRESHOLD,
} from "../country-pyramid.mjs";

// Two grid years, three bands each (year-major): 1950 then 2000.
const GRID = [1950, 2000];
const AGE_GROUPS = ["0-4", "60-64", "65-69"];
const COUNTRY = {
  //        0-4  60-64 65-69   0-4  60-64 65-69
  male: [200, 100, 50, 100, 120, 90],
  female: [180, 110, 70, 90, 130, 120],
};

test("ageBandStart parses the leading age from band labels", () => {
  assert.equal(ageBandStart("0-4"), 0);
  assert.equal(ageBandStart("65-69"), 65);
  assert.equal(ageBandStart("100+"), 100);
  assert.ok(Number.isNaN(ageBandStart("unknown")));
});

test("interpolateAgeStructure returns grid values exactly at grid years", () => {
  const at1950 = interpolateAgeStructure(COUNTRY, GRID, 1950);
  assert.deepEqual(at1950.male, [200, 100, 50]);
  assert.deepEqual(at1950.female, [180, 110, 70]);
  const at2000 = interpolateAgeStructure(COUNTRY, GRID, 2000);
  assert.deepEqual(at2000.male, [100, 120, 90]);
  assert.deepEqual(at2000.female, [90, 130, 120]);
});

test("interpolateAgeStructure linearly blends between grid years", () => {
  const mid = interpolateAgeStructure(COUNTRY, GRID, 1975); // t = 0.5
  assert.deepEqual(mid.male, [150, 110, 70]);
  assert.deepEqual(mid.female, [135, 120, 95]);
});

test("interpolateAgeStructure clamps years outside the grid to its ends", () => {
  assert.deepEqual(
    interpolateAgeStructure(COUNTRY, GRID, 1900).male,
    [200, 100, 50],
  );
  assert.deepEqual(
    interpolateAgeStructure(COUNTRY, GRID, 2100).male,
    [100, 120, 90],
  );
});

test("interpolateAgeStructure returns null on unresolvable input", () => {
  assert.equal(interpolateAgeStructure(null, GRID, 1950), null);
  assert.equal(interpolateAgeStructure(COUNTRY, [], 1950), null);
  // male length not divisible by grid length
  assert.equal(
    interpolateAgeStructure({ male: [1, 2, 3], female: [1, 2, 3] }, GRID, 1950),
    null,
  );
});

test("maxBandShare is the largest single value across either sex and all years", () => {
  assert.equal(maxBandShare(COUNTRY), 200);
  assert.equal(maxBandShare(null), 0);
});

test("buildPyramidGeometry mirrors male left / female right about the center", () => {
  const geo = buildPyramidGeometry({
    male: [100, 0, 0],
    female: [50, 0, 0],
    ageGroups: AGE_GROUPS,
    maxShare: 100,
    width: 200,
    height: 300,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
  });
  assert.equal(geo.centerX, 100);
  const youngest = geo.bars[0];
  // maxShare 100 over halfWidth 100 => scale 1px per unit
  assert.equal(youngest.male.width, 100);
  assert.equal(youngest.male.x, 0); // centerX - width
  assert.equal(youngest.female.width, 50);
  assert.equal(youngest.female.x, 100); // starts at centerX
});

test("buildPyramidGeometry stacks the oldest band on top and flags 65+", () => {
  const geo = buildPyramidGeometry({
    male: [1, 1, 1],
    female: [1, 1, 1],
    ageGroups: AGE_GROUPS, // 0-4, 60-64, 65-69
    maxShare: 1,
    width: 200,
    height: 300,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
  });
  const youngest = geo.bars[0]; // "0-4"
  const oldest = geo.bars[2]; // "65-69"
  assert.ok(oldest.male.y < youngest.male.y, "oldest band sits above youngest");
  assert.equal(oldest.isOld, true);
  assert.equal(youngest.isOld, false);
  assert.equal(geo.bars[1].isOld, false); // 60-64 is below the 65 threshold
});

test("stacked variant lays age bands left→right and stacks male under female", () => {
  const geo = buildPyramidGeometry({
    male: [30, 0, 0],
    female: [10, 0, 0],
    ageGroups: AGE_GROUPS, // 0-4, 60-64, 65-69
    maxShare: 40, // largest band total (30+10)
    width: 300,
    height: 100,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    bandGap: 0,
    variant: "stacked",
  });
  assert.equal(geo.variant, "stacked");
  const youngest = geo.bars[0];
  const oldest = geo.bars[2];
  // bandWidth 100, youngest column at x 0, oldest at x 200 (left→right)
  assert.equal(youngest.male.x, 0);
  assert.equal(oldest.male.x, 200);
  // scale = height/maxShare = 100/40 = 2.5; male 30 -> 75 tall on the baseline
  assert.equal(youngest.male.height, 75);
  assert.equal(youngest.male.y, 25); // baseline(100) - 75
  // female stacks above male: 10 -> 25 tall, sitting on top
  assert.equal(youngest.female.height, 25);
  assert.equal(youngest.female.y, 0); // baseline - male(75) - female(25)
  // age label anchored at the column center along the baseline
  assert.equal(youngest.ageLabel.x, 50);
  assert.equal(youngest.ageLabel.y, 100);
});

test("maxBandTotal is the largest male+female band sum across all years", () => {
  // 0-4:200+180=380, 60-64:100+110=210, 65-69:50+70=120, then 2000 values
  assert.equal(maxBandTotal(COUNTRY), 380);
  assert.equal(maxBandTotal(null), 0);
});

test("buildPyramidGeometry yields zero-width bars when the scale is empty", () => {
  const geo = buildPyramidGeometry({
    male: [10, 20, 30],
    female: [10, 20, 30],
    ageGroups: AGE_GROUPS,
    maxShare: 0,
    width: 200,
    height: 300,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
  });
  assert.ok(geo.bars.every((b) => b.male.width === 0 && b.female.width === 0));
});

test("buildPyramidGeometry reserves a center gutter for age labels", () => {
  const geo = buildPyramidGeometry({
    male: [100, 0, 0],
    female: [100, 0, 0],
    ageGroups: AGE_GROUPS,
    maxShare: 100,
    width: 220,
    height: 300,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    centerGap: 20,
  });
  const youngest = geo.bars[0];
  // innerWidth 220, centerGap 20 => halfWidth 100, scale 1
  assert.equal(youngest.male.width, 100);
  assert.equal(youngest.male.x, 0); // centerX(110) - gap/2(10) - width(100)
  assert.equal(youngest.female.x, 120); // centerX(110) + gap/2(10)
  assert.equal(youngest.female.width, 100);
});

test("OLD_AGE_THRESHOLD marks the retirement-age boundary", () => {
  assert.equal(OLD_AGE_THRESHOLD, 65);
});
