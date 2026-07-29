import test from "node:test";
import assert from "node:assert/strict";
import { createViewRouter } from "../view-router.mjs";

function fakeLifecycle(name, active = false) {
  let value = active;
  return {
    name,
    isActive: () => value,
    activate: (options) => {
      value = true;
      return options;
    },
    deactivate: () => {
      value = false;
    },
  };
}

test("activating a registered mode deactivates every sibling lifecycle", () => {
  const chart = fakeLifecycle("chart", true);
  const search = fakeLifecycle("search");
  const router = createViewRouter({
    lifecycles: [chart, search],
    setBaseView: () => {},
  });
  router.activate("search");
  assert.equal(chart.isActive(), false);
  assert.equal(search.isActive(), true);
});

test("activating an unregistered mode deactivates all lifecycles and falls back to setBaseView", () => {
  const chart = fakeLifecycle("chart", true);
  const search = fakeLifecycle("search", true);
  const baseModes = [];
  const router = createViewRouter({
    lifecycles: [chart, search],
    setBaseView: (mode) => baseModes.push(mode),
  });
  router.activate("map");
  assert.equal(chart.isActive(), false);
  assert.equal(search.isActive(), false);
  assert.deepEqual(baseModes, ["map"]);
});

test("closeMenu runs on every activate call, registered or not", () => {
  const chart = fakeLifecycle("chart");
  let closeCount = 0;
  const router = createViewRouter({
    lifecycles: [chart],
    setBaseView: () => {},
    closeMenu: () => {
      closeCount += 1;
    },
  });
  router.activate("chart");
  router.activate("globe");
  assert.equal(closeCount, 2);
});

test("closeMenu defaults to a no-op when omitted", () => {
  const router = createViewRouter({
    lifecycles: [],
    setBaseView: () => {},
  });
  assert.doesNotThrow(() => router.activate("globe"));
});

test("options passed to activate reach the target lifecycle's own activate", () => {
  let received;
  const chart = {
    name: "chart",
    isActive: () => false,
    activate: (options) => {
      received = options;
    },
    deactivate: () => {},
  };
  const router = createViewRouter({
    lifecycles: [chart],
    setBaseView: () => {},
  });
  router.activate("chart", { preserveStory: true });
  assert.deepEqual(received, { preserveStory: true });
});
