import { computeGlobalTrendMilestones } from "./status-insights.mjs";

export const DATA_URLS = {
  dots: "./data/population-dots.json",
  globalMetrics: "./data/population-global.json",
  incomeGroups: "./data/country-income-groups.json",
  countryDemographics: "./data/country-demographic-metrics.json",
};

async function fetchJson(url, fetchImpl) {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

// data/population-global.json holds one series per indicator, each an
// array of {year, value} rows; index by year so applyYear() can look up
// all five in O(1) as the slider moves. "variants" (High/Low UN scenarios)
// is a nested object, not a flat series, so it's excluded here and indexed
// separately by buildVariantIndex().
export function buildGlobalMetricsIndex(globalData) {
  const byYear = new Map();
  Object.entries(globalData).forEach(([series, rows]) => {
    if (series === "variants") return;
    rows.forEach(({ year, value }) => {
      if (!byYear.has(year)) byYear.set(year, {});
      byYear.get(year)[series] = value;
    });
  });
  return byYear;
}

// Same shape as buildGlobalMetricsIndex, but for a single variant's series
// object (globalData.variants.high or .low).
export function buildVariantIndex(variantSeries = {}) {
  const byYear = new Map();
  Object.entries(variantSeries).forEach(([series, rows]) => {
    rows.forEach(({ year, value }) => {
      if (!byYear.has(year)) byYear.set(year, {});
      byYear.get(year)[series] = value;
    });
  });
  return byYear;
}

// The year a country's modeled population is highest — i.e. where it
// crests and starts declining. Boundary years are excluded: a max at either
// edge usually just means "still rising/falling when the data runs out,"
// not a genuine peak.
export function computePeakYear(populations, years) {
  let maxIndex = -1;
  let maxValue = -Infinity;
  for (let i = 0; i < populations.length; i++) {
    const value = populations[i];
    if (value != null && value > maxValue) {
      maxValue = value;
      maxIndex = i;
    }
  }
  if (maxIndex <= 0 || maxIndex >= populations.length - 1) return null;
  return years[maxIndex];
}

export async function loadPopulationData({
  urls = DATA_URLS,
  fetchImpl = fetch,
} = {}) {
  const [dotsData, globalData, incomeGroups, countryDemographicMetrics] =
    await Promise.all([
      fetchJson(urls.dots, fetchImpl),
      fetchJson(urls.globalMetrics, fetchImpl),
      fetchJson(urls.incomeGroups, fetchImpl),
      fetchJson(urls.countryDemographics, fetchImpl),
    ]);

  const countries = dotsData.countries.map((country) => ({
    ...country,
    peakYear: computePeakYear(country.populations, dotsData.years),
  }));
  const years = dotsData.years;
  const historicalCutoffYear = dotsData.historicalCutoffYear ?? Infinity;
  const globalMetricsByYear = buildGlobalMetricsIndex(globalData);
  const globalTrendMilestones = computeGlobalTrendMilestones(globalData);
  const highMetricsByYear = globalData.variants?.high
    ? buildVariantIndex(globalData.variants.high)
    : new Map();
  const lowMetricsByYear = globalData.variants?.low
    ? buildVariantIndex(globalData.variants.low)
    : new Map();

  return {
    countries,
    years,
    incomeGroups,
    countryDemographicMetrics,
    historicalCutoffYear,
    globalMetricsByYear,
    globalTrendMilestones,
    highMetricsByYear,
    lowMetricsByYear,
  };
}
