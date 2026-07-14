import { chartXFor, chartYFor } from "./chart-math.mjs";

export function createCountryChartGeometry({
  country,
  years,
  historicalCutoffYear,
  width,
  height,
  padding,
}) {
  const count = years.length;
  const cutoffIndex = Math.max(0, years.indexOf(historicalCutoffYear));
  const maxPopulation = Math.max(
    0,
    ...country.populationsHigh,
    ...country.populations,
  );
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const baselineY = padding.top + innerHeight;
  const xyFor = (index, value) => [
    chartXFor(index, count, innerWidth, padding.left),
    chartYFor(value, 0, maxPopulation, innerHeight, padding.top),
  ];

  return {
    count,
    cutoffIndex,
    maxPopulation,
    innerWidth,
    innerHeight,
    baselineY,
    xyFor,
  };
}
