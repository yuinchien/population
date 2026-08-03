export function createInitialNavigationState() {
  return {
    activeView: null,
    overlay: null,
    menuOpen: false,
    lifetimeStarted: false,
  };
}

export function updateNavigationState(state, patch) {
  for (const [key, view] of [
    ["chartActive", "chart"],
    ["clusterActive", "cluster"],
    ["searchActive", "search"],
    ["lifetimeActive", "lifetime"],
  ]) {
    if (!(key in patch)) continue;
    if (patch[key]) state.activeView = view;
    else if (state.activeView === view) state.activeView = null;
  }

  for (const [key, overlay] of [
    ["groupDetailOpen", "group"],
    ["countryDetailOpen", "country"],
    ["infoOpen", "info"],
  ]) {
    if (!(key in patch)) continue;
    if (patch[key]) state.overlay = overlay;
    else if (state.overlay === overlay) state.overlay = null;
  }

  if ("menuOpen" in patch) state.menuOpen = Boolean(patch.menuOpen);
  if ("lifetimeStarted" in patch) {
    state.lifetimeStarted = Boolean(patch.lifetimeStarted);
  }
  if (state.overlay) state.menuOpen = false;
  return state;
}

// The Three.js scene only needs to animate while Globe/Map is the visible,
// interactive surface. Every state here either replaces it or places a modal
// scrim above it, so continuing the RAF loop would spend CPU/GPU on pixels the
// user cannot interact with.
export function shouldRenderScene(state) {
  return !state.activeView && !state.overlay && !state.menuOpen;
}
