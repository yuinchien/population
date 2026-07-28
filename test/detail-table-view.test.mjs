import assert from "node:assert/strict";
import test from "node:test";
import { ratioValueForBar } from "../detail-table-view.mjs";

const columns = [
  {
    key: "population",
    value: (country) => country.population,
  },
];

test("ratioValueForBar preserves an explicit zero value", () => {
  assert.equal(ratioValueForBar(columns, "population", 0), 0);
});

test("ratioValueForBar falls back only when no value was provided", () => {
  assert.equal(
    ratioValueForBar(columns, "population", undefined),
    columns[0].value,
  );
  assert.equal(ratioValueForBar(columns, "population", null), columns[0].value);
});
