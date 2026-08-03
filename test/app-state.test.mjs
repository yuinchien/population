import assert from "node:assert/strict";
import test from "node:test";
import { createInitialAppState } from "../app-state.mjs";

test("createInitialAppState defines one coherent navigation state", () => {
  const state = createInitialAppState({ theme: "light" });

  assert.equal(state.currentTheme, "light");
  assert.equal(state.viewMode, "globe");
  assert.deepEqual(state.navigation, {
    activeView: null,
    overlay: null,
    menuOpen: false,
    lifetimeStarted: false,
  });
  assert.equal(state.selectedCountry, null);
  assert.deepEqual(state.detailSort, {
    key: "population",
    direction: "desc",
  });
});

test("createInitialAppState does not share mutable defaults", () => {
  const first = createInitialAppState();
  const second = createInitialAppState();

  first.selectedChartCountries.push("FRA");
  first.detailSort.direction = "asc";

  assert.deepEqual(second.selectedChartCountries, [
    "USA",
    "JPN",
    "IND",
    "DEU",
    "NGA",
  ]);
  assert.deepEqual(second.detailSort, {
    key: "population",
    direction: "desc",
  });
});

test("application state has a fixed top-level shape", () => {
  const state = createInitialAppState();

  assert.equal(Object.isSealed(state), true);
  assert.throws(() => {
    state.misspelledViewMode = "map";
  }, TypeError);
});
