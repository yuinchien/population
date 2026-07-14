export const PEOPLE_PER_DOT = 500_000;

export const DOT_CONFIG = {
  opacity: 0.9,
  pulseAmplitude: 8,
  pulseFrequencyMin: 0.7,
  pulseFrequencyRange: 2.1,
};

export const VIEW_CONFIG = {
  globe: {
    radius: 200,
    dotSize: 3,
    cameraDistance: 200 * 3.1,
    minDistance: 200 * 1.3,
    maxDistance: 200 * 8,
    autoRotateSpeed: 0.35,
    calloutExtend: 200 * 1.12,
  },
  map: {
    width: 400,
    height: 200,
    dotSize: 1.2,
    cameraDistance: 360,
    minDistance: 250,
    maxDistance: 1200,
    calloutExtend: 80,
  },
};

export const REGION_COLORS = {
  "East Asia & Pacific": "var(--color-blue)",
  "Europe & Central Asia": "var(--color-orange)",
  "Latin America & Caribbean": "var(--color-purple)",
  "Middle East, North Africa, Afghanistan & Pakistan": "var(--color-pink)",
  "North America": "var(--color-yellow)",
  "South Asia": "var(--color-teal)",
  "Sub-Saharan Africa": "var(--color-teal-dark)",
};

export const DEFAULT_COLOR = "var(--color-teal)";

export const INCOME_GROUP_COLORS = {
  "High-income countries": "var(--color-yellow)",
  "Middle-income countries": "var(--color-blue)",
  "Low-income countries": "var(--color-orange)",
};

export const UNCLASSIFIED_INCOME = "Not classified";
export const UNCLASSIFIED_COLOR = "var(--color-subtle)";
