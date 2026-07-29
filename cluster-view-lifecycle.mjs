import { createViewLifecycle } from "./view-lifecycle.mjs";

export function createClusterViewLifecycle({
  state,
  view,
  updateUiState,
  assertReady,
  syncModeButtons,
  underlyingMode,
  stopTour,
  enter,
  exit,
  syncUrl,
}) {
  return createViewLifecycle({
    name: "cluster",
    isActive: () => state.clusterActive,
    setActiveState: (active) => {
      if (active) assertReady();
      state.clusterActive = active;
    },
    setVisible: (active) => {
      view.hidden = !active;
      updateUiState({ clusterActive: active });
    },
    onVisibilityChange: (active) =>
      syncModeButtons(active ? "cluster" : underlyingMode()),
    onEnter: () => {
      stopTour();
      enter();
    },
    onExit: exit,
    sync: syncUrl,
  });
}
