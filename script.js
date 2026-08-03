import {
  displayGroupLabel,
  prioritizedMilestoneYears,
} from "./status-insights.mjs";
import { METRICS, formatCount } from "./metrics.mjs";
import {
  AGE_CATEGORIES,
  AGE_COLUMN_KEYS,
  MIGRATION_CATEGORIES,
  MIGRATION_COLUMN_KEYS,
  subgroupPopulationFor,
  subgroupPopulationLabelFor,
} from "./detail-group-categories.mjs";
import {
  buildDetailColumns,
  selectDetailCountries,
} from "./detail-table.mjs";
import { nextSortState, renderSortableTable } from "./detail-table-view.mjs";
import { createCountryDetailController } from "./country-detail-controller.mjs";
import {
  convertAlpha3ToAlpha2,
  loadPopulationData,
  flagIconUrl,
  preloadFlagIcons,
} from "./data-loader.mjs";
import {
  INCOME_GROUP_COLORS,
  REGION_COLORS,
  UNCLASSIFIED_COLOR,
  UNCLASSIFIED_INCOME,
} from "./view-config.mjs";
import { assertElements, getAppElements } from "./ui-elements.mjs";
import { buildCountrySummary } from "./country-summary-model.mjs";
import {
  buildAgingMilestoneInsight,
  buildCountryDemographicNarrative,
} from "./country-aging-narrative.mjs";
import { parseUrlState, serializeUrlState } from "./url-state.mjs";
import {
  adjacentMilestoneYears,
  createTourController,
} from "./tour-controller.mjs";
import { createClusterController } from "./cluster-controller.mjs";
import { createChartController } from "./chart-controller.mjs";
import { CLUSTER_ARCHETYPES, clusterStatusForYear } from "./cluster-config.mjs";
import {
  createProjectionScenarioData,
  isProjectionScenario,
} from "./projection-scenario-data.mjs";
import {
  hideTooltip as hideTooltipElement,
  showTooltipContent,
  showTooltipLine,
} from "./tooltip-controller.mjs";
import { createInitialAppState } from "./app-state.mjs";
import {
  createCountryCombobox,
  matchCountries,
} from "./country-combobox.mjs";
import { createOverlayController } from "./overlay-controller.mjs";
import { createChartViewLifecycle } from "./chart-view-lifecycle.mjs";
import { createSearchViewLifecycle } from "./search-view-lifecycle.mjs";
import { createClusterViewLifecycle } from "./cluster-view-lifecycle.mjs";
import { createViewRouter } from "./view-router.mjs";
import { createSceneController, easeOutCubic } from "./scene-controller.mjs";
import { createUiStateRenderer } from "./ui-state-renderer.mjs";

// How long each trend-chart line takes to grow up from a flat baseline into
// its real shape when the chart first appears (see chart-controller.mjs's
// renderChart, and country-detail-controller.mjs which reuses this value).
const CHART_LINE_GROW_MS = 500;
// How long markers/labels take to fade in once their curve has finished
// growing — used by both the main country chart and its sparklines so a
// marker never appears sitting on a curve that hasn't caught up to it yet.
const CHART_MARKER_FADE_IN_MS = 320;

const elements = getAppElements();
assertElements(
  elements,
  [
    "menuToggle",
    "menuShim",
    "infoButton",
    "infoPanel",
    "infoClose",
    "status",
    "tooltip",
    "chartTooltip",
    "clusterArchetypeTooltip",
    "yearSlider",
    "yearValue",
    "colorMode",
    "legend",
    "viewMode",
    "calloutLayer",
    "detailPanel",
    "detailFlag",
    "detailTitle",
    "detailSubtitle",
    "detailNav",
    "detailHeader",
    "detailRows",
    "detailClose",
    "countryPanel",
    "countryFlag",
    "countryTitle",
    "countrySubtitle",
    "countryClose",
    "countryDetail",
    "chartPanel",
    "clusterView",
    "clusterCanvas",
  ],
  "app shell",
);

const COUNTRY_DETAIL_ELEMENT_KEYS = [
  "countryChart",
  "countryChartValue",
  "countrySparklines",
  "countryPyramidCard",
  "countryPyramidStage",
  "countryPyramid",
  "countrySimilar",
  "countrySimilarList",
];

const CHART_VIEW_ELEMENT_KEYS = [
  "chartMetricTabs",
  "trendChart",
  "radarChart",
  "chartCountryPicker",
  "chartCountryPickerSummary",
  "chartCountryPickerSummaryFlags",
  // "chartCountryPickerCancel",
  "chartProjectionScenario",
  "chartCountryChips",
  "chartCountrySearch",
  "chartCountrySuggestions",
  "chartTableHeader",
  "chartTableRows",
];

function formatPeakPopulation(value) {
  return formatCount(value, {
    billionsDecimals: 1,
    thousandsDecimals: 1,
    nullFallback: "N/A",
    roundWholeNumbers: true,
  });
}

// Globe/Map's 3D scene (Three.js scene/camera/renderer, the dot buffer,
// view-mode morph, hover/hit-testing, and the peak-population callouts) —
// see scene-controller.mjs. This file keeps only app-level orchestration
// around it.
const sceneController = createSceneController({
  elements,
  getCountries: () => countriesData,
  getYears: () => yearsData,
  getCurrentYearIndex: () => appState.currentYearIndex,
  getColorMode: () => appState.colorMode,
  getViewMode: () => appState.viewMode,
  setViewModeState: (mode) => {
    appState.viewMode = mode;
  },
  getPopulationAt: (country, index) => activePopulationAt(country, index),
  getPeakYear: activePeakYear,
  formatPopulation: formatPeakPopulation,
  onOpenCountry: openCountryDetail,
  renderLegend,
  syncUrl: syncUrlFromState,
});

let countriesData = [];
let yearsData = [];
const projectionData = createProjectionScenarioData();
let countryDemographicMetrics = null;
let countryTrajectory = null;
// Age-structure shares for the country-detail population pyramid, lazily
// loaded (see country-pyramid.mjs). null until it resolves; a country opened
// before then just renders without its pyramid until the data lands.
let countryAgeStructure = null;
let loadCountryDemographicMetrics = async () => null;
let loadCountryTrajectory = async () => null;
let loadCountryAgeStructure = async () => null;
// Set synchronously in <head> (before this module even loads) so first
// paint never flashes the wrong theme — this just picks it up.
const appState = createInitialAppState({
  theme: document.documentElement.dataset.theme || "dark",
});
const uiStateRenderer = createUiStateRenderer();
const updateUiState = (patch) => uiStateRenderer.update(patch);
let lifetimeController = null;
let lifetimeControllerPromise = null;
let lifetimeRequestedActive = false;

function activePopulationSeries(country) {
  return projectionData.populationSeries(country);
}

async function ensureCountryDemographics() {
  if (countryDemographicMetrics) return countryDemographicMetrics;
  const data = await loadCountryDemographicMetrics();
  if (!data) return null;
  countryDemographicMetrics = data;
  if (appState.chartPanelActive) {
    chartController.renderChart();
    chartController.renderTable();
  }
  if (appState.clusterActive) clusterController.render(appState.currentYearIndex);
  if (lifetimeController?.isActive()) lifetimeController.render();
  if (appState.selectedCountry) countryDetailController.refreshDemographics();
  else if (appState.selectedLegend) renderDetailPanel();
  return data;
}

async function ensureCountryTrajectory() {
  if (countryTrajectory) return countryTrajectory;
  countryTrajectory = await loadCountryTrajectory();
  if (countryTrajectory && lifetimeController?.isActive()) {
    lifetimeController.render();
  }
  return countryTrajectory;
}

async function ensureCountryAgeStructure() {
  if (countryAgeStructure) return countryAgeStructure;
  countryAgeStructure = await loadCountryAgeStructure();
  if (countryAgeStructure && appState.selectedCountry) {
    countryDetailController.refreshAgeStructure();
  }
  return countryAgeStructure;
}

function activePopulationAt(country, index = appState.currentYearIndex) {
  return projectionData.populationAt(country, index);
}

function activePeakYear(country) {
  return projectionData.peakYear(country);
}

function activeGlobalMetricsForYear(year) {
  return projectionData.globalMetricsForYear(year);
}

function activeGlobalMetricsMap() {
  return projectionData.globalMetricsMap();
}

function activeGlobalTrendMilestones() {
  return projectionData.globalTrendMilestones();
}
const formatter = new Intl.ListFormat("en", {
  style: "long",
  type: "conjunction",
});

function getPeakCountryName(peakCountries) {
  const names = peakCountries.map((country) => country.name);
  return formatter.format(names);
}

// Picks a phrasing for the peak-year status line based on how many countries
// peak in the given year. Country names live in the detail rows below the
// status, so the copy stays focused on the year and count.
// isProjected distinguishes an observed peak (year <= appState.historicalCutoffYear)
// from a modeled one (year > appState.historicalCutoffYear) — without it, a
// projected-year copy like "France's population peaks in 2061" reads as a
// stated fact rather than the UN Medium-variant projection it actually is.
function buildPeakStatus(year, peakCountries, isProjected) {
  const pick = (variants) =>
    variants[Math.floor(Math.random() * variants.length)];
  const count = peakCountries.length;
  if (count === 0) {
    return "";
    // return pick(
    //   isProjected
    //     ? [
    //         `No country's population is projected to peak in ${year}.`,
    //         `${year} is projected to pass quietly — no country's population is expected to hit its peak.`,
    //         `No population peaks are projected for ${year}. Try another spot on the timeline.`,
    //       ]
    //     : [
    //         `No country's population peaked in ${year}.`,
    //         `${year} passed quietly — no country's population hit its peak.`,
    //         `Not a single population peak that year. Try another spot on the timeline.`,
    //       ],
    // );
  }

  if (count === 1) {
    return pick(
      isProjected
        ? [
            `${peakCountries[0].name} is projected to reach its population peak in ${year}.`,
            `${year} is projected to be a population high point for ${peakCountries[0].name}.`,
            `${peakCountries[0].name} population is projected to top out in ${year}.`,
          ]
        : [
            `${peakCountries[0].name} reached its population peak in ${year}.`,
            `${year} was the population high point for ${peakCountries[0].name}.`,
            `${peakCountries[0].name} population topped out in ${year}.`,
          ],
    );
  }

  if (count <= 3) {
    return pick(
      isProjected
        ? [
            `${getPeakCountryName(peakCountries)} are projected to reach their population peak in ${year}.`,
            `${year} is projected to mark the population high point for ${getPeakCountryName(peakCountries)}.`,
            `${getPeakCountryName(peakCountries)} population are projected to top out in ${year}.`,
          ]
        : [
            `${getPeakCountryName(peakCountries)} reached their population peak in ${year}.`,
            `${year} marked the population high point for ${getPeakCountryName(peakCountries)}.`,
            `${getPeakCountryName(peakCountries)} population topped out in ${year}.`,
          ],
    );
  }

  return pick(
    isProjected
      ? [
          `${getPeakCountryName(peakCountries)} countries are projected to reach their population peak in ${year}.`,
          `${year} is projected to be a busy peak year, with ${getPeakCountryName(peakCountries)} population topping out.`,
          `A wave of projected population peaks lands in ${year}: ${getPeakCountryName(peakCountries)}.`,
        ]
      : [
          `${getPeakCountryName(peakCountries)} reached their population peak in ${year}.`,
          `${year} was a busy peak year, with ${getPeakCountryName(peakCountries)} population topping out.`,
          `A wave of population peaks landed in ${year}: ${getPeakCountryName(peakCountries)}.`,
        ],
  );
}

