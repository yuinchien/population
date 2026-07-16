export function serializeUrlState(state) {
  const params = new URLSearchParams();
  if (state.mode === "map") params.set("mode", "map");

  if (state.view === "chart") {
    params.set("view", "chart");
    params.set("metric", state.metric);
    if (state.countries?.length) params.set("countries", state.countries.join(","));
  } else if (state.view === "country") {
    params.set("view", "country");
    params.set("country", state.country);
  } else if (state.view === "group") {
    params.set("view", "group");
    params.set("groupMode", state.groupMode);
    params.set("group", state.group);
  } else if (state.view === "cosmos") {
    params.set("view", "cosmos");
  }

  if (state.year != null) params.set("year", String(state.year));
  return params.toString();
}

export function parseUrlState(search, { years = [], countryCodes = [] } = {}) {
  const params = new URLSearchParams(search);
  const state = {};
  const year = Number(params.get("year"));
  if (years.includes(year)) state.year = year;
  if (params.get("mode") === "map") state.mode = "map";

  const view = params.get("view");
  if (view === "chart") {
    state.view = "chart";
    state.metric = params.get("metric") || null;
    const allowed = new Set(countryCodes);
    state.countries = (params.get("countries") || "")
      .split(",")
      .map((code) => code.trim().toUpperCase())
      .filter((code) => allowed.has(code));
  } else if (view === "country") {
    const country = params.get("country")?.toUpperCase();
    if (countryCodes.includes(country)) {
      state.view = "country";
      state.country = country;
    }
  } else if (view === "group") {
    const groupMode = params.get("groupMode");
    const group = params.get("group");
    if (group && (groupMode === "region" || groupMode === "income")) {
      state.view = "group";
      state.groupMode = groupMode;
      state.group = group;
    }
  } else if (view === "cosmos") {
    state.view = "cosmos";
  }
  return state;
}
