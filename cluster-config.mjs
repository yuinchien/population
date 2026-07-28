export const CLUSTER_ARCHETYPES = {
  goldenBoom: {
    label: "Golden Boom",
    anchor: { x: 0.8, y: 0.65 },
    summary:
      "During the post-war boom, developed nations saw sustained high fertility and, thanks to medicine and prosperity, life expectancy climb past 65. "
  },
  emergingSurge: {
    label: "Emerging Surge",
    anchor: { x: 0.4, y: 0.4 },
    summary:
      "In the post-war decades, modecine like vaccines slashed death rates across the developing world, but persistent high fertility and rising child survival triggered an unprecedented population boom."
  },
  growth: {
    label: "Natural Expansion",
    anchor: { x: 0.38, y: 0.38 },
    summary:
      "High-fertility nations grow entirely from within. Whether driven by high birth rates or generational momentum, births naturally outpace deaths without requiring migration.",
  },
  bufferedGrowth: {
    label: "Migrant Momentum",
    anchor: { x: 0.55, y: 0.86 },
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

// Two phases with a single hard cut at 1990 — no overlapping transition, so
// each chapter carries one clear idea. Phase 1 is the postwar boom, when the
// whole world was growing and the only distinction was development stage
// (Golden Boom vs Emerging Surge). Phase 2 is the divergence, when the
// fertility transition fractures the world into three fates (Natural
// Expansion / Migrant Momentum / Silver Decline). Its window spans 1990–2100,
// mixing observed and projected years — the split is a narrative pivot, not a
// data-source boundary.
export const CLUSTER_PHASES = {
  historical: {
    years: [1950, 1989],
    archetypes: ["goldenBoom", "emergingSurge"],
  },
  divergence: {
    years: [1990, 2100],
    archetypes: ["growth", "bufferedGrowth", "silverDecline"],
  },
};

export function clusterPhaseForYear(year) {
  if (!Number.isFinite(year)) return CLUSTER_PHASES.divergence;
  return Object.values(CLUSTER_PHASES).find(
    (phase) => year >= phase.years[0] && year <= phase.years[1],
  ) ?? CLUSTER_PHASES.divergence;
}

// #status narration for the Cluster view (script.js's applyClusterStatus) —
// four chapters spanning 1950–2100, each naming the archetypes that define
// it by their exact on-canvas label (CLUSTER_ARCHETYPES[key].label above),
// so the vocabulary in the caption matches what's drawn on screen instead of
// introducing separate wording. Boundaries: 1989/1990 is the same hard cut
// CLUSTER_PHASES uses for the archetype split; 2023/2024 is the app's own
// historical/projected boundary (historicalCutoffYear, loaded from data) —
// hardcoded here as a narrative pivot rather than threaded through as a
// parameter, the same call CLUSTER_PHASES' own 1990 cut already makes for
// the archetype split above. The last split (2060/2061) is pure pacing: the
// 77-year projected era needs a second beat or it'd read as one static
// caption for most of the timeline.
export const CLUSTER_STATUS_PERIODS = [
  {
    years: [1950, 1989],
    title: "The Postwar Boom",
    text: "Nearly every country is expanding — wealthy nations ride a Golden Boom of postwar prosperity, while vaccines and falling death rates trigger an Emerging Surge across the developing world.",
  },
  {
    years: [1990, 2023],
    title: "The Great Split",
    text: "As fertility falls unevenly, three paths emerge: some nations still grow from births alone, others lean on migration, and the first aging societies begin to shrink.",
  },
  {
    years: [2024, 2060],
    title: "Diverging Paths",
    text: "Projections widen the divide: Migrant Momentum and Silver Decline pull further apart as more countries age past replacement fertility, while a shrinking core still grows from within.",
  },
  {
    years: [2061, 2100],
    title: "The New Equilibrium",
    text: "By century's end, three futures coexist: many wealthy nations have settled into low-fertility Silver Decline or lean on Migrant Momentum, while a large bloc of high-fertility countries still power Natural Expansion.",
  },
];

export function clusterStatusForYear(year) {
  if (!Number.isFinite(year)) return CLUSTER_STATUS_PERIODS[0];
  return (
    CLUSTER_STATUS_PERIODS.find(
      (period) => year >= period.years[0] && year <= period.years[1],
    ) ?? CLUSTER_STATUS_PERIODS[CLUSTER_STATUS_PERIODS.length - 1]
  );
}
