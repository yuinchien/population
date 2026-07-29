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
    isActive: () => state.searchActive,
    setActiveState: (active) => {
      if (active) assertReady();
      state.searchActive = active;
    },
    setVisible: (active) => {
      view.hidden = !active;
      bar.hidden = !active;
      updateUiState({ searchActive: active });
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