// Trails the global status line with headline world numbers for the
// selected year — the milestone/peak copy above is about a specific trend
// or country, so these figures themselves would otherwise never appear on
// the main (no country/group selected) view.
function buildGlobalPopulationStatus(year) {
  const isProjected = year > appState.historicalCutoffYear;
  const metrics = activeGlobalMetricsForYear(year);
  const population = metrics?.population;
  if (population == null) return "";
  const verb = isProjected ? "is" : "was";
  const parts = [`Global total ${verb} ${formatPeakPopulation(population)}`];
  if (metrics.lifeExpectancy != null) {
    parts.push(
      `life expectancy ${verb} ${METRICS.lifeExpectancy.format(metrics.lifeExpectancy)}`,
    );
  }
  if (metrics.populationGrowth != null) {
    parts.push(
      `population growth ${verb} ${METRICS.populationGrowth.format(metrics.populationGrowth)}`,
    );
  }
  return `${parts.join(", ")}.`;
}

// groupCountries lets a caller that already has the filtered+sorted group
// list (renderDetailPanel, right after building its table from the same
// list) hand it over instead of this recomputing selectDetailCountries()
// a second time on every year change; other callers just omit it and it's
// computed here as before.
function updateStatusPanel(year, { instant = false, groupCountries } = {}) {
  const isProjected = year > appState.historicalCutoffYear;
  if (appState.selectedCountry && !elements.countryPanel.hidden) {
    updateMilestoneNav(null);
    const migrationNarrative = buildCountryDemographicNarrative({
      country: appState.selectedCountry,
      years: yearsData,
      currentYearIndex: appState.currentYearIndex,
      historicalCutoffYear: appState.historicalCutoffYear,
      seriesFor: (key) =>
        key === "population"
          ? activePopulationSeries(appState.selectedCountry)
          : countryDemographicMetrics?.countries?.[appState.selectedCountry.iso3]?.[
              key
            ] ?? [],
    });
    // The aging milestone (formerly its own card) now closes the summary; the
    // migration sentence, when present, precedes it.
    const agingInsight = buildAgingMilestoneInsight({
      country: appState.selectedCountry,
      years: yearsData,
      currentYearIndex: appState.currentYearIndex,
      historicalCutoffYear: appState.historicalCutoffYear,
      olderPopulationShare:
        countryDemographicMetrics?.countries?.[appState.selectedCountry.iso3]
          ?.olderPopulationShare,
    });
    const demographicNarrative = [migrationNarrative, agingInsight?.text]
      .filter(Boolean)
      .join(" ");
    renderCountrySummary(
      buildCountrySummary({
        country: appState.selectedCountry,
        year,
        years: yearsData,
        historicalCutoffYear: appState.historicalCutoffYear,
        formatPopulation: formatPeakPopulation,
        populationSeries: activePopulationSeries(appState.selectedCountry),
        demographicNarrative,
      }),
    );
    return;
  }
  if (appState.selectedLegend && !elements.detailPanel.hidden) {
    updateMilestoneNav(null);
    return;
  }

  const peakCountries = countriesData.filter(
    (country) => activePeakYear(country) === year,
  );
  const milestone = activeGlobalTrendMilestones().get(year);
  updateMilestoneNav(year);
  const leadText = milestone
    ? `${milestone.text}${
        peakCountries.length
          ? ` ${buildPeakStatus(year, peakCountries, isProjected)}`
          : ""
      }`
    : buildPeakStatus(year, peakCountries, isProjected);
  const globalPopulationStatus = buildGlobalPopulationStatus(year);
  // Neither the milestone blurb nor the peak-year line mentions the year on
  // its own — normally one of them is present and does, but buildPeakStatus
  // returns "" when nothing peaked that year, which (off a milestone year
  // too) would leave the global figures below as the only copy, with no
  // year attached to them at all.
  const yearLead = leadText
    ? ""
    : `${year}${isProjected ? " projection" : ""}:`;
  showStatus(
    [yearLead, leadText, globalPopulationStatus].filter(Boolean).join(" "),
    { instant },
  );
}

// Milestone years in chronological order, so "Milestone #N" counts forward
// through history the same way the ‹/› buttons step through it.
function sortedMilestoneYears() {
  return [...activeGlobalTrendMilestones().keys()].sort((a, b) => a - b);
}

// Off a milestone year, prev/next target the nearest milestone on either
// side rather than being disabled outright — the slider can land anywhere
// (dragging, deep links, chart-marker scrubbing), and these buttons are the
// fastest way back onto the story from wherever that leaves you.
// year is null while a country/group detail view is showing its own status
// instead of the global story — milestone nav isn't relevant there, so both
// buttons are simply disabled rather than pointed at the global timeline.
function updateMilestoneNav(year) {
  const years = sortedMilestoneYears();
  const index = year == null ? -1 : years.indexOf(year);
  const hasMilestone = index !== -1;
  // #milestoneCaption's markup was commented out along with the rest of
  // the old #milestoneRow, but this counter update wasn't — left in place,
  // it throws on every year change (elements.milestoneCaption is null),
  // which is what was actually breaking data loading via updateStatusPanel.
  if (elements.milestoneCaption) {
    elements.milestoneCaption.textContent = hasMilestone
      ? `${index + 1} / ${years.length}`
      : "";
  }
  if (year == null) {
    elements.milestonePrev.disabled = true;
    elements.milestoneNext.disabled = true;
    return;
  }
  const { prev, next } = adjacentMilestoneYears(years, year);
  elements.milestonePrev.disabled = prev == null;
  elements.milestoneNext.disabled = next == null;
}

// Mirrors selectYearFromClientY()'s slider-driven navigation, so jumping to
// a milestone year keeps the slider/timeline/thumb in sync rather than
// mutating appState.currentYearIndex directly and leaving those controls stale.
function goToYear(year) {
  elements.yearSlider.value = year;
  elements.yearSlider.dispatchEvent(new Event("input", { bubbles: true }));
  elements.yearSlider.dispatchEvent(new Event("change", { bubbles: true }));
}

function stepMilestone(delta) {
  tourController.stop();
  const { prev, next } = adjacentMilestoneYears(
    sortedMilestoneYears(),
    yearsData[appState.currentYearIndex],
  );
  const target = delta < 0 ? prev : next;
  if (target == null) return;
  goToYear(target);
}

// Guided "story mode": auto-advances through milestones one at a time,
// dwelling on each long enough to read the status text before moving on.
// A fixed dwell (rather than measuring text length) is simplest and the
// milestone blurbs are all similar, short-paragraph lengths.
function setTourButtonState(playing) {
  elements.milestoneTourIcon.textContent = playing ? "pause" : "play_arrow";
  const label = playing ? "Pause milestone tour" : "Play milestone tour";
  elements.milestoneTour.setAttribute("aria-label", label);
  elements.milestoneTour.title = playing ? "Pause tour" : "Play tour";
}

// #clusterPlay's own play/pause state — a separate button and function from
// setTourButtonState above (rather than one button branching on
// appState.clusterActive) so each has a fixed, correct label instead of
// needing to track which mode is currently driving it.
function setClusterPlayButtonState(playing) {
  elements.clusterPlayIcon.textContent = playing ? "pause" : "play_arrow";
  elements.clusterPlay.setAttribute(
    "aria-label",
    playing ? "Pause timeline" : "Play timeline",
  );
  elements.clusterPlay.title = playing ? "Pause" : "Play";
}

// Resets the fill to empty with no transition (a mid-fade snap-back would
// read as a glitch rather than "tour stopped").
function resetTourProgress() {
  const fill = elements.milestoneProgressFill;
  fill.style.transition = "none";
  fill.style.width = "0%";
}

// Restarts the fill-to-100% sweep timed to exactly one dwell period, so it
// reads as "time remaining on this milestone" rather than decoration.
function animateTourProgress(durationMs) {
  const fill = elements.milestoneProgressFill;
  fill.style.transition = "none";
  fill.style.width = "0%";
  // Force a reflow so the 0%-width reset above is committed before the
  // transition is re-enabled — otherwise the browser coalesces both style
  // writes and the fill just jumps straight to 100% with no visible sweep.
  void fill.offsetWidth;
  fill.style.transition = `width ${durationMs}ms linear`;
  fill.style.width = "100%";
}

const tourController = createTourController({
  getMilestoneYears: sortedMilestoneYears,
  getCurrentYear: () => yearsData[appState.currentYearIndex],
  goToYear,
  onPlayingChange: setTourButtonState,
  onProgressReset: resetTourProgress,
  onProgressStart: animateTourProgress,
});

// Swaps the status line's text in with a quick fade, so the peak-year
// callout catches the eye instead of silently changing as the year slider
// drags. Removing the animation class and forcing a reflow before re-adding
// it restarts the CSS fade even though the element itself persists across
// year changes.
function showStatus(text, { instant = false } = {}) {
  const el = elements.status;
  const textNode = document.createElement("div");
  // innerHTML, not textContent — the global-figures portion of `text` comes
  // from METRICS[key].format(), which wraps its unit in <span class="suffix">
  // (metrics.mjs) for spacing; textContent would print that markup literally.
  textNode.innerHTML = text;
  el.replaceChildren(textNode);
  if (instant) return;

  el.classList.remove("status-fade-in");
  void el.offsetWidth;
  el.classList.add("status-fade-in");
}

