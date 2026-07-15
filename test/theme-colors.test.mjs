import assert from "node:assert/strict";
import test from "node:test";
import {
  contrastRatio,
  foregroundForColor,
  relativeLuminance,
  resolveCssColor,
} from "../theme-colors.mjs";

const tokens = new Map([
  ["--color-bg", "#050505"],
  ["--color-text", "#f3f1ed"],
  ["--color-yellow", "#f2ee68"],
  ["--color-blue", "#174fe5"],
]);
const styles = { getPropertyValue: (name) => tokens.get(name) ?? "" };

test("resolveCssColor resolves root token references", () => {
  assert.equal(resolveCssColor("var(--color-yellow)", styles), "#f2ee68");
  assert.equal(resolveCssColor("#fff", styles), "#fff");
});

test("relative luminance and contrast follow WCAG ordering", () => {
  assert.ok(relativeLuminance("#fff", styles) > relativeLuminance("#000", styles));
  assert.equal(contrastRatio("#000", "#fff", styles), 21);
});

test("foregroundForColor chooses contrast for bright and dark palette colors", () => {
  assert.equal(
    foregroundForColor("var(--color-yellow)", { styles }),
    "var(--color-bg)",
  );
  assert.equal(
    foregroundForColor("var(--color-blue)", { styles }),
    "var(--color-text)",
  );
});
