const DEFAULT_CHART_COUNTRIES = ["USA", "JPN", "IND", "DEU", "NGA"];

// Durable, user-visible application state lives here. Rendering resources,
// animation handles, DOM references, and controller instances intentionally
// stay with the modules that own their lifecycles.
export function createInitialAppState({
  theme = "dark",
  chartCountries = DEFAULT_CHART_COUNTRIES,
} = {}) {
  return Object.seal({
    currentYearIndex: -1,
    historicalCutoffYear: Infinity,
    currentTheme: theme,
    colorMode: "region",
    viewMode: "globe",
    selectedLegend: null,
    selectedCountry: null,
    detailEntryMode: null,
    detailSort: { key: "population", direction: "desc" },
    chartPanelActive: false,
    clusterActive: false,
    clusterStatusPeriod: null,
    searchActive: false,
    searchSelectedIso3: null,
    chartMetricKey: "ageDependencyRatio",
    selectedChartCountries: [...chartCountries],
    chartCountryPickerExpanded: false,
    chartTableSort: { key: "population", direction: "desc" },
    isProjectedYear: false,
  });
}
