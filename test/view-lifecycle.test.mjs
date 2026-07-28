import test from "node:test";
import assert from "node:assert/strict";
import { createViewLifecycle } from "../view-lifecycle.mjs";
import { createViewRouter } from "../view-router.mjs";

function fakeLifecycle(name, active = false) {
  let value = active;
  return {
    name,
    isActive: () => value,
    activate: () => {
      value = true;
    },
    deactivate: () => {
      value = false;
    },
  };
}

test("view lifecycle runs transitions once and syncs after hooks", () => {
  let active = false;
  const events = [];
  const lifecycle = createViewLifecycle({
    name: "sample",
    isActive: () => active,
    setActiveState: (value) => {
      active = value;
      events.push(`state:${value}`);
    },
    setVisible: (value) => events.push(`visible:${value}`),
    onEnter: () => events.push("enter"),
    onExit: () => events.push("exit"),
    sync: () => events.push("sync"),
  });
  assert.equal(lifecycle.activate(), true);
  assert.equal(lifecycle.activate(), false);
  assert.equal(lifecycle.deactivate(), true);
  assert.deepEqual(events, [
    "state:true",
    "visible:true",
    "enter",
    "sync",
    "state:false",
    "visible:false",
    "exit",
    "sync",
  ]);
});

test("view router deactivates siblings before activating its target", () => {
  const chart = fakeLifecycle("chart", true);
  const search = fakeLifecycle("search");
  const baseModes = [];
  const router = createViewRouter({
    lifecycles: [chart, search],
    setBaseView: (mode) => baseModes.push(mode),
  });
  router.activate("search");
  assert.equal(chart.isActive(), false);
  assert.equal(search.isActive(), true);
  router.activate("map");
  assert.equal(search.isActive(), false);
  assert.deepEqual(baseModes, ["map"]);
});
