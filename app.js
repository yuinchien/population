import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  CSS2DRenderer,
  CSS2DObject,
} from "three/addons/renderers/CSS2DRenderer.js";

const API_BASE = "https://api.worldbank.org/v2";

const indicators = [
  {
    code: "NY.GDP.PCAP.CD",
    name: "GDP per capita",
    unit: "current US$",
    description: "GDP per person in current US dollars",
  },
  {
    code: "SP.POP.TOTL",
    name: "Population",
    unit: "people",
    description: "Total population",
  },
  {
    code: "SP.DYN.LE00.IN",
    name: "Life expectancy",
    unit: "years",
    description: "Life expectancy at birth",
  },
  {
    code: "EN.ATM.CO2E.PC",
    name: "CO2 emissions per capita",
    unit: "metric tons",
    description: "Carbon dioxide emissions per person",
  },
  {
    code: "SE.XPD.TOTL.GD.ZS",
    name: "Education spending",
    unit: "% of GDP",
    description: "Government expenditure on education",
  },
  {
    code: "SL.UEM.TOTL.ZS",
    name: "Unemployment",
    unit: "% of labor force",
    description: "Modeled ILO estimate",
  },
];

const palette = [
  "#0f766e",
  "#b7791f",
  "#2563a8",
  "#b33a3a",
  "#6d5bd0",
  "#2f855a",
];
const defaultCountries = ["USA", "JPN", "DEU", "BRA"];
const manualCountries = [
  {
    id: "TWN",
    name: "Taiwan",
    region: { id: "EAS" },
  },
];

const elements = {
  indicator: document.querySelector("#indicator"),
  customIndicator: document.querySelector("#customIndicator"),
  countries: document.querySelector("#countries"),
  startYear: document.querySelector("#startYear"),
  endYear: document.querySelector("#endYear"),
  lineMode: document.querySelector("#lineMode"),
  barMode: document.querySelector("#barMode"),
  status: document.querySelector("#status"),
  indicatorLabel: document.querySelector("#indicatorLabel"),
  chartTitle: document.querySelector("#chartTitle"),
  meta: document.querySelector("#meta"),
  chart: document.querySelector("#chart"),
  chart3d: document.querySelector("#chart3d"),
  chartWrap: document.querySelector(".chart-wrap"),
  chartLegend: document.querySelector("#chartLegend"),
  tooltip: document.querySelector("#tooltip"),
};

const state = {
  countries: [],
  data: [],
  mode: "line",
  activeIndicator: indicators[0],
  loading: false,
};

const BAR_COLOR = 0xc4cac9;

const scene3d = {
  scene: null,
  camera: null,
  renderer: null,
  labelRenderer: null,
  controls: null,
  barGroup: null,
  labelGroup: null,
  raf: null,
  raycaster: null,
  pointer: null,
  ground: null,
  grid: null,
};

function init() {
  const currentYear = new Date().getFullYear();
  elements.startYear.value = currentYear - 20;
  elements.endYear.value = currentYear - 1;

  indicators.forEach((indicator) => {
    const option = document.createElement("option");
    option.value = indicator.code;
    option.textContent = `${indicator.name} (${indicator.code})`;
    elements.indicator.append(option);
  });

  restoreFromUrl();
  bindEvents();
  loadCountries();
}

function bindEvents() {
  elements.indicator.addEventListener("change", () => {
    const selected = indicators.find(
      (item) => item.code === elements.indicator.value,
    );
    state.activeIndicator = selected || indicatorFromCustom();
    elements.customIndicator.value = "";
    updateUrl();
    fetchAndRender();
  });

  elements.customIndicator.addEventListener("change", () => {
    if (!elements.customIndicator.value.trim()) return;
    state.activeIndicator = indicatorFromCustom();
    updateUrl();
    fetchAndRender();
  });

  elements.countries.addEventListener("change", () => {
    updateUrl();
    fetchAndRender();
  });

  elements.startYear.addEventListener("change", handleYearChange);
  elements.endYear.addEventListener("change", handleYearChange);
  elements.lineMode.addEventListener("click", () => setMode("line"));
  elements.barMode.addEventListener("click", () => setMode("bar"));
  window.addEventListener("resize", () => {
    render();
    resizeThree();
  });
}

