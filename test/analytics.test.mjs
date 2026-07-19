import assert from "node:assert/strict";
import test from "node:test";
import { trackEvent } from "../analytics.mjs";

test("trackEvent sends Umami events when available", () => {
  const originalWindow = globalThis.window;
  const calls = [];
  try {
    globalThis.window = {
      umami: {
        track: (eventName, props) => calls.push({ eventName, props }),
      },
    };

    trackEvent("lifetime_begin", { birthYear: 1985, country: "TWN" });

    assert.deepEqual(calls, [
      {
        eventName: "lifetime_begin",
        props: { birthYear: 1985, country: "TWN" },
      },
    ]);
  } finally {
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
  }
});

test("trackEvent is a no-op without Umami", () => {
  const originalWindow = globalThis.window;
  try {
    globalThis.window = {};

    assert.doesNotThrow(() => trackEvent("lifetime_begin", {}));
  } finally {
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
  }
});