// Cluster's own #status narration — a handful of ~30-40 year chapters
// (CLUSTER_STATUS_PERIODS, cluster-config.mjs) rather than a per-year
// figure like Globe/Map's own status text, since there's no single number
// that sums up "which of the five archetypes is this year's picture."
// Only calls showStatus() on an actual chapter change (see
// appState.clusterStatusPeriod above) so scrubbing within one chapter doesn't
// retrigger its fade every year.
function applyClusterStatus(year, options) {
  const period = clusterStatusForYear(year);
  if (period === appState.clusterStatusPeriod) return;
  appState.clusterStatusPeriod = period;
  showStatus(`${period.title}. ${period.text}`, options);
}

// Cluster's own play button (#clusterPlay): rather than hopping between
// milestone years (the global tour's job), it sweeps through every year
// from 1950 to 2100 once and stops — a single pass through the full
// archetype narrative rather than a looping story. Reuses goToYear() so
// each step still runs through the slider's normal input/change pipeline
// (cluster particles, #status chapter caption, URL sync all update exactly
// as they would from a manual drag).
let clusterPlaybackTimer = null;
// 150 year-steps at 90ms lands the full sweep around 13.5s — quick enough
// to hold attention, slow enough that each archetype phase is still
// readable as it passes rather than a blur.
const CLUSTER_PLAYBACK_STEP_MS = 90;

function isClusterPlaying() {
  return clusterPlaybackTimer !== null;
}

function stopClusterPlayback() {
  if (clusterPlaybackTimer === null) return;
  clearTimeout(clusterPlaybackTimer);
  clusterPlaybackTimer = null;
  setClusterPlayButtonState(false);
}

function playClusterTimelineOnce() {
  if (isClusterPlaying()) {
    stopClusterPlayback();
    return;
  }
  setClusterPlayButtonState(true);
  goToYear(yearsData[0]);
  const step = () => {
    const nextIndex = appState.currentYearIndex + 1;
    if (nextIndex >= yearsData.length) {
      stopClusterPlayback();
      return;
    }
    goToYear(yearsData[nextIndex]);
    clusterPlaybackTimer = setTimeout(step, CLUSTER_PLAYBACK_STEP_MS);
  };
  clusterPlaybackTimer = setTimeout(step, CLUSTER_PLAYBACK_STEP_MS);
}

function renderCountrySummary(summary) {
  elements.countrySummary.hidden = false;
  // Same .sparkline-caption label/value pattern the other cards use (e.g.
  // the Population card's "Population" / "115.1M"), so this card's caption
  // reads as one of the set rather than a one-off badge.
  const caption = document.createElement("div");
  caption.className = "sparkline-caption monospace";
  const label = document.createElement("div");
  label.className = "sparkline-label";
  label.textContent = "Summary";
  const value = document.createElement("div");
  value.className = "sparkline-value";
  value.innerHTML = badgeLabel();
  caption.append(label, value);

  if (summary.flagUrl) {
    elements.countryFlag.style.backgroundImage = `url(${summary.flagUrl})`;
    elements.countryFlag.hidden = false;
  } else {
    elements.countryFlag.hidden = true;
    elements.countryFlag.style.backgroundImage = "";
  }

  const copy = document.createElement("div");
  copy.className = "country-summary-copy paragraph";
  summary.segments.forEach((segment) => {
    if (!segment.className) {
      copy.append(document.createTextNode(segment.text));
      return;
    }
    const span = document.createElement("span");
    span.className = segment.className;
    span.textContent = segment.text;
    copy.append(span);
  });
  elements.countrySummary.replaceChildren(caption, copy);
}

function applyYear(year, { instant = false } = {}) {
  const yearIndex = yearsData.indexOf(year);
  if (yearIndex === -1) return;
  const isFirstCall = appState.currentYearIndex === -1;
  appState.currentYearIndex = yearIndex;

  // The 3D scene is fully hidden behind the chart overlay while it's open,
  // so repositioning every dot on each year change here would be pure
  // wasted work — this keeps year-scrubbing (e.g. the draggable chart
  // marker) cheap by touching only what's actually visible. Closing the
  // overlay (setChartPanelActive) does one full applyYear() call to catch
  // the 3D scene up to wherever this left it.
  if (appState.chartPanelActive) {
    updateYearLabels(year);
    chartController.renderChart();
    chartController.renderTable();
    setProjectionScenarioLabel(badgeLabel());
    syncUrlFromState();
    return;
  }

  // Same reasoning as the appState.chartPanelActive branch above — the 3D scene is
  // hidden behind the cluster overlay, so skip repositioning it and just
  // reclassify/reposition the (already-built) particles instead.
  // setClusterActive(false) does the 3D catch-up when the overlay closes.
  if (appState.clusterActive) {
    updateYearLabels(year);
    clusterController.setYear(year);
    applyClusterStatus(year, { instant });
    syncUrlFromState();
    return;
  }

  // The lifetime overlay covers the 3D scene too; the slider just re-frames
  // the personal story for the selected year (setLifetimeActive(false) catches
  // the 3D scene up on close).
  if (lifetimeController?.isActive()) {
    updateYearLabels(year);
    lifetimeController.render();
    syncUrlFromState();
    return;
  }

  if (!sceneController.isReady()) return;
  sceneController.applyYear(year, yearIndex, { isFirstCall });

  const isProjected = year > appState.historicalCutoffYear;
  appState.isProjectedYear = isProjected;

  updateYearLabels(year);
  renderDetailPanel();
  if (appState.selectedCountry) {
    countryDetailController.updateYear(year);
    updateStatusPanel(year, { instant });
  } else if (!appState.selectedLegend) {
    updateStatusPanel(year, { instant });
  }
  sceneController.rebuildCallouts(year);
  syncUrlFromState();
}

function updateSliderProgress() {
  const slider = elements.yearSlider;
  const min = Number(slider.min);
  const max = Number(slider.max);
  const pct = ((Number(slider.value) - min) / (max - min)) * 100;
  slider.style.setProperty("--progress", `${pct}%`);
}

// Cheap enough to run on every "input" tick while dragging, unlike
// applyYear()'s full rebuild — so the year figure still tracks the thumb
// live, even though the rest of the content waits for "change".
function updateYearLabels(year) {
  const slider = elements.yearSlider;
  const min = Number(slider.min || 0);
  const max = Number(slider.max || 100);
  const percentage = (Number(slider.value) - min) / (max - min);
  const thumbSize = 8;
  const thumbCenter =
    slider.offsetLeft + thumbSize / 2 +
    percentage * Math.max(0, slider.clientWidth - thumbSize);
  elements.yearValue.style.setProperty('--thumb-position', `${thumbCenter}px`);

  elements.yearValue.textContent = `${year}`;
}

function updateYearHoverLabel(event) {
  const slider = elements.yearSlider;
  const min = Number(slider.min);
  const max = Number(slider.max);
  const thumbSize = 8;
  const rect = slider.getBoundingClientRect();
  const trackWidth = Math.max(1, rect.width - thumbSize);
  const ratio = Math.min(
    1,
    Math.max(0, (event.clientX - rect.left - thumbSize / 2) / trackWidth),
  );
}

function legendEntriesFor(mode) {
  if (mode !== "income") return Object.entries(REGION_COLORS);
  return [
    ...Object.entries(INCOME_GROUP_COLORS),
    ...(sceneController.hasUnclassifiedIncome()
      ? [[UNCLASSIFIED_INCOME, UNCLASSIFIED_COLOR]]
      : []),
  ];
}

function renderLegend(modeOverride = null) {
  const mode =
    modeOverride ??
    (appState.clusterActive ? clusterController.getColorMode() : appState.colorMode);
  const entries = legendEntriesFor(mode);
  elements.legend.replaceChildren(
    ...entries.map(([label, color]) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "legend-item";
      item.dataset.label = label;
      item.dataset.color = color;
      item.dataset.mode = mode;
      item.classList.toggle(
        "active",
        appState.selectedLegend?.mode === mode && appState.selectedLegend?.label === label,
      );
      const swatch = document.createElement("span");
      swatch.className = "legend-swatch";
      item.style.setProperty("--color-legend", color);
      const text = document.createElement("span");
      text.textContent = displayGroupLabel(label);
      item.append(swatch, text);
      return item;
    }),
  );
}

function getDetailNav() {
  const sections = [
    { label: "Age", mode: "age", items: AGE_CATEGORIES },
    { label: "Migration", mode: "migration", items: MIGRATION_CATEGORIES },
    {
      label: "Region",
      mode: "region",
      items: legendEntriesFor("region").map(([label, color]) => ({
        key: label,
        label,
        color,
      })),
    },
    {
      label: "Income group",
      mode: "income",
      items: legendEntriesFor("income").map(([label, color]) => ({
        key: label,
        label,
        color,
      })),
    },
  ];

  const result =
    sections.map(({ label: sectionLabel, mode, items }) => {
    const section = document.createElement("div");
    section.className = "detail-nav-section";
    const heading = document.createElement("div");
    heading.className = "detail-nav-section-label";
    heading.textContent = sectionLabel;
    section.append(
      heading,
      ...items.map((item) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "detail-nav-item";
        button.dataset.mode = mode;
        button.dataset.key = item.key;
        button.dataset.label = item.label;
        button.dataset.color = item.color;
        if (item.sortKey) button.dataset.sortKey = item.sortKey;
        if (item.sortDirection) button.dataset.sortDirection = item.sortDirection;
        button.classList.toggle(
          "active",
          appState.selectedLegend?.mode === mode && appState.selectedLegend?.key === item.key,
        );
        button.textContent = displayGroupLabel(item.label);
        return button;
      }),
    );
    return section;
  });

  return result;
}

// The detail panel's own left-column nav — unlike the outer #legend
// sidebar (which shows only one of region/income, picked via #appState.colorMode),
// this lists all four groupings side by side so a reader can jump straight
// from e.g. "Aged society" to "Europe & Central Asia" without leaving the
// panel. Re-rendered on every renderDetailPanel() call so its "active" item
// stays in sync with whichever group is currently shown.
function renderDetailNav() {
  if (!elements.detailNav) return;
  elements.detailNav.replaceChildren(...getDetailNav());
}

function metricFor(country, key) {
  return countryDemographicMetrics?.countries?.[country.iso3]?.[key]?.[
    appState.currentYearIndex
  ];
}

