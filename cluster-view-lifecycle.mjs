import { createViewLifecycle } from "./view-lifecycle.mjs";

export function createClusterViewLifecycle({
  state,
  view,
  body = document.body,
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
      body.classList.toggle("view-cluster", active);
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
