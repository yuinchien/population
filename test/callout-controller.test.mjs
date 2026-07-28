import assert from "node:assert/strict";
import test from "node:test";
import {
  createCalloutInteractionState,
  smoothCalloutPosition,
} from "../callout-controller.mjs";

test("smoothCalloutPosition starts at the target and eases subsequent movement", () => {
  assert.equal(smoothCalloutPosition(null, 100, 16, 90), 100);
  const next = smoothCalloutPosition(0, 100, 16, 90);
  assert.ok(next > 0 && next < 100);
});

test("smoothCalloutPosition is stable when no frame time elapsed", () => {
  assert.equal(smoothCalloutPosition(40, 100, 0, 90), 40);
});

test("callout interaction remains active until pointer and focus both leave", () => {
  const country = { iso3: "JPN" };
  const events = [];
  const interactions = createCalloutInteractionState({
    onActivate: (value) => events.push(`activate:${value.iso3}`),
    onDeactivate: (value) => events.push(`deactivate:${value.iso3}`),
  });

  interactions.activate(country, "pointer");
  interactions.activate(country, "focus");
  interactions.deactivate(country, "pointer");
  assert.deepEqual(events, ["activate:JPN"]);

  interactions.deactivate(country, "focus");
  assert.deepEqual(events, ["activate:JPN", "deactivate:JPN"]);
});

test("callout interaction restores a focused label after pointer hover moves away", () => {
  const japan = { iso3: "JPN" };
  const france = { iso3: "FRA" };
  const events = [];
  const interactions = createCalloutInteractionState({
    onActivate: (country) => events.push(`activate:${country.iso3}`),
    onDeactivate: (country) => events.push(`deactivate:${country.iso3}`),
  });

  interactions.activate(japan, "focus");
  interactions.activate(france, "pointer");
  interactions.deactivate(france, "pointer");

  assert.deepEqual(events, [
    "activate:JPN",
    "deactivate:JPN",
    "activate:FRA",
    "deactivate:FRA",
    "activate:JPN",
  ]);
});

test("clearing callouts deactivates the current interaction once", () => {
  const country = { iso3: "JPN" };
  const events = [];
  const interactions = createCalloutInteractionState({
    onActivate: () => events.push("activate"),
    onDeactivate: () => events.push("deactivate"),
  });

  interactions.activate(country, "pointer");
  interactions.activate(country, "focus");
  interactions.clear();
  interactions.clear();

  assert.deepEqual(events, ["activate", "deactivate"]);
});
