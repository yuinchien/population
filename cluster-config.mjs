export const CLUSTER_ARCHETYPES = {
  goldenBoom: {
    label: "Golden Boom",
    anchor: { x: 0.8, y: 0.65 },
    summary:
      "Fertility stayed high through the post-war decades as medicine and rising prosperity pushed life expectancy past 65. This is the Baby Boom written into the data — growth from a generation living longer than any before it.",
  },
  emergingSurge: {
    label: "Emerging Surge",
    anchor: { x: 0.35, y: 0.4 },
    summary:
      "The same post-war decades, playing out earlier in the transition — vaccines and public health cut deaths fast, but life expectancy hadn't yet passed 65. Fertility stayed high while more children survived, fueling rapid growth across the newly independent world.",
  },
  growth: {
    label: "Natural Expansion",
    anchor: { x: 0.21, y: 0.38 },
    summary:
      "Population still growing from within, no migration required. Sometimes fertility itself remains high; sometimes it's the momentum of a larger generation of parents still outpacing today's deaths.",
  },
  bufferedGrowth: {
    label: "Migrant Momentum",
    anchor: { x: 0.5, y: 0.8 },
    summary:
      "Births alone would barely hold the population steady, or shrink it outright. As fertility fell below replacement, immigration became the real engine of growth.",
  },
  silverDecline: {
    label: "Silver Decline",
    anchor: { x: 0.79, y: 0.5 },
    summary:
      "The population has passed its peak and is now shrinking. Deaths outnumber births by more than migration can offset, and the age structure keeps skewing older.",
  },
};

export const CLUSTER_PHASES = {
  historical: {
    years: [1950, 1999],
    archetypes: ["goldenBoom", "emergingSurge"],
  },
  projection: {
    years: [2000, 2100],
    archetypes: ["growth", "bufferedGrowth", "silverDecline"],
  },
};

export function clusterPhaseForYear(year) {
  if (!Number.isFinite(year)) return CLUSTER_PHASES.projection;
  return Object.values(CLUSTER_PHASES).find(
    (phase) => year >= phase.years[0] && year <= phase.years[1],
  ) ?? CLUSTER_PHASES.projection;
}