function selectedCountries() {
  if (!appState.selectedLegend) return [];
  return selectDetailCountries({
    countries: countriesData,
    legend: appState.selectedLegend,
    columns: detailColumns(),
    sort: appState.detailSort,
    metricFor,
  });
}

// Single source of truth for the detail-panel table: each column knows how
// to read its own sort value (used both for sorting and for the population
// ratio bar) and how to format it for display. Header cells are generated
// from this list too, so clicking one always lines up with the right column.
// Age/migration groupings get their own curated metric set instead of the
// full region/income column list, since most of those columns wouldn't be
// relevant to (e.g.) a "Migration inflow" cohort.
function detailColumns() {
  const metricKeys =
    appState.selectedLegend?.mode === "age"
      ? AGE_COLUMN_KEYS
      : appState.selectedLegend?.mode === "migration"
        ? MIGRATION_COLUMN_KEYS
        : undefined;
  // Age/migration curated tables show the subgroup's own population (e.g.
  // Super-aged society's 65+ headcount) rather than each country's total —
  // region/income keep the plain country total.
  const populationFor =
    appState.selectedLegend?.mode === "age" || appState.selectedLegend?.mode === "migration"
      ? (country) =>
          subgroupPopulationFor(appState.selectedLegend, {
            population: activePopulationAt(country),
            olderPopulationShare: metricFor(country, "olderPopulationShare"),
            youthDependencyRatio: metricFor(country, "youthDependencyRatio"),
            ageDependencyRatio: metricFor(country, "ageDependencyRatio"),
            netMigrationRate: metricFor(country, "netMigrationRate"),
          })
      : activePopulationAt;
  const populationLabel =
    appState.selectedLegend?.mode === "age" || appState.selectedLegend?.mode === "migration"
      ? subgroupPopulationLabelFor(appState.selectedLegend)
      : undefined;
  return buildDetailColumns({
    currentYearIndex: appState.currentYearIndex,
    metricFor,
    metricKeys,
    populationFor,
    populationLabel,
  });
}

function setDetailSort(key) {
  const next = nextSortState(appState.detailSort, key, detailColumns());
  if (!next) return;
  appState.detailSort = next;
  renderDetailPanel();
}

// Keeps other UI in sync with the detail panels' visibility. Switching view
// mode while either panel is open would rebuild the active dot set out from
// under its population-ratio bars and callout anchors mid-read, so the
// toggle is disabled whenever one is visible; the body class lets
// stylesheets target "detail panel open" state generally (layout, canvas
// dimming, etc.) without every consumer re-deriving it from the panels.
function updateViewModeAvailability() {
  const groupDetailOpen = !elements.detailPanel.hidden;
  const countryDetailOpen = !elements.countryPanel.hidden;
  const isOpen = groupDetailOpen || countryDetailOpen;
  elements.viewMode.querySelectorAll("button").forEach((btn) => {
    btn.disabled = isOpen;
  });
  const nextUiState = updateUiState({ groupDetailOpen, countryDetailOpen });
  if (!nextUiState.menuOpen) {
    elements.menuToggle.setAttribute("aria-expanded", "false");
  }
}

function renderDetailPanel() {
  // A country drill-down (from a row click or a dot click) takes over the
  // country panel; re-running this on the next year change would otherwise
  // stomp it back to the group table.
  if (!appState.selectedLegend || appState.selectedCountry || appState.currentYearIndex < 0) return;
  // Group tables use demographic columns that are no longer part of the
  // initial Globe payload. Opening a group is their first-use boundary;
  // ensureCountryDemographics() memoizes the request and re-renders this
  // panel when it resolves.
  if (!countryDemographicMetrics) ensureCountryDemographics();

  const columns = detailColumns();
  const countries = selectedCountries();
  const year = yearsData[appState.currentYearIndex];
  elements.detailPanel.style.setProperty(
    "--detail-color",
    appState.selectedLegend.color,
  );
  elements.detailTitle.textContent = displayGroupLabel(appState.selectedLegend.label);
  elements.detailSubtitle.textContent = `${countries.length} countries · ${year}`;
  renderDetailNav();

  renderSortableTable({
    headerEl: elements.detailHeader,
    rowsEl: elements.detailRows,
    columns,
    sort: appState.detailSort,
    countries,
    barMode: "country-cell",
    barMetric: "population",
    onSort: setDetailSort,
    onRowClick: openCountryDetail,
  });
  countryOverlay.close({ restoreFocus: false });
  detailOverlay.open({ focus: false });
  updateViewModeAvailability();
  updateStatusPanel(year, { groupCountries: countries });
}

function closeDetailPanel() {
  countryDetailController.reset();
  appState.selectedLegend = null;
  appState.selectedCountry = null;
  detailOverlay.close();
  countryOverlay.close();
  updateViewModeAvailability();
  renderLegend();
  // Match chart-view close behavior: the underlying global status was
  // already established before opening the detail overlay, so restore it
  // immediately instead of replaying the typewriter animation.
  if (appState.currentYearIndex >= 0) {
    updateStatusPanel(yearsData[appState.currentYearIndex], { instant: true });
  }
  // If this country/group detail was opened from inside Chart or Cluster
  // (a table row click, or a cluster-particle click), restore that mode
  // instead of always landing back on whichever of Globe/Map is
  // underneath — this is the single place both navigation paths (a direct
  // close, and closeCountryDetail()'s fallback once there's no group table
  // left to return to) funnel through on their way fully out. Each of the
  // set*Active(true) calls below does its own syncUrlFromState(), so the
  // plain call at the end only runs when there's nothing to restore.
  const restoreMode = appState.detailEntryMode;
  appState.detailEntryMode = null;
  if (restoreMode === "chart") {
    setChartPanelActive(true);
  } else if (restoreMode === "cluster") {
    setClusterActive(true);
  } else if (restoreMode === "search") {
    // Back to the bare list: drop the chip but stay in search view.
    appState.searchSelectedIso3 = null;
    renderSearchCountryChip();
    syncUrlFromState();
  } else if (restoreMode === "lifetime") {
    // preserveStory: true — the story's DOM/scroll position was left exactly
    // as it was (see the "Explore Country's Dataset" onOpenCountry callback),
    // so this just makes the same section visible again.
    setLifetimeActive(true, { preserveStory: true });
  } else {
    syncUrlFromState();
  }
}

function openInfoPanel() {
  infoOverlay.open();
  updateUiState({ infoOpen: true });
  elements.menuToggle.setAttribute("aria-expanded", "false");
}

function closeInfoPanel() {
  infoOverlay.close();
  updateUiState({ infoOpen: false });
}

// Returns to the group table this country was opened from (if any),
// otherwise closes the whole panel — mirrors closeDetailPanel()'s job but
// one level up the navigation stack.
function closeCountryDetail() {
  countryDetailController.reset();
  appState.selectedCountry = null;
  if (appState.selectedLegend) {
    renderDetailPanel();
  } else {
    closeDetailPanel();
  }
  syncUrlFromState();
}

// --- Deep linking ---------------------------------------------------------
// Mirrors "which page am I looking at" into the URL query string (via
// replaceState, so it doesn't spam browser history with every year the
// slider passes through) so a copied link reopens to the same view —
// country/group detail, or the chart view with its metric and selected
// countries — instead of always landing back on the plain globe.
function urlStateFromApp() {
  const state = { mode: appState.viewMode, projection: projectionData.scenario() };
  if (appState.chartPanelActive) {
    Object.assign(state, { view: "chart", metric: appState.chartMetricKey, countries: appState.selectedChartCountries });
  } else if (appState.clusterActive) {
    Object.assign(state, { view: "cluster" });
  } else if (appState.searchActive) {
    Object.assign(state, {
      view: "search",
      ...(appState.searchSelectedIso3 ? { country: appState.searchSelectedIso3 } : {}),
    });
  } else if (lifetimeController?.isActive()) {
    lifetimeController.applyToUrlState(state);
  } else if (appState.selectedCountry) {
    Object.assign(state, { view: "country", country: appState.selectedCountry.iso3 });
  } else if (appState.selectedLegend) {
    Object.assign(state, { view: "group", groupMode: appState.selectedLegend.mode, group: appState.selectedLegend.key });
  }
  if (appState.currentYearIndex >= 0) state.year = yearsData[appState.currentYearIndex];
  return state;
}

function syncUrlFromState() {
  const query = serializeUrlState(urlStateFromApp());
  const url = `${window.location.pathname}${query ? `?${query}` : ""}`;
  window.history.replaceState(null, "", url);
}

// Applied once at startup, after the default year and legend have already
// rendered — it only overrides that default when the URL actually asks for
// something, so a plain visit behaves exactly as it always has. Takes the
// search string as an argument (captured before init() started calling
// syncUrlFromState()) rather than reading window.location.search live,
// since by this point that's already been overwritten with default state.
function applyUrlStateFromLocation(search) {
  const state = parseUrlState(search, {
    years: yearsData,
    countryCodes: countriesData.map((country) => country.iso3),
  });
  if (state.projection) setProjectionScenario(state.projection, { sync: false });
  if (state.year != null) goToYear(state.year);
  if (state.mode === "map") sceneController.setViewMode("map");

  if (state.view === "chart") {
    if (state.countries.length) appState.selectedChartCountries = state.countries;
    // Countries/metric are settled before the panel opens, so its own
    // renderChart({ animate: true }) call is both the first one that
    // reflects the deep-linked state and the only one that's actually
    // visible — no need for a redundant plain re-render after it.
    if (state.metric) chartController.setMetric(state.metric);
    chartController.renderCountryChips();
    setChartPanelActive(true);
  } else if (state.view === "cluster") {
    setClusterActive(true);
  } else if (state.view === "search") {
    setSearchActive(true);
    if (state.country) selectSearchCountry(state.country);
  } else if (state.view === "lifetime") {
    lifetimeRequestedActive = true;
    ensureCountryDemographics();
    ensureCountryTrajectory();
    ensureCountryAgeStructure();
    ensureLifetimeController().then((controller) => {
      if (!lifetimeRequestedActive) return;
      controller.applyUrlState(state);
      controller.setActive(true);
    });
  } else if (state.view === "country") {
    const country = countriesData.find((c) => c.iso3 === state.country);
    if (country) openCountryDetail(country);
  } else if (state.view === "group") {
    if (state.groupMode === "region" || state.groupMode === "income") {
      if (state.groupMode !== appState.colorMode) setColorMode(state.groupMode);
      const entry = legendEntriesFor(state.groupMode).find(
        ([label]) => label === state.group,
      );
      if (entry) selectLegendItem(entry[0], entry[1]);
    } else {
      const categories =
        state.groupMode === "age" ? AGE_CATEGORIES : MIGRATION_CATEGORIES;
      const category = categories.find((c) => c.key === state.group);
      if (category) {
        selectDetailGroup(
          state.groupMode,
          category.key,
          category.label,
          category.color,
          category.sortKey,
          category.sortDirection,
        );
      }
    }
  }
}

