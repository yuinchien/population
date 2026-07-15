import assert from "node:assert/strict";
import test from "node:test";
import { smoothCalloutPosition } from "../callout-controller.mjs";

test("smoothCalloutPosition starts at the target and eases subsequent movement", () => {
  assert.equal(smoothCalloutPosition(null, 100, 16, 90), 100);
  const next = smoothCalloutPosition(0, 100, 16, 90);
  assert.ok(next > 0 && next < 100);
});

test("smoothCalloutPosition is stable when no frame time elapsed", () => {
  assert.equal(smoothCalloutPosition(40, 100, 0, 90), 40);
});
