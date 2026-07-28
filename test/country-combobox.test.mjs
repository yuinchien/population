import test from "node:test";
import assert from "node:assert/strict";
import {
  matchCountries,
  nextComboboxIndex,
} from "../country-combobox.mjs";

const countries = [
  { iso3: "USA", name: "United States" },
  { iso3: "GBR", name: "United Kingdom" },
  { iso3: "URY", name: "Uruguay" },
];
const codes = { USA: "US", GBR: "GB", URY: "UY" };

test("matches names, alpha-2 codes, aliases, exclusions, and limits", () => {
  const options = {
    countries,
    convertCode: (iso3) => codes[iso3],
    limit: 2,
  };
  assert.deepEqual(matchCountries("united", options).map((c) => c.iso3), [
    "GBR",
    "USA",
  ]);
  assert.deepEqual(matchCountries("uk", options).map((c) => c.iso3), ["GBR"]);
  assert.deepEqual(
    matchCountries("u", { ...options, exclude: ["GBR"] }).map((c) => c.iso3),
    ["USA", "URY"],
  );
});

test("combobox navigation clamps to available options", () => {
  assert.equal(nextComboboxIndex(-1, 1, 3), 0);
  assert.equal(nextComboboxIndex(0, -1, 3), 0);
  assert.equal(nextComboboxIndex(2, 1, 3), 2);
  assert.equal(nextComboboxIndex(0, 1, 0), -1);
});
