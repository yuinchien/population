import { computePeakYear } from "./data-loader.mjs";
import { computeGlobalTrendMilestones } from "./status-insights.mjs";

const PROJECTION_SCENARIOS = new Set(["medium", "high", "low"]);

export function isProjectionScenario(scenario) {
  return PROJECTION_SCENARIOS.has(scenario);
}

export function createProjectionScenarioData() {
  let scenario = "medium";
  let countries = [];
  let years = [];
  let historicalCutoffYear = Infinity;
  let globalMetricsByYear = new Map();
  let globalTrendMilestones = new Map();
  let highMetricsByYear = new Map();
  let lowMetricsByYear = new Map();
  let globalMetricsCache = null;
  let globalMetricsCacheScenario = null;
  let globalTrendMilestonesCache = null;
  let globalTrendMilestonesCacheScenario = null;

  function invalidateCache() {
    globalMetricsCache = null;
    globalMetricsCacheScenario = null;
    globalTrendMilestonesCache = null;
    globalTrendMilestonesCacheScenario = null;
  }

  function variantMetricsByYear() {
    if (scenario === "high") return highMetricsByYear;
    if (scenario === "low") return lowMetricsByYear;
    return null;
  }

  function populationSeries(country) {
    if (scenario === "high") {
      return country?.populationsHigh ?? country?.populations ?? [];
    }
    if (scenario === "low") {
      return country?.populationsLow ?? country?.populations ?? [];
    }
    return country?.populations ?? [];
  }

  function globalMetricsMap() {
    const variant = variantMetricsByYear();
    if (!variant?.size) return globalMetricsByYear;
    if (globalMetricsCache && globalMetricsCacheScenario === scenario) {
      return globalMetricsCache;
    }
    globalMetricsCache = new Map(
      [...globalMetricsByYear.entries()].map(([year, metrics]) => [
        year,
        { ...metrics, ...(variant.get(year) ?? {}) },
      ]),
    );
    globalMetricsCacheScenario = scenario;
    return globalMetricsCache;
  }

  return {
    configure({
      countries: nextCountries = countries,
      years: nextYears = years,
      historicalCutoffYear: nextHistoricalCutoffYear = historicalCutoffYear,
      globalMetricsByYear: nextGlobalMetricsByYear = globalMetricsByYear,
      globalTrendMilestones: nextGlobalTrendMilestones = globalTrendMilestones,
      highMetricsByYear: nextHighMetricsByYear = highMetricsByYear,
      lowMetricsByYear: nextLowMetricsByYear = lowMetricsByYear,
    } = {}) {
      countries = nextCountries;
      years = nextYears;
      historicalCutoffYear = nextHistoricalCutoffYear;
      globalMetricsByYear = nextGlobalMetricsByYear;
      globalTrendMilestones = nextGlobalTrendMilestones;
      highMetricsByYear = nextHighMetricsByYear;
      lowMetricsByYear = nextLowMetricsByYear;
      invalidateCache();
    },

    scenario() {
      return scenario;
    },

    setScenario(nextScenario) {
      if (!isProjectionScenario(nextScenario)) return false;
      if (nextScenario === scenario) return false;
      scenario = nextScenario;
      invalidateCache();
      return true;
    },

    populationSeries,

    populationAt(country, index) {
      return populationSeries(country)[index] ?? country?.populations?.[index];
    },

    peakYear(country) {
      return computePeakYear(populationSeries(country), years);
    },

    globalMetricsForYear(year) {
      const base = globalMetricsByYear.get(year);
      const variant = variantMetricsByYear()?.get(year);
      return variant ? { ...(base ?? {}), ...variant } : base;
    },

    globalMetricsMap,

    globalTrendMilestones() {
      if (scenario === "medium") return globalTrendMilestones;
      if (
        globalTrendMilestonesCache &&
        globalTrendMilestonesCacheScenario === scenario
      ) {
        return globalTrendMilestonesCache;
      }
      globalTrendMilestonesCache = computeGlobalTrendMilestones(
        globalMetricsMap(),
        countries,
        years,
        historicalCutoffYear,
      );
      globalTrendMilestonesCacheScenario = scenario;
      return globalTrendMilestonesCache;
    },
  };
}
