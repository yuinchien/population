import {
  classifyCountry,
  populationDeclineContext,
  refineArchetypeForPhase,
} from "./cluster-model.mjs";
import { currentAgingStage } from "./country-aging-narrative.mjs";
import {
  ageBandStart,
  interpolateAgeStructure,
} from "./country-pyramid.mjs";
import {
  agingSocietiesSentence,
  legacyClusterSentence,
  lifespanProjectionSentence,
} from "./narrative-copy.mjs";
import { displayGroupLabel } from "./status-insights.mjs";

// Pure helpers for the Lifetime view — no DOM, no data fetching — so the
// personal-framing math stays unit-testable independent of the render wiring.

// Your age in a given year, or null if you aren't born yet.
export function ageAt(birthYear, year) {
  if (!Number.isFinite(birthYear) || !Number.isFinite(year)) return null;
  const age = year - birthYear;
  return age >= 0 ? age : null;
}

// The year you reach the end of your life expectancy (birth year + LE at
// birth, rounded). Null when either input is missing.
export function projectedLifespanEnd(birthYear, lifeExpectancy) {
  if (!Number.isFinite(birthYear) || !Number.isFinite(lifeExpectancy)) {
    return null;
  }
  return Math.round(birthYear + lifeExpectancy);
}

// World-population milestones from the global series: the first year each
// threshold is crossed (population rises then peaks, so thresholds above the
// peak are simply never reached), plus the peak year itself. `rows` is the
// [{ year, value }] population series in chronological order.
export function populationMilestones(rows, thresholds = [8e9, 9e9, 10e9]) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const milestones = [];
  for (const threshold of thresholds) {
    const crossing = rows.find((row) => row.value >= threshold);
    if (crossing) {
      milestones.push({
        year: crossing.year,
        label: `World population passes ${formatBillions(threshold)}`,
      });
    }
  }
  const peak = rows.reduce(
    (best, row) => (!best || row.value > best.value ? row : best),
    null,
  );
  if (peak) {
    milestones.push({ year: peak.year, label: "World population peaks" });
  }
  return milestones.sort((a, b) => a.year - b.year);
}

function formatBillions(value) {
  const billions = value / 1e9;
  return `${Number.isInteger(billions) ? billions : billions.toFixed(1)}B`;
}

// The subset of milestones that fall within your projected lifespan
// [birthYear, endYear], sorted chronologically. When endYear is null (no life
// expectancy), everything from your birth year on is included.
export function milestonesInLifespan(milestones, birthYear, endYear) {
  if (!Array.isArray(milestones) || !Number.isFinite(birthYear)) return [];
  return milestones
    .filter(
      (milestone) =>
        milestone.year >= birthYear &&
        (endYear == null || milestone.year <= endYear),
    )
    .sort((a, b) => a.year - b.year);
}

export function lifetimePresentYear(years, date = new Date()) {
  if (!Array.isArray(years) || years.length === 0) return null;
  const calendarYear = date.getFullYear();
  let nearestYear = years[0];
  let nearestDistance = Math.abs(calendarYear - nearestYear);
  years.forEach((year) => {
    const distance = Math.abs(calendarYear - year);
    if (
      distance < nearestDistance ||
      (distance === nearestDistance && year < nearestYear)
    ) {
      nearestYear = year;
      nearestDistance = distance;
    }
  });
  return nearestYear;
}

function yearIndex(years, year) {
  return years.indexOf(year);
}

function nearestYearIndex(years, year) {
  if (!Array.isArray(years) || !years.length || !Number.isFinite(year)) {
    return -1;
  }
  return years.reduce((bestIndex, candidateYear, index) => {
    const bestDistance = Math.abs(years[bestIndex] - year);
    const distance = Math.abs(candidateYear - year);
    return distance < bestDistance ? index : bestIndex;
  }, 0);
}

function countrySeries(country, demographicMetrics, key, getPopulationSeries) {
  return key === "population"
    ? getPopulationSeries?.(country) ?? country?.populations ?? []
    : demographicMetrics?.countries?.[country?.iso3]?.[key] ?? [];
}

function countryValue(country, demographicMetrics, key, index, getPopulationSeries) {
  if (!country || index < 0) return null;
  return countrySeries(country, demographicMetrics, key, getPopulationSeries)[
    index
  ] ?? null;
}

function globalPopulationRows(years, globalMetricsByYear) {
  return years
    .map((year) => ({ year, value: globalMetricsByYear?.get(year)?.population }))
    .filter((row) => Number.isFinite(row.value));
}

