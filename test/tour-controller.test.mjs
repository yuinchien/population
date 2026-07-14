import assert from "node:assert/strict";
import test from "node:test";
import {
  adjacentMilestoneYears,
  createTourController,
} from "../tour-controller.mjs";

test("milestone adjacency works both on and between milestones", () => {
  const years = [2000, 2010, 2020];
  assert.deepEqual(adjacentMilestoneYears(years, 2010), {
    prev: 2000,
    next: 2020,
  });
  assert.deepEqual(adjacentMilestoneYears(years, 2015), {
    prev: 2010,
    next: 2020,
  });
});

function harness(currentYear = 2000) {
  let timerCallback;
  const visited = [];
  const playing = [];
  let year = currentYear;
  const controller = createTourController({
    getMilestoneYears: () => [2000, 2010],
    getCurrentYear: () => year,
    goToYear: (nextYear) => {
      year = nextYear;
      visited.push(nextYear);
    },
    onPlayingChange: (value) => playing.push(value),
    setTimer: (callback) => {
      timerCallback = callback;
      return 1;
    },
    clearTimer: () => {},
  });
  return { controller, visited, playing, tick: () => timerCallback() };
}

test("tour advances through milestones and loops", () => {
  const tour = harness();
  tour.controller.start();
  assert.equal(tour.controller.isPlaying(), true);
  tour.tick();
  tour.tick();
  assert.deepEqual(tour.visited, [2010, 2000]);
  assert.deepEqual(tour.playing, [true]);
});

test("tour starts at the first milestone and can stop", () => {
  const tour = harness(2005);
  tour.controller.start();
  assert.deepEqual(tour.visited, [2000]);
  tour.controller.stop();
  assert.equal(tour.controller.isPlaying(), false);
  assert.deepEqual(tour.playing, [true, false]);
});
