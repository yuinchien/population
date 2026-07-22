import { displayGroupLabel } from "./status-insights.mjs";
import {
  COUNTRY_SPARKLINE_METRIC_KEYS,
  METRICS,
} from "./metrics.mjs";
import {
  computePeakYear,
  flagIconUrl,
  preloadFlagIcons,
} from "./data-loader.mjs";
import { createCountryChartGeometry } from "./country-chart.mjs";
import {
  ageBandStart,
  buildPyramidGeometry,
  interpolateAgeStructure,
  maxBandTotal,
} from "./country-pyramid.mjs";
import { createSparklineGeometry } from "./sparkline-chart.mjs";
import {
  cancelChartAnimations,
  runChartAnimation,
} from "./chart-animation.mjs";
import { computeValueRange } from "./chart-math.mjs";
import { currentAgingStage } from "./country-aging-narrative.mjs";

const SVG_NS = "http://www.w3.org/2000/svg";

const COUNTRY_CHART_WIDTH = 760;
const COUNTRY_CHART_HEIGHT = 220;
const COUNTRY_CHART_PADDING = { top: 8, right: 0, bottom: 0, left: 0 };
const COUNTRY_CHART_LABEL_MIN_Y = 12;
const COUNTRY_PYRAMID_VIEW = { width: 300, height: 300 };
const COUNTRY_PYRAMID_PADDING = { top: 0, right: 0, bottom: 0, left: 0 };
const COUNTRY_PYRAMID_AGE_LABEL_STEP = 20;
const SIMILAR_COUNTRY_METRIC_KEYS = [
  "fertility",
  "medianAge",
  "lifeExpectancy",
  "populationGrowth",
  "ageDependencyRatio",
];
const SIMILAR_COUNTRY_LIMIT = 4;

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  return el;
}

function divEl(className, text = "") {
  const el = document.createElement("div");
  el.className = className;
  el.textContent = text;
  return el;
}

function setPyramidBarStyle(el, rect) {
  el.style.left = `${(rect.x / COUNTRY_PYRAMID_VIEW.width) * 100}%`;
  el.style.top = `${(rect.y / COUNTRY_PYRAMID_VIEW.height) * 100}%`;
  el.style.width = `${(rect.width / COUNTRY_PYRAMID_VIEW.width) * 100}%`;
  el.style.height = `${(rect.height / COUNTRY_PYRAMID_VIEW.height) * 100}%`;
}

function pyramidGeometryFor(shares, ageGroups, maxShare) {
  return buildPyramidGeometry({
    ...shares,
    ageGroups,
    maxShare,
    width: COUNTRY_PYRAMID_VIEW.width,
    height: COUNTRY_PYRAMID_VIEW.height,
    padding: COUNTRY_PYRAMID_PADDING,
  });
}