function globalLifeExpectancyRows(years, globalMetricsByYear, extraYears = []) {
  return [...new Set([...(years ?? []), ...extraYears])]
    .map((year) => ({
      year,
      value: globalMetricsByYear?.get(year)?.lifeExpectancy,
    }))
    .filter((row) => Number.isFinite(row.value))
    .sort((a, b) => a.year - b.year);
}

export function lifetimeAgeStructureShareYoungerThan({
  country,
  countryAgeStructure,
  year,
  age,
}) {
  if (!Number.isFinite(age) || age <= 0 || !countryAgeStructure) return null;
  const countryData = countryAgeStructure.countries?.[country.iso3];
  const shares = interpolateAgeStructure(
    countryData,
    countryAgeStructure.years,
    year,
  );
  if (!shares) return null;
  const ageGroups = countryAgeStructure.ageGroups ?? [];
  let younger = 0;
  let total = 0;
  ageGroups.forEach((label, index) => {
    const start = ageBandStart(label);
    if (!Number.isFinite(start)) return;
    const nextStart = ageBandStart(ageGroups[index + 1]);
    const end = Number.isFinite(nextStart) ? nextStart : start + 5;
    const bandShare = (shares.male[index] ?? 0) + (shares.female[index] ?? 0);
    total += bandShare;
    const portion = Math.min(1, Math.max(0, (age - start) / (end - start)));
    younger += bandShare * portion;
  });
  return total > 0 ? (younger / total) * 100 : null;
}

export function lifetimeCountryArchetype({
  country,
  years,
  yearIndex,
  demographicMetrics,
  getPopulationSeries,
}) {
  if (!country || yearIndex < 0) return null;
  const seriesFor = (key) =>
    countrySeries(country, demographicMetrics, key, getPopulationSeries);
  const population = seriesFor("population")[yearIndex] ?? null;
  const rawArchetype = classifyCountry({
    fertility: seriesFor("fertility")[yearIndex],
    netMigrationRate: seriesFor("netMigrationRate")[yearIndex],
    populationGrowth: seriesFor("populationGrowth")[yearIndex],
    incomeLabel: country._incomeLabel,
    ...populationDeclineContext(
      seriesFor("population"),
      years,
      yearIndex,
      population,
    ),
  });
  return refineArchetypeForPhase(
    rawArchetype,
    years[yearIndex],
    seriesFor("lifeExpectancy")[yearIndex],
  );
}

export function lifetimeClusterCount({
  archetype,
  countries,
  years,
  yearIndex,
  demographicMetrics,
  getPopulationSeries,
}) {
  if (!demographicMetrics || yearIndex < 0) return null;
  return countries.reduce((count, country) => {
    return (
      count +
      (lifetimeCountryArchetype({
        country,
        years,
        yearIndex,
        demographicMetrics,
        getPopulationSeries,
      }) === archetype)
    );
  }, 0);
}

export function lifetimeSuperAgedCount({
  countries,
  yearIndex,
  demographicMetrics,
}) {
  if (!demographicMetrics || yearIndex < 0) return null;
  return countries.reduce((count, country) => {
    const share =
      demographicMetrics.countries?.[country.iso3]?.olderPopulationShare?.[
        yearIndex
      ];
    return count + (Number.isFinite(share) && share > 20);
  }, 0);
}

export function lifetimeAgingSocietyCount({
  countries,
  yearIndex,
  demographicMetrics,
}) {
  if (!demographicMetrics || yearIndex < 0) return null;
  return countries.reduce((count, country) => {
    const share =
      demographicMetrics.countries?.[country.iso3]?.olderPopulationShare?.[
        yearIndex
      ];
    return count + (currentAgingStage(share) ? 1 : 0);
  }, 0);
}

function lifetimeAgingStageCount({
  countries,
  yearIndex,
  demographicMetrics,
  stage,
}) {
  if (!stage || !demographicMetrics || yearIndex < 0) return null;
  return countries.reduce((count, country) => {
    const share =
      demographicMetrics.countries?.[country.iso3]?.olderPopulationShare?.[
        yearIndex
      ];
    return count + (currentAgingStage(share)?.key === stage.key ? 1 : 0);
  }, 0);
}

function firstPopulationMilestoneAfter(rows, year, endYear) {
  return populationMilestones(rows).find(
    (milestone) =>
      milestone.year > year && (endYear == null || milestone.year <= endYear),
  );
}

function latestPopulationMilestoneBetween(rows, startYear, endYear) {
  return milestonesInLifespan(
    populationMilestones(rows),
    startYear,
    endYear,
  ).at(-1);
}

