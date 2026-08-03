const DEFAULT_ALIASES = { uk: "GB" };

export function matchCountries(
  query,
  {
    countries,
    convertCode,
    exclude = [],
    aliases = DEFAULT_ALIASES,
    limit = 8,
  },
) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];
  const excluded = new Set(exclude);
  const aliasCode = aliases[normalized];
  return countries
    .filter((country) => {
      if (excluded.has(country.iso3)) return false;
      const iso2 = convertCode(country.iso3);
      return (
        country.name.toLowerCase().includes(normalized) ||
        iso2?.toLowerCase().includes(normalized) ||
        (aliasCode && iso2 === aliasCode)
      );
    })
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, limit);
}

export function nextComboboxIndex(current, delta, itemCount) {
  if (!itemCount) return -1;
  return Math.min(itemCount - 1, Math.max(0, current + delta));
}

export function createCountryCombobox({
  input,
  list,
  container = input.parentElement,
  getCandidates,
  onSelect,
  flagUrl,
  preloadFlags = () => {},
  renderPrefix = null,
  onInput = null,
  onFocus = null,
  onEscape = null,
  onEmptyBackspace = null,
  onEnterWithoutSelection = null,
  blurDismissMs = null,
  closeOnOutsideClick = true,
}) {
  let activeIndex = -1;
  let candidates = [];
  let blurTimer = null;

  if (!list.id) list.id = `${input.id || "country"}-suggestions`;
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-controls", list.id);
  input.setAttribute("aria-expanded", "false");
  list.setAttribute("role", "listbox");

  function hide() {
    list.hidden = true;
    list.replaceChildren();
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    activeIndex = -1;
    candidates = [];
  }

  function render() {
    const query = input.value.trim();
    candidates = getCandidates(query);
    activeIndex = -1;
    input.removeAttribute("aria-activedescendant");
    if (!query && !candidates.length) {
      hide();
      return;
    }
    preloadFlags(candidates.map((country) => country.iso3));
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
    if (!candidates.length) {
      const empty = document.createElement("div");
      empty.className = "chip-suggestions-empty";
      empty.textContent = "No matching countries";
      list.replaceChildren(empty);
      return;
    }
    const children = [];
    const prefix = renderPrefix?.(query, candidates);
    if (prefix) children.push(prefix);
    children.push(
      ...candidates.map((country, index) => {
        const item = document.createElement("button");
        item.type = "button";
        item.id = `${list.id}-option-${index}`;
        item.className = "chip-suggestion";
        item.dataset.iso3 = country.iso3;
        item.setAttribute("role", "option");
        item.setAttribute("aria-selected", "false");
        const flag = document.createElement("span");
        flag.className = "chip-suggestion-flag";
        flag.style.backgroundImage = `url(${flagUrl(country.iso3)})`;
        const label = document.createElement("span");
        label.textContent = country.name;
        item.append(flag, label);
        return item;
      }),
    );
    list.replaceChildren(...children);
  }

  function move(delta) {
    const items = [...list.querySelectorAll(".chip-suggestion")];
    if (!items.length) return;
    activeIndex = nextComboboxIndex(activeIndex, delta, items.length);
    items.forEach((item, index) => {
      const active = index === activeIndex;
      item.classList.toggle("highlighted", active);
      item.setAttribute("aria-selected", String(active));
    });
    const active = items[activeIndex];
    input.setAttribute("aria-activedescendant", active.id);
    active.scrollIntoView({ block: "nearest" });
  }

  function select(index = activeIndex >= 0 ? activeIndex : 0) {
    const country = candidates[index];
    if (!country) return false;
    onSelect(country);
    hide();
    return true;
  }

  function handleInput() {
    onInput?.(input.value);
    render();
  }

  function handleFocus() {
    onFocus?.();
    render();
  }

  function handleKeydown(event) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (list.hidden) return;
      event.preventDefault();
      move(event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Enter") {
      if (candidates.length) {
        event.preventDefault();
        select();
      } else {
        onEnterWithoutSelection?.(event);
      }
    } else if (event.key === "Backspace" && !input.value) {
      onEmptyBackspace?.(event);
    } else if (event.key === "Escape") {
      const wasOpen = !list.hidden;
      hide();
      onEscape?.({ wasOpen });
    }
  }

  function handleListClick(event) {
    const item = event.target.closest(".chip-suggestion[data-iso3]");
    if (!item || !list.contains(item)) return;
    const index = candidates.findIndex(
      (country) => country.iso3 === item.dataset.iso3,
    );
    select(index);
  }

  function handleDocumentClick(event) {
    if (!event.composedPath().includes(container)) hide();
  }

  input.addEventListener("input", handleInput);
  input.addEventListener("focus", handleFocus);
  input.addEventListener("keydown", handleKeydown);
  list.addEventListener("click", handleListClick);
  if (blurDismissMs != null) {
    input.addEventListener("blur", () => {
      clearTimeout(blurTimer);
      blurTimer = setTimeout(hide, blurDismissMs);
    });
  }
  if (closeOnOutsideClick) {
    document.addEventListener("click", handleDocumentClick);
  }

  return {
    hide,
    render,
    focus: () => input.focus(),
    dispose() {
      clearTimeout(blurTimer);
      input.removeEventListener("input", handleInput);
      input.removeEventListener("focus", handleFocus);
      input.removeEventListener("keydown", handleKeydown);
      list.removeEventListener("click", handleListClick);
      document.removeEventListener("click", handleDocumentClick);
    },
  };
}
