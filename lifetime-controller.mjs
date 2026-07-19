import {
  convertAlpha3ToAlpha2,
  flagIconUrl,
} from "./data-loader.mjs";
import {
  buildLifetimeStoryAct,
  lifetimePresentYear,
} from "./lifetime-model.mjs";
import { METRICS } from "./metrics.mjs";

const LIFETIME_SECTION_COUNT = 3;
const LIFETIME_SCROLL_LOCK_MS = 900;
const LIFETIME_WHEEL_IDLE_MS = 240;

function createLifetimeStat(value, label) {
  const stat = document.createElement("div");
  stat.className = "lifetime-stat";
  const valueEl = document.createElement("div");
  valueEl.className = "lifetime-stat-value";
  valueEl.textContent = value;
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

export function createLifetimeController({
  elements,
  getCountries,
  getYears,
  getGlobalMetricsByYear,
  getCountryDemographicMetrics,
  getCountryAgeStructure,
  getViewMode,
  formatPopulation,
  goToYear,
  syncUrl,
  stopTour,
  catchUpScene,
}) {
  let active = false;
  let birthYear = null;
  let countryIso = null;
  let actIndex = -1;
  let suggestionActiveIndex = -1;
  let titleBeforeLifetime = "";
  let viewModeHiddenBeforeStory = false;
  let scrollFrame = null;
  let scrollLockedUntil = 0;
  let lastWheelAt = 0;

  const countries = () => getCountries() ?? [];
  const years = () => getYears() ?? [];
  const demographicMetrics = () => getCountryDemographicMetrics?.() ?? null;
  const ageStructure = () => getCountryAgeStructure?.() ?? null;
  const globalMetricsByYear = () => getGlobalMetricsByYear?.() ?? new Map();

  function presentYear() {
    return lifetimePresentYear(years());
  }

  function selectedCountry() {
    return countryIso
      ? countries().find((country) => country.iso3 === countryIso)
      : null;
  }

  function buildAct(country, index) {
    return buildLifetimeStoryAct({
      country,
      actIndex: index,
      birthYear,
      years: years(),
      countries: countries(),
      globalMetricsByYear: globalMetricsByYear(),
      demographicMetrics: demographicMetrics(),
      countryAgeStructure: ageStructure(),
      formatPopulation,
      formatLifeExpectancy: METRICS.lifeExpectancy.format,
    });
  }

  function started() {
    return actIndex >= 0;
  }

  function countryMatches(query) {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return countries()
      .filter((country) => {
        const iso2 = convertAlpha3ToAlpha2(country.iso3);
        return (
          country.name.toLowerCase().includes(q) ||
          (iso2 && iso2.toLowerCase().includes(q))
        );
      })
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 40);
  }

  function hideCountrySuggestions() {
    elements.lifetimeCountrySuggestions.hidden = true;
    elements.lifetimeCountrySuggestions.replaceChildren();
    suggestionActiveIndex = -1;
  }

  function renderCountrySuggestions() {
    const query = elements.lifetimeCountry.value.trim();
    if (!query) {
      hideCountrySuggestions();
      return;
    }
    const matches = countryMatches(query);
    suggestionActiveIndex = -1;
    elements.lifetimeCountrySuggestions.hidden = false;
    if (!matches.length) {
      const empty = document.createElement("div");
      empty.className = "chip-suggestions-empty";
      empty.textContent = "No matching countries";
      elements.lifetimeCountrySuggestions.replaceChildren(empty);
      return;
    }
    elements.lifetimeCountrySuggestions.replaceChildren(
      ...matches.map((country) => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "chip-suggestion";
        item.dataset.iso3 = country.iso3;
        const flag = document.createElement("span");
        flag.className = "chip-suggestion-flag";
        flag.style.backgroundImage = `url(${flagIconUrl(country.iso3)})`;
        const label = document.createElement("span");
        label.textContent = country.name;
        item.append(flag, label);
        return item;
      }),
    );
  }

  function moveSuggestionActive(delta) {
    const items = elements.lifetimeCountrySuggestions.querySelectorAll(
      ".chip-suggestion",
    );
    if (!items.length) return;
    suggestionActiveIndex = Math.min(
      items.length - 1,
      Math.max(0, suggestionActiveIndex + delta),
    );
    items.forEach((item, i) =>
      item.classList.toggle("highlighted", i === suggestionActiveIndex),
    );
    items[suggestionActiveIndex].scrollIntoView({ block: "nearest" });
  }

  function selectCountry(iso3) {
    const country = countries().find((item) => item.iso3 === iso3);
    if (!country) return;
    countryIso = iso3;
    elements.lifetimeCountry.value = country.name;
    hideCountrySuggestions();
    render();
    syncUrl();
  }

  function setActiveSection(index) {
    const clamped = Math.min(
      LIFETIME_SECTION_COUNT - 1,
      Math.max(0, index),
    );
    actIndex = clamped;
    elements.lifetimeJourney
      ?.querySelectorAll(".lifetime-progress-dot")
      .forEach((dot, i) => {
        dot.classList.toggle("active", i === clamped);
        dot.setAttribute("aria-current", i === clamped ? "step" : "false");
      });
  }

  function createLifeExpectancyComparison(rows) {
    const chart = document.createElement("div");
    chart.className = "lifetime-le-comparison";

    const values = rows.map((row) => row.value);
    const max = Math.max(...values);
    const min = Math.min(...values);
    const range = max - min || 1;
    const format = METRICS.lifeExpectancy.format;
    rows.forEach((row) => {
      const item = document.createElement("div");
      item.className = `lifetime-le-row${row.highlight ? " is-highlight" : ""}`;
      const bar = document.createElement("div");
      bar.className = "lifetime-le-bar";
      // Zoomed proportional width so close life-expectancy values still read as
      // different; a floor keeps the shortest bar visible, the ceiling leaves
      // room for the value label, and CSS min-width keeps long labels legible
      // inside their pill.
      bar.style.width = `${(0.2 + 0.6 * ((row.value - min) / range)) * 100}%`;
      const name = document.createElement("span");
      name.className = "lifetime-le-name";
      name.textContent = row.label;
      bar.append(name);
      const value = document.createElement("span");
      value.className = "lifetime-le-value";
      value.textContent = format(row.value);
      item.append(bar, value);
      chart.append(item);
    });
    return chart;
  }

