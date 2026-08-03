import assert from "node:assert/strict";
import test from "node:test";
import {
  bodyClassState,
  createUiStateRenderer,
  shouldRenderScene,
} from "../ui-state-renderer.mjs";

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
      searchActive: true,
      infoOpen: true,
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

test("detail remains active until every detail surface closes", () => {
  const body = fakeBody();
  const renderer = createUiStateRenderer({ body });

  renderer.update({ groupDetailOpen: true, infoOpen: true });
  renderer.update({ infoOpen: false });
  assert.equal(body.classes.has("detail"), true);

  renderer.update({ groupDetailOpen: false });
  assert.equal(body.classes.has("detail"), false);
});

test("scene renders only when no full-screen or modal UI covers it", () => {
  assert.equal(shouldRenderScene({}), true);
  for (const key of [
    "chartActive",
    "clusterActive",
    "searchActive",
    "lifetimeActive",
    "groupDetailOpen",
    "countryDetailOpen",
    "infoOpen",
    "menuOpen",
  ]) {
    assert.equal(
      shouldRenderScene({ [key]: true }),
      false,
      `${key} should pause the scene`,
    );
  }
});