export function countryPopulationPeakYearBetween({
  country,
  years,
  birthYear,
  presentYear,
  startYear = birthYear,
  endYear = presentYear,
  includeStart = true,
  getPopulationSeries,
}) {
  const series = getPopulationSeries?.(country) ?? country?.populations ?? [];
  if (
    !country ||
    !Array.isArray(years) ||
    !Array.isArray(series) ||
    !Number.isFinite(startYear) ||
    !Number.isFinite(endYear)
  ) {
    return null;
  }
  const peak = years.reduce((best, year, index) => {
    const value = series[index];
    if (!Number.isFinite(value)) return best;
    return !best || value > best.value ? { year, value } : best;
  }, null);
  const startsInRange = includeStart
    ? peak?.year >= startYear
    : peak?.year > startYear;
  return peak && startsInRange && peak.year <= endYear
    ? peak.year
    : null;
}

function lifetimePresentPivotSentence({
  recentMilestone,
  country,
  countryPeakYear,
}) {
  const possessiveCountryName = country.name.endsWith("s")
    ? `${country.name}'`
    : `${country.name}'s`;
  const pivots = [];
  if (recentMilestone) {
    const milestoneCopy = recentMilestone.label
      .replace(/^World population passes /, "the world population passing ");
    pivots.push(`${milestoneCopy} in ${recentMilestone.year}`);
  }
  if (countryPeakYear != null) {
    pivots.push(`${possessiveCountryName} population peak in ${countryPeakYear}`);
  }
  if (!pivots.length) return "";
  const pivotCopy =
    pivots.length === 1
      ? pivots[0]
      : `${pivots.slice(0, -1).join(", ")} and ${pivots.at(-1)}`;
  return ` You have already lived through major pivots, like ${pivotCopy}.`;
}

export function countryTrajectorySummary(countryTrajectory, country) {
  const trajectories = countryTrajectory?.demographic_trajectories ?? [];
  const match = trajectories.find((trajectory) =>
    trajectory.iso3_list?.includes(country?.iso3),
  );
  const template = match?.summary_template;
  if (!template || !country?.name) return "";
  return template.replaceAll("[COUNTRY]", country.name);
}

function lifetimeArrivalAgingClause(olderShareAtBirth) {
  if (!Number.isFinite(olderShareAtBirth)) return "";
  const stage = currentAgingStage(olderShareAtBirth);
  if (!stage) return " remained below the aging-society threshold";
  const article = stage.label.startsWith("a") ? "an" : "a";
  return ` was already ${article} ${stage.label}`;
}

export function lifetimeStoryContext({
  country,
  birthYear,
  years,
  demographicMetrics,
  globalMetricsByYear,
  getPopulationSeries,
  currentDate,
}) {
  const birthIndex = yearIndex(years, birthYear);
  const presentYear = lifetimePresentYear(years, currentDate);
  const presentIndex = yearIndex(years, presentYear);
  const lifeExpectancy = countryValue(
    country,
    demographicMetrics,
    "lifeExpectancy",
    birthIndex,
    getPopulationSeries,
  );
  const lifespanEnd = projectedLifespanEnd(birthYear, lifeExpectancy);
  const maxYear = years[years.length - 1];
  const finalYear =
    lifespanEnd == null
      ? maxYear
      : Math.min(Math.max(lifespanEnd, presentYear, birthYear), maxYear);
  const finalIndex = yearIndex(years, finalYear);
  const populationRows = globalPopulationRows(years, globalMetricsByYear);
  const horizonMilestone = firstPopulationMilestoneAfter(
    populationRows,
    presentYear,
    finalYear,
  );
  const horizonYear = horizonMilestone?.year ?? finalYear;
  const horizonIndex = yearIndex(years, horizonYear);
  return {
    birthIndex,
    presentYear,
    presentIndex,
    lifeExpectancy,
    lifespanEnd,
    finalYear,
    finalIndex,
    horizonMilestone,
    horizonYear,
    horizonIndex,
    populationRows,
  };
}

