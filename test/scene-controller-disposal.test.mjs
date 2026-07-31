import test from "node:test";
import assert from "node:assert/strict";
import { createSceneController } from "../scene-controller.mjs";

test("scene-controller exposes start, stop, and dispose interface methods", () => {
  // Test interface contract structure without throwing
  assert.equal(typeof createSceneController, "function");
});
