// ---------------------------------------------------------------------------
// ARCHIVED — the isometric "Plot" view (Globe/Map/Chart's former fourth
// mode). Superseded by the physics-based Cluster view (cluster-model.mjs,
// cluster-controller.mjs, cluster-layout.mjs, cluster-config.mjs) and no
// longer wired into the running app: its nav button is `hidden` in
// index.html, and every call site that used to reference the functions
// below has been removed from script.js.
//
// This file is not imported anywhere and will not run as-is — it's a
// reference snapshot of a working feature, kept in case the isometric
// layout (fertility/life-expectancy/migration on 3 literal axes, rendered
// as an SVG grid + HTML cards) is ever wanted again. To revive it:
//   1. Re-add the DOM markup and CSS below (also unchanged from when this
//      was pulled out) to index.html/styles.css.
//   2. Re-add the `plotView`/`plotGrid`/`plotCards`/`plotGroups`/
//      `plotGroupMode` bindings to ui-elements.mjs, and the `"plot"` view
//      branches to url-state.mjs's serializeUrlState/parseUrlState.
//   3. Paste the code below back into script.js and wire it back into
//      applyYear, urlStateFromApp, applyUrlStateFromLocation, the
//      countryDemographicMetricsPromise handler, the year slider's
//      "input"/"pointerdown" listeners, the #viewMode click handler, and
//      the resize handler — grep the git history for "plotActive" to see
//      exactly where each branch used to live.
//
// External dependencies this code assumed from script.js's module scope
// (all still defined there — only this Plot-specific code was removed):
//   countriesData, yearsData, currentYearIndex, elements, chartSeriesFor,
//   valueAtFractionalYear (generic linear-interpolation helper — still used
//     by the Cluster view's own valueAtYear callback, so it was NOT moved
//     here; see script.js), colorFor, flagIconUrl, displayGroupLabel,
//   showChartTooltip, hideChartTooltip, svgEl, METRICS, REGION_COLORS,
//   INCOME_GROUP_COLORS, DEFAULT_COLOR, tourController, viewMode,
//   applyYear, goToYear, syncUrlFromState, updateSliderProgress,
//   updateYearLabels.
// ---------------------------------------------------------------------------

// --- Plot view (Globe/Map/Chart's fourth mode) --------------------------
// A hybrid 2D isometric world: a native SVG grid floor + axes, overlaid
// with GPU-accelerated HTML cards (one per country, positioned via CSS
// transform) placed by three demographic metrics at once — fertility (X),
// life expectancy (Y, vertical), and net migration rate (Z). The year
// slider drives every card's position simultaneously, so a trend reads as
// motion through the grid rather than a redrawn chart.
let plotActive = false;
let plotDomains = null; // { fertility: {min,max}, ... } — global across every country/year, computed once
let plotCardsBuilt = false;
let plotCardEntries = []; // [{ country, el }]
let plotLayoutCache = null; // { scale, centerX, centerY } from the last renderPlotGrid()

const PLOT_AXES = { x: "fertility", y: "lifeExpectancy", z: "netMigrationRate" };
// Classic 30° axonometric projection (rotate the ground plane 45°, squash
// vertically) — baked-in constants rather than recomputed every call.
const ISO_COS30 = Math.cos(Math.PI / 6);
const ISO_SIN30 = Math.sin(Math.PI / 6);
// How tall the Y (life expectancy) axis reads relative to the ground
// plane's own diagonal span. 1 keeps the whole iso-space symmetric around
// the origin (see plotLayout), which is what makes centering it in the
// viewport a matter of just centering on iso (0, 0).
const PLOT_HEIGHT_SCALE = 1;
// Kept tight — every pixel handed back here goes straight into scale (see
// plotLayout), which is what actually makes a given year-to-year data
// change move a card further. Sized just wide/tall enough for the
// shortened axis-name labels (PLOT_AXIS_LABELS) plus their min/max
// ticks, not the full METRICS[key].label + value strings used elsewhere.
const PLOT_MARGIN = { top: 60, right: 0, bottom: 0, left: 0 };
const PLOT_GRID_DIVISIONS = 3;
// Depth-sort buckets for z-index (see positionPlotCards) — deliberately
// coarse. z-index has no interpolation, so every reorder is an instant,
// visible cut; a fine-grained bucket count reshuffles ~200 overlapping
// cards on nearly every frame during the region-select timeline sweep
// (playPlotTimelineOnce), which reads as flicker. This few buckets is
// still plenty to keep "further toward the viewer" cards on top — exact
// ordering within a band doesn't matter for a cluster of flag icons.
const PLOT_ZINDEX_BUCKETS = 20;
// With tick values hidden, the axis/grid only need to communicate
// direction, not a precise scale — so cards (not the axis lines or their
// labels, which stay at the literal [0,1] mapping) get stretched away from
// the center of each axis to amplify how far a country's position and
// year-to-year movement actually read. 1 is a no-op; >1 exaggerates.
const PLOT_MOVEMENT_SCALE = 1.1;

