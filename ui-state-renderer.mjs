import {
  createInitialNavigationState,
  updateNavigationState,
} from "./navigation-state.mjs";

export function bodyClassState(state) {
  return {
    "view-chart": state.activeView === "chart",
    "view-cluster": state.activeView === "cluster",
    "view-search": state.activeView === "search",
    "view-lifetime": state.activeView === "lifetime",
    "view-lifetime-started":
      state.activeView === "lifetime" && state.lifetimeStarted,
    "country-detail": state.overlay === "country",
    "info-open": state.overlay === "info",
    "menu-open": state.menuOpen,
    detail: Boolean(state.overlay),
  };
}

export function createUiStateRenderer({
  body = document.body,
  state = createInitialNavigationState(),
} = {}) {
  function render() {
    const classes = bodyClassState(state);
    Object.entries(classes).forEach(([className, active]) => {
      body.classList.toggle(className, active);
    });
  }

  function update(patch) {
    updateNavigationState(state, patch);
    render();
    return { ...state };
  }

  render();
  return {
    getState: () => ({ ...state }),
    render,
    update,
  };
}
