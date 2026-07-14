import {
  buildLinePath,
  chartXFor,
  chartYFor,
  computeValueRange,
} from "./chart-math.mjs";

export function createSparklineGeometry({
  series,
  cutoffIndex,
  width,
  height,
  referenceValue,
}) {
  const { min, range } = computeValueRange(series, referenceValue);
  const baselineValue = referenceValue ?? min;
  const baselineY = chartYFor(baselineValue, min, range, height);
  const n = series.length;
  const xFor = (index) => chartXFor(index, n, width);
  const yFor = (value) => chartYFor(value, min, range, height);
  const toXY = (index, value) => [xFor(index), yFor(value)];
  const pathFor = (from, to, valueToY = yFor) =>
    buildLinePath(series, from, to, xFor, valueToY);

  function areaFor(from, to, valueToY = yFor) {
    const linePath = pathFor(from, to, valueToY);
    if (!linePath) return "";
    let firstX = null;
    let lastX = null;
    for (let index = from; index <= to; index++) {
      if (series[index] == null) continue;
      const x = xFor(index);
      if (firstX == null) firstX = x;
      lastX = x;
    }
    return `${linePath} L ${lastX.toFixed(1)} ${baselineY.toFixed(1)} L ${firstX.toFixed(1)} ${baselineY.toFixed(1)} Z`;
  }

  return {
    min,
    range,
    baselineValue,
    baselineY,
    cutoffIndex,
    toXY,
    yFor,
    pathFor,
    areaFor,
  };
}
