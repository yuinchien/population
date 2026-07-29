import { computePeakYear, convertAlpha3ToAlpha2 } from "./data-loader.mjs";
import {
  countryPopulationLeadSegments,
  countryPopulationTrendSegments,
  styledSegment,
  textSegment,
} from "./narrative-copy.mjs";

const PERCENT_PATTERN = /\d+(?:\.\d+)?%/g;

// demographicNarrative arrives as a plain joined string (it's built by
// stitching together several narrative-copy.mjs sentence functions that
// each return prose, not segments — see script.js's updateStatusPanel).
// Splitting it here, once, at the boundary where it's folded into the
// summary's segment list, underlines every percentage figure in it (e.g.
// "29.4%") the same way the population/peak-year segments above already
// are — without needing each upstream sentence builder to know about
// segments itself.
function narrativeSegments(text) {
  const segments = [];
  let lastIndex = 0;
  for (const match of text.matchAll(PERCENT_PATTERN)) {
    if (match.index > lastIndex) {
      segments.push(textSegment(text.slice(lastIndex, match.index)));
    }
    segments.push(styledSegment(match[0], "underlined"));
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    segments.push(textSegment(text.slice(lastIndex)));
  }
  return segments;
}

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
    trend.push(...narrativeSegments(` ${demographicNarrative}`));
  }

  return {
    flagUrl: iso2 ? `./flags/4x3/${iso2}.svg` : null,
    segments: [...lead, ...trend],
  };
}
