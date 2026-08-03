import assert from "node:assert/strict";
import test from "node:test";
import {
  bodyClassState,
  createUiStateRenderer,
} from "../ui-state-renderer.mjs";
import {
  createInitialNavigationState,
  shouldRenderScene,
  updateNavigationState,
} from "../navigation-state.mjs";

function fakeBody() {
  const classes = new Set();
  return {
    classes,
    classList: {
      toggle(className, active) {
        if (active) classes.add(className);
        else classes.delete(className);
      },
    },
  };
}

test("body classes are derived from one UI state snapshot", () => {
  assert.deepEqual(
    bodyClassState({
      activeView: "search",
      overlay: "info",
      menuOpen: false,
      lifetimeStarted: false,
    }),
    {
      "view-chart": false,
      "view-cluster": false,
      "view-search": true,
      "view-lifetime": false,
      "view-lifetime-started": false,
      "country-detail": false,
      "info-open": true,
      "menu-open": false,
      detail: true,
    },
  );
});

test("opening a modal surface closes the menu and keeps detail derived", () => {
  const body = fakeBody();
  const renderer = createUiStateRenderer({ body });

  renderer.update({ menuOpen: true });
  assert.equal(body.classes.has("menu-open"), true);

  const state = renderer.update({ infoOpen: true });
  assert.equal(state.menuOpen, false);
  assert.equal(body.classes.has("menu-open"), false);
  assert.equal(body.classes.has("info-open"), true);
  assert.equal(body.classes.has("detail"), true);

  renderer.update({ infoOpen: false });
  assert.equal(body.classes.has("detail"), false);
});

test("overlay transitions are mutually exclusive", () => {
  const body = fakeBody();
  const renderer = createUiStateRenderer({ body });

  renderer.update({ groupDetailOpen: true });
  assert.equal(renderer.getState().overlay, "group");

  renderer.update({ infoOpen: true });
  assert.equal(renderer.getState().overlay, "info");
  assert.equal(body.classes.has("info-open"), true);
  assert.equal(body.classes.has("detail"), true);

  renderer.update({ infoOpen: false });
  assert.equal(body.classes.has("detail"), false);
});

test("view transitions use one mutually exclusive activeView field", () => {
  const state = createInitialNavigationState();
  updateNavigationState(state, { chartActive: true });
  assert.equal(state.activeView, "chart");

  updateNavigationState(state, { searchActive: true });
  assert.equal(state.activeView, "search");

  updateNavigationState(state, { chartActive: false });
  assert.equal(state.activeView, "search");
});

test("scene renders only when no full-screen or modal UI covers it", () => {
  assert.equal(shouldRenderScene(createInitialNavigationState()), true);
  for (const activeView of ["chart", "cluster", "search", "lifetime"]) {
    assert.equal(
      shouldRenderScene({
        ...createInitialNavigationState(),
        activeView,
      }),
      false,
      `${activeView} should pause the scene`,
    );
  }
  for (const overlay of ["group", "country", "info"]) {
    assert.equal(
      shouldRenderScene({ ...createInitialNavigationState(), overlay }),
      false,
      `${overlay} should pause the scene`,
    );
  }
  assert.equal(
    shouldRenderScene({ ...createInitialNavigationState(), menuOpen: true }),
    false,
  );
});