function selectLegendItem(label, color, mode = appState.colorMode) {
  if (appState.selectedLegend?.mode === mode && appState.selectedLegend?.key === label) {
    // closeDetailPanel();
    return;
  }

  appState.detailSort = { key: 'population', direction: "desc" };

  tourController.stop();
  appState.selectedLegend = { mode, key: label, label, color };
  renderLegend(mode);
  renderDetailPanel();
  syncUrlFromState();
}

// Selects an age/migration cohort from the detail panel's own nav — unlike
// selectLegendItem (region/income, shared with the outer #legend sidebar),
// this never touches the outer legend, since "age"/"migration" aren't modes
// it knows how to render. `sortKey`/`sortDirection`, when given, are the
// metric and direction that actually explain the category (e.g. descending
// oldAgeDependencyRatio for "Aged society", or ascending netMigrationRate
// for "Migration outflow" so the strongest — most negative — outflows sort
// first), so the table opens sorted by the number that matters instead of
// always falling back to population.
function selectDetailGroup(mode, key, label, color, sortKey, sortDirection) {
  if (appState.selectedLegend?.mode === mode && appState.selectedLegend?.key === key) {
    // closeDetailPanel();
    return;
  }
  tourController.stop();
  appState.selectedLegend = { mode, key, label, color };
  if (sortKey) {
    appState.detailSort = { key: sortKey, direction: sortDirection ?? "desc" };
  }
  renderDetailPanel();
  syncUrlFromState();
}

// --- Country detail view ------------------------------------------------
// A single-country drill-down that replaces the 3D canvas area with charts
// (same fixed/glass panel the group table uses) — entered by clicking a dot
// on the globe/map, or a row inside the group table above.

// --- Chart view (Globe/Map's third mode) ---------------------------------
// A full-width multi-country trend chart, independent of the 3D dot scene
// and the single-year snapshot the rest of the app is built around. Most of
// its logic lives in chart-controller.mjs; script.js retains only the
// app-level orchestration below (tooltip wrappers shared with Cluster,
// overlay wiring, and the entry points into/out of the full country detail
// panel).
function showChartTooltip(event, text, color = null) {
  showTooltipLine(elements.chartTooltip, event, text, color);
}

function hideChartTooltip() {
  hideTooltipElement(elements.chartTooltip);
}

// Cluster-only: shows an archetype's full description on hovering its
// canvas-drawn title — a dedicated element rather than reusing
// #chartTooltip, since that one's compact single-line pill styling is used
// broadly elsewhere (chart lines, sparklines, cluster particles) and this
// needs to wrap a full paragraph instead.
function showClusterArchetypeTooltip(event, archetype) {
  const definition = CLUSTER_ARCHETYPES[archetype];
  if (!definition) return;
  const summary = document.createElement("p");
  summary.className = "tooltip-summary";
  summary.textContent = definition.summary;
  showTooltipContent(elements.clusterArchetypeTooltip, event, summary);
}

function hideClusterArchetypeTooltip() {
  hideTooltipElement(elements.clusterArchetypeTooltip);
}

const detailOverlay = createOverlayController({
  panel: elements.detailPanel,
  labelledBy: elements.detailTitle.id,
  // Focus the panel itself, not the close button — the panel appearing is
  // already an obvious visual cue, so a button-shaped focus ring on open
  // would just be a distraction. The panel is still a real Tab stop
  // (tabIndex -1, set by the controller), so keyboard users can Tab from
  // there into the close button and the rest of the panel's controls.
  initialFocus: () => null,
  requestClose: closeDetailPanel,
});
const countryOverlay = createOverlayController({
  panel: elements.countryPanel,
  labelledBy: elements.countryTitle.id,
  initialFocus: () => null,
  requestClose: closeCountryDetail,
});
const infoOverlay = createOverlayController({
  panel: elements.infoPanel,
  labelledBy: "settingsTitle",
  trigger: elements.infoButton,
  scrim: elements.menuShim,
  initialFocus: () => elements.infoClose,
  requestClose: closeInfoPanel,
});

const countryDetailController = createCountryDetailController({
  elements,
  getYears: () => yearsData,
  getCurrentYearIndex: () => appState.currentYearIndex,
  setCurrentYearIndex: (index) => {
    appState.currentYearIndex = index;
  },
  getHistoricalCutoffYear: () => appState.historicalCutoffYear,
  getCountries: () => countriesData,
  getPopulationSeries: activePopulationSeries,
  getColorMode: () => appState.colorMode,
  getDemographicMetrics: () => countryDemographicMetrics,
  getAgeStructure: () => countryAgeStructure,
  colorFor: sceneController.colorFor,
  formatPopulation: formatPeakPopulation,
  easeOut: easeOutCubic,
  chartLineGrowMs: CHART_LINE_GROW_MS,
  chartMarkerFadeInMs: CHART_MARKER_FADE_IN_MS,
  updateStatusPanel,
  updateViewModeAvailability,
  stopTour: () => tourController.stop(),
  goToYear,
  showTooltip: showChartTooltip,
  hideTooltip: hideChartTooltip,
  onOpenCountry: openCountryDetail,
});

function openCountryDetail(country) {
  if (!country || appState.currentYearIndex < 0) return;
  ensureCountryDemographics();
  ensureCountryAgeStructure();
  // A row click in the chart view's own table drills into the same full
  // country detail panel the group table uses — that panel and the chart
  // overlay are both full-screen, so the chart has to step aside first.
  // Remembered (see appState.detailEntryMode) so closing back out restores Chart
  // instead of landing on whichever of Globe/Map is underneath.
  if (appState.chartPanelActive) {
    appState.detailEntryMode = "chart";
    setChartPanelActive(false);
  }
  tourController.stop();
  appState.selectedCountry = country;
  elements.tooltip.hidden = true;
  recordRecentCountry(country.iso3);
  renderCountryDetail();
  syncUrlFromState();
}

function renderCountryDetail(options = { animate: true }) {
  const country = appState.selectedCountry;
  if (!country || appState.currentYearIndex < 0) return;
  assertElements(elements, COUNTRY_DETAIL_ELEMENT_KEYS, "country detail");
  // Both chart builders derive their viewBox from the rendered SVG size.
  // Make the panel measurable before building them; rendering while hidden
  // makes clientWidth/clientHeight zero and forces fallback dimensions that
  // `preserveAspectRatio="none"` then stretches into the responsive layout.
  detailOverlay.close({ restoreFocus: false });
  countryOverlay.open({ focus: false });
  countryDetailController.render(country, options);
  if (options.animate !== false) countryOverlay.open();
  updateViewModeAvailability();
}

function setProjectionScenario(scenario, { sync = true } = {}) {
  if (!isProjectionScenario(scenario)) return;
  if (scenario === projectionData.scenario()) {
    if (elements.chartProjectionScenario) {
      elements.chartProjectionScenario.value = scenario;
    }
    if (sync) syncUrlFromState();
    return;
  }
  projectionData.setScenario(scenario);
  if (elements.chartProjectionScenario) {
    elements.chartProjectionScenario.value = scenario;
  }

  if (appState.chartPanelActive) {
    chartController.renderChart();
    chartController.renderTable();
    setProjectionScenarioLabel(badgeLabel());
  } else if (appState.clusterActive) {
    clusterController.refreshData(appState.currentYearIndex);
    if (appState.currentYearIndex >= 0) updateYearLabels(yearsData[appState.currentYearIndex]);
  } else if (lifetimeController?.isActive()) {
    lifetimeController.render();
    if (appState.currentYearIndex >= 0) updateYearLabels(yearsData[appState.currentYearIndex]);
  } else if (appState.currentYearIndex >= 0) {
    applyYear(yearsData[appState.currentYearIndex], { instant: true });
    if (appState.selectedCountry) renderCountryDetail({ animate: false });
  }

  if (sync) syncUrlFromState();
}

// Population comes from the dots dataset (same series peakYear/dots are
// built from); every other chart metric comes from the demographics file,
// keyed and indexed identically to yearsData.
const chartController = createChartController({
  elements,
  getCountries: () => countriesData,
  getYears: () => yearsData,
  getDemographicMetrics: () => countryDemographicMetrics,
  getPopulationSeries: activePopulationSeries,
  getSelectedCountries: () => appState.selectedChartCountries,
  getMetricKey: () => appState.chartMetricKey,
  setMetricKey: (key) => {
    appState.chartMetricKey = key;
  },
  getCurrentYearIndex: () => appState.currentYearIndex,
  setCurrentYearIndex: (index) => {
    appState.currentYearIndex = index;
  },
  getHistoricalCutoffYear: () => appState.historicalCutoffYear,
  getPickerExpanded: () => appState.chartCountryPickerExpanded,
  setPickerExpanded: (expanded) => {
    appState.chartCountryPickerExpanded = expanded;
  },
  getTableSort: () => appState.chartTableSort,
  setTableSort: (sort) => {
    appState.chartTableSort = sort;
  },
  showTooltip: showChartTooltip,
  hideTooltip: hideChartTooltip,
  stopTour: () => tourController.stop(),
  commitYear: goToYear,
  onOpenCountry: openCountryDetail,
  syncUrl: syncUrlFromState,
});

let searchCountryCombobox;

// --- Cluster view (physics-based demographic clustering) -----------------
// Canvas rendering, physics, hit-testing, and phase-specific annotations live
// in cluster-controller.mjs. This file retains only app-level view orchestration.
const clusterController = createClusterController({
  canvas: elements.clusterCanvas,
  getCountries: () => countriesData,
  getYears: () => yearsData,
  chartSeriesFor: chartController.chartSeriesFor,
  valueAtYear: chartController.valueAtFractionalYear,
  colorFor: (country, mode) =>
    `#${sceneController.colorFor(country, mode).getHexString()}`,
  showTooltip: showChartTooltip,
  hideTooltip: hideChartTooltip,
  showArchetypeTooltip: showClusterArchetypeTooltip,
  hideArchetypeTooltip: hideClusterArchetypeTooltip,
  onCountryClick: (country) => {
    // Remembered (see appState.detailEntryMode) so closing the detail panel back
    // out restores Cluster instead of landing on whichever of Globe/Map
    // is underneath.
    appState.detailEntryMode = "cluster";
    setClusterActive(false);
    openCountryDetail(country);
  },
});