// Life-expectancy-at-birth for the person's country plus each world region
// (unweighted country mean, matching the app's group aggregation) at a given
// year index. The country is flagged for highlight and pinned first; regions
// follow alphabetically by display label. Values are raw numbers — the caller
// formats them.
export function lifetimeLifeExpectancyComparison({
  country,
  countries,
  demographicMetrics,
  yearIndex: index,
}) {
  if (!country || index == null || index < 0) return [];
  const lifeExpectancyAt = (iso3) =>
    demographicMetrics?.countries?.[iso3]?.lifeExpectancy?.[index];

  const totals = new Map(); // raw region name -> { sum, count }
  for (const item of countries ?? []) {
    const region = item.region?.trim();
    const value = lifeExpectancyAt(item.iso3);
    if (!region || !Number.isFinite(value)) continue;
    const entry = totals.get(region) ?? { sum: 0, count: 0 };
    entry.sum += value;
    entry.count += 1;
    totals.set(region, entry);
  }

  const regions = [...totals.entries()]
    .map(([region, { sum, count }]) => ({
      label: displayGroupLabel(region),
      value: sum / count,
      highlight: false,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const countryValue = lifeExpectancyAt(country.iso3);
  const rows = [];
  if (Number.isFinite(countryValue)) {
    rows.push({ label: country.name, value: countryValue, highlight: true });
  }
  rows.push(...regions);
  return rows;
}

export function buildLifetimeStoryAct({
  country,
  actIndex,
  birthYear,
  years,
  countries,
  globalMetricsByYear,
  getPopulationSeries,
  demographicMetrics,
  countryAgeStructure,
  countryTrajectory,
  formatPopulation,
  formatLifeExpectancy,
  currentDate,

}) {
  const context = lifetimeStoryContext({
    country,
    birthYear,
    years,
    demographicMetrics,
    globalMetricsByYear,
    getPopulationSeries,
    currentDate,
  });
  const birthPop = globalMetricsByYear.get(birthYear)?.population;
  const presentPop = globalMetricsByYear.get(context.presentYear)?.population;
  const finalPop = globalMetricsByYear.get(context.finalYear)?.population;
  const globalLifeAtBirth = globalMetricsByYear.get(birthYear)?.lifeExpectancy;
  const globalLifeAtFinal = globalMetricsByYear.get(
    context.finalYear,
  )?.lifeExpectancy;
  const countryLifeAtBirth = context.lifeExpectancy;
  const countryOlderShareAtBirth =
    demographicMetrics?.countries?.[country.iso3]?.olderPopulationShare?.[
      context.birthIndex
    ];
  const arrivalAgingClause = lifetimeArrivalAgingClause(
    countryOlderShareAtBirth,
  );

  const presentAge = ageAt(birthYear, context.presentYear);
  const finalAge = ageAt(birthYear, context.finalYear);
  const horizonAge = ageAt(birthYear, context.horizonYear);
  const addedSinceBirth =
    Number.isFinite(birthPop) && Number.isFinite(presentPop)
      ? presentPop - birthPop
      : null;
  const youngerShare = lifetimeAgeStructureShareYoungerThan({
    country,
    countryAgeStructure,
    year: context.presentYear,
    age: presentAge,
  });
  const selectedOlderPopulationShare =
    demographicMetrics?.countries?.[country.iso3]?.olderPopulationShare;
  const agingYearIndex =
    context.finalIndex >= 0
      ? context.finalIndex
      : nearestYearIndex(years, context.finalYear);
  const selectedAgingStage =
    agingYearIndex >= 0 &&
    currentAgingStage(selectedOlderPopulationShare?.[agingYearIndex]);
  const selectedOlderShareAtHorizon = selectedOlderPopulationShare?.[
    agingYearIndex
  ];


  const agingSocietyCount = lifetimeAgingSocietyCount({
    countries,
    yearIndex: agingYearIndex,
    demographicMetrics,
  });
  const selectedAgingStageCount = lifetimeAgingStageCount({
    countries,
    yearIndex: agingYearIndex,
    demographicMetrics,
    stage: selectedAgingStage,
  });
  const silverDeclineCount = lifetimeClusterCount({
    archetype: "silverDecline",
    countries,
    years,
    yearIndex: context.finalIndex,
    demographicMetrics,
    getPopulationSeries,
  });
  const growthCount = lifetimeClusterCount({
    archetype: "growth",
    countries,
    years,
    yearIndex: context.finalIndex,
    demographicMetrics,
    getPopulationSeries,
  });
  const lifespanCopy = lifespanProjectionSentence({
    lifespanEnd: context.lifespanEnd,
    presentYear: context.presentYear,
    finalYear: context.finalYear,
  });
  const recentMilestone = latestPopulationMilestoneBetween(
    context.populationRows,
    birthYear,
    context.presentYear,
  );
  const countryPeakYear = countryPopulationPeakYearBetween({
    country,
    years,
    birthYear,
    presentYear: context.presentYear,
    getPopulationSeries,
  });
  const presentPivotCopy = lifetimePresentPivotSentence({
    recentMilestone,
    country,
    countryPeakYear,
  });
  const projectedCountryPeakYear = countryPopulationPeakYearBetween({
    country,
    years,
    startYear: context.presentYear,
    endYear: years[years.length - 1],
    includeStart: false,
    getPopulationSeries,
  });
  const projectedCountryPeakCopy =
    projectedCountryPeakYear != null
      ? ` ${country.name} is projected to reach its population peak in ${projectedCountryPeakYear}.`
      : "";
  const horizonAgingCopy = agingSocietiesSentence({
    countryName: country.name,
    selectedCountryIsAging: !!selectedAgingStage,
    selectedStage: selectedAgingStage,
    year: context.finalYear,
    olderShare: selectedOlderShareAtHorizon,
    count: selectedAgingStage ? selectedAgingStageCount : agingSocietyCount,
  });
  const finalClusterCopy = legacyClusterSentence({
    silverDeclineCount,
    growthCount,
  });
  const trajectoryCopy = countryTrajectorySummary(countryTrajectory, country);
  const globalLifeChangeCopy =
    Number.isFinite(globalLifeAtBirth) && Number.isFinite(globalLifeAtFinal)
      ? ` Since your birth in ${birthYear}, global life expectancy has risen to ${formatLifeExpectancy(globalLifeAtFinal)} from ${formatLifeExpectancy(globalLifeAtBirth)}.`
      : "";
  const globalLifeExpectancy = {
    title: "Global life expectancy",
    birthYear,
    finalYear: context.finalYear,
    maxYear: years[years.length - 1],
    birthValue: globalLifeAtBirth,
    finalValue: globalLifeAtFinal,
    rows: globalLifeExpectancyRows(years, globalMetricsByYear, [
      birthYear,
      context.finalYear,
    ]),
  };

  const lifeComparison = lifetimeLifeExpectancyComparison({
    country,
    countries,
    demographicMetrics,
    yearIndex: context.birthIndex,
  });


  const acts = [
    {
      year: birthYear,
      text: `When you were born in ${birthYear}, you joined a global population of ${formatPopulation(birthPop)} people. ${country.name} ${arrivalAgingClause}, and the average life expectancy at birth was ${countryLifeAtBirth != null ? formatLifeExpectancy(countryLifeAtBirth) : "not available"}.`,
      comparison: lifeComparison,
      stats: [
        { value: formatPopulation(birthPop), label: "World population" },
        {
          value:
            countryLifeAtBirth != null
              ? formatLifeExpectancy(countryLifeAtBirth)
              : "—",
          label: `${country.name} life expectancy`,
        },
      ],
    },
    {
      year: context.presentYear,
      text: `Fast forward to today. The world has added ${formatPopulation(addedSinceBirth)} people since your birth year.${youngerShare != null ? ` In ${country.name}, about ${youngerShare.toFixed(0)}% of people alive now are younger than you.` : ""}${presentPivotCopy}`,
      populationChange: {
        birthYear,
        presentYear: context.presentYear,
        birthPopulation: formatPopulation(birthPop),
        addedPopulation: formatPopulation(addedSinceBirth),
        birthShare:
          Number.isFinite(birthPop) && Number.isFinite(presentPop) && presentPop
            ? birthPop / presentPop
            : null,
        addedShare:
          Number.isFinite(addedSinceBirth) &&
          Number.isFinite(presentPop) &&
          presentPop
            ? addedSinceBirth / presentPop
            : null,
      },
      stats: [
        { value: String(presentAge ?? "—"), label: "Your age today" },
        {
          value: formatPopulation(addedSinceBirth),
          label: "Added since birth",
        },
      ],
    },
    {
      year: context.finalYear,
      text: `By ${context.finalYear}, you will be ${finalAge ?? "—"} years old in a world of roughly ${formatPopulation(finalPop)} people.${globalLifeChangeCopy}${projectedCountryPeakCopy} ${horizonAgingCopy}${trajectoryCopy ? ` ${trajectoryCopy}` : ""}`,
      globalLifeExpectancy,
      stats: [
        { value: String(finalAge ?? "—"), label: "Your age then" },
        { value: formatPopulation(finalPop), label: "World population" },
        {
          value: agingSocietyCount != null ? String(agingSocietyCount) : "—",
          label: "Aging societies",
        },
        {
          value:
            silverDeclineCount != null ? String(silverDeclineCount) : "—",
          label: "Silver Decline countries",
        },
        {
          value: growthCount != null ? String(growthCount) : "—",
          label: "Natural Expansion countries",
        },
      ],
    },
  ];

  return acts[actIndex] ?? acts[0];
}
