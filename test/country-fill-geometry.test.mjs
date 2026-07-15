import assert from "node:assert/strict";
import test from "node:test";
import {
  ringNeedsGlobeTessellation,
  simplifyRing,
  stitchOpenRings,
  unwrapLongitudes,
} from "../country-fill-geometry.mjs";

test("simplifyRing removes low-detail intermediate points without mutating input", () => {
  const ring = Array.from({ length: 20 }, (_, index) => [index, index * 0.01]);
  const original = structuredClone(ring);
  const simplified = simplifyRing(ring, 0.1);
  assert.ok(simplified.length < ring.length);
  assert.deepEqual(ring, original);
  assert.deepEqual(simplified[0], ring[0]);
  assert.deepEqual(simplified.at(-1), ring.at(-1));
});

test("unwrapLongitudes makes a dateline crossing continuous", () => {
  assert.deepEqual(
    unwrapLongitudes([[179, 60], [-179, 61], [-178, 62]]),
    [[179, 60], [181, 61], [182, 62]],
  );
});

test("stitchOpenRings joins Russia-style dateline fragments", () => {
  const fragments = [
    [[130, 42], [179.8, 69]],
    [[-180, 69], [-180, 65]],
    [[179.8, 65], [130, 42]],
  ];
  const original = structuredClone(fragments);
  const [stitched] = stitchOpenRings(fragments);
  assert.equal(stitched.length, 6);
  assert.ok(stitched.every((point, index) =>
    index === 0 || Math.abs(point[0] - stitched[index - 1][0]) <= 180
  ));
  assert.deepEqual(fragments, original);
});

test("ringNeedsGlobeTessellation detects geographically large rings", () => {
  assert.equal(ringNeedsGlobeTessellation([[0, 0], [5, 0], [5, 5]]), false);
  assert.equal(ringNeedsGlobeTessellation([[0, 0], [25, 0], [25, 5]]), true);
});
