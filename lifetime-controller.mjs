import {
  convertAlpha3ToAlpha2,
  flagIconUrl,
  preloadFlagIcons,
} from "./data-loader.mjs";
import {
  createCountryCombobox,
  matchCountries,
} from "./country-combobox.mjs";
import { trackEvent } from "./analytics.mjs";
import {
  runChartAnimation,
  prefersReducedMotion,
} from "./chart-animation.mjs";
import {
  buildLifetimeStory,
  createLifetimeAggregateCache,
  lifetimePresentYear,
} from "./lifetime-model.mjs";
import { METRICS, stripFormatSuffix } from "./metrics.mjs";
import {
  downloadBlob,
  renderLifetimeShareCard,
} from "./lifetime-share-card.mjs";

const LIFETIME_SECTION_COUNT = 3;
// The Horizon act is the only one that lands on a projected (not historical)
// year — see setActIndex()'s onActiveSectionChange call below.
const HORIZON_ACT_INDEX = 2;
const LIFETIME_SCROLL_LOCK_MS = 900;
const LIFETIME_WHEEL_IDLE_MS = 240;
const LIFETIME_COUNTRY_SUGGESTION_LIMIT = 40;
// Long enough that clicking a suggestion (a blur then a click) still
// registers before the list disappears out from under it.
const LIFETIME_COUNTRY_BLUR_DISMISS_MS = 150;
// The global-life curve rises from a flat baseline to its real shape, the same
// entrance the trend chart uses (runChartAnimation + easeOutCubic).
const LIFETIME_CURVE_GROW_MS = 600;
const easeOutCubic = (t) => 1 - (1 - t) ** 3;

function createLifetimeStat(value, label) {
  const stat = document.createElement("div");
  stat.className = "lifetime-stat";
  const valueEl = document.createElement("div");
  valueEl.className = "lifetime-stat-value";
  // innerHTML — formatLifeExpectancy/other METRICS formatters wrap their
  // unit in <span class="suffix"> (metrics.mjs) for spacing.
  valueEl.innerHTML = value;
  const labelEl = document.createElement("div");
  labelEl.className = "lifetime-stat-label";
  labelEl.textContent = label;
  stat.append(valueEl, labelEl);
  return stat;
}

function percentFromShare(share, fallback) {
  return `${(Number.isFinite(share) ? share : fallback) * 100}%`;
}

function actLabel(index) {
  return [
    "The Arrival",
    "Present",
    "The Horizon",
  ][index] ?? "Lifetime";
}

function capitalizeFirstLetter(value) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : "";
}

// The four builders below (through createStorySection) are pure — none of
// them touch controller state (elements, birthYear, etc.) — so they live at
// module scope rather than nested inside createLifetimeController.

function createLifeExpectancyComparison(rows) {
  const chart = document.createElement("div");
  chart.className = "lifetime-le-comparison";

  const values = rows.map((row) => row.value);
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const format = METRICS.lifeExpectancy.format;
  rows.forEach((row, index) => {
    const item = document.createElement("div");
    item.className = `lifetime-le-row${row.highlight ? " is-highlight" : ""}`;
    // Staggers each bar's reveal (see .lifetime-le-bar entrance CSS).
    item.style.setProperty("--row-index", index);
    const bar = document.createElement("div");
    bar.className = "lifetime-le-bar";
    // Zoomed proportional width so close life-expectancy values still read as
    // different; a floor keeps the shortest bar visible, the ceiling leaves
    // room for the value label, and CSS min-width keeps long labels legible
    // inside their pill. Stored as a custom property (not the width style
    // directly) so the entrance animation — a plain 0 -> target width grow,
    // see .lifetime-le-bar in styles.css — has something to animate toward.
    bar.style.setProperty(
      "--lifetime-le-bar-width",
      `${(0.3 + 0.6 * ((row.value - min) / range)) * 100}%`,
    );
    const name = document.createElement("span");
    name.className = "lifetime-le-name";
    name.textContent = row.label;
    bar.append(name);
    const value = document.createElement("span");
    value.className = "lifetime-le-value";
    value.innerHTML = format(row.value);
    item.append(bar, value);
    chart.append(item);
  });
  return chart;
}

