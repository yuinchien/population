export const CLUSTER_ARCHETYPES = {
  goldenBoom: {
    label: "Golden Boom",
    anchor: { x: 0.8, y: 0.65 },
    summary: [
      "Positive natural increase",
      "Life expectancy of 65 years or more",
      "Post-war growth in longer-lived populations",
    ],
  },
  emergingSurge: {
    label: "Emerging Surge",
    anchor: { x: 0.35, y: 0.4 },
    summary: [
      "Positive natural increase",
      "Life expectancy below 65 years",
      "Earlier-stage mortality transition",
    ],
  },
  growth: {
    label: "Natural Expansion",
    anchor: { x: 0.21, y: 0.38 },
    summary: [
      "Positive natural increase",
      "Population grows without migration support",
      "Includes demographic momentum below replacement",
    ],
  },
  bufferedGrowth: {
    label: "Migrant Momentum",
    anchor: { x: 0.5, y: 0.8 },
    summary: [
      "Natural change is negative or near zero",
      "High net-positive immigration",
      "Total population remains stable or growing",
    ],
  },
  silverDecline: {
    label: "Silver Decline",
    anchor: { x: 0.79, y: 0.5 },
    summary: [
      "Net population decline",
      "Migration is insufficient to prevent contraction",
      "Includes sustained, significant loss from peak",
    ],
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
