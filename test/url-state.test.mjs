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

test("URL state round-trips the lifetime view", () => {
  const query = serializeUrlState({
    view: "lifetime",
    birthYear: 1990,
    country: "IND",
    year: 2024,
  });
  assert.deepEqual(
    parseUrlState(query, {
      years: [1990, 2024],
      countryCodes: ["IND", "USA"],
    }),
    { view: "lifetime", birthYear: 1990, country: "IND", year: 2024 },
  );
});

test("lifetime view drops an out-of-range birth year and unknown country", () => {
  const state = parseUrlState("?view=lifetime&birth=1200&country=XX&year=2024", {
    years: [2024],
    countryCodes: ["IND"],
  });
  assert.deepEqual(state, { view: "lifetime", year: 2024 });
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
