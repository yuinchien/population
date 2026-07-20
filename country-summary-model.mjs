import { computePeakYear, convertAlpha3ToAlpha2 } from "./data-loader.mjs";
import {
  countryPopulationLeadSegments,
  countryPopulationTrendSegments,
  textSegment,
} from "./narrative-copy.mjs";

export function buildCountrySummary({
  country,
  year,
  years,
  historicalCutoffYear,
  formatPopulation,
  populationSeries,
  demographicNarrative = "",
}) {
  const resolvedPopulationSeries = populationSeries ?? country.populations;
  const isProjected = year > historicalCutoffYear;
  const index = years.indexOf(year);
  const population = formatPopulation(resolvedPopulationSeries[index]);
  const peakYear =
    computePeakYear(resolvedPopulationSeries, years) ??
    (populationSeries ? null : country.peakYear);
  const iso2 = convertAlpha3ToAlpha2(country.iso3)?.toLowerCase();
  const lead = countryPopulationLeadSegments({
    countryName: country.name,
    population,
    year,
    isProjected,
  });

  const peakPopulation =
    peakYear == null
      ? null
      : formatPopulation(resolvedPopulationSeries[years.indexOf(peakYear)]);
  const peakIsProjected = peakYear != null && peakYear > historicalCutoffYear;
  const trend = countryPopulationTrendSegments({
    year,
    finalYear: years.at(-1),
    peakYear,
    peakPopulation,
    isProjected,
    peakIsProjected,
  });

  if (demographicNarrative) {
    trend.push(textSegment(` ${demographicNarrative}`));
  }

  return {
    flagUrl: iso2 ? `./flags/4x3/${iso2}.svg` : null,
    segments: [...lead, ...trend],
  };
}
