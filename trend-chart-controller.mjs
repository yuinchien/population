import {
  buildLinePath,
  chartXFor,
  chartYFor,
  computeValueRange,
} from "./chart-math.mjs";
import { runChartAnimation } from "./chart-animation.mjs";
import { TREND_CHART_PADDING } from "./trend-chart.mjs";

const LINE_GROW_MS = 500;
const Y_TICK_COUNT = 2;
const CHART_TOP = 4;
const MARKER_PILL_WIDTH = 32;
const MARKER_PILL_HEIGHT = 18;
const DRAG_HIT_HALF_WIDTH = 10;

function easeOutCubic(t) {
  return 1 - (1 - t) ** 3;
}

export function createTrendChartController({
  svg,
  radarSvg,
  radarKey,
  metrics,
  benchmarkLines,
  svgEl,
  getMetricKey,
  getItems,
  getYears,
  getCurrentYearIndex,
  setCurrentYearIndex,
  getHistoricalCutoffYear,
  renderRadar,
  renderTable,
  showTooltip,
  hideTooltip,
  stopTour,
  commitYear,
}) {
  let animationHandle = null;

  function cancelAnimation() {
    animationHandle?.cancel();
    animationHandle = null;
  }

  function render({ animate = false } = {}) {
    const key = getMetricKey();
    const isRadar = key === radarKey;
    svg.toggleAttribute("hidden", isRadar);
    radarSvg.toggleAttribute("hidden", !isRadar);
    cancelAnimation();
    if (isRadar) {
      renderRadar();
      return;
    }

    const width = svg.clientWidth || 900;
    const height = svg.clientHeight || 360;
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    const items = getItems();
    const years = getYears();
    const definition = metrics[key];
    const n = years.length;
    const cutoffIndex = Math.max(0, years.indexOf(getHistoricalCutoffYear()));
    const pad = TREND_CHART_PADDING;
    const innerW = width - pad.left - pad.right;
    const innerH = height - pad.top - pad.bottom;
    const allValues = items.flatMap((item) =>
      item.series(key).filter(Number.isFinite),
    );
    const { min, range } = computeValueRange(
      allValues,
      definition?.referenceValue,
    );
    const yFor = (value) => chartYFor(value, min, range, innerH, pad.top);
    const xFor = (index) => chartXFor(index, n, innerW, pad.left);
    const pathFor = (series, from, to) =>
      buildLinePath(series, from, to, xFor, yFor);
    const children = [];
    const tickFormat =
      key === "population"
        ? (value) => `${Math.round(value / 1_000_000).toLocaleString()}M`
        : (definition?.format ?? ((value) => `${value}`));

    children.push(
      svgEl("line", {
        class: "trend-chart-axis",
        x1: pad.left,
        x2: pad.left,
        y1: CHART_TOP,
        y2: height - pad.bottom,
      }),
      svgEl("line", {
        class: "trend-chart-axis",
        x1: pad.left,
        x2: width - pad.right,
        y1: height - pad.bottom,
        y2: height - pad.bottom,
      }),
    );

    for (let index = 0; index < Y_TICK_COUNT; index++) {
      const value = min + (range / (Y_TICK_COUNT - 1)) * index;
      const y = yFor(value).toFixed(1);
      children.push(
        svgEl("line", {
          class: "trend-chart-tick-line",
          x1: pad.left,
          x2: width - pad.right,
          y1: y,
          y2: y,
        }),
        svgEl("line", {
          class: "trend-chart-tick",
          x1: pad.left - 4,
          x2: pad.left,
          y1: y,
          y2: y,
        }),
      );
      const label = svgEl("text", {
        class: "trend-chart-axis-label",
        x: pad.left - 8,
        y: (Number(y) + 3).toFixed(1),
        "text-anchor": "end",
      });
      label.textContent = value === 0 ? "0" : tickFormat(value);
      children.push(label);
    }

    for (const benchmark of benchmarkLines[key] ?? []) {
      const y = yFor(benchmark.value).toFixed(1);
      children.push(
        svgEl("line", {
          class: "trend-chart-baseline",
          x1: pad.left,
          x2: width - pad.right,
          y1: y,
          y2: y,
        }),
      );
      const label = svgEl("text", {
        class: "trend-chart-baseline-label",
        x: pad.left - 8,
        y: Math.max(yFor(benchmark.value) + 3, 12).toFixed(1),
        "text-anchor": "end",
      });
      label.textContent = benchmark.label;
      children.push(label);
    }

    const firstYear = svgEl("text", {
      class: "trend-chart-axis-label",
      x: pad.left,
      y: height - 6,
      "text-anchor": "start",
    });
    firstYear.textContent = years[0];
    const lastYear = svgEl("text", {
      class: "trend-chart-axis-label",
      x: width - pad.right,
      y: height - 6,
      "text-anchor": "end",
    });
    lastYear.textContent = years[n - 1];
    children.push(firstYear, lastYear);

    const baselineY = pad.top + innerH;
    const growingLines = [];
    items.forEach((item) => {
      const series = item.series(key);
      const historical = svgEl("path", {
        class: "trend-line historical",
        d: animate
          ? buildLinePath(series, 0, cutoffIndex, xFor, () => baselineY)
          : pathFor(series, 0, cutoffIndex),
        stroke: item.color,
      });
      const projected = svgEl("path", {
        class: "trend-line projected",
        d: animate
          ? buildLinePath(series, cutoffIndex, n - 1, xFor, () => baselineY)
          : pathFor(series, cutoffIndex, n - 1),
        stroke: item.color,
      });
      const historicalHit = svgEl("path", {
        class: "trend-line-hit",
        d: pathFor(series, 0, cutoffIndex),
      });
      const projectedHit = svgEl("path", {
        class: "trend-line-hit",
        d: pathFor(series, cutoffIndex, n - 1),
      });
      [historicalHit, projectedHit].forEach((hit) => {
        hit.addEventListener("pointerenter", (event) =>
          showTooltip(event, item.name, item.color),
        );
        hit.addEventListener("pointermove", (event) =>
          showTooltip(event, item.name, item.color),
        );
        hit.addEventListener("pointerleave", hideTooltip);
      });
      children.push(historical, projected, historicalHit, projectedHit);
      if (animate) {
        growingLines.push(
          { element: historical, series, from: 0, to: cutoffIndex },
          { element: projected, series, from: cutoffIndex, to: n - 1 },
        );
      }
    });

    const currentYearIndex = getCurrentYearIndex();
    if (currentYearIndex >= 0 && currentYearIndex < n) {
      addYearMarker({
        children,
        width,
        height,
        pad,
        innerW,
        years,
        n,
        xFor,
        currentYearIndex,
      });
    }

    svg.replaceChildren(...children);
    if (growingLines.length) {
      animationHandle = runChartAnimation({
        duration: LINE_GROW_MS,
        easing: easeOutCubic,
        onFrame: (eased) => {
          growingLines.forEach(({ element, series, from, to }) => {
            element.setAttribute(
              "d",
              buildLinePath(series, from, to, xFor, (value) =>
                baselineY + (yFor(value) - baselineY) * eased,
              ),
            );
          });
        },
        onFinish: () => {
          animationHandle = null;
        },
      });
    }
  }

  function addYearMarker({
    children,
    width,
    height,
    pad,
    innerW,
    years,
    n,
    xFor,
    currentYearIndex,
  }) {
    const markerX = xFor(currentYearIndex).toFixed(1);
    const line = svgEl("line", {
      class: "trend-chart-year-marker",
      x1: markerX,
      x2: markerX,
      y1: CHART_TOP + MARKER_PILL_HEIGHT,
      y2: height - pad.bottom,
    });
    const pill = svgEl("rect", {
      class: "trend-chart-year-pill",
      x: (Number(markerX) - MARKER_PILL_WIDTH / 2).toFixed(1),
      y: CHART_TOP,
      width: MARKER_PILL_WIDTH,
      height: MARKER_PILL_HEIGHT,
      rx: 4,
    });
    const label = svgEl("text", {
      class: "trend-chart-year-label",
      x: markerX,
      y: CHART_TOP + 13,
      "text-anchor": "middle",
    });
    label.textContent = years[currentYearIndex];
    const hit = svgEl("rect", {
      class: "trend-chart-year-drag",
      x: (Number(markerX) - DRAG_HIT_HALF_WIDTH).toFixed(1),
      y: CHART_TOP + MARKER_PILL_HEIGHT,
      width: DRAG_HIT_HALF_WIDTH * 2,
      height: height - pad.bottom - CHART_TOP - MARKER_PILL_HEIGHT,
    });

    const yearForClientX = (clientX) => {
      const rect = svg.getBoundingClientRect();
      const localX = ((clientX - rect.left) / rect.width) * width;
      const ratio = (localX - pad.left) / innerW;
      const index = Math.round(ratio * (n - 1));
      return years[Math.min(n - 1, Math.max(0, index))];
    };
    let tableRenderScheduled = false;
    const previewYear = (year) => {
      const index = years.indexOf(year);
      if (index === -1 || index === getCurrentYearIndex()) return;
      const x = xFor(index).toFixed(1);
      line.setAttribute("x1", x);
      line.setAttribute("x2", x);
      pill.setAttribute("x", (Number(x) - MARKER_PILL_WIDTH / 2).toFixed(1));
      label.setAttribute("x", x);
      label.textContent = year;
      hit.setAttribute("x", (Number(x) - DRAG_HIT_HALF_WIDTH).toFixed(1));
      setCurrentYearIndex(index);
      if (!tableRenderScheduled) {
        tableRenderScheduled = true;
        requestAnimationFrame(() => {
          tableRenderScheduled = false;
          renderTable();
        });
      }
    };
    let dragging = false;
    hit.addEventListener("pointerdown", (event) => {
      dragging = true;
      stopTour();
      hit.setPointerCapture(event.pointerId);
      previewYear(yearForClientX(event.clientX));
    });
    hit.addEventListener("pointermove", (event) => {
      if (dragging) previewYear(yearForClientX(event.clientX));
    });
    const endDrag = () => {
      if (!dragging) return;
      dragging = false;
      commitYear(years[getCurrentYearIndex()]);
    };
    hit.addEventListener("pointerup", endDrag);
    hit.addEventListener("pointercancel", endDrag);
    children.push(line, pill, label, hit);
  }

  return { cancelAnimation, render };
}
