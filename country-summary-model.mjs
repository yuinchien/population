import { convertAlpha3ToAlpha2 } from "./data-loader.mjs";

const text = (value) => ({ text: value });
const styled = (value, className) => ({ text: value, className });

export function buildCountrySummary({
  country,
  year,
  years,
  historicalCutoffYear,
  formatPopulation,
  forceNarrative = "",
}) {
  const isProjected = year > historicalCutoffYear;
  const index = years.indexOf(year);
  const population = formatPopulation(country.populations[index]);
  const peakYear = country.peakYear;
  const iso2 = convertAlpha3ToAlpha2(country.iso3)?.toLowerCase();
  const lead = [styled(country.name, "country-capsule")];

  if (isProjected) {
    lead.push(text(" is projected to be home to "));
  } else {
    lead.push(text(" was home to "));
  }
  lead.push(
    styled(population, "underlined"),
    text(` people in ${year}. `),
  );

  let trend;
  if (peakYear == null) {
    trend = [
      text(
        `Its population is projected to keep growing through ${years.at(-1)}, with no peak yet in sight.`,
      ),
    ];
  } else if (peakYear === year) {
    trend = [
      text(
        isProjected
          ? "This is projected to be its peak — the highest its population will reach."
          : "This was its peak — the highest its population reached.",
      ),
    ];
  } else {
    const peakIsProjected = peakYear > historicalCutoffYear;
    const peakPopulation = formatPopulation(
      country.populations[years.indexOf(peakYear)],
    );
    if (year < peakYear && peakIsProjected) {
      trend = [
        text(`That number is projected to keep climbing until it peaks near ${peakPopulation} in `),
        styled(String(peakYear), "underlined"),
        text("."),
      ];
    } else if (year < peakYear) {
      trend = [
        text(`That number kept climbing until it peaked at ${peakPopulation} in ${peakYear}.`),
      ];
    } else {
      trend = [
        text(`That's down from ${peakIsProjected ? "a projected peak" : "a peak"} of ${peakPopulation} in `),
        styled(String(peakYear), "underlined"),
        text("."),
      ];
    }
  }

  if (forceNarrative) {
    trend.push(text(` ${forceNarrative}`));
  }

  return {
    caption: isProjected ? "Projection" : "Historical",
    flagUrl: iso2 ? `./flags/4x3/${iso2}.svg` : null,
    segments: [...lead, ...trend],
  };
}