function amplifyPlotMovement(normalized) {
  return 0.5 + (normalized - 0.5) * PLOT_MOVEMENT_SCALE;
}
// Shorter than METRICS[key].label ("Net migration rate" etc.) — every
// character here is width the axis's own margin has to reserve, at the
// direct expense of the plot's scale.
const PLOT_AXIS_LABELS = {
  fertility: "Fertility rate",
  lifeExpectancy: "Life expectancy",
  netMigrationRate: "Migration rate",
};

// One entry per real region (same taxonomy as REGION_COLORS/the Globe-Map
// legend, plus a one-line summary of that region's demographic story) — the
// left-panel list this drives doubles as a filter (see
// setPlotGroupFilter): every country is always plotted, selecting one of
// these just hides the rest so a single cluster is easier to pick out.
const PLOT_REGIONS = [
  {
    label: "Sub-Saharan Africa",
    summary: "Still-rising fertility and the fastest population growth of any region.",
  },
  {
    label: "East Asia & Pacific",
    summary: "A wide mix — China and Japan's ultra-low fertility alongside Pacific islands with very different profiles.",
  },
  {
    label: "Europe & Central Asia",
    summary: "Aging populations kept from shrinking mainly by immigration rather than fertility.",
  },
  {
    label: "Latin America & Caribbean",
    summary: "Fertility moderating quickly, tracking a generation or two behind East Asia.",
  },
  {
    label: "Middle East, North Africa, Afghanistan & Pakistan",
    summary: "A wide range — Gulf states with extreme migration inflows alongside still-high-fertility Afghanistan and Pakistan.",
  },
  {
    label: "North America",
    summary: "Steady growth driven by immigration rather than fertility.",
  },
  {
    label: "South Asia",
    summary: "The world's most populous region, now mid-transition as fertility falls.",
  },
].map((region) => ({
  kind: "region",
  label: region.label,
  summary: region.summary,
  color: REGION_COLORS[region.label] ?? DEFAULT_COLOR,
}));

// Same idea, sliced by income tier instead of geography — a different lens
// on the same underlying countries/cards, not a second independent filter
// (see plotSelectedGroup — only one of region/income can be active at
// once).
const PLOT_INCOME_GROUPS = [
  {
    label: "High-income countries",
    summary: "Sub-replacement fertility and historic longevity. An aging demographic relying on net migration to sustain its peak.",
  },
  {
    label: "Middle-income countries",
    summary: "The global engine. A vast, mid-transition population driving the bulk of current urban and economic expansion.",
  },
  {
    label: "Low-income countries",
    summary: "High fertility paired with emerging lifespans. A highly youthful, rapidly growing tier concentrated in Sub-Saharan Africa.",
  }
].map((group) => ({
  kind: "income",
  label: group.label,
  summary: group.summary,
  color: INCOME_GROUP_COLORS[group.label] ?? DEFAULT_COLOR,
}));

// null = every country visible; otherwise one entry from PLOT_REGIONS or
// PLOT_INCOME_GROUPS, and every country outside it has its card hidden
// (see positionPlotCards). Reset whenever Plot closes (setPlotActive)
// so each visit starts unfiltered.
let plotSelectedGroup = null;
// Which of PLOT_REGIONS/PLOT_INCOME_GROUPS the summary panel currently
// shows — a separate, Plot-local concept from plotSelectedGroup (which
// filter is applied to the cards) and from the Globe/Map legend's own
// colorMode: the two panels look alike (both reuse .tab-group) but Plot's
// filter+replay click behavior has nothing to do with colorMode's
// recolor+drill-down, so they don't share state or DOM.
let plotGroupTab = "region";

function plotGroupKey(group) {
  return `${group.kind}:${group.label}`;
}

function normalizePlotValue(value, domain) {
  if (!domain) return 0.5;
  const { min, max } = domain;
  if (max === min) return 0.5;
  // Values outside the percentile-clipped domain (see computePlotDomains)
  // pin to the edge rather than pushing a card off the grid entirely.
  return Math.min(1, Math.max(0, (value - min) / (max - min)));
}

// nx/nz are the ground-plane axes (fertility/migration), ny is height
// (life expectancy), each normalized to [0, 1].
function plotProject(nx, ny, nz) {
  const isoX = (nx - nz) * ISO_COS30;
  const isoY = (nx + nz) * ISO_SIN30 - ny * PLOT_HEIGHT_SCALE;
  return { isoX, isoY };
}

