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
  // Defaults to `series` — pass a wider array (e.g. series plus an overlay
  // series sharing this chart's baseline) so the value range fits both
  // without the overlay getting clipped. The line/area still only ever
  // draws `series` itself.
  rangeValues = series,
}) {
  const { min, range } = computeValueRange(rangeValues, referenceValue);
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
