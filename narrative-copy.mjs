export const textSegment = (value) => ({ text: value });
export const styledSegment = (value, className) => ({
  text: value,
  className,
});

export function countryPopulationLeadSegments({
  countryName,
  population,
  year,
  isProjected,
}) {
  return [
    styledSegment(countryName, "country-capsule"),
    textSegment(isProjected ? " is projected to be home to " : " was home to "),
    styledSegment(population, "underlined"),
    textSegment(` people in ${year}. `),
  ];
}

export function countryPopulationTrendSegments({
  year,
  finalYear,
  peakYear,
  peakPopulation,
  isProjected,
  peakIsProjected,
}) {
  if (peakYear == null) {
    return [
      textSegment(
        `Its population should keep growing through ${finalYear}, with no peak yet in sight.`,
      ),
    ];
  }

  if (peakYear === year) {
    return [
      textSegment(
        isProjected
          ? "This marks its expected peak — the highest its population will reach."
          : "This was its peak — the highest its population reached.",
      ),
    ];
  }

  if (year < peakYear && peakIsProjected) {
    return [
      textSegment(
        `That number should keep climbing until it peaks near ${peakPopulation} in `,
      ),
      styledSegment(String(peakYear), "underlined"),
      textSegment("."),
    ];
  }

  if (year < peakYear) {
    return [
      textSegment(
        `That number kept climbing until it peaked at ${peakPopulation} in ${peakYear}.`,
      ),
    ];
  }

  return [
    textSegment(`That's down from its peak of ${peakPopulation} in `),
    styledSegment(String(peakYear), "underlined"),
    textSegment("."),
  ];
}

export function migrationMomentumSentence({
  year,
  historicalCutoffYear,
  formattedRate,
}) {
  const rateCopy =
    year > historicalCutoffYear
      ? `Net migration is forecast at ${formattedRate} per 1,000 people in ${year}`
      : `Net migration was ${formattedRate} per 1,000 people in ${year}`;
  return `${rateCopy}, helping sustain its Migrant Momentum trajectory.`;
}

export function agingMilestoneSentence({
  countryName,
  stage,
  article,
  entryYear,
  year,
  shareCopy,
  historicalCutoffYear,
}) {
  const timingCopy =
    entryYear > historicalCutoffYear ? "is expected to become" : "became";
  const selectedYearCopy =
    year > historicalCutoffYear ? "will reach" : "had reached";
  return `${countryName} ${timingCopy} ${article} ${stage.label} in ${entryYear}. By ${year}, the 65+ share ${selectedYearCopy} ${shareCopy} of its population.`;
}

export function belowAgingThresholdSentence({
  countryName,
  year,
  shareCopy,
  nextYear,
  historicalCutoffYear,
}) {
  if (nextYear != null) {
    const transitionCopy =
      nextYear > historicalCutoffYear ? "will reach" : "reached";
    return `${countryName} remains below the aging-society threshold in ${year}. It ${transitionCopy} 7% of its population aged 65 and older in ${nextYear}.`;
  }

  return `${countryName} remains below the aging-society threshold in ${year}, with people aged 65 and older making up ${shareCopy} of its population.`;
}

export function lifespanProjectionSentence({
  lifespanEnd,
  presentYear,
  finalYear,
}) {
  return lifespanEnd != null && lifespanEnd < presentYear
    ? `You have already lived beyond your birth-year life expectancy of ${lifespanEnd}; from here, the projection window stretches toward ${finalYear}`
    : `Based on UN projections, your life expectancy stretches toward ${lifespanEnd ?? finalYear}`;
}

export function superAgedSocietiesSentence({
  countryName,
  selectedCountryIsSuperAged,
  count,
}) {
  if (selectedCountryIsSuperAged && count != null) {
    return `${countryName} will be among ${count} nations classified as super-aged societies, grappling with shrinking, aging populations.`;
  }
  if (count != null) {
    return `${count} countries would have become super-aged societies.`;
  }
  return "Many countries will be adjusting to older age structures.";
}

export function agingSocietiesSentence({
  countryName,
  selectedCountryIsAging,
  selectedStage,
  year,
  olderShare,
  count,
}) {
  const unit = count === 1 ? "nation" : "nations";
  if (selectedStage && count != null) {
    const pluralStageLabel = selectedStage.label.replace(
      /society$/,
      "societies",
    );
    const shareCopy = Number.isFinite(olderShare)
      ? `, with 65+ share reaching ${olderShare.toFixed(1)}% of its population`
      : "";
    return `${countryName} will be among ${count} ${unit} classified as ${pluralStageLabel}${shareCopy}.`;
  }
  if (selectedCountryIsAging && count != null) {
    return `${countryName} will be among ${count} ${unit} classified as aging societies, navigating the needs of a rapidly aging population.`;
  }
  if (count != null) {
    return `${count} ${unit} will be classified as aging societies, navigating the needs of a rapidly aging population.`;
  }
  return "Many countries will be adjusting to older age structures.";
}

export function legacyClusterSentence({ silverDeclineCount, growthCount }) {
  if (silverDeclineCount == null || growthCount == null) return "";
  return ` ${silverDeclineCount} countries are projected to be in Silver Decline, adjusting to shrinking, super-aged societies`;
}
