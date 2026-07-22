import { currentAgingStage } from "./country-aging-narrative.mjs";

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
  subject,
  selectedCountryIsAging,
  selectedStage,
  year,
  olderShare,
  count,
}) {
  const name = subject ?? countryName;
  const unit = count === 1 ? "nation" : "nations";
  if (selectedStage && count != null) {
    const pluralStageLabel = selectedStage.label.replace(
      /society$/,
      "societies",
    );
    const shareCopy = Number.isFinite(olderShare)
      ? `, with 65+ share reaching ${olderShare.toFixed(1)}% of its population`
      : "";
    return `${name} will be among ${count} ${unit} classified as ${pluralStageLabel}${shareCopy}.`;
  }
  if (selectedCountryIsAging && count != null) {
    return `${name} will be among ${count} ${unit} classified as aging societies, navigating the needs of a rapidly aging population.`;
  }
  if (count != null) {
    return "";
    // return `${count} ${unit} will be classified as aging societies, navigating the needs of a rapidly aging population.`;
  }
  return "";
  // return "Many countries will be adjusting to older age structures.";
}

export function legacyClusterSentence({ silverDeclineCount, growthCount }) {
  if (silverDeclineCount == null || growthCount == null) return "";
  return ` ${silverDeclineCount} countries are projected to be in Silver Decline, adjusting to shrinking, super-aged societies`;
}

// Join sentence fragments into a paragraph: trim each, drop empties, and put a
// single space between. Builders can return "" to skip a sentence without any
// caller having to juggle leading/trailing spaces.
export function joinSentences(...parts) {
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
    youthDependencyRatioAtBirth <= 60
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

// Bare, lowercase, unpunctuated clause — the caller weaves this directly into
// the sentence that already established the birth year, rather than
// reintroducing it with a separate "By then" (which reads as a later point in
// time even though it's the same year).
export function lifetimeArrivalFactsSentence({
  olderShareAtBirth,
  youthDependencyRatioAtBirth,
  peakYear,
  birthYear,
}) {
  return joinListProse([
    lifetimeArrivalPeakPhrase(peakYear, birthYear),
    lifetimeArrivalAgingPhrase(olderShareAtBirth),
    lifetimeArrivalYouthDependencyPhrase(youthDependencyRatioAtBirth),
  ]);
}

function possessive(name) {
  return name.endsWith("s") ? `${name}'` : `${name}'s`;
}

// `nameAlreadyUsed` lets the caller avoid repeating the country's name a
// second time in the same paragraph (e.g. right after the "younger than you"
// sentence already named it) by falling back to "its".
export function lifetimePresentPivotSentence({
  countryName,
  countryPeakYear,
  nameAlreadyUsed = false,
}) {
  if (!countryName) return "";
  const subject = nameAlreadyUsed ? "its" : possessive(countryName);
  const capitalizedSubject = `${subject[0].toUpperCase()}${subject.slice(1)}`;
  if (countryPeakYear != null) {
    return ` You have already lived through ${subject} population peak in ${countryPeakYear}.`;
  }
  // No peak yet: still give Present a closing beat instead of trailing off.
  return ` ${capitalizedSubject} population is still climbing as you read this.`;
}

// Sharpens the raw "younger than you" percentage once it crosses the midpoint
// — the number alone doesn't tell you you're now on the older half.
export function lifetimeYoungerShareSentence({ countryName, youngerShare }) {
  if (youngerShare == null) return "";
  const base = `In ${countryName}, about ${youngerShare.toFixed(0)}% of people alive now are younger than you.`;
  return base;
}

export function lifetimeProjectedCountryPeakSentence({
  countryName,
  projectedCountryPeakYear,
}) {
  return projectedCountryPeakYear != null && countryName
    ? `${countryName} is projected to reach its population peak in ${projectedCountryPeakYear}.`
    : "";
}

export function lifetimeGlobalLifeExpectancySentence({
  birthYear,
  globalLifeAtBirth,
  globalLifeAtFinal,
  formatLifeExpectancy,
}) {
  return Number.isFinite(globalLifeAtBirth) &&
    Number.isFinite(globalLifeAtFinal)
    ? ` Since your birth in ${birthYear}, global life expectancy has risen to ${formatLifeExpectancy(globalLifeAtFinal)} from ${formatLifeExpectancy(globalLifeAtBirth)}.`
    : "";
}

export function lifetimeArrivalCopy({
  birthYear,
  countryName,
  birthPopulation,
  countryLifeAtBirth,
  arrivalFactsSentence,
  formatPopulation,
  formatLifeExpectancy,
}) {
  const lifeExpectancyText =
    countryLifeAtBirth != null
      ? formatLifeExpectancy(countryLifeAtBirth)
      : "not available";
  const lifeExpectancySentence = arrivalFactsSentence
    ? `In ${countryName}, the average life expectancy at birth was ${lifeExpectancyText} — that same year, ${arrivalFactsSentence}.`
    : `In ${countryName}, the average life expectancy at birth was ${lifeExpectancyText}.`;
  return joinSentences(
    `When you were born in ${birthYear}, you joined a global population of ${formatPopulation(birthPopulation)} people.`,
    lifeExpectancySentence,
  );
}

export function lifetimePresentCopy({
  countryName,
  addedSinceBirth,
  youngerShare,
  presentPivotCopy,
  formatPopulation,
}) {
  return joinSentences(
    `Fast forward to today. The world has added ${formatPopulation(addedSinceBirth)} people since your birth year.`,
    lifetimeYoungerShareSentence({ countryName, youngerShare }),
    presentPivotCopy,
  );
}

export function lifetimeHorizonCopy({
  finalYear,
  finalAge,
  finalPopulation,
  globalLifeChangeCopy,
  projectedCountryPeakCopy,
  horizonAgingCopy,
  trajectoryCopy,
  formatPopulation,
}) {
  return joinSentences(
    `By ${finalYear}, you will be ${finalAge ?? "—"} years old in a world of roughly ${formatPopulation(finalPopulation)} people.`,
    globalLifeChangeCopy,
    projectedCountryPeakCopy,
    horizonAgingCopy,
    trajectoryCopy,
  );
}
