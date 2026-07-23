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

test("URL state round-trips the search view", () => {
  const bare = serializeUrlState({ view: "search", year: 2024 });
  assert.deepEqual(parseUrlState(bare, { years: [2024] }), {
    view: "search",
    year: 2024,
  });

  const withCountry = serializeUrlState({
    view: "search",
    country: "JPN",
    year: 2024,
  });
  assert.deepEqual(
    parseUrlState(withCountry, { years: [2024], countryCodes: ["JPN"] }),
    { view: "search", country: "JPN", year: 2024 },
  );
});

test("URL state round-trips global projection scenario", () => {
  const query = serializeUrlState({
    view: "chart",
    metric: "population",
    countries: ["IND"],
    projection: "high",
    year: 2050,
  });
  assert.deepEqual(
    parseUrlState(query, { years: [2050], countryCodes: ["IND"] }),
    {
      view: "chart",
      metric: "population",
      countries: ["IND"],
      projection: "high",
      year: 2050,
    },
  );
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

test("URL state round-trips a region/income group view", () => {
  const query = serializeUrlState({
    view: "group",
    groupMode: "region",
    group: "Europe & Central Asia",
    year: 2050,
  });
  assert.deepEqual(parseUrlState(query, { years: [2050] }), {
    view: "group",
    groupMode: "region",
    group: "Europe & Central Asia",
    year: 2050,
  });
});

test("URL state round-trips an age or migration group view", () => {
  const ageQuery = serializeUrlState({
    view: "group",
    groupMode: "age",
    group: "superAged",
    year: 2050,
  });
  assert.deepEqual(parseUrlState(ageQuery, { years: [2050] }), {
    view: "group",
    groupMode: "age",
    group: "superAged",
    year: 2050,
  });

  const migrationQuery = serializeUrlState({
    view: "group",
    groupMode: "migration",
    group: "outflow",
    year: 2050,
  });
  assert.deepEqual(parseUrlState(migrationQuery, { years: [2050] }), {
    view: "group",
    groupMode: "migration",
    group: "outflow",
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
