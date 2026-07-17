export const CLUSTER_ARCHETYPES = {
  goldenBoom: {
    label: "Golden Boom",
    anchor: { x: 0.8, y: 0.65 },
    summary:
      "During the post-war boom, developed nations saw sustained high fertility and, thanks to medicine and prosperity, life expectancy climb past 65. "
  },
  emergingSurge: {
    label: "Emerging Surge",
    anchor: { x: 0.35, y: 0.4 },
    summary:
      "In the post-war decades, modecine like vaccines slashed death rates across the developing world, but persistent high fertility and rising child survival triggered an unprecedented population boom."
  },
  growth: {
    label: "Natural Expansion",
    anchor: { x: 0.21, y: 0.38 },
    summary:
      "High-fertility nations grow entirely from within. Whether driven by high birth rates or generational momentum, births naturally outpace deaths without requiring migration.",
  },
  bufferedGrowth: {
    label: "Migrant Momentum",
    anchor: { x: 0.5, y: 0.8 },
    summary:
      "Wealthy nations with below-replacement fertility lean on immigration to keep growing. Births alone would barely hold the population steady—newcomers have become the real engine of growth.",
  },
  silverDecline: {
    label: "Silver Decline",
    anchor: { x: 0.79, y: 0.5 },
    summary:
      "Aging societies face high old age dependency and sustained population loss. Deaths outnumber births, while low migration leaves too little inflow to offset natural decline.",
  },
};

export const CLUSTER_PHASES = {
  historical: {
    years: [1950, 1989],
    archetypes: ["goldenBoom", "emergingSurge"],
  },
  transition: {
    years: [1990, 1999],
    archetypes: [
      "goldenBoom",
      "emergingSurge",
      "bufferedGrowth",
      "silverDecline",
    ],
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
