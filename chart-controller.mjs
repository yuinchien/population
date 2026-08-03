import {
  CHART_METRIC_KEYS,
  CHART_RADAR_KEY,
  METRICS,
  RADAR_CHART_METRICS,
} from "./metrics.mjs";
import { buildDetailColumns } from "./detail-table.mjs";
import { nextSortState, renderSortableTable } from "./detail-table-view.mjs";
import { chartXFor } from "./chart-math.mjs";
import { createTrendChartController } from "./trend-chart-controller.mjs";
import { REGION_COLORS } from "./view-config.mjs";
import { foregroundForColor } from "./theme-colors.mjs";
import {
  convertAlpha3ToAlpha2,
  flagIconUrl,
  preloadFlagIcons,
} from "./data-loader.mjs";
import {
  createCountryCombobox,
  matchCountries,
} from "./country-combobox.mjs";

import { svgEl, resolveComputedColor } from "./dom-utils.mjs";

// Clockwise from the top spoke — see renderRadarChart's angleFor.
// Generous left/right padding: axis labels like "Age dependency ratio" run
// off the side spokes horizontally rather than wrapping.
const RADAR_CHART_PADDING = { top: 56, right: 132, bottom: 48, left: 132 };

// A plain categorical color set assigned by selection order, not by the
// country's actual region — two countries in the same region are a
// near-certainty among any handful of selections, so coloring by region
// here would make their lines indistinguishable. Starts with the region
// palette (for visual consistency with the rest of the app) extended with
// a few more distinct hues, since the country grid invites selecting well
// past 7.
const CHART_LINE_COLORS = [
  ...Object.values(REGION_COLORS),
  "#4C75F0",
  "#A99BEA",
  "#F46E54",
  "#5CC8BB",
  "#E9A0E2",
];

// Fixed reference lines for the trend chart's Y axis, keyed by metric.
// Fertility's 2.1 is the UN's global replacement-level rate. Age dependency
// ratio's 45/70 and life expectancy's bands are the UN Human Development
// Index thresholds. Drawn by trend-chart-controller.mjs.
const CHART_BENCHMARK_LINES = {
  fertility: [{ value: 2.1, label: "2.1" }],
  ageDependencyRatio: [
    { value: 70, label: "High" },
    { value: 45, label: "Low" },
  ],
  lifeExpectancy: [
    { value: 80, label: "Very high" },
    { value: 75, label: "High" },
    { value: 70, label: "Low" },
  ],
  olderPopulationShare: [
    { value: 20, label: "Super-aged" },
    { value: 14, label: "Aged" },
    { value: 7, label: "Aging" },
  ],
};

const CHART_COUNTRY_SUGGESTION_LIMIT = 8;