function handleYearChange() {
  const start = Number(elements.startYear.value);
  const end = Number(elements.endYear.value);
  if (start > end) {
    elements.endYear.value = start;
  }
  updateUrl();
  fetchAndRender();
}

function restoreFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const indicator = params.get("indicator");
  const countries = params.get("countries");
  const start = params.get("start");
  const end = params.get("end");
  const mode = params.get("mode");

  if (indicator) {
    const known = indicators.find((item) => item.code === indicator);
    if (known) {
      elements.indicator.value = known.code;
      state.activeIndicator = known;
    } else {
      elements.customIndicator.value = indicator;
      state.activeIndicator = indicatorFromCustom();
    }
  }
  if (start) elements.startYear.value = start;
  if (end) elements.endYear.value = end;
  if (mode === "bar") setMode("bar", false);
  if (countries) {
    state.pendingCountrySelection = countries
      .split(",")
      .map((code) => code.toUpperCase());
  }
}

function updateUrl() {
  const params = new URLSearchParams();
  params.set("indicator", getIndicator().code);
  params.set("countries", getSelectedCountryCodes().join(","));
  params.set("start", elements.startYear.value);
  params.set("end", elements.endYear.value);
  params.set("mode", state.mode);
  history.replaceState(null, "", `${window.location.pathname}?${params}`);
}

async function loadCountries() {
  setStatus("Loading countries...");
  try {
    const payload = await fetchJson(
      `${API_BASE}/country?format=json&per_page=400`,
    );
    state.countries = payload[1]
      .filter((country) => country.region && country.region.id !== "NA")
      .concat(manualCountries)
      .sort((a, b) => a.name.localeCompare(b.name));

    const selected = state.pendingCountrySelection || defaultCountries;
    elements.countries.innerHTML = "";
    state.countries.forEach((country) => {
      const option = document.createElement("option");
      option.value = country.id;
      option.textContent = country.name;
      option.selected = selected.includes(country.id);
      elements.countries.append(option);
    });

    setStatus("Ready.");
    updateUrl();
    fetchAndRender();
  } catch (error) {
    setStatus(`Could not load countries: ${error.message}`);
  }
}

async function fetchAndRender() {
  const countryCodes = getSelectedCountryCodes();
  const indicator = getIndicator();
  const start = Number(elements.startYear.value);
  const end = Number(elements.endYear.value);

  if (!countryCodes.length) {
    setStatus("Choose at least one country.");
    return;
  }
  if (!indicator.code) {
    setStatus("Choose an indicator or enter a custom code.");
    return;
  }

  state.loading = true;

  try {
    const url = `${API_BASE}/country/${countryCodes.join(";")}/indicator/${indicator.code}?format=json&date=${start}:${end}&per_page=20000`;
    const payload = await fetchJson(url);
    const rows = Array.isArray(payload[1]) ? payload[1] : [];
    state.data = rows
      .filter((row) => row.value !== null)
      .map((row) => ({
        countryCode: row.countryiso3code || row.country.id,
        countryName: row.country.value,
        year: Number(row.date),
        value: Number(row.value),
        indicatorName: row.indicator.value,
      }))
      .sort(
        (a, b) => a.countryName.localeCompare(b.countryName) || a.year - b.year,
      );

    if (state.data[0] && indicator.name === indicator.code) {
      state.activeIndicator = {
        ...indicator,
        name: state.data[0].indicatorName || indicator.code,
      };
    }

    setStatus(
      state.data.length
        ? `Loaded ${state.data.length} data points.`
        : "No data returned for this selection.",
    );
    render();
  } catch (error) {
    state.data = [];
    render();
    setStatus(`Could not fetch data: ${error.message}`);
  } finally {
    state.loading = false;
  }
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const payload = await response.json();
  if (payload[0] && payload[0].message) {
    throw new Error(payload[0].message[0].value || "API error");
  }
  return payload;
}

function setMode(mode, shouldRender = true) {
  state.mode = mode;
  elements.lineMode.classList.toggle("active", mode === "line");
  elements.barMode.classList.toggle("active", mode === "bar");
  if (shouldRender) {
    updateUrl();
    render();
  }
}

function getIndicator() {
  const custom = elements.customIndicator.value.trim().toUpperCase();
  if (custom) return indicatorFromCustom();
  return (
    indicators.find((item) => item.code === elements.indicator.value) ||
    state.activeIndicator
  );
}

