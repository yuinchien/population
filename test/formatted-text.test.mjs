import assert from "node:assert/strict";
import test from "node:test";
import { formattedTextParts } from "../formatted-text.mjs";

test("formattedTextParts recognizes only the approved suffix token", () => {
  assert.deepEqual(
    formattedTextParts('Life expectancy is 80.1<span class="suffix">yrs</span>.'),
    [
      { text: "Life expectancy is 80.1" },
      { text: "yrs", className: "suffix" },
      { text: "." },
    ],
  );
});

test("formattedTextParts leaves unexpected markup inert", () => {
  assert.deepEqual(formattedTextParts('<img src=x onerror="alert(1)">'), [
    { text: '<img src=x onerror="alert(1)">' },
  ]);
  assert.deepEqual(formattedTextParts('<span class="admin">unsafe</span>'), [
    { text: '<span class="admin">unsafe</span>' },
  ]);
});

test("formattedTextParts supports multiple suffixes", () => {
  assert.deepEqual(
    formattedTextParts(
      '80.1<span class="suffix">yrs</span> and 1.20<span class="suffix">%</span>',
    ),
    [
      { text: "80.1" },
      { text: "yrs", className: "suffix" },
      { text: " and 1.20" },
      { text: "%", className: "suffix" },
    ],
  );
});
