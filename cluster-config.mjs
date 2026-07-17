export const CLUSTER_ARCHETYPES = {
  goldenBoom: {
    label: "Golden Boom",
    anchor: { x: 0.8, y: 0.65 },
    summary:
      "In the post-war developed world, fertility stayed high as medicine and prosperity pushed life expectancy past 65. This data captures the iconic Baby Boom—a generation living longer than any before."
  },
  emergingSurge: {
    label: "Emerging Surge",
    anchor: { x: 0.35, y: 0.4 },
    summary:
      "In the post-war decades, the developing world entered a volatile demographic transition. Vaccines slashed death rates, but high fertility and rising child survival triggered an unprecedented population boom."
  },
  growth: {
    label: "Natural Expansion",
    anchor: { x: 0.21, y: 0.38 },
    summary:
      "In the 21st century, high-fertility nations grow entirely from within. Whether driven by high birth rates or generational momentum, births naturally outpace deaths without requiring migration.",
  },
  bufferedGrowth: {
    label: "Migrant Momentum",
    anchor: { x: 0.5, y: 0.8 },
    summary:
      "In the 21st century, wealthy nations with below-replacement fertility lean on immigration to keep growing. Births alone would barely hold the population steady—newcomers have become the real engine of growth.",
  },
  silverDecline: {
    label: "Silver Decline",
    anchor: { x: 0.79, y: 0.5 },
    summary:
      "In the 21st century, aging societies face high old age dependency and sustained population loss. Deaths outnumber births, while low migration leaves too little inflow to offset natural decline.",
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
