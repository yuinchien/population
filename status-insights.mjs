export function displayGroupLabel(label) {
  if (label.includes("Afghanistan & Pakistan")) {
    return "Middle East & North Africa";
  }
  return label.replace(" countries", "");
}

function formatYears(value) {
  if (value == null) return "N/A";
  return `${Number(value).toFixed(1)} yrs`;
}

function formatAverageYears(value) {
  return `${Number(value).toFixed(1)} yrs`;
}

function formatPercent(value) {
  if (value == null) return "N/A";
  return `${Number(value).toFixed(2)}%`;
}

function formatFertility(value) {
  if (value == null) return "N/A";
  return Number(value).toFixed(2);
}

function formatCount(value, options = {}) {
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

function metricRows(globalData, key) {
  return [...(globalData[key] || [])].sort((a, b) => a.year - b.year);
}

function firstMetricYear(globalData, key, predicate) {
  return metricRows(globalData, key).find(({ value }) => predicate(value));
}

function addMilestone(milestones, year, text, priority = 0) {
  if (!Number.isFinite(year)) return;
  const current = milestones.get(year);
  if (!current || priority > current.priority) {
    milestones.set(year, { text, priority });
  }
}

export function computeGlobalTrendMilestones(globalData) {
  const milestones = new Map();
  const populationRows = metricRows(globalData, "population");
  const peakPopulation = populationRows.reduce(
    (best, row) => (!best || row.value > best.value ? row : best),
    null,
  );
  if (peakPopulation) {
    addMilestone(
      milestones,
      peakPopulation.year,
      `${peakPopulation.year} is the projected turning point for global population: it tops out near ${formatCount(peakPopulation.value)} before edging downward.`,
      5,
    );
  }

  const tenBillion = firstMetricYear(
    globalData,
    "population",
    (value) => value >= 10_000_000_000,
  );
  if (tenBillion) {
    addMilestone(
      milestones,
      tenBillion.year,
      `${tenBillion.year} is the first year the medium projection puts the world above 10B people.`,
      4,
    );
  }

  const replacementFertility = firstMetricYear(
    globalData,
    "fertility",
    (value) => value < 2.1,
  );
  if (replacementFertility) {
    addMilestone(
      milestones,
      replacementFertility.year,
      `${replacementFertility.year} is when global fertility is projected to slip below replacement, at ${replacementFertility.value.toFixed(3)} births per woman.`,
      4,
    );
  }

  const slowGrowth = firstMetricYear(
    globalData,
    "populationGrowth",
    (value) => value < 0.5,
  );
  if (slowGrowth) {
    addMilestone(
      milestones,
      slowGrowth.year,
      `${slowGrowth.year} marks a slower-growth world: global population growth falls below 0.5% for the first time in the projection.`,
      3,
    );
  }

  const life80 = firstMetricYear(
    globalData,
    "lifeExpectancy",
    (value) => value >= 80,
  );
  if (life80) {
    addMilestone(
      milestones,
      life80.year,
      `${life80.year} is the first projected year global life expectancy reaches 80 years.`,
      3,
    );
  }

  return milestones;
}

export function prioritizedMilestoneYears(
  milestones,
  { minYear = -Infinity, maxYear = Infinity, limit = Infinity } = {},
) {
  return [...milestones.entries()]
    .filter(([year]) => year >= minYear && year <= maxYear)
    .sort(
      ([yearA, milestoneA], [yearB, milestoneB]) =>
        milestoneB.priority - milestoneA.priority || yearA - yearB,
    )
    .slice(0, limit)
    .map(([year]) => year);
}

function countriesWithNumericValue(countries, value) {
  return countries
    .map((country) => ({ country, value: value(country) }))
    .filter((entry) => Number.isFinite(entry.value));
}

function maxEntry(entries) {
  return entries.reduce(
    (best, entry) => (!best || entry.value > best.value ? entry : best),
    null,
  );
}

function minEntry(entries) {
  return entries.reduce(
    (best, entry) => (!best || entry.value < best.value ? entry : best),
    null,
  );
}

function averageValue(entries) {
  if (!entries.length) return null;
  return entries.reduce((sum, entry) => sum + entry.value, 0) / entries.length;
}

function computeMetricStats(countries, otherCountries, key, metricFor) {
  const entries = countriesWithNumericValue(countries, (country) =>
    metricFor(country, key),
  );
  const otherEntries = countriesWithNumericValue(otherCountries, (country) =>
    metricFor(country, key),
  );
  return {
    entries,
    otherEntries,
    average: averageValue(entries),
    otherAverage: averageValue(otherEntries),
    max: maxEntry(entries),
    min: minEntry(entries),
  };
}

export function buildDetailStatus({
  year,
  countries,
  allCountries,
  currentYearIndex,
  isProjected,
  legend,
  metricFor,
}) {
  const label = displayGroupLabel(legend.label);
  const projected = isProjected ? "projected " : "";
  const yearLead = isProjected ? `${year} projection:` : `${year}:`;
  const populationEntries = countriesWithNumericValue(
    countries,
    (country) => country.populations[currentYearIndex],
  );

  if (!populationEntries.length) {
    return `No ${projected}country population data is available for ${label} in ${year}.`;
  }

  const otherCountries = allCountries.filter((country) =>
    legend.mode === "income"
      ? country._incomeLabel !== legend.label
      : country.region.trim() !== legend.label,
  );

  const growth = computeMetricStats(
    countries,
    otherCountries,
    "populationGrowth",
    metricFor,
  );
  const decliningCount = growth.entries.filter(
    (entry) => entry.value < 0,
  ).length;
  const growingCount = growth.entries.filter((entry) => entry.value > 0).length;
  const fastestGrowth = growth.max;
  const steepestDecline = growth.min;

  const fertility = computeMetricStats(
    countries,
    otherCountries,
    "fertility",
    metricFor,
  );
  const belowReplacementCount = fertility.entries.filter(
    (entry) => entry.value < 2.1,
  ).length;
  const belowReplacementShare =
    belowReplacementCount / fertility.entries.length;
  const fertilityContext = fertility.entries.length
    ? ` ${belowReplacementCount} of ${fertility.entries.length} countries are below replacement fertility.`
    : "";
  const growthComparison =
    Number.isFinite(growth.average) && Number.isFinite(growth.otherAverage)
      ? ` average growth is ${formatPercent(growth.average)}, versus ${formatPercent(growth.otherAverage)} outside this group.`
      : "";
  const fertilityComparison =
    Number.isFinite(fertility.average) &&
    Number.isFinite(fertility.otherAverage)
      ? ` Average fertility is ${formatFertility(fertility.average)}, versus ${formatFertility(fertility.otherAverage)} outside this group.`
      : "";

  if (legend.mode === "income") {
    const life = computeMetricStats(
      countries,
      otherCountries,
      "lifeExpectancy",
      metricFor,
    );
    const medianAge = computeMetricStats(
      countries,
      otherCountries,
      "medianAge",
      metricFor,
    );
    const oldest = medianAge.max;
    const youngest = medianAge.min;
    const longestLived = life.max;
    const shortestLived = life.min;

    if (
      Number.isFinite(medianAge.average) &&
      Number.isFinite(medianAge.otherAverage) &&
      medianAge.average - medianAge.otherAverage >= 4
    ) {
      return `${yearLead} ${label} has the oldest age profile among income groups. Median age averages ${formatAverageYears(medianAge.average)}, versus ${formatAverageYears(medianAge.otherAverage)} outside this group; ${oldest.country.name} is highest at ${formatYears(oldest.value)}.`;
    }

    if (
      Number.isFinite(medianAge.average) &&
      Number.isFinite(medianAge.otherAverage) &&
      medianAge.otherAverage - medianAge.average >= 4
    ) {
      return `${yearLead} ${label} has the youngest age profile among income groups. Median age averages ${formatAverageYears(medianAge.average)}, versus ${formatAverageYears(medianAge.otherAverage)} outside this group; ${youngest.country.name} is lowest at ${formatYears(youngest.value)}.`;
    }

    if (
      Number.isFinite(life.average) &&
      Number.isFinite(life.otherAverage) &&
      Math.abs(life.average - life.otherAverage) >= 2
    ) {
      const direction = life.average > life.otherAverage ? "higher" : "lower";
      const edgeCountry =
        life.average > life.otherAverage ? longestLived : shortestLived;
      return `${yearLead} life expectancy is ${direction} in ${label}. The group averages ${formatAverageYears(life.average)}, versus ${formatAverageYears(life.otherAverage)} outside it; ${edgeCountry.country.name} defines the edge at ${formatYears(edgeCountry.value)}.`;
    }
  }

  if (fertility.entries.length && belowReplacementShare >= 0.6) {
    return `${yearLead} low fertility is the standout pattern in ${label};${fertilityContext}${fertilityComparison}`;
  }

  if (growth.entries.length && decliningCount > growingCount) {
    return `${yearLead} population decline is the stronger signal in ${label}; ${decliningCount} of ${growth.entries.length} countries show negative growth, led by ${steepestDecline.country.name} at ${formatPercent(steepestDecline.value)}.${growthComparison}${fertilityContext}`;
  }

  if (growth.entries.length && growingCount > decliningCount) {
    return `${yearLead} ${label} still leans toward growth, with ${growingCount} of ${growth.entries.length} countries increasing. ${fastestGrowth.country.name} has the fastest rate at ${formatPercent(fastestGrowth.value)}.${growthComparison}${fertilityContext}`;
  }

  return `${yearLead} ${label} is balanced between growth and decline.${growthComparison}${fertilityContext}`;
}