// Shared by every setXActive(active) toggle below (and the initial
// bind-events setup) — #appState.viewMode stays visible while a full-screen overlay
// (Search/Chart/Cluster) is open rather than being hidden behind it, so its
// "active" highlight has to track that overlay's own mode string instead of
// just the underlying Globe/Map appState.viewMode.
function syncViewModeButtons(activeMode) {
  elements.viewMode.querySelectorAll("button").forEach((btn) =>
    btn.classList.toggle("active", btn.dataset.mode === activeMode),
  );
}

const clusterViewLifecycle = createClusterViewLifecycle({
  state: appState,
  view: elements.clusterView,
  updateUiState,
  assertReady: () =>
    assertElements(elements, ["clusterView", "clusterCanvas"], "cluster view"),
  syncModeButtons: syncViewModeButtons,
  underlyingMode: () => appState.viewMode,
  stopTour: () => tourController.stop(),
  enter: () => {
    ensureCountryDemographics();
    updateColorModeControls(clusterController.getColorMode());
    renderLegend();
    clusterController.activate(appState.currentYearIndex);
    if (appState.currentYearIndex >= 0) {
      applyClusterStatus(yearsData[appState.currentYearIndex]);
    }
  },
  exit: () => {
    stopClusterPlayback();
    clusterController.deactivate();
    updateColorModeControls(appState.colorMode);
    renderLegend();
    // Forces the next applyClusterStatus() call (reactivating, possibly at
    // a different year) to treat it as a fresh chapter instead of a no-op
    // just because it happens to match whatever was cached from this visit.
    appState.clusterStatusPeriod = null;
    if (appState.currentYearIndex >= 0) {
      // Cluster took applyYear()'s cheap fast path (see there) while open,
      // leaving the 3D scene stale — catch it up now that it's visible
      // again.
      applyYear(yearsData[appState.currentYearIndex], { instant: true });
    }
  },
  syncUrl: syncUrlFromState,
});

function setClusterActive(active) {
  clusterViewLifecycle.setActive(active);
}

function setLifetimeActive(active, options) {
  lifetimeRequestedActive = active;
  if (active) {
    ensureCountryDemographics();
    ensureCountryTrajectory();
    ensureCountryAgeStructure();
    return ensureLifetimeController().then((controller) => {
      if (lifetimeRequestedActive) controller.setActive(true, options);
    });
  }
  lifetimeController?.setActive(active, options);
}

async function ensureLifetimeController() {
  if (lifetimeController) return lifetimeController;
  lifetimeControllerPromise ??= import("./lifetime-controller.mjs").then(
    ({ createLifetimeController }) => {
      lifetimeController = createLifetimeController({
        elements,
        getCountryTrajectory: () => countryTrajectory,
        getCountries: () => countriesData,
        getYears: () => yearsData,
        getGlobalMetricsByYear: activeGlobalMetricsMap,
        getPopulationSeries: activePopulationSeries,
        getProjectionScenario: () => projectionData.scenario(),
        getCountryDemographicMetrics: () => countryDemographicMetrics,
        getCountryAgeStructure: () => countryAgeStructure,
        getViewMode: () => appState.viewMode,
        formatPopulation: formatPeakPopulation,
        goToYear,
        syncUrl: syncUrlFromState,
        stopTour: () => tourController.stop(),
        catchUpScene: () => {
          if (appState.currentYearIndex >= 0) {
            applyYear(yearsData[appState.currentYearIndex], { instant: true });
          }
        },
        updateUiState,
        onOpenCountry: (country) => {
          appState.detailEntryMode = "lifetime";
          setLifetimeActive(false, { preserveStory: true });
          openCountryDetail(country);
        },
        onActiveSectionChange: setProjectionScenarioLabel,
      });
      lifetimeController.bindEvents();
      lifetimeController.setBirthYearMax();
      return lifetimeController;
    },
  );
  return lifetimeControllerPromise;
}

// --- Recently viewed countries ---------------------------------------------
// Persisted across sessions (localStorage) so the search bar can offer a
// quick way back in before the user has typed anything. Recorded from
// openCountryDetail() — the single funnel every entry point (search, group
// table, dot clicks, similar-countries, the Lifetime "Explore Dataset" link,
// deep-linked URLs) already opens a country detail through.
const RECENT_COUNTRIES_STORAGE_KEY = "recentCountries";
const RECENT_COUNTRIES_LIMIT = 5;

function getRecentCountryIsos() {
  try {
    const stored = JSON.parse(
      localStorage.getItem(RECENT_COUNTRIES_STORAGE_KEY) ?? "[]",
    );
    return Array.isArray(stored) ? stored : [];
  } catch {
    return [];
  }
}

function recordRecentCountry(iso3) {
  if (!iso3) return;
  const withoutCurrent = getRecentCountryIsos().filter(
    (code) => code !== iso3,
  );
  const next = [iso3, ...withoutCurrent].slice(0, RECENT_COUNTRIES_LIMIT);
  try {
    localStorage.setItem(RECENT_COUNTRIES_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable (private browsing, quota, etc.) — recent-countries
    // is a convenience, not core functionality, so just skip persisting.
  }
}

// Resolved against the live country list (rather than trusted blindly) so a
// stale iso3 from an older dataset version can't produce a broken entry.
function getRecentCountries() {
  const isos = getRecentCountryIsos();
  return isos
    .map((iso3) => countriesData.find((country) => country.iso3 === iso3))
    .filter(Boolean);
}

// --- Search view ----------------------------------------------------------
// A full, alphabetized country list plus a single-select chip search bar.
// Picking a country (from the list or the search box) opens the shared
// country-detail overlay on top; the button dock and search bar stay pinned
// (see the body.view-search.detail CSS override) so the chip's X is the way
// back to the bare list.
const SEARCH_SUGGESTION_LIMIT = 8;

const searchViewLifecycle = createSearchViewLifecycle({
  state: appState,
  view: elements.searchView,
  bar: elements.searchBar,
  updateUiState,
  assertReady: () =>
    assertElements(
      elements,
      ["searchView", "searchBar", "searchCategoryGrid", "searchCountryGrid", "searchCountryInput"],
      "search view",
    ),
  syncModeButtons: syncViewModeButtons,
  underlyingMode: () => appState.viewMode,
  stopTour: () => tourController.stop(),
  prepare: () => {
    appState.searchSelectedIso3 = null;
    renderCategoryGrid();
    renderSearchCountryGrid();
    renderSearchCountryChip();
    elements.searchCountryInput.value = "";
    searchCountryCombobox?.hide();
  },
  teardown: () => {
    // Leaving search entirely tears down any open detail this view opened,
    // without routing through closeDetailPanel() (whose "search" restore
    // would just reactivate this view). appState.detailEntryMode is cleared first for
    // the same reason.
    if (appState.selectedCountry && appState.detailEntryMode === "search") {
      appState.detailEntryMode = null;
      countryDetailController.reset();
      appState.selectedCountry = null;
      countryOverlay.close({ restoreFocus: false });
      updateViewModeAvailability();
      renderLegend();
      if (appState.currentYearIndex >= 0) {
        updateStatusPanel(yearsData[appState.currentYearIndex], { instant: true });
      }
    }
    appState.searchSelectedIso3 = null;
    renderSearchCountryChip();
  },
  syncUrl: syncUrlFromState,
});

function setSearchActive(active) {
  searchViewLifecycle.setActive(active);
}

function renderCategoryGrid() {
  // const categories = [...AGE_CATEGORIES, ...MIGRATION_CATEGORIES];
  // let items = categories.map((item, index) => {
  //   const button = document.createElement("button");
  //   button.className = "search-category-item";
  //   button.dataset.mode = item.mode;
  //   button.dataset.key = item.key;
  //   button.dataset.label = item.label;
  //   button.dataset.color = item.color;
  //   if (item.sortKey) button.dataset.sortKey = item.sortKey;
  //   if (item.sortDirection) button.dataset.sortDirection = item.sortDirection;
  //   button.textContent = displayGroupLabel(item.label);
  //   return button;
  // });
  const items = getDetailNav();
  elements.searchCategoryGrid.replaceChildren(...items);
}

function renderSearchCountryGrid() {
  const sortedCountries = [...countriesData].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  preloadFlagIcons(sortedCountries.map((country) => country.iso3));
  const items = sortedCountries
    .map((country, index) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "search-country-item";
      item.dataset.iso3 = country.iso3;
      const flag = document.createElement("span");
      flag.className = "search-country-item-flag";
      flag.style.backgroundImage = `url(${flagIconUrl(country.iso3)})`;
      const label = document.createElement("span");
      label.textContent = country.name;
      item.append(flag, label);
      return item;
    });
  elements.searchCountryGrid.replaceChildren(...items);
}

function renderSearchCountryChip() {
  const country =
    appState.searchSelectedIso3 &&
    countriesData.find((c) => c.iso3 === appState.searchSelectedIso3);
  elements.searchCountryPicker.classList.toggle("has-selection", !!country);
  if (!country) {
    elements.searchCountryChips.replaceChildren();
    return;
  }
  preloadFlagIcons([country.iso3]);
  const chip = document.createElement("span");
  chip.className = "chip";
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
  elements.searchCountryChips.replaceChildren(chip);
}

function selectSearchCountry(iso3) {
  const country = countriesData.find((c) => c.iso3 === iso3);
  if (!country) return;
  appState.searchSelectedIso3 = iso3;
  renderSearchCountryChip();
  elements.searchCountryInput.value = "";
  searchCountryCombobox?.hide();
  // Remembered so closeDetailPanel() returns here (see its "search" branch)
  // rather than to whichever of Globe/Map is underneath.
  appState.detailEntryMode = "search";
  openCountryDetail(country);
}