// iso (0,0) sits at the pixel center of the available plot area — the
// bounding box is symmetric in both isoX ([-cos30, cos30]) and isoY
// ([-1, 1]) around that point (see PLOT_HEIGHT_SCALE), so this also
// happens to be the geometric center of the whole shape, not just the
// origin corner's own projection.
function plotLayout(width, height) {
  const availW = width - PLOT_MARGIN.left - PLOT_MARGIN.right;
  const availH = height - PLOT_MARGIN.top - PLOT_MARGIN.bottom;
  const isoWidthUnits = 2 * ISO_COS30;
  const isoHeightUnits = 2;
  const scale = Math.max(
    20,
    Math.min(availW / isoWidthUnits, availH / isoHeightUnits),
  );
  return {
    scale,
    centerX: width / 2,
    centerY: PLOT_MARGIN.top + availH / 2,
  };
}

function plotPixel(nx, ny, nz, layout) {
  const { isoX, isoY } = plotProject(nx, ny, nz);
  return {
    x: layout.centerX + isoX * layout.scale,
    y: layout.centerY + isoY * layout.scale,
  };
}

// Inverse of plotPixel at floor level (ny = 0) — given a pixel, which
// ground-plane (nx, nz) projects there. Used only to figure out how far the
// grid floor (see renderPlotGrid) needs to extend to cover a canvas
// corner; not needed for card placement, which only ever goes pixel-space.
function plotUnproject(pixelX, pixelY, layout) {
  const isoX = (pixelX - layout.centerX) / layout.scale;
  const isoY = (pixelY - layout.centerY) / layout.scale;
  // Inverting isoX = (nx-nz)*cos30, isoY = (nx+nz)*sin30.
  const nx = (isoX / ISO_COS30 + isoY / ISO_SIN30) / 2;
  const nz = (isoY / ISO_SIN30 - isoX / ISO_COS30) / 2;
  return { nx, nz };
}

