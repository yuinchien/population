import { createViewLifecycle } from "./view-lifecycle.mjs";

export function createSearchViewLifecycle({
  state,
  view,
  bar,
  updateUiState,
  assertReady,
  syncModeButtons,
  underlyingMode,
  stopTour,
  prepare,
  teardown,
  syncUrl,
}) {
  return createViewLifecycle({
    name: "search",
    isActive: () => state.navigation.activeView === "search",
    setActiveState: (active) => {
      if (active) assertReady();
      updateUiState({ searchActive: active });
    },
    setVisible: (active) => {
      view.hidden = !active;
      bar.hidden = !active;
    },
    onVisibilityChange: (active) =>
      syncModeButtons(active ? "search" : underlyingMode()),
    onEnter: () => {
      stopTour();
      prepare();
    },
    onExit: teardown,
    sync: syncUrl,
  });
}
