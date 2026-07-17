import { CLUSTER_ARCHETYPES, CLUSTER_PHASES } from "./cluster-config.mjs";
import {
  classifyCountry,
  estimatedNaturalIncrease,
  populationDeclineContext,
  refineArchetypeForPhase,
} from "./cluster-model.mjs";

function valueAt(seriesFor, key, index) {
  return seriesFor(key)?.[index] ?? null;
}

// The raw classification, with no Phase 1 (pre-2000) override — see
// archetypeAt below for why the narrative walks this back instead of the
// phase-refined version.
function rawArchetypeAt({ country, years, index, seriesFor }) {
  const population = valueAt(seriesFor, "population", index);
  return classifyCountry({
    fertility: valueAt(seriesFor, "fertility", index),
    netMigrationRate: valueAt(seriesFor, "netMigrationRate", index),
    populationGrowth: valueAt(seriesFor, "populationGrowth", index),
    incomeLabel: country._incomeLabel,
    ...populationDeclineContext(
      seriesFor("population"),
      years,
      index,
      population,
    ),
  });
}

function archetypeAt(args) {
  const lifeExpectancy = valueAt(args.seriesFor, "lifeExpectancy", args.index);
  return refineArchetypeForPhase(
    rawArchetypeAt(args),
    args.years[args.index],
    lifeExpectancy,
  );
}

function forceExplanation(archetype, index, seriesFor) {
  const fertility = valueAt(seriesFor, "fertility", index);
  const migration = valueAt(seriesFor, "netMigrationRate", index);
  const growth = valueAt(seriesFor, "populationGrowth", index);
  const naturalIncrease = estimatedNaturalIncrease(growth, migration);

  if (archetype === "bufferedGrowth") {
    return "as immigration offset weak or negative natural population change";
  }
  if (archetype === "silverDecline") {
    if (naturalIncrease != null && naturalIncrease < 0) {
      return "as natural decrease accelerated and migration could not fully offset it";
    }
    return "as sustained population loss outweighed the forces supporting growth";
  }
  if (archetype === "goldenBoom") {
    return "as positive natural increase combined with longer life expectancy";
  }
  if (archetype === "emergingSurge") {
    return "as strong natural increase accompanied an earlier-stage mortality transition";
  }
  if (Number.isFinite(fertility) && fertility < 2.1) {
    return "as demographic momentum sustained growth despite sub-replacement fertility";
  }
  return "as births continued to outpace deaths";
}

export function buildCountryForceNarrative({
  country,
  years,
  currentYearIndex,
  historicalCutoffYear,
  seriesFor,
}) {
  if (!country || currentYearIndex < 0 || !years[currentYearIndex]) return "";
  const currentArchetype = archetypeAt({
    country,
    years,
    index: currentYearIndex,
    seriesFor,
  });
  if (!currentArchetype) return "";

  // Growth/Migrant Momentum/Silver Decline come straight out of
  // classifyCountry() with no phase override, so they're meaningful for
  // any year, not just 2000+ (refineArchetypeForPhase only ever *adds* the
  // Golden Boom/Emerging Surge split on top of them for years before
  // 2000 — it never changes what these three mean). Walking back with the
  // phase-refined archetypeAt would hit that Phase 1/Phase 2 split — a
  // Cluster-view visual choice (see CLUSTER_PHASES), not a real
  // demographic change — and report every long-running growth-family
  // country as having "entered" its archetype in 2000, regardless of how
  // much earlier its own data actually got there. Walking back on the raw
  // classification instead finds the country's real entry year; Golden
  // Boom/Emerging Surge entries (which only exist within Phase 1) still
  // walk back on the phase-refined version, since there's no raw
  // equivalent to compare against.
  const isPhaseTwoArchetype =
    CLUSTER_PHASES.projection.archetypes.includes(currentArchetype);
  let entryIndex = currentYearIndex;
  while (entryIndex > 0) {
    const previousArchetype = isPhaseTwoArchetype
      ? rawArchetypeAt({ country, years, index: entryIndex - 1, seriesFor })
      : archetypeAt({ country, years, index: entryIndex - 1, seriesFor });
    if (previousArchetype !== currentArchetype) break;
    entryIndex--;
  }

  const label = CLUSTER_ARCHETYPES[currentArchetype]?.label;
  if (!label) return "";
  const entryYear = years[entryIndex];
  const explanation = forceExplanation(
    currentArchetype,
    currentYearIndex,
    seriesFor,
  );
  if (entryIndex === 0) {
    return `${country.name}'s trajectory reflects ${label}, ${explanation}.`;
  }
  const isProjected = entryYear > historicalCutoffYear;
  const verb = isProjected ? "is projected to enter" : "entered";
  // "around" always — even a historical entry year is a threshold crossing
  // read off a yearly classification, not a recorded discrete event, so
  // it's hedged the same way a projected one is.
  return `${country.name} ${verb} ${label} around ${entryYear} ${explanation}.`;
}