// A category tile in the search view's grid opens the same group-detail
// panel #detailNav's own age/migration items do — same as selectSearchCountry
// above, appState.detailEntryMode is set first so closing the panel comes back here
// instead of Globe/Map.
function selectSearchCategory(mode, key, label, color, sortKey, sortDirection) {
  appState.detailEntryMode = "search";
  selectDetailGroup(mode, key, label, color, sortKey, sortDirection);
}

// Both ways out of a selection — the chip's X and the detail panel's own
// close button — funnel through closeDetailPanel()'s "search" restore, which
// clears the chip and re-shows the list.
function clearSearchCountry() {
  if (appState.selectedCountry && appState.detailEntryMode === "search") {
    closeDetailPanel();
  } else {
    appState.searchSelectedIso3 = null;
    renderSearchCountryChip();
    syncUrlFromState();
  }
  elements.searchCountryInput?.focus();
}


function capitalizeFirstLetter(str) {
  if (!str) return ""; // Handle empty strings safely
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function badgeLabel() {
  return yearsData[appState.currentYearIndex] < appState.historicalCutoffYear
    ? `Historical`
    : `${capitalizeFirstLetter(projectionData.scenario())} Projection`;
}

// Shared top-center "Historical" / "{Scenario} Projection" indicator for
// Chart view (driven by year changes below) and Lifetime view (driven by
// lifetime-controller.mjs's onActiveSectionChange dep, since its acts aren't
// tied to the global year slider). null hides it.
function setProjectionScenarioLabel(text) {
  if (!elements.projectionScenarioLabel) return;
  elements.projectionScenarioLabel.textContent = text ?? "";
  elements.projectionScenarioLabel.hidden = !text;
}

// Chart is a full-screen overlay, not a real member of the Globe/Map
// toggle's selection state — opening it never touches which of those two
// is "active", so whichever was selected before is still the one shown
// (and still marked active) once the overlay closes.
const chartViewLifecycle = createChartViewLifecycle({
  state: appState,
  panel: elements.chartPanel,
  updateUiState,
  assertReady: () =>
    assertElements(elements, CHART_VIEW_ELEMENT_KEYS, "chart view"),
  syncModeButtons: syncViewModeButtons,
  underlyingMode: () => appState.viewMode,
  stopTour: () => tourController.stop(),
  render: () => {
    ensureCountryDemographics();
    chartController.renderChart({ animate: true });
    chartController.renderTable();
    setProjectionScenarioLabel(badgeLabel());
  },
  closeCountryPicker: () => {
    // Always reopens collapsed, regardless of how it was left — an editor
    // left expanded from last time isn't state worth remembering the way
    // the selected countries themselves are.
    chartController.setCountryPickerExpanded(false);
  },
  cancelAnimation: () => chartController.cancelAnimation(),
  catchUpScene: () => {
    setProjectionScenarioLabel(null);
    if (appState.currentYearIndex < 0) return;
    // While the overlay was open, applyYear() took its chart-only fast path
    // and left the 3D scene stale (still showing whatever year it had
    // before) — catch it up now that it's visible again. instant: true
    // skips #status's typewriter replay here — chart view already showed
    // this year's own text (via renderChart/renderTable) the whole time, so
    // retyping it from scratch on close would just be redundant animation.
    applyYear(yearsData[appState.currentYearIndex], { instant: true });
  },
  syncUrl: syncUrlFromState,
});

function setChartPanelActive(active) {
  chartViewLifecycle.setActive(active);
}

const THEME_STORAGE_KEY = "theme"; // must match the inline <head> script in index.html

function updateThemeToggleUI() {
  const isLight = appState.currentTheme === "light";
  elements.themeToggle?.setAttribute(
    "aria-pressed",
    String(!isLight),
  );
  elements.themeToggleLight?.setAttribute("aria-pressed", String(isLight));
  elements.themeToggle?.classList.toggle("active", !isLight);
  elements.themeToggleLight?.classList.toggle("active", isLight);

  const legacyIcon = elements.themeToggle?.querySelector(
    ".material-symbols-outlined",
  );
  if (legacyIcon) {
    elements.themeToggle.setAttribute(
      "aria-label",
      isLight ? "Switch to dark theme" : "Switch to light theme",
    );
    legacyIcon.textContent = isLight ? "dark_mode" : "light_mode";
  }
}

// Most of the app's colors are plain CSS var() references (region/income
// swatches, chart lines, group-detail panels) and repaint for free the
// instant the theme's custom properties change, via the ordinary cascade —
// no JS involved. The few exceptions are values baked into something other
// than a live CSS property at the moment they were built: the GPU dot color
// buffer, cached hover-fill mesh materials, peak-callout label colors,
// (only while a single country's own detail panel is open) --detail-color,
// which is resolved to a literal hex rather than left as a var() reference
// because colorFor() also has to double as a THREE.Color for the globe, and
// the Cluster view's canvas — its archetype titles and particle labels are
// resolveCssColor()'d straight to literal pixels at draw time, which only
// happens on the next simulation tick; once the simulation settles (alpha
// decays to 0) nothing repaints it on its own, so a toggle while Cluster is
// open would otherwise leave stale-theme text frozen on screen.
// Those are exactly what this re-derives and pushes out again.
function applyTheme(theme, { persist = true } = {}) {
  if (theme === appState.currentTheme) return;
  appState.currentTheme = theme;
  document.documentElement.dataset.theme = theme;
  if (persist) localStorage.setItem(THEME_STORAGE_KEY, theme);
  updateThemeToggleUI();

  if (!countriesData.length) return; // toggled before data loaded — nothing baked yet
  sceneController.recomputeThemeColors();
  sceneController.recolor();
  if (appState.currentYearIndex >= 0) {
    sceneController.rebuildCallouts(yearsData[appState.currentYearIndex]);
  }
  if (appState.selectedCountry && !elements.countryPanel.hidden) {
    elements.countryPanel.style.setProperty(
      "--detail-color",
      `#${sceneController.colorFor(appState.selectedCountry).getHexString()}`,
    );
  }
  if (clusterController.isActive()) clusterController.redraw();
  // Chart-view line/legend colors are var() references too, except the chip
  // text color — chosen per-chip by contrast against the chip's background
  // at render time, and *baked in as one of two variable names*
  // (--color-bg/--color-text). Those two swap which one is actually the
  // darker/lighter option between themes, so a decision made before this
  // toggle is now backwards, not just stale — this needs to re-run
  // regardless of whether chart view happens to be open right now, or it
  // stays wrong (inverted, not just outdated) until something else happens
  // to touch the chip list (adding/removing a country).
  chartController.renderCountryChips();
}

function updateColorModeControls(mode) {
  elements.colorMode
    .querySelectorAll("button")
    .forEach((btn) =>
      btn.classList.toggle("active", btn.dataset.mode === mode),
    );
}

function setClusterColorMode(mode) {
  if (mode === clusterController.getColorMode()) return;
  clusterController.setColorMode(mode);
  updateColorModeControls(mode);
  renderLegend();
}

function setColorMode(mode) {
  if (mode === appState.colorMode) return;
  const keepDetailOpen = appState.selectedLegend && !elements.detailPanel.hidden;
  appState.colorMode = mode;
  updateColorModeControls(mode);

  if (keepDetailOpen) {
    // Switching Region/Income while browsing a group's detail should let
    // the user keep exploring, not boot them back to the globe — land on
    // that mode's first legend entry instead of closing the panel.
    const [label, color] = legendEntriesFor(mode)[0];
    appState.selectedLegend = { mode, key: label, label, color };
  } else {
    appState.selectedLegend = null;
    detailOverlay.close({ restoreFocus: false });
    updateViewModeAvailability();
  }
  sceneController.recolor();
  if (keepDetailOpen) renderDetailPanel();
  sceneController.rebuildCallouts(yearsData[appState.currentYearIndex]);
  syncUrlFromState();
}

// The following bind*Events() functions each wire up one cohesive area of
// the UI (year slider, color mode, legend, ...) — split out of init() so
// that function stays a readable top-to-bottom sequence of named steps
// instead of one flat run of ~30 addEventListener calls. Each is called
// exactly once, from init(), in the same order this wiring always ran in.

function bindYearSliderEvents({ minYear, maxYear, defaultYear }) {
  elements.yearSlider.min = minYear;
  elements.yearSlider.max = maxYear;
  elements.yearSlider.step = 1;
  elements.yearSlider.value = defaultYear;
  // elements.yearControl.hidden = false;
  // "input" fires continuously while dragging — kept cheap (thumb/fill
  // tracking plus the year figure itself, so there's still feedback on
  // what year you'd land on) so the slider stays responsive. The actual
  // content update (dot repositioning, status line, metrics, detail
  // panel, callouts) is real work, so it's deferred to "change", which
  // only fires once the drag is released (or after a keyboard step),
  // instead of re-running on every intermediate value.
  elements.yearSlider.addEventListener("input", () => {
    updateSliderProgress();
    updateYearLabels(Number(elements.yearSlider.value));
    // Cluster particles are cheap to reposition (no dot-buffer rewrite
    // like the 3D scene needs), so — unlike the globe/map content below —
    // they get to move live during the drag itself rather than waiting
    // for "change". The chapter caption rides along too (it's cheap: a
    // no-op unless the drag actually crossed into a new period) — without
    // it, dragging from one end of the timeline to the other would show
    // "The Postwar Boom" the entire time and only jump to the right
    // chapter once the drag is released, well after the particles
    // themselves had already moved on.
    if (appState.clusterActive) {
      const year = Number(elements.yearSlider.value);
      clusterController.setYear(year);
      applyClusterStatus(year);
    }
  });
  elements.yearSlider.addEventListener("change", () => {
    applyYear(Number(elements.yearSlider.value));
  });
  // "pointerdown" (not "input"/"change") is the tour's cue to stop, since
  // goToYear() itself only dispatches "input"/"change" — using those to
  // cancel would make the tour immediately cancel its own steps. Same
  // reasoning covers the cluster sweep, which drives the slider the same way.
  elements.yearSlider.addEventListener("pointerdown", () => {
    tourController.stop();
    stopClusterPlayback();
  });
  elements.yearSlider.addEventListener("pointermove", updateYearHoverLabel);
}

function bindColorModeEvents() {
  elements.colorMode.hidden = false;
  elements.colorMode.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (appState.clusterActive) {
        setClusterColorMode(btn.dataset.mode);
      } else {
        setColorMode(btn.dataset.mode);
      }
    });
  });
}