function createPopulationChangeChart(change) {
    const chart = document.createElement("div");
    chart.className = "lifetime-population-change";
    chart.style.setProperty(
      "--lifetime-birth-share",
      percentFromShare(change?.birthShare, 0.5),
    );

    const birthSegment = document.createElement("div");
    birthSegment.className = "lifetime-population-segment birth";
    birthSegment.style.width = percentFromShare(change?.birthShare, 0.5);

    const birthValue = document.createElement("span");
    birthValue.className = "lifetime-population-value";
    birthValue.textContent = change?.birthPopulation ?? "N/A";
    birthSegment.append(birthValue);

    const addedSegment = document.createElement("div");
    addedSegment.className = "lifetime-population-segment added";
    addedSegment.style.width = percentFromShare(change?.addedShare, 0.5);
    addedSegment.textContent = change?.addedPopulation
      ? `+${change.addedPopulation}`
      : "+N/A";

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
  const height = 430;
  const padding = { top: 68, right: 18, bottom: 48, left: 44 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const yearsOnly = rows.map((row) => row.year);
  const values = rows.map((row) => row.value);
  const minYear = Math.min(...yearsOnly);
  const maxYear = Math.max(change?.maxYear ?? yearsOnly.at(-1), ...yearsOnly);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const valuePadding = Math.max(2, (maxValue - minValue) * 0.12);
  const yMin = minValue - valuePadding;
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
    value.textContent = format(marker.value).replace(/\s*yrs$/, "");

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
  return chart;
}

  function createStorySection(country, index) {
    const act = buildAct(country, index);
    const section = document.createElement("section");
    section.className = "lifetime-story-section";
    section.dataset.index = String(index);
    section.tabIndex = -1;

    const label = document.createElement("div");
    label.className = "lifetime-section-label";
    label.textContent = actLabel(index);

    const copy = document.createElement("p");
    copy.className = "lifetime-act-copy";
    copy.textContent = act.text;

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
    section.scrollIntoView({
      behavior: behavior === "instant" ? "auto" : behavior,
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

  function renderStory(country) {
    if (!active || !started()) return;
    const sections = Array.from({ length: LIFETIME_SECTION_COUNT }, (_, index) =>
      createStorySection(country, index),
    );
    elements.lifetimeAbout.replaceChildren(...sections);
    renderProgressDots();
    requestAnimationFrame(() => scrollToSection(actIndex, "instant"));
  }

  function resetStory() {
    if (scrollFrame != null) {
      cancelAnimationFrame(scrollFrame);
      scrollFrame = null;
    }
    actIndex = -1;
    scrollLockedUntil = 0;
    lastWheelAt = 0;
    elements.lifetimeAbout?.replaceChildren();
    elements.lifetimeJourney?.replaceChildren();
    render();
    syncUrl();
  }

  function render() {
    if (!elements.lifetimeView || elements.lifetimeView.hidden) return;
    elements.lifetimeView.classList.toggle("is-started", started());
    document.body.classList.toggle("view-lifetime-started", started());
    if (elements.headerTitle) {
      elements.headerTitle.textContent = started()
        ? "Your Lifespan."
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
      actIndex = -1;
      render();
      syncUrl();
      return;
    }

    actIndex = 0;
    const targetYear = buildAct(country, 0).year;
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
      if (started()) actIndex = -1;
      render();
      syncUrl();
    });
    elements.lifetimeCountry?.addEventListener("input", () => {
      if (!elements.lifetimeCountry.value.trim() && countryIso) {
        countryIso = null;
        actIndex = -1;
        render();
        syncUrl();
      }
      renderCountrySuggestions();
    });
    elements.lifetimeCountry?.addEventListener("focus", () => {
      elements.lifetimeCountry.select();
      renderCountrySuggestions();
    });
    elements.lifetimeCountry?.addEventListener("blur", () => {
      setTimeout(() => {
        hideCountrySuggestions();
        const country = selectedCountry();
        elements.lifetimeCountry.value = country ? country.name : "";
      }, 150);
    });
    elements.lifetimeCountry?.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        moveSuggestionActive(1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        moveSuggestionActive(-1);
      } else if (event.key === "Enter") {
        const items = elements.lifetimeCountrySuggestions.querySelectorAll(
          ".chip-suggestion",
        );
        if (!items.length) return;
        event.preventDefault();
        const index = suggestionActiveIndex >= 0 ? suggestionActiveIndex : 0;
        selectCountry(items[index].dataset.iso3);
      } else if (event.key === "Escape") {
        hideCountrySuggestions();
      }
    });
    elements.lifetimeCountrySuggestions?.addEventListener("click", (event) => {
      const button = event.target.closest(".chip-suggestion[data-iso3]");
      if (!button || !elements.lifetimeCountrySuggestions.contains(button)) {
        return;
      }
      selectCountry(button.dataset.iso3);
    });
  }

  function setActive(nextActive) {
    if (nextActive === active) return;
    active = nextActive;
    elements.lifetimeView.hidden = !nextActive;
    document.body.classList.toggle("view-lifetime", nextActive);
    document.body.classList.toggle(
      "view-lifetime-started",
      nextActive && started(),
    );
    elements.viewMode.querySelectorAll("button").forEach((btn) =>
      btn.classList.toggle(
        "active",
        btn.dataset.mode === (nextActive ? "lifetime" : getViewMode()),
      ),
    );
    if (nextActive) {
      titleBeforeLifetime = elements.headerTitle?.textContent ?? "";
      viewModeHiddenBeforeStory = elements.buttonsContainer.hidden;
      stopTour();
      render();
    } else {
      resetStory();
      elements.lifetimeView.classList.remove("is-started");
      document.body.classList.remove("view-lifetime-started");
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
    elements.lifetimeBirthYear.max = String(presentYear());
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
