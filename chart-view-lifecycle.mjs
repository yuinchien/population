import { createViewLifecycle } from "./view-lifecycle.mjs";

export function createChartViewLifecycle({
  state,
  panel,
  body = document.body,
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
    isActive: () => state.chartPanelActive,
    setActiveState: (active) => {
      if (active) assertReady();
      state.chartPanelActive = active;
    },
    setVisible: (active) => {
      panel.hidden = !active;
      body.classList.toggle("view-chart", active);
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