function bindLegendEvents() {
  elements.legend.addEventListener("click", (event) => {
    const item = event.target.closest(".legend-item[data-label]");
    if (!item || !elements.legend.contains(item)) return;
    // Remembered (see appState.detailEntryMode) so closing the detail panel
    // back out restores Cluster instead of landing on whichever of
    // Globe/Map is underneath.
    if (appState.clusterActive) {
      appState.detailEntryMode = "cluster";
      setClusterActive(false);
    }
    selectLegendItem(
      item.dataset.label,
      item.dataset.color,
      item.dataset.mode,
    );
  });
}

function bindDetailNavEvents() {
  elements.detailNav?.addEventListener("click", (event) => {
    const item = event.target.closest(".detail-nav-item[data-key]");
    if (!item || !elements.detailNav.contains(item)) return;
    const { mode, key, label, color, sortKey, sortDirection } = item.dataset;
    if (mode === "region" || mode === "income") {
      selectLegendItem(label, color, mode);
    } else {
      selectDetailGroup(mode, key, label, color, sortKey, sortDirection);
    }
  });
}

function bindViewRouter() {
  elements.viewMode.hidden = false;
  syncViewModeButtons(appState.viewMode);
  const lifetimeViewLifecycle = {
    name: "lifetime",
    isActive: () => lifetimeRequestedActive,
    activate: (options) => setLifetimeActive(true, options),
    deactivate: (options) => setLifetimeActive(false, options),
  };
  const viewRouter = createViewRouter({
    lifecycles: [
      searchViewLifecycle,
      chartViewLifecycle,
      clusterViewLifecycle,
      lifetimeViewLifecycle,
    ],
    setBaseView: sceneController.setViewMode,
    closeMenu: () => {
      updateUiState({ menuOpen: false });
      elements.menuToggle.setAttribute("aria-expanded", "false");
    },
  });
  viewRouter.bind(elements.viewMode);
  // The title doubles as a "go home" control — closes whatever detail
  // panel is open (rather than letting it restore its usual entry-mode
  // overlay) and always lands on Globe specifically, regardless of what
  // was showing before.
  elements.headerTitle.addEventListener("click", () => {
    if (!elements.detailPanel.hidden || !elements.countryPanel.hidden) {
      closeDetailPanel();
    }
    viewRouter.activate("globe");
  });
}

function bindChartControlsEvents() {
  assertElements(elements, CHART_VIEW_ELEMENT_KEYS, "chart controls");
  elements.chartProjectionScenario.value = projectionData.scenario();
  // updateProjectionScenarioVisibility();
  elements.chartProjectionScenario.addEventListener("change", () => {
    const scenario = elements.chartProjectionScenario.value;
    setProjectionScenario(scenario);
  });
  chartController.bindEvents();
  chartController.renderMetricTabs();
  chartController.renderCountryChips();
}

function bindSearchViewEvents() {
  // Search view: full list + single-select chip search bar.
  elements.searchCountryGrid.addEventListener("click", (event) => {
    const item = event.target.closest(".search-country-item[data-iso3]");
    if (!item || !elements.searchCountryGrid.contains(item)) return;
    selectSearchCountry(item.dataset.iso3);
  });
  elements.searchCategoryGrid?.addEventListener("click", (event) => {
    const item = event.target.closest(".detail-nav-item[data-key]");
    if (!item || !elements.searchCategoryGrid.contains(item)) return;
    const { mode, key, label, color, sortKey, sortDirection } = item.dataset;
    if (mode === "region" || mode === "income") {
      appState.detailEntryMode = "search";
      selectLegendItem(label, color, mode);
    } else {
      selectSearchCategory(mode, key, label, color, sortKey, sortDirection);
    }
  });
  elements.searchCountryChips.addEventListener("click", (event) => {
    const button = event.target.closest(".chip-remove[data-iso3]");
    if (!button || !elements.searchCountryChips.contains(button)) return;
    clearSearchCountry();
  });
  searchCountryCombobox = createCountryCombobox({
    input: elements.searchCountryInput,
    list: elements.searchCountrySuggestions,
    container: elements.searchCountryPicker,
    getCandidates: (query) =>
      query
        ? matchCountries(query, {
            countries: countriesData,
            convertCode: convertAlpha3ToAlpha2,
            limit: SEARCH_SUGGESTION_LIMIT,
          })
        : getRecentCountries(),
    onSelect: (country) => selectSearchCountry(country.iso3),
    flagUrl: flagIconUrl,
    preloadFlags: preloadFlagIcons,
    renderPrefix: (query) => {
      if (query) return null;
      const label = document.createElement("div");
      label.className = "chip-suggestions-label";
      label.textContent = "Recently viewed";
      return label;
    },
  });
}

function bindPanelCloseEvents() {
  elements.detailClose.addEventListener("click", closeDetailPanel);
  elements.countryClose.addEventListener("click", closeCountryDetail);
  elements.infoButton.addEventListener("click", openInfoPanel);
  elements.infoClose.addEventListener("click", closeInfoPanel);
  // elements.detailBack.addEventListener("click", () => {
  //   if (appState.selectedCountry) {
  //     closeCountryDetail();
  //   } else {
  //     closeDetailPanel();
  //   }
  // });
}

function bindMilestoneEvents() {
  elements.milestonePrev.addEventListener("click", () => stepMilestone(-1));
  elements.milestoneNext.addEventListener("click", () => stepMilestone(1));
  elements.milestoneTour.addEventListener("click", tourController.toggle);
  // Cluster's own once-through 1950-2100 sweep — a separate button
  // (#clusterPlay, swapped in via CSS for #milestoneTour) rather than this
  // same button branching on appState.clusterActive.
  elements.clusterPlay.addEventListener("click", playClusterTimelineOnce);
  // #exploreMilestones' markup is gone along with the old #milestoneRow —
  // guarded the same way as its .hidden toggle above, rather than
  // assuming it won't come back.
  elements.exploreMilestones?.addEventListener("click", tourController.toggle);
}

function bindMenuEvents() {
  elements.menuToggle.addEventListener("click", () => {
    const { menuOpen } = uiStateRenderer.getState();
    const nextState = updateUiState({ menuOpen: !menuOpen });
    elements.menuToggle.setAttribute(
      "aria-expanded",
      String(nextState.menuOpen),
    );
  });
  elements.menuShim.addEventListener("click", () => {
    updateUiState({ menuOpen: false });
    elements.menuToggle.setAttribute("aria-expanded", "false");
  });
}

function bindThemeEvents() {
  updateThemeToggleUI();
  elements.themeToggle?.addEventListener("click", () => {
    applyTheme("dark");
  });
  elements.themeToggleLight?.addEventListener("click", () => {
    applyTheme("light");
  });
}

async function init() {
  // Captured before anything else runs — applyYear() and friends call
  // syncUrlFromState() as they go, which would otherwise overwrite the
  // deep link's query string with default state before it's ever read.
  const initialSearch = window.location.search;
  try {

    const appData = await loadPopulationData();
    loadCountryDemographicMetrics = appData.loadCountryDemographicMetrics;
    loadCountryTrajectory = appData.loadCountryTrajectory;
    loadCountryAgeStructure = appData.loadCountryAgeStructure;
    sceneController.setLoadCountryBorders(appData.loadCountryBorders);
    countriesData = appData.countries;
    yearsData = appData.years;
    preloadFlagIcons(appState.selectedChartCountries);
    appState.historicalCutoffYear = appData.historicalCutoffYear;
    projectionData.configure({
      countries: countriesData,
      years: yearsData,
      historicalCutoffYear: appState.historicalCutoffYear,
      globalMetricsByYear: appData.globalMetricsByYear,
      globalTrendMilestones: appData.globalTrendMilestones,
      highMetricsByYear: appData.highMetricsByYear,
      lowMetricsByYear: appData.lowMetricsByYear,
    });


    sceneController.setup(countriesData, appData.incomeGroups);
    const initialUrlState = parseUrlState(initialSearch, {
      years: yearsData,
      countryCodes: countriesData.map((country) => country.iso3),
    });
    if (initialUrlState.projection) {
      projectionData.setScenario(initialUrlState.projection);
    }
    sceneController.initializeViewMode(initialUrlState.mode);

    const minYear = yearsData[0];
    const maxYear = yearsData[yearsData.length - 1];
    // Randomized per page load from the same data-driven milestones used in
    // the status copy, rather than maintaining a second hardcoded year list.
    const defaultYears = prioritizedMilestoneYears(activeGlobalTrendMilestones(), {
      minYear,
      maxYear,
    });
    const defaultYear =
      defaultYears[Math.floor(Math.random() * defaultYears.length)] ?? minYear;

    sceneController.bindEvents();
    bindYearSliderEvents({ minYear, maxYear, defaultYear });
    bindColorModeEvents();
    bindLegendEvents();
    bindDetailNavEvents();
    bindViewRouter();
    bindChartControlsEvents();
    bindSearchViewEvents();
    bindPanelCloseEvents();
    bindMilestoneEvents();
    bindMenuEvents();
    bindThemeEvents();

    updateSliderProgress();
    applyYear(defaultYear);
    renderLegend();
    applyUrlStateFromLocation(initialSearch);
  } catch (error) {
    elements.status.textContent = `Could not load data: ${error.message}`;
  }
}

function createDebouncedResizeHandler(callback, delay = 120) {
  let timerId = null;
  return () => {
    clearTimeout(timerId);
    timerId = setTimeout(callback, delay);
  };
}

// Panel/canvas subviews each own their own debounce. Sharing one timer meant
// whichever branch ran last during resize could cancel the others.
const resizeCountryDetail = createDebouncedResizeHandler(() => {
  // Re-checked rather than trusting the `appState.selectedCountry` value at resize
  // event time: the panel can close during the debounce window.
  if (!appState.selectedCountry) return;
  countryDetailController.resize(appState.selectedCountry);
});
const resizeTrendChart = createDebouncedResizeHandler(() =>
  chartController.renderChart(),
);
const resizeCluster = createDebouncedResizeHandler(clusterController.resize);

window.addEventListener("resize", () => {
  sceneController.resize();
  if (appState.currentYearIndex >= 0) {
    updateYearLabels(yearsData[appState.currentYearIndex]);
  }
  if (appState.selectedCountry) {
    resizeCountryDetail();
  }
  if (appState.chartPanelActive) {
    resizeTrendChart();
  }
  if (appState.clusterActive) {
    resizeCluster();
  }
});

init();
sceneController.start();