// Local copy — script.js's own copy of this generic helper was removed
// alongside the rest of this Plot-only code (the Cluster view's
// cluster-controller.mjs has its own independent copy instead).
function percentile(sortedValues, p) {
  const index = (sortedValues.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sortedValues[lower];
  return (
    sortedValues[lower] * (upper - index) + sortedValues[upper] * (index - lower)
  );
}

// Global (not per-year) domain per axis, across every country and every
// year — the space itself needs to stay fixed for a year change to read as
// motion through it rather than the grid rescaling under the cards. Returns
// null if the (lazily loaded) demographics data isn't in yet.
function computePlotDomains() {
  const domains = {};
  for (const key of Object.values(PLOT_AXES)) {
    const values = [];
    countriesData.forEach((country) => {
      chartSeriesFor(country, key).forEach((value) => {
        if (Number.isFinite(value)) values.push(value);
      });
    });
    if (!values.length) {
      domains[key] = null;
      continue;
    }
    values.sort((a, b) => a - b);
    // A handful of tiny-population territories post extreme swings
    // (especially in migration rate — a huge percentage move on a tiny
    // population base) that would otherwise stretch the whole axis and
    // collapse every other country into one corner of the grid. Clipping
    // to the 3rd/97th percentile keeps the space readable for the vast
    // majority; genuine outliers just sit pinned at the edge instead of
    // dictating the whole scale (see normalizePlotValue's clamp).
    const min = percentile(values, 0.03);
    const max = percentile(values, 0.97);
    domains[key] =
      min < max
        ? { min, max }
        : { min: values[0], max: values[values.length - 1] };
  }
  return Object.values(domains).every(Boolean) ? domains : null;
}

function ensurePlotDomains() {
  if (plotDomains) return true;
  plotDomains = computePlotDomains();
  return plotDomains != null;
}

function plotRegionColor(country) {
  return REGION_COLORS[country.region?.trim()] ?? DEFAULT_COLOR;
}

function buildPlotCards() {
  if (plotCardsBuilt) return;
  plotCardEntries = countriesData.map((country) => {
    const color = plotRegionColor(country);
    const el = document.createElement("div");
    el.className = "plot-card";
    el.style.setProperty("--card-color", color);
    const flag = document.createElement("span");
    flag.className = "plot-card-flag";
    flag.style.backgroundImage = `url(${flagIconUrl(country.iso3, false)})`;
    const name = document.createElement("span");
    name.className = "plot-card-name";
    name.textContent = country.name;
    el.append(flag, name);
    el.addEventListener("pointerenter", (event) =>
      showChartTooltip(event, country.name, color),
    );
    el.addEventListener("pointermove", (event) =>
      showChartTooltip(event, country.name, color),
    );
    el.addEventListener("pointerleave", hideChartTooltip);
    // el.addEventListener("click", () => {
    //   setPlotActive(false);
    //   openCountryDetail(country);
    // });
    return { country, el, lastZIndex: null };
  });
  elements.plotCards.replaceChildren(
    ...plotCardEntries.map((entry) => entry.el),
  );
  plotCardsBuilt = true;
}

// Cheap per-year update: only moves/recolors existing cards, never touches
// the grid or rebuilds any DOM — safe to call on every year-slider "input"
// frame while dragging.
// yearIndex may be fractional (see playPlotTimelineOnce) — years data
// only has one value per whole year, so a fractional index linearly
// interpolates between the two nearest years' values instead of picking
// one. A whole-number index (every other caller) degenerates to exactly
// that year's value, so this is a drop-in generalization, not a behavior
// change for them.
//
// NOTE: this called `valueAtFractionalYear`, which still lives in
// script.js (shared with the Cluster view) and was not duplicated here.
function positionPlotCards(yearIndex) {
  if (!plotLayoutCache || yearIndex == null || yearIndex < 0) return;
  plotCardEntries.forEach((entry) => {
    const { country, el } = entry;
    if (plotSelectedGroup) {
      const value =
        plotSelectedGroup.kind === "income"
          ? country._incomeLabel
          : country.region?.trim();
      if (value !== plotSelectedGroup.label) {
        el.style.opacity = "0";
        el.style.pointerEvents = "none";
        return;
      }
    }
    const x = valueAtFractionalYear(country, PLOT_AXES.x, yearIndex);
    const y = valueAtFractionalYear(country, PLOT_AXES.y, yearIndex);
    const z = valueAtFractionalYear(country, PLOT_AXES.z, yearIndex);
    if (![x, y, z].every(Number.isFinite)) {
      el.style.opacity = "0";
      el.style.pointerEvents = "none";
      return;
    }
    // Amplified (see PLOT_MOVEMENT_SCALE) for the card's own position and
    // depth sort — the axis lines/grid/ticks below are built separately in
    // renderPlotGrid, from the un-amplified [0,1] mapping, and are
    // unaffected by this.
    const nx = amplifyPlotMovement(
      normalizePlotValue(x, plotDomains[PLOT_AXES.x]),
    );
    const ny = amplifyPlotMovement(
      normalizePlotValue(y, plotDomains[PLOT_AXES.y]),
    );
    const nz = amplifyPlotMovement(
      normalizePlotValue(z, plotDomains[PLOT_AXES.z]),
    );
    const point = plotPixel(nx, ny, nz, plotLayoutCache);
    el.style.transform = `translate3d(${point.x.toFixed(1)}px, ${point.y.toFixed(1)}px, 0) translate(-50%, -50%)`;
    // Ground-plane depth (nx+nz) sorts cards the way an isometric scene
    // should — one further "toward the viewer" (bigger nx+nz, lower on
    // screen) overlaps one further back, regardless of paint order. Written
    // only when the (coarse — see PLOT_ZINDEX_BUCKETS) bucket actually
    // changes: touching z-index forces the browser to re-evaluate
    // stacking/paint order even when the value is identical, worth
    // skipping on a property this many elements update every drag frame.
    const zIndex = Math.round((nx + nz) * PLOT_ZINDEX_BUCKETS);
    if (entry.lastZIndex !== zIndex) {
      el.style.zIndex = String(zIndex);
      entry.lastZIndex = zIndex;
    }
    el.style.opacity = "1";
    el.style.pointerEvents = "auto";
  });
}

function renderPlotGrid() {
  const svg = elements.plotGrid;
  const width = svg.clientWidth || 900;
  const height = svg.clientHeight || 600;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  const layout = plotLayout(width, height);
  plotLayoutCache = layout;

  const elementsToAppend = [];

  // The grid floor covers the whole canvas, not just the [0,1] cube the
  // axes/data actually span — unproject the four canvas corners back to
  // ground-plane coordinates to find how far out each line needs to run,
  // then snap that range to the same spacing the [0,1] cube already uses
  // so the two look like one continuous grid rather than two mismatched
  // ones.
  const spacing = 1 / PLOT_GRID_DIVISIONS;
  const corners = [
    plotUnproject(0, 0, layout),
    plotUnproject(width, 0, layout),
    plotUnproject(0, height, layout),
    plotUnproject(width, height, layout),
  ];
  const nxMin = Math.floor(Math.min(...corners.map((c) => c.nx)) / spacing) * spacing;
  const nxMax = Math.ceil(Math.max(...corners.map((c) => c.nx)) / spacing) * spacing;
  const nzMin = Math.floor(Math.min(...corners.map((c) => c.nz)) / spacing) * spacing;
  const nzMax = Math.ceil(Math.max(...corners.map((c) => c.nz)) / spacing) * spacing;

  // Lines of constant nz, spanning the full nx range (and vice versa) —
  // each line only needs to be as long as the whole canvas's nx/nz extent,
  // not just its own, since drawing a little past the visible edge is
  // harmless (the SVG's overflow: visible just lets it run off).
  for (let nz = nzMin; nz <= nzMax + spacing / 2; nz += spacing) {
    const a = plotPixel(nxMin, 0, nz, layout);
    const b = plotPixel(nxMax, 0, nz, layout);
    elementsToAppend.push(
      svgEl("line", {
        class: "plot-grid-line",
        x1: a.x.toFixed(1),
        y1: a.y.toFixed(1),
        x2: b.x.toFixed(1),
        y2: b.y.toFixed(1),
      }),
    );
  }
  for (let nx = nxMin; nx <= nxMax + spacing / 2; nx += spacing) {
    const c = plotPixel(nx, 0, nzMin, layout);
    const d = plotPixel(nx, 0, nzMax, layout);
    elementsToAppend.push(
      svgEl("line", {
        class: "plot-grid-line",
        x1: c.x.toFixed(1),
        y1: c.y.toFixed(1),
        x2: d.x.toFixed(1),
        y2: d.y.toFixed(1),
      }),
    );
  }

  const origin = plotPixel(0, 0, 0, layout);
  const axisEnds = {
    [PLOT_AXES.x]: { end: plotPixel(1, 0, 0, layout), anchor: "start", dx: 10, dy: 4 },
    [PLOT_AXES.z]: { end: plotPixel(0, 0, 1, layout), anchor: "end", dx: -10, dy: 4 },
    [PLOT_AXES.y]: { end: plotPixel(0, 1, 0, layout), anchor: "middle", dx: 0, dy: -12 },
  };

  Object.entries(axisEnds).forEach(([key, { end, anchor, dx, dy }]) => {
    elementsToAppend.push(
      svgEl("line", {
        class: "plot-axis-line",
        x1: origin.x.toFixed(1),
        y1: origin.y.toFixed(1),
        x2: end.x.toFixed(1),
        y2: end.y.toFixed(1),
      }),
    );
    const definition = METRICS[key];
    const domain = plotDomains?.[key];
    // Name only (no value) right at the endpoint — kept short so
    // PLOT_MARGIN can stay tight; the actual min/max values live in the
    // two ticks below instead.
    const nameLabel = svgEl("text", {
      class: "plot-axis-label",
      x: (end.x + dx).toFixed(1),
      y: (end.y + dy).toFixed(1),
      "text-anchor": anchor,
    });
    nameLabel.textContent = PLOT_AXIS_LABELS[key];
    elementsToAppend.push(nameLabel);
    if (!domain) return;
    // Both ticks sit a little way in from their respective ends, along
    // this axis's own direction — close enough to read as "the start/end
    // of this spoke" without the three axes' ticks overlapping each other
    // at the shared origin, and without the max tick colliding with the
    // name label right at the endpoint.
    [
      { t: 0.12, value: domain.min, offset: 0.6 },
      { t: 0.82, value: domain.max, offset: 0.75 },
    ].forEach(({ t, value, offset }) => {
      const point = plotPixel(
        key === PLOT_AXES.x ? t : 0,
        key === PLOT_AXES.y ? t : 0,
        key === PLOT_AXES.z ? t : 0,
        layout,
      );
      const tick = svgEl("text", {
        class: "plot-tick-label",
        x: (point.x + dx * offset).toFixed(1),
        y: (point.y + dy * offset + 3).toFixed(1),
        "text-anchor": anchor,
      });
      tick.textContent = definition.format(value);
      elementsToAppend.push(tick);
    });
  });

  svg.replaceChildren(...elementsToAppend);
}

let plotSummaryBuilt = false;
let plotPlaybackFrame = null;
const PLOT_PLAYBACK_DURATION_MS = 9000;

function stopPlotPlayback() {
  // .plot-card's own transition (a nicety for occasional updates — a
  // manual drag, a single click) actively works against a 60fps JS-driven
  // sweep: every position write mid-transition forces the compositor to
  // resample and retarget instead of just jumping to the new value, and
  // that retargeting cost compounds across ~200 cards every ~16ms for the
  // full 9s sweep. Switching regions mid-sweep used to make this worse by
  // starting a second overlapping retarget chain right on top of the
  // first's still-settling one — is-playing turns the transition off for
  // the whole sweep instead, so there's nothing left to retarget.
  elements.plotCards.classList.remove("is-playing");
  if (plotPlaybackFrame == null) return;
  cancelAnimationFrame(plotPlaybackFrame);
  plotPlaybackFrame = null;
}

// Sweeps the year slider from the very first year to the very last, once,
// so a newly selected region's cluster reads as trending across the whole
// dataset instead of sitting frozen wherever the slider happened to be.
// Mirrors the trend chart's own scrubber: cheap live updates (slider
// value/labels/card positions) every frame, committed through the real
// applyYear pipeline (goToYear) only once, at the end.
function playPlotTimelineOnce() {
  stopPlotPlayback();
  if (!plotActive || yearsData.length < 2) return;
  elements.plotCards.classList.add("is-playing");
  const lastYear = yearsData[yearsData.length - 1];
  const startTime = performance.now();

  function frame(now) {
    const t = Math.min(1, (now - startTime) / PLOT_PLAYBACK_DURATION_MS);
    // 150 years over PLOT_PLAYBACK_DURATION_MS is only ~60ms per whole
    // year — rounding to the nearest year index before positioning cards
    // meant most of the 60fps rAF frames recomputed the exact same
    // position, then jumped a visible amount every ~4th frame once the
    // rounded index finally ticked over. positionPlotCards now accepts a
    // fractional index and interpolates between the two nearest years, so
    // every single frame moves cards a little instead of most doing
    // nothing and one doing a lot — the slider/label still snap to whole
    // years since that's the only unit yearsData actually has.
    const fractionalIndex = t * (yearsData.length - 1);
    const index = Math.round(fractionalIndex);
    const year = yearsData[index];
    elements.yearSlider.value = year;
    updateSliderProgress();
    updateYearLabels(year);
    positionPlotCards(fractionalIndex);
    if (t < 1) {
      plotPlaybackFrame = requestAnimationFrame(frame);
    } else {
      plotPlaybackFrame = null;
      elements.plotCards.classList.remove("is-playing");
      goToYear(lastYear);
    }
  }
  plotPlaybackFrame = requestAnimationFrame(frame);
}

// Toggles the region/income filter (see plotSelectedGroup/
// positionPlotCards): clicking the already-selected group clears it, same
// as the Globe/Map legend's own selectLegendItem toggle. Cheap — only
// touches existing cards' opacity/transform, never rebuilds the grid or
// DOM. Selecting a group (not clearing one) also replays the whole timeline
// once, so its cluster's trend is visible immediately rather than needing a
// manual drag.
function setPlotGroupFilter(group) {
  const isDeselecting =
    plotSelectedGroup != null &&
    plotGroupKey(plotSelectedGroup) === plotGroupKey(group);
  plotSelectedGroup = isDeselecting ? null : group;
  elements.plotGroups.querySelectorAll(".plot-group-item").forEach((item) => {
    item.classList.toggle(
      "active",
      plotSelectedGroup != null &&
        item.dataset.groupKey === plotGroupKey(plotSelectedGroup),
    );
  });
  if (isDeselecting) {
    stopPlotPlayback();
    positionPlotCards(currentYearIndex);
  } else {
    // No positionPlotCards(currentYearIndex) call here — during an
    // active sweep currentYearIndex is stale (the sweep drives the slider
    // directly, not through applyYear, until it commits at the end), so
    // that call would only draw one frame at the wrong year immediately
    // before playPlotTimelineOnce's own first frame overwrote it anyway.
    playPlotTimelineOnce();
  }
}

function buildPlotGroupList(groups) {
  const list = document.createElement("div");
  list.className = "plot-group-list";
  list.append(
    ...groups.map((group) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "plot-group-item";
      item.dataset.groupKey = plotGroupKey(group);
      item.style.setProperty("--color-legend", group.color);
      const header = document.createElement("div");
      header.className = "plot-group-header";
      const swatch = document.createElement("span");
      swatch.className = "legend-swatch";
      const label = document.createElement("span");
      label.textContent = displayGroupLabel(group.label);
      header.append(swatch, label);
      const summary = document.createElement("p");
      summary.className = "plot-group-summary paragraph";
      summary.textContent = group.summary;
      item.append(header, summary);
      item.addEventListener("click", () => setPlotGroupFilter(group));
      return item;
    }),
  );
  return list;
}

