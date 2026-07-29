import test from "node:test";
import assert from "node:assert/strict";
import { createViewLifecycle } from "../view-lifecycle.mjs";

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
