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
