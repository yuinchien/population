import { createInitialNavigationState } from "./navigation-state.mjs";

const DEFAULT_CHART_COUNTRIES = ["USA", "JPN", "IND", "DEU", "NGA"];

// Durable, user-visible application state lives here. Rendering resources,
// animation handles, DOM references, and controller instances intentionally
// stay with the modules that own their lifecycles.
export function createInitialAppState({
  theme = "dark",
  chartCountries = DEFAULT_CHART_COUNTRIES,
} = {}) {
  const navigation = Object.seal(createInitialNavigationState());
  return Object.seal({
    currentYearIndex: -1,
    historicalCutoffYear: Infinity,
    currentTheme: theme,
    colorMode: "region",
    viewMode: "globe",
    // The group-detail panel's active filters: at most one per group
    // (age/migration/region/income), keyed by mode, combined with AND —
    // see countryMatchesAllFilters (detail-table.mjs) and
    // toggleDetailFilter (script.js). Populated from the search view's
    // category grid, the panel's own #detailNav sidebar, or the outer
    // Globe/Map #legend sidebar — all three funnel through the same toggle.
    selectedLegends: {},
    selectedCountry: null,
    detailEntryMode: null,
    detailSort: { key: "population", direction: "desc" },
    clusterStatusPeriod: null,
    navigation,
    searchSelectedIso3: null,
    chartMetricKey: "ageDependencyRatio",
    selectedChartCountries: [...chartCountries],
    chartCountryPickerExpanded: false,
    chartTableSort: { key: "population", direction: "desc" },
    isProjectedYear: false,
  });
}
