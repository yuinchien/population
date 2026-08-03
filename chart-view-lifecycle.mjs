import { createViewLifecycle } from "./view-lifecycle.mjs";

export function createChartViewLifecycle({
  state,
  panel,
  updateUiState,
  assertReady,
  syncModeButtons,
  underlyingMode,
  stopTour,
  render,
  closeCountryPicker,
  catchUpScene,
  cancelAnimation,
  syncUrl,
}) {
  return createViewLifecycle({
    name: "chart",
    isActive: () => state.navigation.activeView === "chart",
    setActiveState: (active) => {
      if (active) assertReady();
      updateUiState({ chartActive: active });
    },
    setVisible: (active) => {
      panel.hidden = !active;
    },
    onVisibilityChange: (active) =>
      syncModeButtons(active ? "chart" : underlyingMode()),
    onEnter: () => {
      stopTour();
      render();
    },
    onExit: () => {
      closeCountryPicker();
      cancelAnimation();
      catchUpScene();
    },
    sync: syncUrl,
  });
}