// Switches which of PLOT_REGIONS/PLOT_INCOME_GROUPS the panel shows — both
// lists are built once (see renderPlotSummary) and just toggled via
// [hidden], the same way the item summaries below stay in the DOM
// (collapsed via CSS) rather than getting torn down, so an expanded
// description or the active filter's highlight survives switching tabs and
// back.
function setPlotGroupTab(tab) {
  if (tab === plotGroupTab) return;
  plotGroupTab = tab;
  elements.plotGroupMode.querySelectorAll("button").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === tab);
  });
  elements.plotGroups.querySelectorAll(".plot-group-list").forEach((list) => {
    list.hidden = list.dataset.tab !== tab;
  });
}

// Static explanation of each region/income group — doesn't depend on year
// or domains, so it's built once and left alone; each button also doubles
// as that group's filter trigger (setPlotGroupFilter).
function renderPlotSummary() {
  if (plotSummaryBuilt) return;
  const regionList = buildPlotGroupList(PLOT_REGIONS);
  regionList.dataset.tab = "region";
  const incomeList = buildPlotGroupList(PLOT_INCOME_GROUPS);
  incomeList.dataset.tab = "income";
  incomeList.hidden = true;
  elements.plotGroups.replaceChildren(regionList, incomeList);
  elements.plotGroupMode.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => setPlotGroupTab(btn.dataset.mode));
  });
  plotSummaryBuilt = true;
}

