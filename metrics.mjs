export function formatYears(value) {
  if (value == null) return "N/A";
  return `${Number(value).toFixed(1)} yrs`;
}

export function formatPopulation(value) {
  if (value == null) return "N/A";
  return Math.round(value).toLocaleString();
}

export function formatPercent(value) {
  if (value == null) return "N/A";
  return `${Number(value).toFixed(2)}%`;
}

export function formatFertility(value) {
  if (value == null) return "N/A";
  return Number(value).toFixed(1);
}

export function formatDependencyRatio(value) {
  if (value == null) return "N/A";
  return Number(value).toFixed(1);
}

export function formatMigrationRate(value) {
  if (value == null) return "N/A";
  return Number(value).toFixed(1);
}

export function formatCount(value, options = {}) {
  const {
    billionsDecimals = 2,
    millionsDecimals = 1,
    thousandsDecimals = 0,
    nullFallback = null,
    roundWholeNumbers = false,
  } = options;
  if (value == null) return nullFallback ?? `${value}`;
  if (value >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(billionsDecimals)}B`;
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(millionsDecimals)}M`;
  }
  if (value >= 1_000) return `${(value / 1_000).toFixed(thousandsDecimals)}K`;
  return roundWholeNumbers ? Math.round(value).toLocaleString() : `${value}`;
}

export const METRICS = {
  population: {
    key: "population",
    label: "Population",
    detailLabel: "Population",
    defaultDirection: "desc",
    format: formatPopulation,
    formatPanel: formatCount,
    // Population is never negative, so 0 is always the natural floor —
    // charts for this metric shouldn't scale to the selected countries'
    // own minimum, which would exaggerate their curves' apparent slope.
    referenceValue: 0,
  },
  fertility: {
    key: "fertility",
    label: "Fertility rate",
    detailLabel: "Fertility rate",
    defaultDirection: "desc",
    format: formatFertility,
    formatPanel: (value) => `${formatFertility(value)} births/woman`,
    formatRange: formatFertility,
    // UN-defined global replacement-level fertility rate — charts for this
    // metric plot deviation from this line rather than from zero/min.
    referenceValue: 2.1,
  },
  lifeExpectancy: {
    key: "lifeExpectancy",
    label: "Life expectancy",
    detailLabel: "Life expectancy",
    defaultDirection: "desc",
    format: formatYears,
    formatPanel: formatYears,
    formatRange: (value) => Number(value).toFixed(1),
    referenceValue: 0,
  },
  medianAge: {
    key: "medianAge",
    label: "Median age",
    detailLabel: "Median age",
    defaultDirection: "desc",
    format: formatYears,
    formatPanel: formatYears,
    formatRange: (value) => Number(value).toFixed(1),
    referenceValue: 0,
  },
  populationGrowth: {
    key: "populationGrowth",
    label: "Population growth",
    detailLabel: "Growth rate",
    defaultDirection: "desc",
    format: formatPercent,
    formatPanel: formatPercent,
    // Zero growth is the natural threshold — charts for this metric plot
    // deviation from it so a country's shift into decline stands out.
    referenceValue: 0,
  },
  ageDependencyRatio: {
    key: "ageDependencyRatio",
    label: "Age dependency ratio",
    detailLabel: "Dependency ratio",
    defaultDirection: "desc",
    format: formatDependencyRatio,
    formatPanel: (value) => `${formatDependencyRatio(value)} per 100`,
    formatRange: formatDependencyRatio,
    referenceValue: 0,
  },
  netMigrationRate: {
    key: "netMigrationRate",
    label: "Net migration rate",
    detailLabel: "Migration rate",
    defaultDirection: "desc",
    format: formatMigrationRate,
    formatPanel: (value) => `${formatMigrationRate(value)} per 1,000`,
    formatRange: formatMigrationRate,
    // Net-zero migration (inflow exactly offsetting outflow) is the natural
    // threshold — charts for this metric plot deviation from it so a shift
    // between net immigration and net emigration stands out.
    referenceValue: 0,
  },
};

export const GLOBAL_METRIC_KEYS = [
  "population",
  "fertility",
  "lifeExpectancy",
  "medianAge",
  "populationGrowth",
];

export const DETAIL_METRIC_KEYS = [
  "population",
  "populationGrowth",
  "fertility",
  "lifeExpectancy",
  "medianAge",
];