function indicatorFromCustom() {
  return {
    code: elements.customIndicator.value.trim().toUpperCase(),
    name: elements.customIndicator.value.trim().toUpperCase(),
    unit: "",
    description: "Custom World Bank indicator",
  };
}

function getSelectedCountryCodes() {
  return Array.from(elements.countries.selectedOptions).map(
    (option) => option.value,
  );
}

function setStatus(message) {
  elements.status.textContent = message;
}

function render() {
  const indicator = getIndicator();
  elements.indicatorLabel.textContent = indicator.code || "Indicator";
  elements.chartTitle.textContent = indicator.name || "World Bank data";
  elements.meta.textContent = `${elements.startYear.value}-${elements.endYear.value} | ${state.mode === "line" ? "trend view" : "latest value view"}`;

  clearTooltip();
  clearSvg();
  clearLegend();

  const is3d = state.mode === "bar";
  elements.chart.hidden = is3d;
  elements.chart3d.hidden = !is3d;
  elements.chartWrap.classList.toggle("is-3d", is3d);

  if (!state.data.length) {
    if (is3d) {
      clearBars3D();
      stopAnimation();
    }
    renderEmptyState("No data to display");
    return;
  }

  if (is3d) {
    renderBarChart3D();
  } else {
    stopAnimation();
    renderLineChart();
  }
}

function clearSvg() {
  elements.chart.replaceChildren();
}

function clearLegend() {
  elements.chartWrap.classList.remove("has-legend");
  elements.chartLegend.hidden = true;
  elements.chartLegend.replaceChildren();
}

function getChartSize() {
  const rect = elements.chart.getBoundingClientRect();
  const width = Math.max(320, Math.floor(rect.width));
  const height = Math.max(360, Math.floor(rect.height));
  elements.chart.setAttribute("viewBox", `0 0 ${width} ${height}`);
  return { width, height };
}

function renderEmptyState(message) {
  const { width, height } = getChartSize();
  const text = svgNode("text", {
    x: width / 2,
    y: height / 2,
    "text-anchor": "middle",
    class: "axis-label",
  });
  text.textContent = message;
  elements.chart.append(text);
}