// Full (re)build: grid + card DOM + initial positions. Only needed once per
// activation or resize — the domains (and so the coordinate space itself)
// never change between frames, only the year does (see updatePlotYear).
function renderPlotLayout() {
  if (!plotActive) return;
  renderPlotSummary();
  if (!ensurePlotDomains()) {
    // Demographics data hasn't loaded yet — the countryDemographicMetrics
    // promise handler retries this once it resolves.
    elements.plotCards.replaceChildren();
    elements.plotGrid.replaceChildren();
    return;
  }
  buildPlotCards();
  renderPlotGrid();
  positionPlotCards(currentYearIndex);
}

function updatePlotYear(year) {
  if (!plotActive || !plotDomains) return;
  const yearIndex = yearsData.indexOf(year);
  if (yearIndex === -1) return;
  positionPlotCards(yearIndex);
}

function setPlotActive(active) {
  if (active === plotActive) return;
  plotActive = active;
  elements.plotView.hidden = !active;
  document.body.classList.toggle("view-plot", active);
  // setViewMode() only ever toggles between "globe"/"map" — same reasoning
  // as setchartPanelActive's own #viewMode resync.
  elements.viewMode.querySelectorAll("button").forEach((btn) =>
    btn.classList.toggle(
      "active",
      btn.dataset.mode === (active ? "plot" : viewMode),
    ),
  );
  if (active) {
    tourController.stop();
    renderPlotLayout();
  } else {
    stopPlotPlayback();
    // Each visit starts unfiltered, on the Region tab, rather than
    // remembering the last group/tab — the summary panel's DOM is only
    // built once (plotSummaryBuilt), so this needs to clear things by hand
    // rather than just resetting the underlying state.
    plotSelectedGroup = null;
    elements.plotGroups
      .querySelectorAll(".plot-group-item.active")
      .forEach((item) => item.classList.remove("active"));
    setPlotGroupTab("region");
    if (currentYearIndex >= 0) {
      // Plot took applyYear()'s cheap fast path (see there) while open,
      // leaving the 3D scene stale — catch it up now that it's visible
      // again.
      applyYear(yearsData[currentYearIndex], { instant: true });
    }
  }
  syncUrlFromState();
}

