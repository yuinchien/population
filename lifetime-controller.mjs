import {
  convertAlpha3ToAlpha2,
  flagIconUrl,
} from "./data-loader.mjs";
import {
  buildLifetimeStoryAct,
  lifetimePresentYear,
} from "./lifetime-model.mjs";
import { METRICS } from "./metrics.mjs";

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

function actLabel(index) {
  return [
    "Act I · The Arrival",
    "Act II · The Present Intersect",
    "Act III · The Milestone Horizon",
    "Act IV · The Legacy",
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

  function renderAct(country) {
    if (!active || elements.lifetimeStory.hidden) return;
    const act = buildAct(country, actIndex);
    const label = document.createElement("div");
    label.className = "lifetime-section-label";
    label.textContent = actLabel(actIndex);

    const copy = document.createElement("p");
    copy.className = "lifetime-act-copy";
    copy.textContent = act.text;

    const progress = document.createElement("div");
    progress.className = "lifetime-progress";
    progress.textContent = `${actIndex + 1} / 4 · ${act.year}`;

    const statRow = document.createElement("div");
    statRow.className = "lifetime-stat-row";
    statRow.append(
      ...act.stats.map((stat) => createLifetimeStat(stat.value, stat.label)),
    );

    elements.lifetimeAbout.replaceChildren(label, copy, progress);
    elements.lifetimeJourney.replaceChildren(statRow);
  }

  function render() {
    if (!elements.lifetimeView || elements.lifetimeView.hidden) return;
    if (birthYear != null) {
      elements.lifetimeBirthYear.value = String(birthYear);
    }
    const country = selectedCountry();
    if (country && document.activeElement !== elements.lifetimeCountry) {
      elements.lifetimeCountry.value = country.name;
    }
    const ready =
      Number.isFinite(birthYear) && birthYear <= presentYear() && !!country;
    elements.lifetimeButtonBegin.textContent =
      actIndex < 0 ? "Begin" : actIndex >= 3 ? "Restart" : "Next";
    elements.lifetimeStory.hidden = !ready || actIndex < 0;
    if (!ready) return;
    if (actIndex >= 0) renderAct(country);
  }

  function advance() {
    const value = Number(elements.lifetimeBirthYear.value);
    birthYear = years().includes(value) && value <= presentYear() ? value : null;
    const country = selectedCountry();
    if (!Number.isFinite(birthYear) || !country) {
      actIndex = -1;
      render();
      syncUrl();
      return;
    }

    actIndex = actIndex < 0 || actIndex >= 3 ? 0 : actIndex + 1;
    const targetYear = buildAct(country, actIndex).year;
    if (years().includes(targetYear)) {
      goToYear(targetYear);
    } else {
      render();
      syncUrl();
    }
  }

  function bindEvents() {
    elements.lifetimeButtonBegin?.addEventListener("click", advance);
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
    elements.viewMode.querySelectorAll("button").forEach((btn) =>
      btn.classList.toggle(
        "active",
        btn.dataset.mode === (nextActive ? "lifetime" : getViewMode()),
      ),
    );
    if (nextActive) {
      stopTour();
      render();
    } else {
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
