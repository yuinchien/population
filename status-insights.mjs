import {
  formatCount,
  formatFertility,
  formatPercent,
  formatYears,
} from "./metrics.mjs";

export function displayGroupLabel(label) {
  if (label.includes("Afghanistan & Pakistan")) {
    return "Middle East & North Africa";
  }
  return label.replace(" countries", "");
}

function formatAverageYears(value) {
  return `${Number(value).toFixed(1)} yrs`;
}

function metricRows(globalData, key) {
  return [...(globalData[key] || [])].sort((a, b) => a.year - b.year);
}

function firstMetricYear(globalData, key, predicate) {
  return metricRows(globalData, key).find(({ value }) => predicate(value));
}

// title reads as the milestone's headline sentence, folded directly into
// its own text rather than kept as a separate field — #statusTitle used to
// render it as its own lead-in span ahead of the description, but that
// meant every consumer of a milestone's text had to know to stitch the two
// back together in the right order; a single combined string can't drift
// out of sync with itself.
function addMilestone(milestones, year, title, text, priority = 0) {
  if (!Number.isFinite(year)) return;
  const current = milestones.get(year);
  if (!current || priority > current.priority) {
    milestones.set(year, { text: `${title}. ${text}`, priority });
  }
}

// The first year a region's share of *cumulative* population growth since
// baseYear (typically the historical/projected cutoff, i.e. "now") crosses
// the given threshold — distinct from that region's share of total world
// population, which the region has held for a while by the time its share
// of new growth catches up.
function regionGrowthShareYear(countries, years, baseYear, region, threshold) {
  const baseIndex = years.indexOf(baseYear);
  if (baseIndex === -1 || baseIndex >= years.length - 1) return null;

  const totalAt = (index, regionFilter) =>
    countries.reduce((sum, country) => {
      if (regionFilter && country.region?.trim() !== regionFilter) return sum;
      const value = country.populations[index];
      return value != null ? sum + value : sum;
    }, 0);

  const globalBase = totalAt(baseIndex);
  const regionBase = totalAt(baseIndex, region);

  for (let i = baseIndex + 1; i < years.length; i++) {
    const globalGrowth = totalAt(i) - globalBase;
    const regionGrowth = totalAt(i, region) - regionBase;
    if (globalGrowth > 0 && regionGrowth / globalGrowth >= threshold) {
      return years[i];
    }
  }
  return null;
}

export function computeGlobalTrendMilestones(
  globalData,
  countries = [],
  years = [],
  baseYear,
) {
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
      "Peak Humanity",
      `${peakPopulation.year} is the projected turning point for world population: it tops out near ${formatCount(peakPopulation.value)} before edging downward.`,
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
      "Ten Billion World",
      `${tenBillion.year} is the first year the medium projection puts the world above 10B people.`,
      4,
    );
  }

  addMilestone(
    milestones,
    2037,
    "The Next Billion",
    "2037 is the projected year the world population crosses 9B, roughly 15 years after passing 8B in 2022.",
    4,
  );

  addMilestone(
    milestones,
    2063,
    "The Great Age Inversion",
    "2063 is the projected age-structure tipping point when people aged 65 and older outnumber children under 15 for the first time.",
    4,
  );

  addMilestone(
    milestones,
    2070,
    "A Super-Aged Planet",
    "2070 is when the world is projected to become a super-aged society, with more than 20% of the world population aged 65 or older.",
    4,
  );

  addMilestone(
    milestones,
    2080,
    "Seniors Outnumber Youth",
    "2080 deepens the global age shift: adults aged 65 and older are projected to permanently outnumber all children and teenagers under 18.",
    4,
  );

  const replacementFertility = firstMetricYear(
    globalData,
    "fertility",
    (value) => value < 2.1,
  );
  if (replacementFertility) {
    addMilestone(
      milestones,
      replacementFertility.year,
      "Below Replacement",
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
      "Slower Growth Era",
      `${slowGrowth.year} marks a slower-growth world: world population growth falls below 0.5% for the first time in the projection.`,
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
      "Longer Lives",
      `${life80.year} is the first projected year global life expectancy reaches 80 years.`,
      3,
    );
  }

  if (countries.length && years.length && baseYear != null) {
    const africanCenturyYear = regionGrowthShareYear(
      countries,
      years,
      baseYear,
      "Sub-Saharan Africa",
      0.5,
    );
    if (africanCenturyYear) {
      addMilestone(
        milestones,
        africanCenturyYear,
        "The African Century",
        `${africanCenturyYear} is the year Sub-Saharan Africa's share of global population growth since ${baseYear} first tops half — more than half of everyone added to the planet from here on is projected to be born there.`,
        4,
      );
    }
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
  const period = isProjected ? "projection" : "historical";
  const populationEntries = countriesWithNumericValue(
    countries,
    (country) => country.populations[currentYearIndex],
  );

  if (!populationEntries.length) {
    return {
      period,
      text: `No ${projected}country population data is available for ${label} in ${year}.`,
    };
  }

  const otherCountries = allCountries.filter((country) =>
    legend.mode === "income"
      ? country._incomeLabel !== legend.label
      : country.region?.trim() !== legend.label,
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
      return { period, text: `${label} has the oldest age profile among income groups in ${year}. Median age averages ${formatAverageYears(medianAge.average)}, versus ${formatAverageYears(medianAge.otherAverage)} outside this group; ${oldest.country.name} is highest at ${formatYears(oldest.value)}.` };
    }

    if (
      Number.isFinite(medianAge.average) &&
      Number.isFinite(medianAge.otherAverage) &&
      medianAge.otherAverage - medianAge.average >= 4
    ) {
      return { period, text: `${label} has the youngest age profile among income groups in ${year}. Median age averages ${formatAverageYears(medianAge.average)}, versus ${formatAverageYears(medianAge.otherAverage)} outside this group; ${youngest.country.name} is lowest at ${formatYears(youngest.value)}.` };
    }

    if (
      Number.isFinite(life.average) &&
      Number.isFinite(life.otherAverage) &&
      Math.abs(life.average - life.otherAverage) >= 2
    ) {
      const direction = life.average > life.otherAverage ? "higher" : "lower";
      const edgeCountry =
        life.average > life.otherAverage ? longestLived : shortestLived;
      return { period, text: `Life expectancy in ${label} is ${direction} in ${year}. The group averages ${formatAverageYears(life.average)}, versus ${formatAverageYears(life.otherAverage)} outside it; ${edgeCountry.country.name} defines the edge at ${formatYears(edgeCountry.value)}.` };
    }
  }

  if (fertility.entries.length && belowReplacementShare >= 0.6) {
    return { period, text: `Low fertility is the standout pattern in ${label} in ${year};${fertilityContext}${fertilityComparison}` };
  }

  if (growth.entries.length && decliningCount > growingCount) {
    return { period, text: `Population decline is the stronger signal in ${label} in ${year}; ${decliningCount} of ${growth.entries.length} countries show negative growth, led by ${steepestDecline.country.name} at ${formatPercent(steepestDecline.value)}.${growthComparison}${fertilityContext}` };
  }

  if (growth.entries.length && growingCount > decliningCount) {
    return { period, text: `${label} still leans toward growth in ${year}, with ${growingCount} of ${growth.entries.length} countries increasing. ${fastestGrowth.country.name} has the fastest rate at ${formatPercent(fastestGrowth.value)}.${growthComparison}${fertilityContext}` };
  }

  return { period, text: `${label} is balanced between growth and decline in ${year}.${growthComparison}${fertilityContext}` };
}