function renderLineChart() {
  const years = unique(state.data.map((item) => item.year)).sort(
    (a, b) => a - b,
  );
  const values = state.data.map((item) => item.value);
  const xDomain = [Math.min(...years), Math.max(...years)];
  const yDomain = paddedDomain(values);
  const grouped = groupByCountry(state.data);

  renderLegend(grouped);

  const { width, height } = getChartSize();
  const margin = { top: 28, right: 34, bottom: 54, left: 74 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  drawAxes({
    width,
    height,
    margin,
    innerWidth,
    innerHeight,
    xDomain,
    yDomain,
  });

  grouped.forEach((series, index) => {
    const color = palette[index % palette.length];
    const pathData = series
      .sort((a, b) => a.year - b.year)
      .map((point, pointIndex) => {
        const x = scale(point.year, xDomain, [
          margin.left,
          margin.left + innerWidth,
        ]);
        const y = scale(point.value, yDomain, [
          margin.top + innerHeight,
          margin.top,
        ]);
        return `${pointIndex === 0 ? "M" : "L"} ${x} ${y}`;
      })
      .join(" ");

    elements.chart.append(
      svgNode("path", {
        d: pathData,
        class: "series-line",
        stroke: color,
      }),
    );

    series.forEach((point) => {
      const cx = scale(point.year, xDomain, [
        margin.left,
        margin.left + innerWidth,
      ]);
      const cy = scale(point.value, yDomain, [
        margin.top + innerHeight,
        margin.top,
      ]);
      const dot = svgNode("circle", {
        cx,
        cy,
        r: 4,
        fill: color,
        class: "data-dot",
        tabindex: 0,
      });
      attachTooltip(dot, point);
      elements.chart.append(dot);
    });
  });
}

function renderLegend(grouped) {
  elements.chartWrap.classList.add("has-legend");
  elements.chartLegend.hidden = false;

  grouped.forEach((series, index) => {
    const item = document.createElement("div");
    item.className = "legend-item";

    const swatch = document.createElement("span");
    swatch.className = "legend-swatch";
    swatch.style.background = palette[index % palette.length];

    const name = document.createElement("span");
    name.className = "legend-name";
    name.textContent = series[0].countryName;

    item.append(swatch, name);
    elements.chartLegend.append(item);
  });
}

function ensureThreeScene() {
  if (scene3d.scene) return;
  const container = elements.chart3d;
  const rect = container.getBoundingClientRect();
  const w = Math.max(320, rect.width);
  const h = Math.max(360, rect.height || 520);

  const scene = new THREE.Scene();
  scene.background = null;

  const camera = new THREE.PerspectiveCamera(34, w / h, 0.5, 4000);
  camera.position.set(420, 320, 520);

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(w, h);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  container.appendChild(renderer.domElement);

  const labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(w, h);
  const labelEl = labelRenderer.domElement;
  labelEl.style.position = "absolute";
  labelEl.style.inset = "0";
  labelEl.style.pointerEvents = "none";
  container.appendChild(labelEl);

  const hemi = new THREE.HemisphereLight(0xfdfcf6, 0xc0c8b8, 0.55);
  scene.add(hemi);
  const ambient = new THREE.AmbientLight(0xffffff, 0.18);
  scene.add(ambient);

  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(280, 480, 220);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -600;
  key.shadow.camera.right = 600;
  key.shadow.camera.top = 600;
  key.shadow.camera.bottom = -600;
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 1600;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  scene.add(key);

  const fill = new THREE.DirectionalLight(0xb8c4d6, 0.5);
  fill.position.set(-300, 220, -180);
  scene.add(fill);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(2400, 2400),
    new THREE.MeshStandardMaterial({
      color: 0xeef1ec,
      roughness: 0.92,
      metalness: 0,
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const grid = new THREE.GridHelper(2000, 40, 0xb6bdb5, 0xd5dad3);
  grid.position.y = 0.05;
  grid.material.transparent = true;
  grid.material.opacity = 0.55;
  scene.add(grid);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 90, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 240;
  controls.maxDistance = 1200;
  controls.maxPolarAngle = Math.PI / 2 - 0.04;
  controls.minPolarAngle = 0.15;
  controls.enablePan = false;
  controls.addEventListener("start", () =>
    container.classList.add("is-grabbing"),
  );
  controls.addEventListener("end", () =>
    container.classList.remove("is-grabbing"),
  );
  controls.update();

  const barGroup = new THREE.Group();
  scene.add(barGroup);
  const labelGroup = new THREE.Group();
  scene.add(labelGroup);

  scene3d.scene = scene;
  scene3d.camera = camera;
  scene3d.renderer = renderer;
  scene3d.labelRenderer = labelRenderer;
  scene3d.controls = controls;
  scene3d.barGroup = barGroup;
  scene3d.labelGroup = labelGroup;
  scene3d.ground = ground;
  scene3d.grid = grid;
  scene3d.raycaster = new THREE.Raycaster();
  scene3d.pointer = new THREE.Vector2();

  bindRaycasterTooltip();

  const ro = new ResizeObserver(() => resizeThree());
  ro.observe(container);
}

function resizeThree() {
  if (!scene3d.renderer) return;
  const container = elements.chart3d;
  const rect = container.getBoundingClientRect();
  const w = rect.width;
  const h = rect.height;
  if (w <= 0 || h <= 0) return;
  scene3d.camera.aspect = w / h;
  scene3d.camera.updateProjectionMatrix();
  scene3d.renderer.setSize(w, h);
  scene3d.labelRenderer.setSize(w, h);
}

function animateThree() {
  if (state.mode !== "bar") {
    scene3d.raf = null;
    return;
  }
  scene3d.controls.update();
  scene3d.renderer.render(scene3d.scene, scene3d.camera);
  scene3d.labelRenderer.render(scene3d.scene, scene3d.camera);
  scene3d.raf = requestAnimationFrame(animateThree);
}

function startAnimation() {
  if (scene3d.raf == null) {
    scene3d.raf = requestAnimationFrame(animateThree);
  }
}

function stopAnimation() {
  if (scene3d.raf != null) {
    cancelAnimationFrame(scene3d.raf);
    scene3d.raf = null;
  }
}

function clearBars3D() {
  if (!scene3d.barGroup) return;
  while (scene3d.barGroup.children.length) {
    const child = scene3d.barGroup.children[0];
    scene3d.barGroup.remove(child);
    if (child.geometry) child.geometry.dispose();
    if (child.material) child.material.dispose();
  }
  while (scene3d.labelGroup.children.length) {
    const child = scene3d.labelGroup.children[0];
    scene3d.labelGroup.remove(child);
    if (child.element && child.element.parentNode) {
      child.element.parentNode.removeChild(child.element);
    }
  }
}

function renderBarChart3D() {
  ensureThreeScene();
  clearBars3D();

  const latest = latestRowsByCountry(state.data).sort(
    (a, b) => b.value - a.value,
  );
  if (!latest.length) {
    stopAnimation();
    return;
  }

  const max = Math.max(...latest.map((p) => p.value), 0);
  const n = latest.length;
  const slot = 110;
  const barW = slot * 0.55;
  const barD = slot * 0.55;
  const maxH = 280;

  const material = new THREE.MeshStandardMaterial({
    color: BAR_COLOR,
    roughness: 0.42,
    metalness: 0.1,
  });

  latest.forEach((point, index) => {
    const h = Math.max(2, max ? (point.value / max) * maxH : 0);
    const geom = new THREE.BoxGeometry(barW, h, barD);
    const mesh = new THREE.Mesh(geom, material);
    const cx = (index - (n - 1) / 2) * slot;
    mesh.position.set(cx, h / 2, 0);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = { point };
    scene3d.barGroup.add(mesh);

    const valDiv = document.createElement("div");
    valDiv.className = "label-3d label-value";
    valDiv.textContent = formatValue(point.value);
    const valLabel = new CSS2DObject(valDiv);
    valLabel.position.set(cx, h + 22, 0);
    scene3d.labelGroup.add(valLabel);

    const nameDiv = document.createElement("div");
    nameDiv.className = "label-3d label-country";
    nameDiv.textContent = point.countryName;
    const nameLabel = new CSS2DObject(nameDiv);
    nameLabel.position.set(cx, 0, barD / 2 + 32);
    scene3d.labelGroup.add(nameLabel);
  });

  const span = Math.max(n * slot, 320);
  scene3d.controls.target.set(0, Math.min(maxH * 0.4, 120), 0);
  scene3d.controls.maxDistance = span * 2.5;
  resizeThree();
  startAnimation();
}

function bindRaycasterTooltip() {
  const canvas = scene3d.renderer.domElement;
  canvas.addEventListener("mousemove", (event) => {
    if (state.mode !== "bar") return;
    const rect = canvas.getBoundingClientRect();
    scene3d.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    scene3d.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    scene3d.raycaster.setFromCamera(scene3d.pointer, scene3d.camera);
    const hits = scene3d.raycaster.intersectObjects(
      scene3d.barGroup.children,
      false,
    );
    if (hits.length) {
      showTooltip3D(event, hits[0].object.userData.point);
    } else {
      clearTooltip();
    }
  });
  canvas.addEventListener("mouseleave", clearTooltip);
}

function showTooltip3D(event, point) {
  const rect = elements.chartWrap.getBoundingClientRect();
  elements.tooltip.hidden = false;
  elements.tooltip.innerHTML = `
    <strong>${point.countryName}</strong><br>
    ${point.year}: ${formatValue(point.value)} ${getIndicator().unit || ""}
  `;
  elements.tooltip.style.left = `${Math.min(rect.width - 240, event.clientX - rect.left + 12)}px`;
  elements.tooltip.style.top = `${Math.max(8, event.clientY - rect.top - 46)}px`;
}

function drawAxes({
  width,
  height,
  margin,
  innerWidth,
  innerHeight,
  xDomain,
  yDomain,
}) {
  const yTicks = makeTicks(yDomain[0], yDomain[1], 5);
  yTicks.forEach((tick) => {
    const y = scale(tick, yDomain, [margin.top + innerHeight, margin.top]);
    elements.chart.append(
      svgNode("line", {
        x1: margin.left,
        y1: y,
        x2: width - margin.right,
        y2: y,
        class: "grid-line",
      }),
    );
    const label = svgNode("text", {
      x: margin.left - 10,
      y: y + 4,
      "text-anchor": "end",
      class: "axis-label",
    });
    label.textContent = formatValue(tick);
    elements.chart.append(label);
  });

  const xTicks = makeYearTicks(xDomain[0], xDomain[1]);
  xTicks.forEach((tick) => {
    const x = scale(tick, xDomain, [margin.left, margin.left + innerWidth]);
    const label = svgNode("text", {
      x,
      y: height - 18,
      "text-anchor": "middle",
      class: "axis-label",
    });
    label.textContent = tick;
    elements.chart.append(label);
  });

  elements.chart.append(
    svgNode("line", {
      x1: margin.left,
      y1: margin.top,
      x2: margin.left,
      y2: margin.top + innerHeight,
      class: "axis",
    }),
  );
  elements.chart.append(
    svgNode("line", {
      x1: margin.left,
      y1: margin.top + innerHeight,
      x2: width - margin.right,
      y2: margin.top + innerHeight,
      class: "axis",
    }),
  );
}

function latestRowsByCountry(rows) {
  const latest = new Map();
  rows.forEach((row) => {
    const previous = latest.get(row.countryCode);
    if (!previous || row.year > previous.year) {
      latest.set(row.countryCode, row);
    }
  });
  return Array.from(latest.values());
}

function groupByCountry(rows) {
  const groups = new Map();
  rows.forEach((row) => {
    if (!groups.has(row.countryCode)) groups.set(row.countryCode, []);
    groups.get(row.countryCode).push(row);
  });
  return Array.from(groups.values());
}

function attachTooltip(node, point) {
  const show = (event) => {
    const rect = elements.chart.getBoundingClientRect();
    elements.tooltip.hidden = false;
    elements.tooltip.innerHTML = `
      <strong>${point.countryName}</strong><br>
      ${point.year}: ${formatValue(point.value)} ${getIndicator().unit || ""}
    `;
    elements.tooltip.style.left = `${Math.min(rect.width - 240, event.clientX - rect.left + 12)}px`;
    elements.tooltip.style.top = `${Math.max(8, event.clientY - rect.top - 46)}px`;
  };

  node.addEventListener("mousemove", show);
  node.addEventListener("focus", (event) => {
    const rect = node.getBoundingClientRect();
    show({ clientX: rect.left + rect.width / 2, clientY: rect.top });
    event.preventDefault();
  });
  node.addEventListener("mouseleave", clearTooltip);
  node.addEventListener("blur", clearTooltip);
}

function clearTooltip() {
  elements.tooltip.hidden = true;
}

function downloadCsv() {
  if (!state.data.length) return;
  const header = [
    "country_code",
    "country",
    "year",
    "indicator_code",
    "indicator",
    "value",
  ];
  const rows = state.data.map((row) => [
    row.countryCode,
    row.countryName,
    row.year,
    getIndicator().code,
    row.indicatorName,
    row.value,
  ]);
  const csv = [header, ...rows]
    .map((row) => row.map(csvCell).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `world-bank-${getIndicator().code}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function csvCell(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function svgNode(name, attrs) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", name);
  Object.entries(attrs || {}).forEach(([key, value]) =>
    node.setAttribute(key, value),
  );
  return node;
}

function unique(values) {
  return Array.from(new Set(values));
}

function scale(value, domain, range) {
  if (domain[0] === domain[1]) return (range[0] + range[1]) / 2;
  const percent = (value - domain[0]) / (domain[1] - domain[0]);
  return range[0] + percent * (range[1] - range[0]);
}

function paddedDomain(values) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) {
    const pad = Math.abs(min || 1) * 0.1;
    return [min - pad, max + pad];
  }
  const pad = (max - min) * 0.12;
  return [min - pad, max + pad];
}

function makeTicks(min, max, count) {
  const step = (max - min) / Math.max(1, count - 1);
  return Array.from({ length: count }, (_, index) => min + step * index);
}

function makeYearTicks(start, end) {
  const span = end - start;
  const step = span > 35 ? 10 : span > 16 ? 5 : span > 8 ? 2 : 1;
  const ticks = [];
  for (let year = start; year <= end; year += step) {
    ticks.push(year);
  }
  if (!ticks.includes(end)) ticks.push(end);
  return ticks;
}

function formatValue(value) {
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000_000)
    return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (absolute >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (absolute >= 10_000) return Math.round(value).toLocaleString();
  if (absolute >= 100)
    return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

init();
