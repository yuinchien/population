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
    return !best || value > best.value ? { year, value, index } : best;
  }, null);
  // A max at the first or last data year isn't a genuine peak — the series just
  // ran out while still rising or falling, so there's no confirmed turning
  // point (mirrors computePeakYear's boundary rule in data-loader.mjs). This is
  // what keeps a country still growing at 2100 from being called "peaked."
  if (!peak || peak.index === 0 || peak.index === years.length - 1) {
    return null;
  }
  const startsInRange = includeStart
    ? peak.year >= startYear
    : peak.year > startYear;
  return startsInRange && peak.year <= endYear ? peak.year : null;
}

// The only pivot worth surfacing here is the personal one — the country's
// own population peak, when it fell within the reader's lifetime so far.
// (A global milestone like "world population passed 8B" applies to everyone
// alive and reads as filler, so it's deliberately left out.)
function lifetimePresentPivotSentence({ country, countryPeakYear }) {
  if (countryPeakYear == null) return "";
  const possessiveCountryName = country.name.endsWith("s")
    ? `${country.name}'`
    : `${country.name}'s`;
  return ` You have already lived through ${possessiveCountryName} population peak in ${countryPeakYear}.`;
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

// Join sentence fragments into a paragraph: trim each, drop empties, and put a
// single space between. Builders can return "" to skip a sentence without any
// caller having to juggle leading/trailing spaces.
function joinSentences(...parts) {
  return parts
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ");
}

// Render a list of phrases as prose with an Oxford "and":
// ["a"] -> "a"; ["a","b"] -> "a and b"; ["a","b","c"] -> "a, b, and c".
function joinListProse(items) {
  const list = items.filter(Boolean);
  if (list.length <= 1) return list.join("");
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list.slice(0, -1).join(", ")}, and ${list.at(-1)}`;
}

// Arrival-act "context facts" — each returns a bare phrase (no leading space,
// no trailing punctuation) so they can be woven into one prose list sentence
// ("By then <a>, <b>, and <c>.") or dropped entirely by returning "".
function lifetimeArrivalAgingPhrase(olderShareAtBirth) {
  if (!Number.isFinite(olderShareAtBirth)) return "";
  const stage = currentAgingStage(olderShareAtBirth);
  // Below the aging-society threshold, no aging note is added to the copy.
  if (!stage) return "";
  const article = stage.label.startsWith("a") ? "an" : "a";
  return `it had officially become ${article} ${stage.label}`;
}

function lifetimeArrivalYouthDependencyPhrase(youthDependencyRatioAtBirth) {
  if (
    !Number.isFinite(youthDependencyRatioAtBirth) ||
    youthDependencyRatioAtBirth <= 80
  ) {
    return "";
  }
  return `youth dependency was high at ${Number(youthDependencyRatioAtBirth).toFixed(1)} children per 100 working-age adults`;
}

// When the country's population had already peaked before the person was born,
// the peak belongs in the Arrival act (peaks during their life show up in the
// Present/Horizon acts instead). `peakYear` is the country's all-time peak.
function lifetimeArrivalPeakPhrase(peakYear, birthYear) {
  if (
    !Number.isFinite(peakYear) ||
    !Number.isFinite(birthYear) ||
    peakYear >= birthYear
  ) {
    return "";
  }
  return `its population had already peaked in ${peakYear}`;
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

// Builds all three acts [arrival, present, horizon] in one pass so the shared,
// expensive work (cluster/aging counts across every country, the life-
// expectancy comparison, etc.) happens once per render rather than once per
// section. Callers index into the returned array.
export function buildLifetimeStory({
  country,
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
  const countryYouthDependencyRatioAtBirth =
    demographicMetrics?.countries?.[country.iso3]?.youthDependencyRatio?.[
      context.birthIndex
    ];
  const arrivalAgingPhrase = lifetimeArrivalAgingPhrase(
    countryOlderShareAtBirth,
  );
  const arrivalYouthDependencyPhrase = lifetimeArrivalYouthDependencyPhrase(
    countryYouthDependencyRatioAtBirth,
  );
  // The country's all-time population peak; when it predates the birth year it
  // is surfaced in the Arrival act.
  const allTimeCountryPeakYear = countryPopulationPeakYearBetween({
    country,
    years,
    startYear: years[0],
    endYear: years[years.length - 1],
    includeStart: true,
    getPopulationSeries,
  });
  const arrivalPeakPhrase = lifetimeArrivalPeakPhrase(
    allTimeCountryPeakYear,
    birthYear,
  );
  // The notable birth-year context facts, woven into a single sentence that
  // stays out of the (cleaner) life-expectancy line. Order: peak, aging, youth.
  const arrivalFacts = joinListProse([
    arrivalPeakPhrase,
    arrivalAgingPhrase,
    arrivalYouthDependencyPhrase,
  ]);
  const arrivalFactsSentence = arrivalFacts ? `By then ${arrivalFacts}.` : "";

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
  const countryPeakYear = countryPopulationPeakYearBetween({
    country,
    years,
    birthYear,
    presentYear: context.presentYear,
    getPopulationSeries,
  });
  const presentPivotCopy = lifetimePresentPivotSentence({
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
      ? `${country.name} is projected to reach its population peak in ${projectedCountryPeakYear}.`
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
      text: joinSentences(
        `When you were born in ${birthYear}, you joined a global population of ${formatPopulation(birthPop)} people.`,
        `In ${country.name}, the average life expectancy at birth was ${countryLifeAtBirth != null ? formatLifeExpectancy(countryLifeAtBirth) : "not available"}.`,
        arrivalFactsSentence,
      ),
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
      text: joinSentences(
        `Fast forward to today. The world has added ${formatPopulation(addedSinceBirth)} people since your birth year.`,
        youngerShare != null
          ? `In ${country.name}, about ${youngerShare.toFixed(0)}% of people alive now are younger than you.`
          : "",
        presentPivotCopy,
      ),
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
      text: joinSentences(
        `By ${context.finalYear}, you will be ${finalAge ?? "—"} years old in a world of roughly ${formatPopulation(finalPop)} people.`,
        globalLifeChangeCopy,
        projectedCountryPeakCopy,
        horizonAgingCopy,
        trajectoryCopy,
      ),
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

  return acts;
}

// Convenience wrapper for a single act by index. Kept for callers (and tests)
// that want one act; prefer buildLifetimeStory when rendering the whole story.
export function buildLifetimeStoryAct({ actIndex, ...params }) {
  const acts = buildLifetimeStory(params);
  return acts[actIndex] ?? acts[0];
}