export function createCountryDetailController({
  elements,
  getYears,
  getCurrentYearIndex,
  setCurrentYearIndex,
  getHistoricalCutoffYear,
  getCountries,
  getPopulationSeries = (country) => country?.populations ?? [],
  getColorMode,
  getDemographicMetrics,
  getAgeStructure,
  colorFor,
  formatPopulation,
  easeOut,
  chartLineGrowMs,
  chartMarkerFadeInMs,
  updateStatusPanel,
  updateViewModeAvailability,
  stopTour,
  goToYear,
  showTooltip,
  hideTooltip,
  onOpenCountry,
}) {
  let selectedCountry = null;
  let chartLayout = null;
  let pyramidLayout = null;
  let sparklineInstances = [];
  const animationHandles = [];

  const yearAtCurrentIndex = () => getYears()[getCurrentYearIndex()];

  function metricFor(country, key) {
    return getDemographicMetrics()?.countries?.[country.iso3]?.[key]?.[
      getCurrentYearIndex()
    ];
  }

  elements.countrySimilarList?.addEventListener("click", (event) => {
    const item = event.target.closest(".country-similar-item[data-iso3]");
    if (!item || !elements.countrySimilarList.contains(item)) return;
    const match = getCountries().find(
      (country) => country.iso3 === item.dataset.iso3,
    );
    if (match) onOpenCountry(match);
  });

  function sparklineTooltipTarget(event) {
    const target = event.target.closest?.(".sparkline-dot[data-tooltip]");
    return target && elements.countrySparklines.contains(target)
      ? target
      : null;
  }

  elements.countrySparklines?.addEventListener("pointermove", (event) => {
    const target = sparklineTooltipTarget(event);
    if (!target) {
      hideTooltip();
      return;
    }
    showTooltip(event, target.dataset.tooltip);
  });
  elements.countrySparklines?.addEventListener("pointerleave", hideTooltip);

  function computeSimilarCountries(country) {
    const countries = getCountries();
    if (!getDemographicMetrics()) return [];
    const target = SIMILAR_COUNTRY_METRIC_KEYS.map((key) =>
      metricFor(country, key),
    );
    if (target.some((value) => value == null)) return [];

    const ranges = SIMILAR_COUNTRY_METRIC_KEYS.map((key) => {
      const values = countries
        .map((candidate) => metricFor(candidate, key))
        .filter((value) => value != null);
      return Math.max(...values) - Math.min(...values) || 1;
    });

    return countries
      .filter((candidate) => candidate.iso3 !== country.iso3)
      .map((candidate) => {
        const values = SIMILAR_COUNTRY_METRIC_KEYS.map((key) =>
          metricFor(candidate, key),
        );
        if (values.some((value) => value == null)) return null;
        let distanceSquared = 0;
        values.forEach((value, i) => {
          const diff = Math.abs(value - target[i]) / ranges[i];
          distanceSquared += diff * diff;
        });
        return { country: candidate, distance: Math.sqrt(distanceSquared) };
      })
      .filter(Boolean)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, SIMILAR_COUNTRY_LIMIT);
  }

  function renderSimilarCountries(country) {
    const matches = computeSimilarCountries(country);
    preloadFlagIcons(matches.map(({ country: match }) => match.iso3));
    elements.countrySimilar.hidden = matches.length === 0;
    if (!matches.length) return;
    elements.countrySimilarList.replaceChildren(
      ...matches.map(({ country: match }) => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "country-similar-item";
        item.dataset.iso3 = match.iso3;
        const flag = document.createElement("span");
        flag.className = "country-similar-flag";
        flag.style.backgroundImage = `url(${flagIconUrl(match.iso3)})`;
        const text = document.createElement("span");
        text.className = "country-similar-text";
        const name = document.createElement("span");
        name.className = "country-similar-name";
        name.textContent = match.name;
        text.append(name);
        item.append(flag, text);
        return item;
      }),
    );
  }

  function buildSparklineCard(key) {
    const definition = METRICS[key];
    const svg = svgEl("svg", {
      class: "sparkline-svg",
      preserveAspectRatio: "none",
    });
    const dotLine = svgEl("line", { class: "sparkline-dot-line" });
    const dot = svgEl("circle", { class: "sparkline-dot", r: 4 });

    const titleCaption = document.createElement("div");
    titleCaption.className = "sparkline-caption";
    const card = document.createElement("div");
    card.className = "sparkline-card";
    const label = document.createElement("div");
    label.className = "sparkline-label";
    label.textContent = definition.label;
    const value = document.createElement("div");
    value.className = "sparkline-value";
    titleCaption.append(label, value);
    card.append(titleCaption, svg);

    return { card, svg, dotLine, dot, valueEl: value };
  }

  function populateSparkline(instance, series, cutoffIndex, key, { animate }) {
    const { svg, dotLine, dot } = instance;
    const width = svg.clientWidth || 160;
    const height = svg.clientHeight || 40;
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

    const configuredReferenceValue = METRICS[key]?.referenceValue;
    const { min } = computeValueRange(series, configuredReferenceValue);
    const referenceValue = configuredReferenceValue ?? min;
    const n = series.length;
    const { baselineY, toXY, yFor, pathFor, areaFor } =
      createSparklineGeometry({
        series,
        cutoffIndex,
        width,
        height,
        referenceValue: configuredReferenceValue,
      });

    const elementsToAppend = [];
    const initialYFor = animate ? () => baselineY : yFor;
    const historicalArea = svgEl("path", {
      class: "sparkline-area historical",
      d: areaFor(0, cutoffIndex, initialYFor),
    });
    const projectedArea = svgEl("path", {
      class: "sparkline-area projected",
      d: areaFor(cutoffIndex, n - 1, initialYFor),
    });
    elementsToAppend.push(historicalArea, projectedArea);
    if (referenceValue != null) {
      elementsToAppend.push(
        svgEl("line", {
          class: "sparkline-baseline",
          x1: 0,
          x2: width,
          y1: baselineY.toFixed(1),
          y2: baselineY.toFixed(1),
        }),
      );
      const format = METRICS[key]?.format ?? ((value) => `${value}`);
      const baselineLabel = svgEl("text", {
        class: "sparkline-baseline-label",
        x: 0,
        y: Math.max(baselineY - 4, 8).toFixed(1),
        "text-anchor": "start",
      });
      baselineLabel.textContent =
        referenceValue === 0 ? "0" : format(referenceValue);
      elementsToAppend.push(baselineLabel);
    }
    const historicalPath = svgEl("path", {
      class: "sparkline-path historical",
      d: pathFor(0, cutoffIndex, initialYFor),
    });
    const projectedPath = svgEl("path", {
      class: "sparkline-path projected",
      d: pathFor(cutoffIndex, n - 1, initialYFor),
    });
    elementsToAppend.push(historicalPath, projectedPath);
    if (animate) {
      dot.style.opacity = "0";
      dotLine.style.opacity = "0";
    }
    svg.append(...elementsToAppend, dotLine, dot);

    if (animate) {
      const totalDuration = chartLineGrowMs + chartMarkerFadeInMs;
      animationHandles.push(runChartAnimation({
        duration: totalDuration,
        onFrame: (_eased, progress) => {
          const elapsed = progress * totalDuration;
          const growT = easeOut(Math.min(1, elapsed / chartLineGrowMs));
          const animatedYFor = (value) =>
            baselineY + (yFor(value) - baselineY) * growT;
          historicalPath.setAttribute(
            "d",
            pathFor(0, cutoffIndex, animatedYFor),
          );
          projectedPath.setAttribute(
            "d",
            pathFor(cutoffIndex, n - 1, animatedYFor),
          );
          historicalArea.setAttribute(
            "d",
            areaFor(0, cutoffIndex, animatedYFor),
          );
          projectedArea.setAttribute(
            "d",
            areaFor(cutoffIndex, n - 1, animatedYFor),
          );

          const fadeT = Math.min(
            1,
            Math.max(0, (elapsed - chartLineGrowMs) / chartMarkerFadeInMs),
          );
          dot.style.opacity = String(fadeT);
          dotLine.style.opacity = String(fadeT);
        },
      }));
    }

    instance.toXY = toXY;
    instance.baselineY = baselineY;
  }

  function buildCharts(country, { animate = false } = {}) {
    const years = getYears();
    const populationSeries = getPopulationSeries(country);
    cancelChartAnimations(animationHandles);
    const chartWidth = elements.countryChart.clientWidth || COUNTRY_CHART_WIDTH;
    const chartHeight =
      elements.countryChart.clientHeight || COUNTRY_CHART_HEIGHT;
    const svg = elements.countryChart;
    svg.setAttribute("viewBox", `0 0 ${chartWidth} ${chartHeight}`);
    const {
      count: n,
      cutoffIndex,
      baselineY,
      xyFor,
    } = createCountryChartGeometry({
      country,
      populationSeries,
      years,
      historicalCutoffYear: getHistoricalCutoffYear(),
      width: chartWidth,
      height: chartHeight,
      padding: COUNTRY_CHART_PADDING,
    });

    svg.replaceChildren();
    const growingBars = [];
    const revealElements = [];

    if (cutoffIndex < n - 1) {
      let top = "";
      for (let i = cutoffIndex; i < n; i++) {
        const [x, y] = xyFor(i, country.populationsHigh[i]);
        top += `${top ? " L " : "M "}${x.toFixed(2)} ${y.toFixed(2)}`;
      }
      let bottom = "";
      for (let i = n - 1; i >= cutoffIndex; i--) {
        const [x, y] = xyFor(i, country.populationsLow[i]);
        bottom += ` L ${x.toFixed(2)} ${y.toFixed(2)}`;
      }
      const band = svgEl("path", {
        class: "country-chart-band",
        d: `${top}${bottom} Z`,
      });
      if (animate) band.style.opacity = "0";
      revealElements.push(band);
      svg.append(band);
    }

    const bars = document.createDocumentFragment();
    for (let i = 0; i < n; i++) {
      const value = populationSeries[i];
      if (value == null) continue;
      const [x, y] = xyFor(i, value);
      const isProjected = i >= cutoffIndex;
      const bar = svgEl("line", {
        class: `country-chart-bar${isProjected ? " projected" : ""}`,
        x1: x.toFixed(2),
        x2: x.toFixed(2),
        y1: baselineY,
        y2: animate ? baselineY : y.toFixed(2),
      });
      if (animate) growingBars.push({ bar, targetY: y });
      bars.append(bar);
    }
    svg.append(bars);

    const axisY = chartHeight - 6;
    const peakIndex = years.indexOf(computePeakYear(populationSeries, years));
    const peakDotSize = 8.2;
    if (peakIndex !== -1 && Number.isFinite(populationSeries[peakIndex])) {
      const [px, py] = xyFor(peakIndex, populationSeries[peakIndex]);
      const peakLine = svgEl("line", {
        class: "country-chart-peak-line",
        x1: px,
        x2: px,
        y1: baselineY,
        y2: py.toFixed(2),
      });
      const peakDot = svgEl("rect", {
        class: "country-chart-peak-dot",
        x: (px - peakDotSize / 2).toFixed(2),
        y: (py - peakDotSize / 2).toFixed(2),
        width: peakDotSize,
        height: peakDotSize,
      });
      if (animate) {
        peakLine.style.opacity = "0";
        peakDot.style.opacity = "0";
      }
      revealElements.push(peakLine, peakDot);
      svg.append(peakLine, peakDot);
      const peakTextAnchor =
        peakIndex > n * 0.85
          ? "end"
          : peakIndex < n * 0.15
            ? "start"
            : "middle";
      const peakLabel = svgEl("text", {
        class: "country-chart-peak-label",
        x: px,
        y: axisY + 4,
        "text-anchor": peakTextAnchor,
      });
      peakLabel.textContent = "PEAK";
      if (animate) peakLabel.style.opacity = "0";
      revealElements.push(peakLabel);
      svg.append(peakLabel);
    }

    const markerDot = svgEl("circle", {
      id: "countryChartMarkerDot",
      class: "country-chart-marker-dot",
      r: 4.5,
    });
    const markerLabel = svgEl("text", {
      id: "countryChartMarkerLabel",
      class: "country-chart-marker-label",
    });
    const markerYearLabel = svgEl("text", {
      id: "countryChartMarkerYearLabel",
      class: "country-chart-marker-year-label",
    });
    const markerLine = svgEl("line", {
      id: "countryChartMarkerLine",
      class: "country-chart-marker-line",
      y2: baselineY,
    });
    const markerDragHit = svgEl("rect", {
      class: "country-chart-year-drag",
      y: COUNTRY_CHART_PADDING.top,
      width: 18,
      height: Math.max(0, baselineY - COUNTRY_CHART_PADDING.top),
    });
    if (animate) {
      markerLine.style.opacity = "0";
      markerDot.style.opacity = "0";
      markerLabel.style.opacity = "0";
      markerYearLabel.style.opacity = "0";
    }
    revealElements.push(markerLine, markerDot, markerLabel, markerYearLabel);
    svg.append(markerLine, markerDot, markerLabel, markerYearLabel, markerDragHit);

    chartLayout = {
      populations: populationSeries,
      xyFor,
      axisLabelY: axisY + 4,
      markerLine,
      markerDot,
      markerLabel,
      markerYearLabel,
      markerDragHit,
    };

    function yearForClientX(clientX) {
      const rect = svg.getBoundingClientRect();
      const localX = ((clientX - rect.left) / rect.width) * chartWidth;
      const [firstX] = xyFor(0, 0);
      const [lastX] = xyFor(n - 1, 0);
      const ratio = (localX - firstX) / (lastX - firstX);
      const index = Math.round(ratio * (n - 1));
      return years[Math.min(n - 1, Math.max(0, index))];
    }

    function previewCountryYear(clientX) {
      const year = yearForClientX(clientX);
      const index = years.indexOf(year);
      if (index === -1 || index === getCurrentYearIndex()) return;
      setCurrentYearIndex(index);
      updateYear(year);
    }

    let draggingYearMarker = false;
    markerDragHit.addEventListener("pointerdown", (event) => {
      draggingYearMarker = true;
      stopTour();
      markerDragHit.setPointerCapture(event.pointerId);
      previewCountryYear(event.clientX);
    });
    markerDragHit.addEventListener("pointermove", (event) => {
      if (draggingYearMarker) previewCountryYear(event.clientX);
    });
    const endYearMarkerDrag = () => {
      if (!draggingYearMarker) return;
      draggingYearMarker = false;
      goToYear(years[getCurrentYearIndex()]);
    };
    markerDragHit.addEventListener("pointerup", endYearMarkerDrag);
    markerDragHit.addEventListener("pointercancel", endYearMarkerDrag);

    if (animate && growingBars.length) {
      const totalDuration = chartLineGrowMs + chartMarkerFadeInMs;
      animationHandles.push(runChartAnimation({
        duration: totalDuration,
        onFrame: (_eased, progress) => {
          const elapsed = progress * totalDuration;
          const growT = easeOut(Math.min(1, elapsed / chartLineGrowMs));
          growingBars.forEach(({ bar, targetY }) => {
            bar.setAttribute(
              "y2",
              baselineY + (targetY - baselineY) * growT,
            );
          });

          const fadeT = Math.min(
            1,
            Math.max(0, (elapsed - chartLineGrowMs) / chartMarkerFadeInMs),
          );
          revealElements.forEach((element) => {
            element.style.opacity = String(fadeT);
          });
        },
      }));
    }

    elements.countrySparklines.replaceChildren();
    if (elements.countryPyramidCard) {
      elements.countrySparklines.append(elements.countryPyramidCard);
    }
    const metrics = getDemographicMetrics();
    sparklineInstances = COUNTRY_SPARKLINE_METRIC_KEYS.map((key) => {
      const series = metrics?.countries?.[country.iso3]?.[key] ?? [];
      const instance = buildSparklineCard(key);
      elements.countrySparklines.append(instance.card);
      populateSparkline(instance, series, cutoffIndex, key, { animate });
      return { key, series, ...instance };
    });
  }

  function updatePyramidStage(country, year) {
    if (!elements.countryPyramidStage || !country) return;
    const index = getYears().indexOf(year);
    const olderShare =
      index >= 0
        ? getDemographicMetrics()?.countries?.[country.iso3]
            ?.olderPopulationShare?.[index]
        : null;
    const stage = currentAgingStage(olderShare);
    if (!stage) {
      elements.countryPyramidStage.textContent = "";
      elements.countryPyramidStage.title = "";
      return;
    }
    const label = stage.label.replace(/^\w/, (char) => char.toUpperCase());
    const comparator = stage.includesThreshold ? "at least" : "over";
    elements.countryPyramidStage.textContent = label;
    elements.countryPyramidStage.title = `${label}: ${comparator} ${stage.thresholdCopy} of the population is aged 65 or older.`;
  }

  function updatePyramid(year) {
    const layout = pyramidLayout;
    if (!layout || !selectedCountry) return;
    const shares = interpolateAgeStructure(
      layout.countryData,
      layout.gridYears,
      year,
    );
    if (!shares) return;
    updatePyramidStage(selectedCountry, year);
    const geo = pyramidGeometryFor(shares, layout.ageGroups, layout.maxShare);
    geo.bars.forEach((bar, i) => {
      const { maleBar, femaleBar } = layout.bars[i];
      setPyramidBarStyle(maleBar, bar.male);
      setPyramidBarStyle(femaleBar, bar.female);
    });
  }

  function buildPyramid(country) {
    pyramidLayout = null;
    const pyramid = elements.countryPyramid;
    const ageStructure = getAgeStructure();
    const countryData = ageStructure?.countries?.[country.iso3];
    const gridYears = ageStructure?.years;
    const ageGroups = ageStructure?.ageGroups;
    if (!countryData || !gridYears || !ageGroups) {
      elements.countryPyramidCard.hidden = true;
      pyramid.replaceChildren();
      return;
    }
    elements.countryPyramidCard.hidden = false;

    const maxShare = maxBandTotal(countryData);
    const initialYear = yearAtCurrentIndex() ?? gridYears[0];
    const shares = interpolateAgeStructure(countryData, gridYears, initialYear);
    const geo = pyramidGeometryFor(shares, ageGroups, maxShare);

    const children = [];
    const bars = geo.bars.map((bar) => {
      const cls = `pyramid-bar${bar.isOld ? " is-old" : ""}`;
      const maleBar = divEl(`${cls} male`);
      const femaleBar = divEl(`${cls} female`);
      setPyramidBarStyle(maleBar, bar.male);
      setPyramidBarStyle(femaleBar, bar.female);
      children.push(maleBar, femaleBar);
      if (ageBandStart(bar.label) % COUNTRY_PYRAMID_AGE_LABEL_STEP === 0) {
        const label = divEl("pyramid-age-label", ageBandStart(bar.label));
        label.style.left =
          `${(bar.ageLabel.x / COUNTRY_PYRAMID_VIEW.width) * 100}%`;
        label.style.top =
          `${(bar.ageLabel.y / COUNTRY_PYRAMID_VIEW.height) * 100}%`;
        children.push(label);
      }
      return { maleBar, femaleBar };
    });

    pyramid.replaceChildren(...children);
    pyramidLayout = { bars, countryData, gridYears, ageGroups, maxShare };
    updatePyramid(initialYear);
  }

  function updateYear(year) {
    if (!chartLayout || !selectedCountry) return;
    const years = getYears();
    const index = years.indexOf(year);
    if (index === -1) return;

    const groupLabel =
      getColorMode() === "income"
        ? selectedCountry._incomeLabel
        : displayGroupLabel(selectedCountry.region);
    elements.detailSubtitle.textContent = `${groupLabel} · ${year}`;

    const {
      populations,
      xyFor,
      axisLabelY,
      markerLine,
      markerDot,
      markerLabel,
      markerYearLabel,
      markerDragHit,
    } = chartLayout;
    const population = populations[index];
    if (elements.countryChartValue) {
      elements.countryChartValue.textContent =
        population != null ? formatPopulation(population) : "";
    }
    const [x, y] = xyFor(index, population ?? 0);
    if (markerLine && markerDot && markerLabel) {
      markerLine.setAttribute("x1", x);
      markerLine.setAttribute("x2", x);
      markerLine.setAttribute("y1", y);
      markerDot.setAttribute("cx", x);
      markerDot.setAttribute("cy", y);
      markerLabel.setAttribute("x", x);
      markerLabel.setAttribute(
        "y",
        Math.max(y - 14, COUNTRY_CHART_LABEL_MIN_Y),
      );
      markerLabel.textContent = String(year);
      markerYearLabel?.setAttribute("x", x);
      markerYearLabel?.setAttribute("y", axisLabelY);
      markerYearLabel?.setAttribute(
        "text-anchor",
        index === 0 ? "start" : index === years.length - 1 ? "end" : "middle",
      );
      if (markerYearLabel) markerYearLabel.textContent = String(year);
      markerDragHit?.setAttribute("x", x - 9);
    }

    updatePyramid(year);

    sparklineInstances.forEach(
      ({ key, series, dotLine, dot, valueEl, toXY, baselineY }) => {
        const value = series[index];
        const definition = METRICS[key];
        const format = definition.formatPanel ?? definition.format;
        valueEl.textContent = format(value);
        if (value != null) {
          dot.dataset.tooltip = valueEl.textContent;
          const [dx, dy] = toXY(index, value);
          dotLine.setAttribute("x1", dx);
          dotLine.setAttribute("x2", dx);
          dotLine.setAttribute("y1", dy);
          dotLine.setAttribute("y2", baselineY);
          dot.setAttribute("cx", dx);
          dot.setAttribute("cy", dy);
          dotLine.style.display = "";
          dot.style.display = "";
        } else {
          delete dot.dataset.tooltip;
          dotLine.style.display = "none";
          dot.style.display = "none";
        }
      },
    );
  }

  function render(country, { animate = false } = {}) {
    if (!country || getCurrentYearIndex() < 0) return;
    selectedCountry = country;
    const year = yearAtCurrentIndex();

    elements.detailPanel.style.setProperty(
      "--detail-color",
      `#${colorFor(country).getHexString()}`,
    );
    elements.detailTitle.textContent = country.name;
    preloadFlagIcons([country.iso3]);
    elements.detailFlag.style.backgroundImage =
      `url(${flagIconUrl(country.iso3)})`;
    elements.detailFlag.hidden = false;

    elements.detailHeader.hidden = true;
    elements.detailRows.hidden = true;
    elements.countryDetail.hidden = false;
    elements.detailPanel.hidden = false;
    updateStatusPanel(year);
    buildCharts(country, { animate });
    buildPyramid(country);
    updateYear(year);
    renderSimilarCountries(country);
    updateViewModeAvailability();
  }

  function reset() {
    cancelChartAnimations(animationHandles);
    selectedCountry = null;
    chartLayout = null;
    pyramidLayout = null;
    sparklineInstances = [];
  }

  function resize(country = selectedCountry) {
    if (!country || getCurrentYearIndex() < 0) return;
    selectedCountry = country;
    buildCharts(country);
    updateYear(yearAtCurrentIndex());
  }

  return {
    render,
    reset,
    resize,
    updateYear,
  };
}
