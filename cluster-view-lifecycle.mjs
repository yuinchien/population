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
    isActive: () => state.navigation.activeView === "cluster",
    setActiveState: (active) => {
      if (active) assertReady();
      updateUiState({ clusterActive: active });
    },
    setVisible: (active) => {
      view.hidden = !active;
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