function createPopulationChangeChart(change) {
  const chart = document.createElement("div");
  chart.className = "lifetime-population-change";
  // One source of truth for the birth/added split: the CSS var (used to
  // place the birth tick) and the birth segment width must never drift.
  const birthWidth = percentFromShare(change?.birthShare, 0.5);
  chart.style.setProperty("--lifetime-birth-share", birthWidth);

  const birthSegment = document.createElement("div");
  birthSegment.className = "lifetime-population-segment birth";
  birthSegment.style.width = birthWidth;

  const birthValue = document.createElement("span");
  birthValue.className = "lifetime-population-value";
  birthValue.textContent = change?.birthPopulation ?? "N/A";
  birthSegment.append(birthValue);

  const addedSegment = document.createElement("div");
  addedSegment.className = "lifetime-population-segment added";
  addedSegment.style.width = percentFromShare(change?.addedShare, 0.5);
  const addedValue = document.createElement("span");
  addedValue.className = "lifetime-population-value";
  addedValue.textContent = change?.addedPopulation
    ? `${change.addedPopulation}`
    : "N/A";
  addedSegment.append(addedValue);

  const bar = document.createElement("div");
  bar.className = "lifetime-population-bar";
  bar.append(birthSegment, addedSegment);

  const axis = document.createElement("div");
  axis.className = "lifetime-population-axis";
  const birthTick = document.createElement("div");
  birthTick.className = "lifetime-population-tick birth";
  birthTick.textContent = change?.birthYear ?? "";
  const presentTick = document.createElement("div");
  presentTick.className = "lifetime-population-tick present";
  presentTick.textContent = change?.presentYear ?? "";
  axis.append(birthTick, presentTick);

  chart.append(bar, axis);
  return chart;
}

