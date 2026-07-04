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
  return Number(value).toFixed(2);
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
  },
  fertility: {
    key: "fertility",
    label: "Fertility rate",
    detailLabel: "Fertility rate",
    defaultDirection: "desc",
    format: formatFertility,
    formatPanel: (value) => `${Number(value).toFixed(2)} births/woman`,
    formatRange: (value) => Number(value).toFixed(2),
  },
  lifeExpectancy: {
    key: "lifeExpectancy",
    label: "Life expectancy",
    detailLabel: "Life expectancy",
    defaultDirection: "desc",
    format: formatYears,
    formatPanel: formatYears,
    formatRange: (value) => Number(value).toFixed(1),
  },
  medianAge: {
    key: "medianAge",
    label: "Median age",
    detailLabel: "Median age",
    defaultDirection: "desc",
    format: formatYears,
    formatPanel: formatYears,
    formatRange: (value) => Number(value).toFixed(1),
  },
  populationGrowth: {
    key: "populationGrowth",
    label: "Population growth",
    detailLabel: "Growth rate",
    defaultDirection: "desc",
    format: formatPercent,
    formatPanel: formatPercent,
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
