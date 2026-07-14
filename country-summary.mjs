import { flagIconUrl } from "./data-loader.mjs";
export function buildCountrySummary({
  country,
  year,
  years,
  historicalCutoffYear,
  formatPopulation,
}) {
  const isProjected = year > historicalCutoffYear;
  const index = years.indexOf(year);
  const population = formatPopulation(country.populations[index]);
  const peakYear = country.peakYear;
  const caption = isProjected ? "Projected" : "Historical";

  const flagUrl = flagIconUrl(country.iso3);
  const lead = isProjected
    ? `<span class="country-capsule">${country.name}</span> is projected to be home to <span class="underlined">${population}</span> people in ${year}.`
    : `<span class="country-capsule">${country.name}</span> was home to <span class="underlined">${population}</span> people in ${year}.`;

  let trend;
  if (peakYear == null) {
    trend = `Its population is projected to keep growing through ${years.at(-1)}, with no peak yet in sight.`;
  } else if (peakYear === year) {
    trend = isProjected
      ? "This is projected to be its peak — the highest its population will reach."
      : "This was its peak — the highest its population reached.";
  } else {
    const peakIsProjected = peakYear > historicalCutoffYear;
    const peakPopulation = formatPopulation(country.populations[years.indexOf(peakYear)]);
    trend =
      year < peakYear
        ? peakIsProjected
          ? `That number is projected to keep climbing until it peaks near ${peakPopulation} in <span class="underlined">${peakYear}</span>.`
          : `That number kept climbing until it peaked at ${peakPopulation} in ${peakYear}.`
        : `That's down from ${peakIsProjected ? "a projected peak" : "a peak"} of ${peakPopulation} in <span class="underlined">${peakYear}</span>.`;
  }

  return `<div class="country-summary-meta"><div class="caption mono-uppercase">${caption}</div><span class="country-summary-flag" style="background-image: url('${flagUrl}');" aria-hidden="true"></span></div><div class="country-summary-copy">${lead} ${trend}</div>`;
}
