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
  "East Asia & Pacific": "#5ec8e5",
  "Europe & Central Asia": "#FFBD91",
  "Latin America & Caribbean": "#D7BDFF",
  "Middle East, North Africa, Afghanistan & Pakistan": "#e6b5c9",
  "North America": "#E4E42F",
  "South Asia": "#C0E08D",
  "Sub-Saharan Africa": "#62c2b1",
};

export const DEFAULT_COLOR = "#5fe39a";

export const INCOME_GROUP_COLORS = {
  "High-income countries": "#62c2b1",
  "Middle-income countries": "#ABBEF8",
  "Low-income countries": "#E0DE70",
};

export const UNCLASSIFIED_INCOME = "Not classified";
export const UNCLASSIFIED_COLOR = "#999999";