// A full-width multi-country trend chart, independent of the 3D dot scene
// and the single-year snapshot the rest of the app is built around. Owns
// the country picker, metric tabs, radar chart, and comparison table;
// delegates the actual line-chart SVG rendering to trend-chart-controller.mjs.
export function createChartController({
  elements,
  getCountries,
  getYears,
  getDemographicMetrics,
  getPopulationSeries,
  getSelectedCountries,
  getMetricKey,
  setMetricKey,
  getCurrentYearIndex,
  setCurrentYearIndex,
  getHistoricalCutoffYear,
  getPickerExpanded,
  setPickerExpanded,
  getTableSort,
  setTableSort,
  showTooltip,
  hideTooltip,
  stopTour,
  commitYear,
  onOpenCountry,
  syncUrl,
}) {
  let countryCombobox;

  // Population comes from the dots dataset (same series peakYear/dots are
  // built from); every other chart metric comes from the demographics
  // file, keyed and indexed identically to years.
  function chartSeriesFor(country, key) {
    if (key === "population") return getPopulationSeries(country);
    return getDemographicMetrics()?.countries?.[country.iso3]?.[key] ?? [];
  }

  // Generic linear-interpolation helper: yearIndex may be fractional (e.g.
  // mid-sweep during an animated timeline), and years data only has one
  // value per whole year, so a fractional index interpolates between the
  // two nearest years' values instead of picking one. A whole-number index
  // degenerates to exactly that year's value. Shared by the Cluster view
  // (passed in as its valueAtYear callback).
  function valueAtFractionalYear(country, key, yearIndex) {
    const series = chartSeriesFor(country, key);
    const lower = Math.floor(yearIndex);
    const upper = Math.min(series.length - 1, lower + 1);
    const a = series[lower];
    const b = series[upper];
    if (!Number.isFinite(a)) return b;
    if (!Number.isFinite(b)) return a;
    return a + (b - a) * (yearIndex - lower);
  }

  function chartCountryList() {
    return getSelectedCountries()
      .map((iso3) => getCountries().find((country) => country.iso3 === iso3))
      .filter(Boolean);
  }

  function chartColorFor(iso3) {
    const index = getSelectedCountries().indexOf(iso3);
    if (index === -1) return null;
    return CHART_LINE_COLORS[index % CHART_LINE_COLORS.length];
  }

  // Chart mode is always by-country (hand-picked via the country picker) —
  // this used to also support aggregated Region/Income lines via a mode
  // select, removed since Country covered the actual use.
  function chartItems() {
    return chartCountryList().map((country) => ({
      name: country.name,
      label: convertAlpha3ToAlpha2(country.iso3) ?? country.iso3,
      color: chartColorFor(country.iso3),
      series: (key) => chartSeriesFor(country, key),
      onClick: () => onOpenCountry(country),
    }));
  }

  // Resolves any valid CSS <color> value (var(), color-mix(), etc.) to the
  // Keep the comparison table focused on the chart's current question:
  // country and population are always present, followed by the selected
  // metric when it is not population itself.
  function chartTableColumns() {
    // Country + whichever metric tab is currently active — not Population
    // plus that metric, which crowded the table with a column most tabs
    // don't need repeated alongside their own. The radar tab plots five
    // metrics at once, so it gets all five columns instead of one.
    const metricKeys =
      getMetricKey() === CHART_RADAR_KEY
        ? RADAR_CHART_METRICS
        : [getMetricKey()];
    // metricFor/populationFor read off each item's own .series() rather
    // than a global metricFor()/chartSeriesFor(), so the same columns work
    // whether rows are real countries.
    return buildDetailColumns({
      currentYearIndex: getCurrentYearIndex(),
      metricFor: (item, key) => item.series(key)[getCurrentYearIndex()],
      metricKeys,
      populationFor: (item) =>
        item.series("population")[getCurrentYearIndex()],
    });
  }

  function addCountry(iso3) {
    const selected = getSelectedCountries();
    if (selected.includes(iso3)) return;
    selected.push(iso3);
    renderCountryChips();
    renderChart();
    renderTable();
    syncUrl();
  }

  function removeCountry(iso3) {
    const selected = getSelectedCountries();
    const index = selected.indexOf(iso3);
    if (index === -1) return;
    selected.splice(index, 1);
    renderCountryChips();
    renderChart();
    renderTable();
    syncUrl();
  }

  function renderCountryChips() {
    const countries = chartCountryList();
    preloadFlagIcons(countries.map((country) => country.iso3));
    elements.chartCountryPickerSummaryFlags.replaceChildren(
      ...countries.map((country) => {
        const flag = document.createElement("span");
        flag.className = "chip-input-summary-flag";
        flag.style.backgroundImage = `url(${flagIconUrl(country.iso3)})`;
        return flag;
      }),
    );
    elements.chartCountryChips.replaceChildren(
      ...countries.map((country) => {
        const color = chartColorFor(country.iso3);
        const chip = document.createElement("span");
        chip.className = "chip";
        if (color) {
          chip.style.setProperty("--chart-line-color", color);
          // .chip's own background lightens `color` via color-mix() (see
          // styles.css) — picking a readable text color against the
          // *unmixed* line color picks wrong for anything color-mix
          // lightens substantially, so resolve the actual rendered
          // background first. Wrapped defensively: this runs once,
          // unconditionally, during init/renderCountryChips, and a
          // computed-style format this doesn't recognize previously threw
          // there and took the whole app's init down with it — a
          // decorative contrast pick should never be able to do that.
          // Falls back to the CSS default (--color-text) on any failure.
          try {
            const background = resolveComputedColor(
              `color-mix(in srgb, ${color} 90%, white)`,
            );
            chip.style.setProperty(
              "--chip-text-color",
              foregroundForColor(background),
            );
          } catch (error) {
            console.error("chip text-color contrast pick failed:", error);
          }
        }

        const flag = document.createElement("span");
        flag.className = "chip-flag";
        flag.style.backgroundImage = `url(${flagIconUrl(country.iso3)})`;

        const label = document.createElement("span");
        label.textContent = country.name;

        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "chip-remove";
        remove.dataset.iso3 = country.iso3;
        remove.setAttribute("aria-label", `Remove ${country.name}`);
        const icon = document.createElement("span");
        icon.className = "material-symbols-outlined";
        icon.textContent = "close";
        remove.append(icon);

        chip.append(flag, label, remove);
        return chip;
      }),
    );
  }

  function setCountryPickerExpanded(expanded) {
    if (expanded === getPickerExpanded()) return;
    setPickerExpanded(expanded);
    elements.chartCountryPicker.classList.toggle("expanded", expanded);
    if (expanded) {
      elements.chartCountrySearch.focus();
    } else {
      elements.chartCountrySearch.value = "";
      countryCombobox?.hide();
    }
  }

  function selectCountrySuggestion(iso3) {
    addCountry(iso3);
    elements.chartCountrySearch.value = "";
    countryCombobox?.hide();
    elements.chartCountrySearch.focus();
  }

  function setMetric(key) {
    if (key === getMetricKey() || (!METRICS[key] && key !== CHART_RADAR_KEY)) {
      return;
    }
    setMetricKey(key);
    elements.chartMetricTabs.value = key;
    renderChart();
    renderTable();
    syncUrl();
  }

  function renderMetricTabs() {
    // The customizable-select trigger <button> (index.html) has to stay
    // the first child — replaceChildren would otherwise drop it along
    // with the stale <option>s it's clearing out.
    const triggerButton = elements.chartMetricTabs.querySelector("button");
    elements.chartMetricTabs.replaceChildren(
      triggerButton,
      // The radar tab (see renderRadarChart/CHART_RADAR_KEY) is
      // implemented but temporarily withheld from this list pending a
      // visual pass — switch this back to
      // [...CHART_METRIC_KEYS, CHART_RADAR_KEY] once it's ready.
      ...CHART_METRIC_KEYS.map((key) => {
        const option = document.createElement("option");
        option.value = key;
        option.textContent =
          key === CHART_RADAR_KEY ? "Radar chart" : METRICS[key].label;
        option.selected = key === getMetricKey();
        return option;
      }),
    );
  }

  // Rebuilt from scratch on every metric/selection change rather than
  // incrementally updated — infrequent enough (explicit tab/flag clicks)
  // that a full rebuild is simpler and cheap at this scale (a handful of
  // countries × 151 years).
  // A radar/spider chart plotting five metrics as spokes around a wheel
  // for every selected item at the currently selected year — a snapshot,
  // not a time series, so unlike the trend chart this rebuilds completely
  // on every year change rather than owning a persistent line shape that a
  // year marker slides across. Chosen over a bubble/scatter layout because
  // a scatter plot reads poorly with only a couple of points selected; a
  // radar chart's shape comparison still works with as few as two items.
  function renderRadarChart() {
    const svg = elements.radarChart;
    const width = svg.clientWidth || 900;
    const height = svg.clientHeight || 360;
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.onpointermove = (event) => {
      const polygon = event.target.closest?.(".radar-polygon[data-tooltip]");
      if (!polygon || !svg.contains(polygon)) {
        hideTooltip();
        return;
      }
      showTooltip(
        event,
        polygon.dataset.tooltip,
        polygon.dataset.tooltipColor,
      );
    };
    svg.onpointerleave = hideTooltip;

    const items = chartItems();
    const years = getYears();
    const n = years.length;
    const pad = RADAR_CHART_PADDING;
    const innerW = width - pad.left - pad.right;
    const plotHeight = height - pad.top - pad.bottom;
    const cx = pad.left + innerW / 2;
    const cy = pad.top + plotHeight / 2;
    const maxR = Math.max(20, Math.min(innerW, plotHeight) / 2);
    const axisCount = RADAR_CHART_METRICS.length;

    // Clockwise from the top: population growth, fertility, migration,
    // life expectancy, dependency ratio.
    function angleFor(i) {
      return (-90 + (360 / axisCount) * i) * (Math.PI / 180);
    }
    function spokePoint(i, r) {
      const angle = angleFor(i);
      return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
    }

    const currentYearIndex = getCurrentYearIndex();
    const points = items
      .map((item) => ({
        item,
        values: RADAR_CHART_METRICS.map(
          (key) => item.series(key)[currentYearIndex],
        ),
      }))
      // A radar polygon needs all five vertices — one missing metric
      // leaves no sensible way to draw that item's shape, so it's dropped
      // rather than interpolated or zeroed.
      .filter(({ values }) => values.every(Number.isFinite));

    const elementsToAppend = [];

    // The year scrubber (see below) still needs to render even with no
    // plottable points, so it's built after this early return rather than
    // wrapping the whole function.
    if (!points.length) {
      const message = svgEl("text", {
        class: "trend-chart-axis-label",
        x: (width / 2).toFixed(1),
        y: (height / 2).toFixed(1),
        "text-anchor": "middle",
      });
      message.textContent =
        "No comparable data is available for the selected countries.";
      elementsToAppend.push(message);
    } else {
      // Each spoke is normalized independently against the selected
      // items' own min/max — a radar chart's shape only means something
      // relative to what's actually plotted, not against each metric's
      // global range, and the five metrics don't share units anyway.
      const domains = RADAR_CHART_METRICS.map((_, axisIndex) => {
        const values = points.map((p) => p.values[axisIndex]);
        return { min: Math.min(...values), max: Math.max(...values) };
      });
      function normalize(value, axisIndex) {
        const { min, max } = domains[axisIndex];
        return max === min ? 0.5 : (value - min) / (max - min);
      }

      // Concentric rings at 25/50/75/100% give the eye a scale to read
      // distance-from-center against, the same role the trend chart's Y
      // ticks play.
      [0.25, 0.5, 0.75, 1].forEach((fraction) => {
        elementsToAppend.push(
          svgEl("circle", {
            class: "radar-grid-ring",
            cx: width / 2,
            cy: height / 2,
            r: fraction * maxR,
          }),
        );
      });

      RADAR_CHART_METRICS.forEach((key, i) => {
        const outer = spokePoint(i, maxR);
        elementsToAppend.push(
          svgEl("line", {
            class: "trend-chart-axis",
            x1: cx.toFixed(1),
            y1: cy.toFixed(1),
            x2: outer.x.toFixed(1),
            y2: outer.y.toFixed(1),
          }),
        );
        const labelPoint = spokePoint(i, maxR + 14);
        const cos = Math.cos(angleFor(i));
        const anchor = cos > 0.3 ? "start" : cos < -0.3 ? "end" : "middle";
        const label = svgEl("text", {
          class: "trend-chart-axis-label",
          x: labelPoint.x.toFixed(1),
          y: (labelPoint.y + 4).toFixed(1),
          "text-anchor": anchor,
        });
        label.textContent = METRICS[key].label;
        elementsToAppend.push(label);
      });

      points.forEach(({ item, values }) => {
        const vertices = values.map((value, axisIndex) =>
          spokePoint(axisIndex, normalize(value, axisIndex) * maxR),
        );
        const polygon = svgEl("polygon", {
          class: "radar-polygon",
          points: vertices
            .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
            .join(" "),
          fill: item.color,
          stroke: item.color,
        });
        polygon.dataset.tooltip = item.name;
        polygon.dataset.tooltipColor = item.color;
        elementsToAppend.push(polygon);
        vertices.forEach((p) => {
          elementsToAppend.push(
            svgEl("circle", {
              class: "radar-vertex",
              cx: p.x.toFixed(1),
              cy: p.y.toFixed(1),
              r: 2.5,
              fill: item.color,
            }),
          );
        });
      });
    }

    // A compact year scrubber along the top edge — the only way to change
    // year while this tab is active, since .timeline stays hidden for the
    // whole chart view and every polygon's shape (unlike the trend
    // chart's lines) is itself year-dependent. Mirrors the trend chart's
    // own marker: cheap live-drag preview that only moves the pill and
    // live-updates the table, committing the actual polygons through
    // commitYear()'s full pipeline at drag end — re-rendering this SVG
    // mid-drag would drop the pointer capture the drag depends on.
    if (currentYearIndex >= 0 && currentYearIndex < n) {
      const scrubberY = 4;
      const pillWidth = 32;
      const pillHeight = 18;
      const scrubberX = chartXFor(
        currentYearIndex,
        n,
        innerW,
        pad.left,
      ).toFixed(1);
      const scrubberLine = svgEl("line", {
        class: "trend-chart-year-marker",
        x1: scrubberX,
        x2: scrubberX,
        y1: scrubberY + pillHeight,
        y2: scrubberY + pillHeight + 6,
      });
      const scrubberPill = svgEl("rect", {
        class: "trend-chart-year-pill",
        x: (Number(scrubberX) - pillWidth / 2).toFixed(1),
        y: scrubberY,
        width: pillWidth,
        height: pillHeight,
        rx: 4,
      });
      const scrubberLabel = svgEl("text", {
        class: "trend-chart-year-label",
        x: scrubberX,
        y: scrubberY + 13,
        "text-anchor": "middle",
      });
      scrubberLabel.textContent = years[currentYearIndex];
      const DRAG_HIT_HALF_WIDTH = 10;
      const scrubberDragHit = svgEl("rect", {
        class: "trend-chart-year-drag",
        x: (Number(scrubberX) - DRAG_HIT_HALF_WIDTH).toFixed(1),
        y: scrubberY,
        width: DRAG_HIT_HALF_WIDTH * 2,
        height: pillHeight + 6,
      });

      function yearForClientX(clientX) {
        const rect = svg.getBoundingClientRect();
        const localX = ((clientX - rect.left) / rect.width) * width;
        const ratio = (localX - pad.left) / innerW;
        const index = Math.round(ratio * (n - 1));
        return years[Math.min(n - 1, Math.max(0, index))];
      }

      let chartTableRenderScheduled = false;
      function previewYear(year) {
        const index = years.indexOf(year);
        if (index === -1 || index === getCurrentYearIndex()) return;
        const x = chartXFor(index, n, innerW, pad.left).toFixed(1);
        scrubberLine.setAttribute("x1", x);
        scrubberLine.setAttribute("x2", x);
        scrubberPill.setAttribute("x", (Number(x) - pillWidth / 2).toFixed(1));
        scrubberLabel.setAttribute("x", x);
        scrubberLabel.textContent = year;
        scrubberDragHit.setAttribute(
          "x",
          (Number(x) - DRAG_HIT_HALF_WIDTH).toFixed(1),
        );
        setCurrentYearIndex(index);
        if (!chartTableRenderScheduled) {
          chartTableRenderScheduled = true;
          requestAnimationFrame(() => {
            chartTableRenderScheduled = false;
            renderTable();
          });
        }
      }

      let dragging = false;
      scrubberDragHit.addEventListener("pointerdown", (event) => {
        dragging = true;
        stopTour();
        scrubberDragHit.setPointerCapture(event.pointerId);
        previewYear(yearForClientX(event.clientX));
      });
      scrubberDragHit.addEventListener("pointermove", (event) => {
        if (dragging) previewYear(yearForClientX(event.clientX));
      });
      const endDrag = () => {
        if (!dragging) return;
        dragging = false;
        commitYear(years[getCurrentYearIndex()]);
      };
      scrubberDragHit.addEventListener("pointerup", endDrag);
      scrubberDragHit.addEventListener("pointercancel", endDrag);

      elementsToAppend.push(
        scrubberLine,
        scrubberPill,
        scrubberLabel,
        scrubberDragHit,
      );
    }

    svg.replaceChildren(...elementsToAppend);
  }

  function handleTableSort(key) {
    const next = nextSortState(getTableSort(), key, chartTableColumns());
    if (!next) return;
    setTableSort(next);
    renderTable();
  }

  // The same sortable table component the group view uses, reduced here
  // to country, population, and the active chart metric.
  function renderTable() {
    if (!elements.chartTableRows) return;
    const items = chartItems();
    const columns = chartTableColumns();
    let sort = getTableSort();
    if (!columns.some((column) => column.key === sort.key)) {
      // Used to always fall back to "population" specifically, which
      // stopped being a safe assumption once the table dropped its
      // always-present Population column — falls back to whichever metric
      // column is actually here instead (the "name" one is never a useful
      // sort default, so it's excluded).
      const fallback = columns.find((column) => column.key !== "name");
      sort = { key: fallback.key, direction: fallback.defaultDirection };
      setTableSort(sort);
    }
    renderSortableTable({
      headerEl: elements.chartTableHeader,
      rowsEl: elements.chartTableRows,
      columns,
      sort,
      countries: items,
      onSort: handleTableSort,
      onRowClick: (item) => item.onClick(),
      colorFor: (item) => item.color,
      barMode: "none",
      compact: true,
    });
  }

  const trendChart = createTrendChartController({
    svg: elements.trendChart,
    radarSvg: elements.radarChart,
    radarKey: CHART_RADAR_KEY,
    metrics: METRICS,
    benchmarkLines: CHART_BENCHMARK_LINES,
    svgEl,
    getMetricKey,
    getItems: chartItems,
    getYears,
    getCurrentYearIndex,
    setCurrentYearIndex,
    getHistoricalCutoffYear,
    renderRadar: renderRadarChart,
    renderTable,
    showTooltip,
    hideTooltip,
    stopTour,
    commitYear,
  });

  function renderChart(options) {
    trendChart.render(options);
  }

  function cancelAnimation() {
    trendChart.cancelAnimation();
  }

  let eventController = null;

  function init() {
    if (eventController) return false;
    eventController = new AbortController();
    const { signal } = eventController;
    elements.chartMetricTabs.addEventListener("change", () => {
      setMetric(elements.chartMetricTabs.value);
    }, { signal });
    elements.chartCountryChips.addEventListener("click", (event) => {
      const button = event.target.closest(".chip-remove[data-iso3]");
      if (!button || !elements.chartCountryChips.contains(button)) return;
      removeCountry(button.dataset.iso3);
    }, { signal });
    countryCombobox = createCountryCombobox({
      input: elements.chartCountrySearch,
      list: elements.chartCountrySuggestions,
      container: elements.chartCountryPicker,
      getCandidates: (query) =>
        matchCountries(query, {
          countries: getCountries(),
          convertCode: convertAlpha3ToAlpha2,
          exclude: getSelectedCountries(),
          limit: CHART_COUNTRY_SUGGESTION_LIMIT,
        }),
      onSelect: (country) => selectCountrySuggestion(country.iso3),
      flagUrl: flagIconUrl,
      preloadFlags: preloadFlagIcons,
      onEmptyBackspace: () => {
        const selected = getSelectedCountries();
        if (!selected.length) return;
        removeCountry(selected[selected.length - 1]);
      },
      onEscape: ({ wasOpen }) => {
        if (!wasOpen) setCountryPickerExpanded(false);
      },
    });
    elements.chartCountryPickerSummary.addEventListener(
      "click",
      () => setCountryPickerExpanded(true),
      { signal },
    );
    elements.chartCountryPickerCancel.addEventListener(
      "click",
      () => setCountryPickerExpanded(false),
      { signal },
    );
    document.addEventListener("click", (event) => {
      if (!event.composedPath().includes(elements.chartCountryPicker)) {
        setCountryPickerExpanded(false);
      }
    }, { signal });
    return true;
  }

  function dispose() {
    if (!eventController) return false;
    eventController.abort();
    eventController = null;
    countryCombobox?.dispose();
    countryCombobox = null;
    cancelAnimation();
    return true;
  }

  return {
    init,
    dispose,
    renderChart,
    renderTable,
    cancelAnimation,
    addCountry,
    removeCountry,
    setMetric,
    setCountryPickerExpanded,
    renderCountryChips,
    renderMetricTabs,
    chartSeriesFor,
    valueAtFractionalYear,
  };
}
