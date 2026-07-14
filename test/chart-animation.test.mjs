import assert from "node:assert/strict";
import test from "node:test";
import {
  cancelChartAnimations,
  runChartAnimation,
} from "../chart-animation.mjs";

test("chart animation reports eased progress and completion", () => {
  let callback;
  const frames = [];
  let finished = false;
  runChartAnimation({
    duration: 100,
    easing: (value) => value * value,
    onFrame: (eased, raw) => frames.push([eased, raw]),
    onFinish: () => { finished = true; },
    reduceMotion: false,
    now: () => 0,
    requestFrame: (next) => { callback = next; return 1; },
    cancelFrame: () => {},
  });
  callback(50);
  callback(100);
  assert.deepEqual(frames, [[0.25, 0.5], [1, 1]]);
  assert.equal(finished, true);
});

test("reduced motion finishes synchronously", () => {
  const frames = [];
  runChartAnimation({
    duration: 100,
    onFrame: (eased, raw) => frames.push([eased, raw]),
    reduceMotion: true,
  });
  assert.deepEqual(frames, [[1, 1]]);
});

test("cancelChartAnimations cancels and clears every handle", () => {
  let cancellations = 0;
  const handles = [
    { cancel: () => cancellations++ },
    { cancel: () => cancellations++ },
  ];
  cancelChartAnimations(handles);
  assert.equal(cancellations, 2);
  assert.deepEqual(handles, []);
});
