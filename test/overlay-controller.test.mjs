import test from "node:test";
import assert from "node:assert/strict";
import { nextOverlayFocusIndex } from "../overlay-controller.mjs";

test("overlay focus navigation wraps at both ends", () => {
  assert.equal(nextOverlayFocusIndex(2, false, 3), 0);
  assert.equal(nextOverlayFocusIndex(0, true, 3), 2);
  assert.equal(nextOverlayFocusIndex(0, false, 3), 1);
  assert.equal(nextOverlayFocusIndex(0, false, 0), -1);
});