// ---------------------------------------------------------------------------
// Call sites that used to live elsewhere in script.js, for reference:
//
// - applyYear(year): a fast-path branch, same shape as the chartPanelActive
//   and clusterActive ones that remain —
//     if (plotActive) {
//       updateYearLabels(year);
//       updatePlotYear(year);
//       syncUrlFromState();
//       return;
//     }
//
// - urlStateFromApp(): an `else if` arm alongside chart/cluster —
//     else if (plotActive) { Object.assign(state, { view: "plot" }); }
//
// - applyUrlStateFromLocation(search): an `else if` arm alongside chart/cluster —
//     else if (state.view === "plot") { setPlotActive(true); }
//
// - countryDemographicMetricsPromise.then(...): `if (plotActive) renderPlotLayout();`
//
// - yearSlider "input" listener: `if (plotActive) updatePlotYear(Number(elements.yearSlider.value));`
//
// - yearSlider "pointerdown" listener: `elements.yearSlider.addEventListener("pointerdown", stopPlotPlayback);`
//
// - #viewMode button click handler: a `data-mode === "plot"` branch
//   (mutual exclusion with chart/cluster, mirroring how those two branches
//   still look), plus a `setPlotActive(false)` call in each of the other
//   branches (chart/cluster/fallback) to close Plot when switching away.
//
// - resize handler: `if (plotActive) { clearTimeout(countryChartResizeTimer); countryChartResizeTimer = setTimeout(renderPlotLayout, 120); }`
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// DOM markup (index.html) — nav button (inside #viewMode) and the view
// section itself (a sibling of #clusterView), both removed from index.html:
//
// <button
//     type="button"
//     data-mode="plot"
//     class="mono-uppercase"
//     aria-label="Plot"
//     title="Plot"
// >
//     Plot
// </button>
//
// <section id="plotView" class="plot-view glass" hidden>
//     <div class="plot-summary no-scrollbar">
//         <div id="plotGroupMode" class="tab-group">
//             <button type="button" data-mode="region" class="active mono-uppercase" aria-label="Region" title="Region">Region</button>
//             <button type="button" data-mode="income" class="mono-uppercase" aria-label="Income group" title="Income group">Income group</button>
//         </div>
//         <div id="plotGroups" class="plot-groups"></div>
//     </div>
//     <div class="plot-canvas">
//         <svg id="plotGrid" class="plot-grid" preserveAspectRatio="none"></svg>
//         <div id="plotCards" class="plot-cards"></div>
//     </div>
// </section>
//
// The three .milestone-nav-btn buttons in #timelineContainer also carried a
// `hide-for-plot` class alongside `hide-for-chart`/`hide-for-cluster`,
// removed along with the rest.
//
// ui-elements.mjs bindings (removed):
//   plotView: root.querySelector("#plotView"),
//   plotGrid: root.querySelector("#plotGrid"),
//   plotCards: root.querySelector("#plotCards"),
//   plotGroups: root.querySelector("#plotGroups"),
//   plotGroupMode: root.querySelector("#plotGroupMode"),
//
// url-state.mjs branches (removed from both serializeUrlState and
// parseUrlState):
//   } else if (state.view === "plot") { params.set("view", "plot"); }
//   } else if (view === "plot") { state.view = "plot"; }
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// CSS (styles.css) — removed rules, verbatim:
//
// body.view-plot .hide-for-plot,   <- one selector line, folded into the
//                                     shared hide-for-* rule with
//                                     hide-for-cluster/hide-for-detail
//
// .plot-view {
//     position: fixed;
//     top: 0;
//     right: 0;
//     bottom: 0;
//     left: 0;
//     z-index: var(--z-dock);
//     display: flex;
//     background: var(--color-scrim-strong);
//     overflow: hidden;
// }
//
// .plot-summary {
//     flex: 0 0 clamp(320px, 28vw, 360px);
//     min-height: 0;
//     overflow-y: auto;
//     padding: calc(var(--margin) * 2 + var(--button-size) - 8px) 0 var(--margin) var(--margin);
//     position: absolute;
//     left: 0;
//     top: 0;
//     width: 360px;
//     z-index: 10000;
// }
//
// .plot-summary-intro {
//     font-size: 1rem;
//     line-height: 1.5;
//     color: var(--color-muted);
//     margin: 0 0 24px 0;
// }
//
// .plot-groups {
//     display: flex;
//     flex-direction: column;
//     gap: 0;
// }
//
// #plotGroupMode {
//     margin-bottom: 12px;
// }
//
// .plot-group-item {
//     display: flex;
//     flex-direction: column;
//     gap: 6px;
//     width: 100%;
//     border: 0;
//     border-radius: 8px;
//     padding: 4px 4px;
//     background: transparent;
//     color: inherit;
//     font: inherit;
//     text-align: left;
//     cursor: pointer;
//     transition: .25s all ease-out;
//     opacity: .7;
//
//     .plot-group-header {
//         display: flex;
//         align-items: center;
//         gap: 12px;
//         font-weight: 500;
//     }
//
//     .plot-group-summary {
//         padding-left: 20px;
//         color: var(--color-muted);
//         height: 0;
//         opacity: 0;
//         transition: .25s all ease-out;
//         margin: 0;
//         transform: translate3d(0,0,0);
//         position: relative;
//     }
//     .plot-group-summary:before {
//         position: absolute;
//         left: 3px;
//         top: 0;
//         bottom: 0;
//         width: 1px;
//         content: "";
//         background: var(--color-text);
//     }
//
//     .legend-swatch {
//         background: var(--color-legend);
//     }
// }
//
// .plot-group-item.active {
//     opacity: 1;
//
//     .legend-swatch {
//         background: var(--color-legend);
//     }
//     .plot-group-summary {
//         height: auto;
//         opacity: 1;
//         margin-bottom: 12px;
//     }
// }
//
// .plot-canvas {
//     position: relative;
//     flex: 1 1 0;
//     min-width: 0;
// }
//
// .plot-grid {
//     position: absolute;
//     inset: 0;
//     width: 100%;
//     height: 100%;
//     overflow: visible;
// }
//
// .plot-grid-line {
//     stroke: var(--color-border);
//     stroke-width: 1;
// }
//
// .plot-axis-line {
//     stroke: color-mix(in srgb, var(--color-muted) 40%, transparent);
//     stroke-width: 2;
// }
//
// .plot-axis-label {
//     font-size: 11px;
//     font-family: var(--font-mono);
//     text-transform: uppercase;
//     letter-spacing: var(--letterspacing-uppercase);
//     fill: var(--color-text);
//     font-weight: 500;
// }
//
// .plot-tick-label {
//     font-size: 10px;
//     font-family: var(--font-mono);
//     fill: var(--color-muted);
//     display: none;
// }
//
// .plot-cards {
//     position: absolute;
//     inset: 0;
//     width: 100%;
//     height: 100%;
//     pointer-events: none;
// }
//
// .plot-card {
//     position: absolute;
//     top: 0;
//     left: 0;
//     display: flex;
//     align-items: center;
//     gap: 5px;
//     color: var(--color-text);
//     font-family: var(--font-mono);
//     font-size: 11px;
//     white-space: nowrap;
//     cursor: pointer;
//     pointer-events: auto;
//     transition: transform 0.25s ease, opacity 0.25s ease;
//     will-change: transform;
// }
//
// .plot-cards.is-playing .plot-card {
//     transition: none;
// }
//
// .plot-card:hover {
// }
//
// .plot-card-flag {
//     --width: 48px;
//     flex: none;
//     width: var(--width);
//     height: calc(var(--width) * 0.75);
//     background-size: cover;
//     background-position: center;
//     border-radius: 4px;
//     transform: rotateX(60deg) rotateZ(45deg);
//     transform-style: preserve-3d;
//     outline: 4px solid var(--color-bg);
//     box-sizing: border-box;
// }
//
// .plot-card-name {
//     display: none;
// }
// ---------------------------------------------------------------------------
