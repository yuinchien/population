const BODY_CLASS_FOR_STATE = {
  chartActive: "view-chart",
  clusterActive: "view-cluster",
  searchActive: "view-search",
  lifetimeActive: "view-lifetime",
  lifetimeStarted: "view-lifetime-started",
  countryDetailOpen: "country-detail",
  infoOpen: "info-open",
  menuOpen: "menu-open",
};

const SCENE_COVERING_STATE_KEYS = [
  "chartActive",
  "clusterActive",
  "searchActive",
  "lifetimeActive",
  "groupDetailOpen",
  "countryDetailOpen",
  "infoOpen",
  "menuOpen",
];

// The Three.js scene only needs to animate while Globe/Map is the visible,
// interactive surface. Every state here either replaces it or places a modal
// scrim above it, so continuing the RAF loop would spend CPU/GPU on pixels the
// user cannot interact with.
export function shouldRenderScene(state) {
  return !SCENE_COVERING_STATE_KEYS.some((key) => Boolean(state[key]));
}

export function bodyClassState(state) {
  const classes = Object.fromEntries(
    Object.entries(BODY_CLASS_FOR_STATE).map(([key, className]) => [
      className,
      Boolean(state[key]),
    ]),
  );
  classes.detail = Boolean(
    state.groupDetailOpen ||
    state.countryDetailOpen ||
    state.infoOpen,
  );
  return classes;
}

export function createUiStateRenderer({
  body = document.body,
  initialState = {},
} = {}) {
  const state = {
    chartActive: false,
    clusterActive: false,
    searchActive: false,
    lifetimeActive: false,
    lifetimeStarted: false,
    groupDetailOpen: false,
    countryDetailOpen: false,
    infoOpen: false,
    menuOpen: false,
    ...initialState,
  };

  function render() {
    const classes = bodyClassState(state);
    Object.entries(classes).forEach(([className, active]) => {
      body.classList.toggle(className, active);
    });
  }

  function update(patch) {
    Object.assign(state, patch);
    // Modal/detail surfaces always close the navigation menu behind them.
    if (
      state.groupDetailOpen ||
      state.countryDetailOpen ||
      state.infoOpen
    ) {
      state.menuOpen = false;
    }
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
