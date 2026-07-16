import assert from "node:assert/strict";
import test from "node:test";
import { parseUrlState, serializeUrlState } from "../url-state.mjs";

test("URL state round-trips chart selections", () => {
  const query = serializeUrlState({
    mode: "map",
    view: "chart",
    metric: "fertility",
    countries: ["IND", "USA"],
    year: 2036,
  });
  assert.deepEqual(
    parseUrlState(query, { years: [2036], countryCodes: ["IND", "USA"] }),
    {
      mode: "map",
      view: "chart",
      metric: "fertility",
      countries: ["IND", "USA"],
      year: 2036,
    },
  );
});

test("URL state round-trips the cluster view", () => {
  const query = serializeUrlState({ view: "cluster", year: 2050 });
  assert.deepEqual(parseUrlState(query, { years: [2050] }), {
    view: "cluster",
    year: 2050,
  });
});

test("URL parsing rejects unknown years and countries", () => {
  assert.deepEqual(
    parseUrlState("?view=country&country=XXX&year=1900", {
      years: [2036],
      countryCodes: ["IND"],
    }),
    {},
  );
});
