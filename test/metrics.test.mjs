import assert from "node:assert/strict";
import test from "node:test";
import { stripFormatSuffix } from "../metrics.mjs";

test("stripFormatSuffix keeps the unit immediately adjacent by default", () => {
  assert.equal(
    stripFormatSuffix('3.15<span class="suffix">%</span>'),
    "3.15%",
  );
  assert.equal(
    stripFormatSuffix('-0.1<span class="suffix">‰</span>'),
    "-0.1‰",
  );
});

test("stripFormatSuffix drops the unit entirely when keepUnit is false", () => {
  assert.equal(
    stripFormatSuffix('80.1<span class="suffix">yrs</span>', {
      keepUnit: false,
    }),
    "80.1",
  );
});

test("stripFormatSuffix is a no-op on plain text with no suffix markup", () => {
  assert.equal(stripFormatSuffix("N/A"), "N/A");
  assert.equal(stripFormatSuffix("1.2"), "1.2");
});