function createGlobalLifeExpectancyChart(change) {
  const rows = change?.rows ?? [];
  if (!rows.length) return null;

  const svgNs = "http://www.w3.org/2000/svg";
  const width = 560;
  const height = 480;
  const padding = { top: 20, right: 18, bottom: 48, left: 44 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const yearsOnly = rows.map((row) => row.year);
  const values = rows.map((row) => row.value);
  const minYear = Math.min(...yearsOnly);
  const maxYear = Math.max(change?.maxYear ?? yearsOnly.at(-1), ...yearsOnly);
  const maxValue = Math.max(...values);
  const valuePadding = Math.max(2, maxValue * 0.08);
  const yMin = 0;
  const yMax = maxValue + valuePadding;
  const rangeYear = maxYear - minYear || 1;
  const rangeValue = yMax - yMin || 1;
  const xFor = (year) => padding.left + ((year - minYear) / rangeYear) * innerWidth;
  const yFor = (value) =>
    padding.top + innerHeight - ((value - yMin) / rangeValue) * innerHeight;
  const baselineY = padding.top + innerHeight;
  const format = METRICS.lifeExpectancy.format;

  const chart = document.createElement("div");
  chart.className = "lifetime-global-life-chart";

  const title = document.createElement("div");
  title.className = "lifetime-global-life-title";
  title.textContent = change?.title ?? "Global life expectancy";

  const svg = document.createElementNS(svgNs, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("role", "img");
  svg.setAttribute(
    "aria-label",
    `${title.textContent} from ${minYear} to ${maxYear}`,
  );

  const linePoints = rows.map((row) => `${xFor(row.year)},${yFor(row.value)}`);
  const line = document.createElementNS(svgNs, "polyline");
  line.setAttribute("class", "lifetime-global-life-line");
  line.setAttribute("points", linePoints.join(" "));
  line.setAttribute("fill", "none");

  const highlightedRows = rows.filter(
    (row) => row.year >= change.birthYear && row.year <= change.finalYear,
  );
  if (highlightedRows.length >= 2) {
    const area = document.createElementNS(svgNs, "path");
    const areaTop = highlightedRows
      .map((row, index) => `${index === 0 ? "M" : "L"} ${xFor(row.year)} ${yFor(row.value)}`)
      .join(" ");
    const first = highlightedRows[0];
    const last = highlightedRows.at(-1);
    area.setAttribute("class", "lifetime-global-life-area");
    area.setAttribute(
      "d",
      `${areaTop} L ${xFor(last.year)} ${baselineY} L ${xFor(first.year)} ${baselineY} Z`,
    );
    svg.append(area);
  }

  const yAxis = document.createElementNS(svgNs, "line");
  yAxis.setAttribute("class", "lifetime-global-life-axis");
  yAxis.setAttribute("x1", padding.left);
  yAxis.setAttribute("x2", padding.left);
  yAxis.setAttribute("y1", padding.top);
  yAxis.setAttribute("y2", baselineY);

  const xAxis = document.createElementNS(svgNs, "line");
  xAxis.setAttribute("class", "lifetime-global-life-axis");
  xAxis.setAttribute("x1", padding.left);
  xAxis.setAttribute("x2", padding.left + innerWidth);
  xAxis.setAttribute("y1", baselineY);
  xAxis.setAttribute("y2", baselineY);

  svg.append(yAxis, xAxis, line);

  const markerYears = [
    { year: change.birthYear, value: change.birthValue, anchor: "middle" },
    { year: change.finalYear, value: change.finalValue, anchor: "middle" },
  ].filter(
    (marker, index, all) =>
      Number.isFinite(marker.year) &&
      Number.isFinite(marker.value) &&
      all.findIndex((item) => item.year === marker.year) === index,
  );

  markerYears.forEach((marker) => {
    const x = xFor(marker.year);
    const y = yFor(marker.value);
    const guide = document.createElementNS(svgNs, "line");
    guide.setAttribute("class", "lifetime-global-life-guide");
    guide.setAttribute("x1", x);
    guide.setAttribute("x2", x);
    guide.setAttribute("y1", y);
    guide.setAttribute("y2", baselineY);

    const dot = document.createElementNS(svgNs, "circle");
    dot.setAttribute("class", "lifetime-global-life-dot");
    dot.setAttribute("cx", x);
    dot.setAttribute("cy", y);
    dot.setAttribute("r", 5);

    const value = document.createElementNS(svgNs, "text");
    value.setAttribute("class", "lifetime-global-life-value");
    value.setAttribute("x", x);
    value.setAttribute("y", y - 18);
    value.setAttribute("text-anchor", marker.anchor);
    // SVG <text> can't render nested HTML — strip format()'s suffix markup
    // (metrics.mjs) down to a bare number.
    value.textContent = stripFormatSuffix(format(marker.value), {
      keepUnit: false,
    });

    svg.append(guide, dot, value);
  });

  const axisYears = [...new Set([change.birthYear, change.finalYear])]
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  axisYears.forEach((year) => {
    const label = document.createElementNS(svgNs, "text");
    label.setAttribute("class", "lifetime-global-life-year");
    label.setAttribute("x", xFor(year));
    label.setAttribute("y", baselineY + 30);
    label.setAttribute("text-anchor", "middle");
    label.textContent = year;
    svg.append(label);
  });

  chart.append(title, svg);

  // Entrance: the curve rises from a flat baseline to its real shape (same
  // technique as the trend chart). Started flat here so there's no pre-reveal
  // flash; playEntrance() (fired when the section scrolls into view) animates
  // it up. Under reduced motion the line just stays at its final points.
  if (!prefersReducedMotion()) {
    const flatPoints = rows
      .map((row) => `${xFor(row.year)},${baselineY}`)
      .join(" ");
    line.setAttribute("points", flatPoints);
    chart.playEntrance = () =>
      runChartAnimation({
        duration: LIFETIME_CURVE_GROW_MS,
        easing: easeOutCubic,
        onFrame: (eased) => {
          line.setAttribute(
            "points",
            rows
              .map(
                (row) =>
                  `${xFor(row.year)},${baselineY + (yFor(row.value) - baselineY) * eased}`,
              )
              .join(" "),
          );
        },
      });
  }

  return chart;
}

// A CTA out of the personal story into the full country-detail view — clicked
// via a delegated listener in bindEvents() (this function is pure, so it just
// marks the country on the button's dataset rather than closing over a click
// handler).
function createExploreCountryLink(country) {
  const possessiveCountryName = country.name.endsWith("s")
    ? `${country.name}'`
    : `${country.name}'s`;
  const link = document.createElement("button");
  link.type = "button";
  link.className = "lifetime-explore-link";
  link.dataset.iso3 = country.iso3;
  link.textContent = `Explore ${possessiveCountryName} Dataset →`;
  return link;
}

function createStorySection(act, index, country) {
  const section = document.createElement("section");
  section.className = "lifetime-story-section";
  section.dataset.index = String(index);
  section.tabIndex = -1;

  // Download-as-image, positioned next to the (fixed, shared) close button —
  // clicked via a delegated listener in bindEvents(), which resolves the act
  // to draw from this section's own data-index at click time.
  const download = document.createElement("button");
  download.type = "button";
  download.className = "lifetime-section-download detail-close";
  download.setAttribute("aria-label", `Download ${actLabel(index)} as an image`);
  download.title = "Download as image";
  const downloadIcon = document.createElement("span");
  downloadIcon.className = "material-symbols-outlined";
  downloadIcon.textContent = "download";
  download.append(downloadIcon);
  section.append(download);

  const label = document.createElement("div");
  label.className = "lifetime-section-label";
  label.append(document.createTextNode(actLabel(index)));

  const copy = document.createElement("p");
  copy.className = "lifetime-act-copy";
  copy.innerHTML = act.text;

  const group = document.createElement("div");
  group.className = "lifetime-section-text";
  group.append(label, copy);

  // The Arrival act compares your country's life expectancy at birth against
  // every world region for that year — a two-column split (chart | copy)
  // rather than the stacked stat row the other acts use.
  if (act.comparison?.length) {
    section.classList.add("has-comparison");
    // Comparison chart fills the left grid column; label + copy stay in the
    // right column via the existing .lifetime-story-section rules.
    section.append(createLifeExpectancyComparison(act.comparison), group);
    return section;
  }

  if (act.populationChange) {
    section.classList.add("is-present");
    section.append(group, createPopulationChangeChart(act.populationChange));
    return section;
  }

  if (act.globalLifeExpectancy) {
    section.classList.add("is-horizon");
    const chart = createGlobalLifeExpectancyChart(act.globalLifeExpectancy);
    if (chart) {
      // Surfaced on the section so the entrance observer can rise the curve
      // when this section scrolls into view.
      if (chart.playEntrance) section.playEntrance = chart.playEntrance;
      if (country) group.append(createExploreCountryLink(country));
      section.append(group, chart);
      return section;
    }
  }

  const statRow = document.createElement("div");
  statRow.className = "lifetime-stat-row";
  statRow.append(
    ...act.stats.map((stat) => createLifetimeStat(stat.value, stat.label)),
  );

  section.append(label, copy, statRow);
  return section;
}

export function createLifetimeController({
  elements,
  getCountryTrajectory,
  getCountries,
  getYears,
  getGlobalMetricsByYear,
  getPopulationSeries,
  getProjectionScenario,
  getCountryDemographicMetrics,
  getCountryAgeStructure,
  getViewMode,
  formatPopulation,
  goToYear,
  syncUrl,
  stopTour,
  catchUpScene,
  onOpenCountry,
  updateUiState,
  onActiveSectionChange,
}) {
  let active = false;
  let birthYear = null;
  let countryIso = null;
  let actIndex = -1;
  let countryCombobox = null;
  let titleBeforeLifetime = "";
  let viewModeHiddenBeforeStory = false;
  let scrollFrame = null;
  let scrollLockedUntil = 0;
  let lastWheelAt = 0;
  // Hiding #lifetimeAbout (e.g. [hidden]/display:none while paused for
  // "Explore Country's Dataset") doesn't reliably preserve its scrollTop —
  // captured here on pause and restored on resume instead of trusting that.
  let pausedScrollTop = null;
  // Reveals each section's charts once it scrolls into view; the running curve
  // animations are tracked so a rebuild/teardown can cancel them.
  let entranceObserver = null;
  let entranceAnimations = [];
  const aggregateCache = createLifetimeAggregateCache();

  const countries = () => getCountries() ?? [];
  const years = () => getYears() ?? [];
  const demographicMetrics = () => getCountryDemographicMetrics?.() ?? null;
  const ageStructure = () => getCountryAgeStructure?.() ?? null;
  const countryTrajectory = () => getCountryTrajectory?.() ?? null;
  const globalMetricsByYear = () => getGlobalMetricsByYear?.() ?? new Map();
  const populationSeriesFor = (country) =>
    getPopulationSeries?.(country) ?? country?.populations ?? [];

  function presentYear() {
    return lifetimePresentYear(years());
  }

  function birthYearBounds() {
    const availableYears = years();
    const min = availableYears[0] ?? 1950;
    return {
      min,
      max: presentYear() ?? availableYears.at(-1) ?? min,
    };
  }

  function birthYearErrorMessage(value) {
    const rawValue = String(value ?? "").trim();
    if (!rawValue) return "";
    const year = Number(rawValue);
    const { min, max } = birthYearBounds();
    if (
      !Number.isInteger(year) ||
      !years().includes(year) ||
      year < min ||
      year > max
    ) {
      return `Enter a birth year from ${min} to ${max}.`;
    }
    return "";
  }

  function updateBirthYearError() {
    const message = birthYearErrorMessage(elements.lifetimeBirthYear?.value);
    if (elements.lifetimeBirthYear) {
      elements.lifetimeBirthYear.setAttribute(
        "aria-invalid",
        message ? "true" : "false",
      );
    }
    if (elements.lifetimeBirthYearError) {
      elements.lifetimeBirthYearError.textContent = message;
      elements.lifetimeBirthYearError.hidden = !message;
    }
  }

  function selectedCountry() {
    return countryIso
      ? countries().find((country) => country.iso3 === countryIso)
      : null;
  }

  function lifetimeStartedTitle() {
    const country = selectedCountry();
    if (!Number.isFinite(birthYear) || !country?.name) {
      return "Your Lifespan.";
    }
    return `Born ${birthYear} in ${country.name}`;
  }

  function buildStory(country) {
    return buildLifetimeStory({
      country,
      birthYear,
      years: years(),
      countries: countries(),
      globalMetricsByYear: globalMetricsByYear(),
      getPopulationSeries: populationSeriesFor,
      demographicMetrics: demographicMetrics(),
      countryAgeStructure: ageStructure(),
      countryTrajectory: countryTrajectory(),
      formatPopulation,
      formatLifeExpectancy: METRICS.lifeExpectancy.format,
      aggregateCache,
      aggregateKey: getProjectionScenario?.() ?? "medium",
    });
  }

  // Rebuilds the story (cheap — aggregateCache memoizes the expensive part)
  // and draws whichever act this section holds to a PNG, named for the
  // section and country. Errors (e.g. canvas unsupported) are logged rather
  // than thrown, since a failed download shouldn't break the story itself.
  function downloadSectionImage(section) {
    if (!section) return;
    const index = Number(section.dataset.index);
    const country = selectedCountry();
    if (!country || !Number.isFinite(birthYear) || !Number.isFinite(index)) {
      return;
    }
    const act = buildStory(country)[index];
    if (!act) return;
    const title = `Born ${birthYear} in ${country.name}.`;
    renderLifetimeShareCard({ title, label: actLabel(index), act })
      .then((blob) => {
        const slug = actLabel(index)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "");
        downloadBlob(blob, `lifetime-${slug}-${country.iso3.toLowerCase()}.png`);
      })
      .catch((error) => {
        console.error("Failed to download lifetime section image:", error);
      });
  }

  function started() {
    return actIndex >= 0;
  }

  function selectCountry(iso3) {
    const country = countries().find((item) => item.iso3 === iso3);
    if (!country) return;
    countryIso = iso3;
    preloadFlagIcons([country.iso3]);
    elements.lifetimeCountry.value = country.name;
    countryCombobox?.hide();
    render();
    syncUrl();
  }

  // Text for the shared top-center projection-scenario label (owned by
  // script.js, also used by Chart view) — null hides it. Only the Horizon
  // act warrants it; every other act (and the "not started" state, -1) is a
  // historical year with nothing to disambiguate.
  function projectionLabelFor(index) {
    return index === HORIZON_ACT_INDEX
      ? `${capitalizeFirstLetter(getProjectionScenario?.() ?? "medium")} Projection`
      : null;
  }

  // Every actIndex write funnels through here so the shared label always
  // matches whichever act (if any) is actually showing.
  function setActIndex(index) {
    actIndex = index;
    onActiveSectionChange?.(projectionLabelFor(actIndex));
  }

  function setActiveSection(index) {
    const clamped = Math.min(
      LIFETIME_SECTION_COUNT - 1,
      Math.max(0, index),
    );
    setActIndex(clamped);
    elements.lifetimeJourney
      ?.querySelectorAll(".lifetime-progress-dot")
      .forEach((dot, i) => {
        dot.classList.toggle("active", i === clamped);
        dot.setAttribute("aria-current", i === clamped ? "step" : "false");
      });
  }

  function renderProgressDots() {
    elements.lifetimeJourney.replaceChildren(
      ...Array.from({ length: LIFETIME_SECTION_COUNT }, (_, index) => {
        const dot = document.createElement("button");
        dot.type = "button";
        dot.className = "lifetime-progress-dot";
        dot.setAttribute("aria-label", `Go to ${actLabel(index)}`);
        dot.dataset.index = String(index);
        return dot;
      }),
    );
    setActiveSection(actIndex);
  }

  function scrollToSection(index, behavior = "smooth") {
    const section = elements.lifetimeAbout?.querySelector(
      `.lifetime-story-section[data-index="${index}"]`,
    );
    if (!section) return;
    // "instant" must be the literal scroll value, not "auto" — the container's
    // scroll-behavior: smooth would otherwise animate what's meant to be a
    // jump (e.g. the reset-to-first when a fresh story is rendered), showing a
    // distracting scroll-back from wherever the previous story was left.
    section.scrollIntoView({
      behavior: behavior === "instant" ? "instant" : behavior,
      block: "start",
    });
    setActiveSection(index);
  }

  function sectionFromScrollPosition() {
    const viewportTop = elements.lifetimeAbout.getBoundingClientRect().top;
    const sections = [
      ...elements.lifetimeAbout.querySelectorAll(".lifetime-story-section"),
    ];
    if (!sections.length) return null;
    const nearest = sections.reduce(
      (best, section) => {
        const distance = Math.abs(
          section.getBoundingClientRect().top - viewportTop,
        );
        return distance < best.distance ? { section, distance } : best;
      },
      { section: sections[0], distance: Infinity },
    ).section;
    return Number(nearest.dataset.index);
  }

  function snapToAdjacentSection(direction, now = performance.now()) {
    if (!started() || !Number.isFinite(direction) || direction === 0) return;
    if (now < scrollLockedUntil) return;
    const currentIndex = sectionFromScrollPosition() ?? actIndex;
    const nextIndex = Math.min(
      LIFETIME_SECTION_COUNT - 1,
      Math.max(0, currentIndex + Math.sign(direction)),
    );
    if (nextIndex === currentIndex) return;
    scrollLockedUntil = now + LIFETIME_SCROLL_LOCK_MS;
    scrollToSection(nextIndex);
  }

  // Adds .is-in-view to each section the first time it scrolls into the story
  // viewport (driving the CSS bar/text entrance) and fires its curve rise, then
  // stops watching it — entrances play once per story build. Firing off an
  // observer (rather than synchronously) guarantees the initial hidden state
  // has painted, so the CSS transitions actually run.
  function revealSection(section) {
    if (!section || section.classList.contains("is-in-view")) return;
    section.classList.add("is-in-view");
    const handle = section.playEntrance?.();
    if (handle) entranceAnimations.push(handle);
  }

  function teardownEntrances() {
    entranceObserver?.disconnect();
    entranceObserver = null;
    entranceAnimations.forEach((handle) => handle?.cancel?.());
    entranceAnimations = [];
  }

  function observeEntrances(sections) {
    teardownEntrances();
    if (typeof IntersectionObserver !== "function") {
      sections.forEach(revealSection);
      return;
    }
    entranceObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          revealSection(entry.target);
          entranceObserver.unobserve(entry.target);
        });
      },
      { root: elements.lifetimeAbout, threshold: 0.55 },
    );
    sections.forEach((section) => entranceObserver.observe(section));
  }

  function renderStory(country) {
    if (!active || !started()) return;
    const sections = buildStory(country).map((act, index) =>
      createStorySection(act, index, country),
    );
    elements.lifetimeAbout.replaceChildren(...sections);
    renderProgressDots();
    observeEntrances(sections);
    requestAnimationFrame(() => scrollToSection(actIndex, "instant"));
  }

  function resetStory() {
    if (scrollFrame != null) {
      cancelAnimationFrame(scrollFrame);
      scrollFrame = null;
    }
    teardownEntrances();
    setActIndex(-1);
    scrollLockedUntil = 0;
    lastWheelAt = 0;
    elements.lifetimeAbout?.replaceChildren();
    // Drop the scroll position too, so the next story opens at the first
    // section instead of the browser restoring where the last one was left.
    if (elements.lifetimeAbout) elements.lifetimeAbout.scrollTop = 0;
    elements.lifetimeJourney?.replaceChildren();
    render();
    syncUrl();
  }

  function render() {
    if (!elements.lifetimeView || elements.lifetimeView.hidden) return;
    elements.lifetimeView.classList.toggle("is-started", started());
    updateUiState({ lifetimeStarted: started() });
    if (elements.headerTitle) {
      elements.headerTitle.textContent = started()
        ? lifetimeStartedTitle()
        : "World Population.";
    }
    if (elements.buttonsContainer) {
      elements.buttonsContainer.hidden = started() || viewModeHiddenBeforeStory;
    }
    if (birthYear != null) {
      elements.lifetimeBirthYear.value = String(birthYear);
    }
    const country = selectedCountry();
    if (country && document.activeElement !== elements.lifetimeCountry) {
      elements.lifetimeCountry.value = country.name;
    }
    updateBirthYearError();
    const ready =
      Number.isFinite(birthYear) && birthYear <= presentYear() && !!country;
    elements.lifetimeButtonBegin.disabled = !ready;
    elements.lifetimeForm.hidden = started();
    elements.lifetimeButtonBegin.hidden = started();
    elements.lifetimeStory.hidden = !ready || !started();
    if (!ready) return;
    renderStory(country);
  }

  function begin() {
    const value = Number(elements.lifetimeBirthYear.value);
    birthYear = years().includes(value) && value <= presentYear() ? value : null;
    const country = selectedCountry();
    if (!Number.isFinite(birthYear) || !country) {
      setActIndex(-1);
      updateBirthYearError();
      render();
      syncUrl();
      return;
    }

    setActIndex(0);
    // The Arrival act opens on the birth year; no need to build the story here.
    const targetYear = birthYear;
    trackEvent("lifetime_begin", {
      birthYear,
      country: country.iso3,
      countryName: country.name,
      storyYear: targetYear,
    });
    if (years().includes(targetYear)) {
      goToYear(targetYear);
    } else {
      render();
      syncUrl();
    }
  }

  function bindEvents() {
    elements.lifetimeButtonBegin?.addEventListener("click", begin);
    elements.lifetimeForm?.addEventListener("submit", (event) => {
      event.preventDefault();
      begin();
    });
    elements.lifetimeClose?.addEventListener("click", () => {
      if (started()) {
        resetStory();
        return;
      }
      setActive(false);
    });
    elements.lifetimeAbout?.addEventListener(
      "wheel",
      (event) => {
        if (!started() || Math.abs(event.deltaY) < 4) return;
        event.preventDefault();
        const now = performance.now();
        const isSameWheelGesture = now - lastWheelAt < LIFETIME_WHEEL_IDLE_MS;
        lastWheelAt = now;
        if (now < scrollLockedUntil || isSameWheelGesture) {
          scrollLockedUntil = Math.max(
            scrollLockedUntil,
            now + LIFETIME_WHEEL_IDLE_MS,
          );
          return;
        }
        snapToAdjacentSection(event.deltaY, now);
      },
      { passive: false },
    );
    elements.lifetimeAbout?.addEventListener("keydown", (event) => {
      if (!started()) return;
      if (["ArrowDown", "PageDown", " "].includes(event.key)) {
        event.preventDefault();
        snapToAdjacentSection(1);
      } else if (["ArrowUp", "PageUp"].includes(event.key)) {
        event.preventDefault();
        snapToAdjacentSection(-1);
      }
    });
    elements.lifetimeAbout?.addEventListener("click", (event) => {
      const link = event.target.closest(".lifetime-explore-link[data-iso3]");
      if (link && elements.lifetimeAbout.contains(link)) {
        const country = countries().find((item) => item.iso3 === link.dataset.iso3);
        if (country) onOpenCountry?.(country);
        return;
      }
      const downloadButton = event.target.closest(".lifetime-section-download");
      if (downloadButton && elements.lifetimeAbout.contains(downloadButton)) {
        downloadSectionImage(downloadButton.closest(".lifetime-story-section"));
      }
    });
    elements.lifetimeAbout?.addEventListener("scroll", () => {
      if (!started() || scrollFrame != null) return;
      scrollFrame = requestAnimationFrame(() => {
        scrollFrame = null;
        const sectionIndex = sectionFromScrollPosition();
        if (sectionIndex != null) setActiveSection(sectionIndex);
      });
    });
    elements.lifetimeJourney?.addEventListener("click", (event) => {
      const dot = event.target.closest(".lifetime-progress-dot[data-index]");
      if (!dot || !elements.lifetimeJourney.contains(dot)) return;
      scrollToSection(Number(dot.dataset.index));
    });
    elements.lifetimeBirthYear?.addEventListener("input", () => {
      const value = Number(elements.lifetimeBirthYear.value);
      // Only a real, past (<= present) data year counts; anything else leaves
      // birthYear null so the Begin button stays disabled.
      birthYear =
        years().includes(value) && value <= presentYear() ? value : null;
      // Editing an input backs out of a running story.
      if (started()) setActIndex(-1);
      render();
      syncUrl();
    });
    elements.lifetimeBirthYear?.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || elements.lifetimeButtonBegin.disabled) {
        return;
      }
      event.preventDefault();
      begin();
    });
    countryCombobox = createCountryCombobox({
      input: elements.lifetimeCountry,
      list: elements.lifetimeCountrySuggestions,
      getCandidates: (query) =>
        matchCountries(query, {
          countries: countries(),
          convertCode: convertAlpha3ToAlpha2,
          limit: LIFETIME_COUNTRY_SUGGESTION_LIMIT,
          aliases: {},
        }),
      onSelect: (country) => selectCountry(country.iso3),
      flagUrl: flagIconUrl,
      preloadFlags: preloadFlagIcons,
      onInput: (value) => {
        if (!value.trim() && countryIso) {
          countryIso = null;
          setActIndex(-1);
          render();
          syncUrl();
        }
      },
      onFocus: () => elements.lifetimeCountry.select(),
      onEnterWithoutSelection: (event) => {
        if (elements.lifetimeButtonBegin.disabled) return;
        event.preventDefault();
        begin();
      },
      blurDismissMs: LIFETIME_COUNTRY_BLUR_DISMISS_MS,
      closeOnOutsideClick: false,
    });
    elements.lifetimeCountry?.addEventListener("blur", () => {
      setTimeout(() => {
        const country = selectedCountry();
        elements.lifetimeCountry.value = country ? country.name : "";
      }, LIFETIME_COUNTRY_BLUR_DISMISS_MS);
    });
  }

  // preserveStory: true is the "Explore Country's Dataset" round-trip — the
  // Horizon act jumps out to the full country-detail view and should land
  // back on the exact same section (not the intro form) once that closes.
  // It just toggles visibility, leaving actIndex/birthYear/countryIso and the
  // already-built DOM (including which sections have already played their
  // entrance) untouched, rather than tearing the story down and rebuilding it
  // the way a genuine close/reopen does.
  function setActive(nextActive, { preserveStory = false } = {}) {
    if (nextActive === active) return;
    if (!nextActive && preserveStory) {
      pausedScrollTop = elements.lifetimeAbout?.scrollTop ?? null;
    }
    active = nextActive;
    elements.lifetimeView.hidden = !nextActive;
    updateUiState({
      lifetimeActive: nextActive,
      lifetimeStarted: nextActive && started(),
    });
    elements.viewMode.querySelectorAll("button").forEach((btn) =>
      btn.classList.toggle(
        "active",
        btn.dataset.mode === (nextActive ? "lifetime" : getViewMode()),
      ),
    );
    // The shared projection-scenario label is a fixed element outside
    // #lifetimeView, so it needs an explicit hide here too — toggling
    // #lifetimeView's own [hidden] (above) doesn't touch it, and the
    // preserveStory pause (below) never calls resetStory(), which is the
    // only other place that would otherwise clear it.
    if (!nextActive) onActiveSectionChange?.(null);
    if (nextActive) {
      if (!preserveStory) {
        titleBeforeLifetime = elements.headerTitle?.textContent ?? "";
        viewModeHiddenBeforeStory = elements.buttonsContainer.hidden;
        render();
      } else {
        onActiveSectionChange?.(projectionLabelFor(actIndex));
        if (pausedScrollTop != null) {
          // Toggling [hidden] doesn't reliably preserve scrollTop across the
          // round-trip — restore it explicitly once layout has settled.
          const restoreTo = pausedScrollTop;
          pausedScrollTop = null;
          requestAnimationFrame(() => {
            elements.lifetimeAbout.scrollTop = restoreTo;
          });
        }
      }
      stopTour();
    } else if (preserveStory) {
      // Nothing else to do — just hidden, ready to resume as-is.
    } else {
      resetStory();
      elements.lifetimeView.classList.remove("is-started");
      updateUiState({ lifetimeStarted: false });
      elements.lifetimeForm.hidden = false;
      elements.lifetimeButtonBegin.hidden = false;
      elements.lifetimeStory.hidden = true;
      if (elements.headerTitle) {
        elements.headerTitle.textContent =
          titleBeforeLifetime || "World Population.";
      }
      elements.buttonsContainer.hidden = viewModeHiddenBeforeStory;
      catchUpScene();
    }
    syncUrl();
  }

  function applyUrlState({ birthYear: nextBirthYear, country }) {
    if (nextBirthYear != null) birthYear = nextBirthYear;
    if (country) countryIso = country;
  }

  function applyToUrlState(state) {
    Object.assign(state, { view: "lifetime" });
    if (birthYear != null) state.birthYear = birthYear;
    if (countryIso) state.country = countryIso;
  }

  function setBirthYearMax() {
    const { min, max } = birthYearBounds();
    elements.lifetimeBirthYear.min = String(min);
    elements.lifetimeBirthYear.max = String(max);
  }

  return {
    bindEvents,
    setActive,
    render,
    isActive: () => active,
    applyUrlState,
    applyToUrlState,
    setBirthYearMax,
  };
}
