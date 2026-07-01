import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  CSS2DRenderer,
  CSS2DObject,
} from "three/addons/renderers/CSS2DRenderer.js";

const API_BASE = "https://api.worldbank.org/v2";

const indicators = [
  {
    code: "SP.POP.TOTL",
    name: "Population, total",
    unit: "people",
    description: "Total population",
    clamp: (value) => Math.max(0, value),
  },
  {
    code: "SP.POP.GROW",
    name: "Population growth",
    unit: "% annual",
    description: "Annual population growth rate",
  },
  {
    code: "SP.DYN.LE00.IN",
    name: "Life expectancy",
    unit: "years",
    description: "Life expectancy at birth, total",
    clamp: (value) => Math.max(0, value),
  },
  {
    code: "SP.DYN.TFRT.IN",
    name: "Fertility rate",
    unit: "births per woman",
    description: "Total fertility rate",
    clamp: (value) => Math.max(0, value),
  },
  {
    code: "SP.URB.TOTL.IN.ZS",
    name: "Urban population",
    unit: "% of total",
    description: "Share of population living in urban areas",
    clamp: (value) => Math.min(100, Math.max(0, value)),
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
const TOP_N = 20;
const CURRENT_YEAR = new Date().getFullYear();
const FORECAST_HORIZON_YEARS = 25;
const FORECAST_LOOKBACK_YEARS = 20;
const MIN_FORECAST_HISTORY = 3;
const FORECAST_FIT_WINDOW = 15;
const PROJECTED_BAR_COLOR = 0x8aa6ff;

function seriesColor(index) {
  if (index < palette.length) return palette[index];
  const hue = (index * 137.508) % 360;
  return `hsl(${hue.toFixed(0)}, 55%, 45%)`;
}

const elements = {
  indicator: document.querySelector("#indicator"),
  startYear: document.querySelector("#startYear"),
  endYear: document.querySelector("#endYear"),
  startYearLabel: document.querySelector("#startYearLabel"),
  endYearLabel: document.querySelector("#endYearLabel"),
  yearRangeFill: document.querySelector("#yearRangeFill"),
  forecastHint: document.querySelector("#forecastHint"),
  lineMode: document.querySelector("#lineMode"),
  barMode: document.querySelector("#barMode"),
  status: document.querySelector("#status"),
  chartTitle: document.querySelector("#chartTitle"),
  chart3d: document.querySelector("#chart3d"),
  chartWrap: document.querySelector(".chart-wrap"),
  chartLegend: document.querySelector("#chartLegend"),
  tooltip: document.querySelector("#tooltip"),
};

const state = {
  validCountryIds: new Set(),
  data: [],
  mode: "bar",
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
  currentMode: null,
};

function init() {
  const minYear = 1960;
  const maxYear = CURRENT_YEAR + FORECAST_HORIZON_YEARS;
  [elements.startYear, elements.endYear].forEach((input) => {
    input.min = minYear;
    input.max = maxYear;
    input.step = 1;
  });
  elements.startYear.value = CURRENT_YEAR - 15;
  elements.endYear.value = CURRENT_YEAR + 10;
  elements.forecastHint.textContent = `Years after ${CURRENT_YEAR} are estimated with a linear trend.`;

  indicators.forEach((indicator) => {
    const option = document.createElement("option");
    option.value = indicator.code;
    option.textContent = indicator.name;
    elements.indicator.append(option);
  });

  restoreFromUrl();
  bindEvents();
  syncYearLabels();
  loadCountries();
}

function bindEvents() {
  elements.indicator.addEventListener("change", () => {
    const selected = indicators.find(
      (item) => item.code === elements.indicator.value,
    );
    if (selected) state.activeIndicator = selected;
    updateUrl();
    fetchAndRender();
  });

  elements.startYear.addEventListener("input", () => {
    if (Number(elements.startYear.value) > Number(elements.endYear.value)) {
      elements.endYear.value = elements.startYear.value;
    }
    syncYearLabels();
  });
  elements.endYear.addEventListener("input", () => {
    if (Number(elements.endYear.value) < Number(elements.startYear.value)) {
      elements.startYear.value = elements.endYear.value;
    }
    syncYearLabels();
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

function syncYearLabels() {
  elements.startYearLabel.textContent = elements.startYear.value;
  elements.endYearLabel.textContent = elements.endYear.value;

  const min = Number(elements.startYear.min);
  const max = Number(elements.startYear.max);
  const span = max - min || 1;
  const startPct = ((Number(elements.startYear.value) - min) / span) * 100;
  const endPct = ((Number(elements.endYear.value) - min) / span) * 100;
  elements.yearRangeFill.style.left = `${startPct}%`;
  elements.yearRangeFill.style.width = `${Math.max(0, endPct - startPct)}%`;
}

function handleYearChange() {
  syncYearLabels();
  updateUrl();
  fetchAndRender();
}

function restoreFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const indicator = params.get("indicator");
  const start = params.get("start");
  const end = params.get("end");
  const mode = params.get("mode");

  if (indicator) {
    const known = indicators.find((item) => item.code === indicator);
    if (known) {
      elements.indicator.value = known.code;
      state.activeIndicator = known;
    }
  }
  if (start) elements.startYear.value = start;
  if (end) elements.endYear.value = end;
  if (mode === "bar") setMode("bar", false);
}

function updateUrl() {
  const params = new URLSearchParams();
  params.set("indicator", getIndicator().code);
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
    state.validCountryIds = new Set(
      payload[1]
        .filter((country) => country.region && country.region.id !== "NA")
        .map((country) => country.id),
    );

    setStatus("Ready.");
    updateUrl();
    fetchAndRender();
  } catch (error) {
    setStatus(`Could not load countries: ${error.message}`);
  }
}

async function fetchAndRender() {
  const indicator = getIndicator();
  const start = Number(elements.startYear.value);
  const end = Number(elements.endYear.value);

  if (!indicator.code) {
    setStatus("Choose an indicator or enter a custom code.");
    return;
  }

  const fetchStart = Math.max(
    1960,
    Math.min(start, CURRENT_YEAR - FORECAST_LOOKBACK_YEARS),
  );
  const fetchEnd = Math.min(end, CURRENT_YEAR);

  state.loading = true;
  setStatus(`Loading top ${TOP_N} countries...`);

  try {
    const url = `${API_BASE}/country/all/indicator/${indicator.code}?format=json&date=${fetchStart}:${fetchEnd}&per_page=20000`;
    const payload = await fetchJson(url);
    const rows = Array.isArray(payload[1]) ? payload[1] : [];
    const allData = rows
      .filter((row) => row.value !== null)
      .map((row) => ({
        countryCode: row.countryiso3code || row.country.id,
        countryName: row.country.value,
        year: Number(row.date),
        value: Number(row.value),
        indicatorName: row.indicator.value,
        projected: false,
      }))
      .filter((row) => state.validCountryIds.has(row.countryCode));

    const extended = groupByCountry(allData).flatMap((countryRows) =>
      withForecast(countryRows, indicator, end),
    );

    const visibleData = extended.filter(
      (row) => row.year >= start && row.year <= end,
    );

    const topCodes = new Set(
      latestRowsByCountry(visibleData)
        .sort((a, b) => b.value - a.value)
        .slice(0, TOP_N)
        .map((row) => row.countryCode),
    );

    state.data = visibleData
      .filter((row) => topCodes.has(row.countryCode))
      .sort(
        (a, b) => a.countryName.localeCompare(b.countryName) || a.year - b.year,
      );

    if (state.data[0] && indicator.name === indicator.code) {
      state.activeIndicator = {
        ...indicator,
        name: state.data[0].indicatorName || indicator.code,
      };
    }

    const projectedCount = state.data.filter((row) => row.projected).length;
    setStatus(
      state.data.length
        ? `Loaded top ${topCodes.size} countries (${state.data.length} data points${projectedCount ? `, ${projectedCount} projected` : ""}).`
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

function linearRegression(points) {
  const n = points.length;
  const sumX = points.reduce((sum, point) => sum + point.year, 0);
  const sumY = points.reduce((sum, point) => sum + point.value, 0);
  const sumXY = points.reduce(
    (sum, point) => sum + point.year * point.value,
    0,
  );
  const sumXX = points.reduce(
    (sum, point) => sum + point.year * point.year,
    0,
  );
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return { slope: 0, intercept: sumY / n };
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

function withForecast(rows, indicator, endYear) {
  const actual = rows
    .slice()
    .sort((a, b) => a.year - b.year)
    .map((row) => ({ ...row, projected: false }));
  const lastActual = actual[actual.length - 1];

  if (
    !lastActual ||
    endYear <= lastActual.year ||
    actual.length < MIN_FORECAST_HISTORY
  ) {
    return actual;
  }

  const fitPoints = actual.slice(-FORECAST_FIT_WINDOW);
  const { slope, intercept } = linearRegression(fitPoints);
  const forecast = [];
  for (let year = lastActual.year + 1; year <= endYear; year++) {
    const raw = slope * year + intercept;
    forecast.push({
      countryCode: lastActual.countryCode,
      countryName: lastActual.countryName,
      indicatorName: lastActual.indicatorName,
      year,
      value: indicator.clamp ? indicator.clamp(raw) : raw,
      projected: true,
    });
  }
  return [...actual, ...forecast];
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
  return (
    indicators.find((item) => item.code === elements.indicator.value) ||
    state.activeIndicator
  );
}

function setStatus(message) {
  elements.status.textContent = message;
}

function render() {
  const indicator = getIndicator();
  elements.chartTitle.textContent = indicator.name || "World Bank data";

  clearTooltip();
  clearLegend();
  elements.chartWrap.classList.add("is-3d");
  elements.chart3d.hidden = false;

  if (!state.data.length) {
    ensureThreeScene();
    clearBars3D();
    stopAnimation();
    resizeThree();
    return;
  }

  if (state.mode === "bar") {
    renderBarChart3D();
  } else {
    renderLineChart3D();
  }
}

function clearLegend() {
  elements.chartWrap.classList.remove("has-legend");
  elements.chartLegend.hidden = true;
  elements.chartLegend.replaceChildren();
}

function renderLegend(grouped) {
  elements.chartWrap.classList.add("has-legend");
  elements.chartLegend.hidden = false;

  grouped.forEach((series, index) => {
    const item = document.createElement("div");
    item.className = "legend-item";

    const swatch = document.createElement("span");
    swatch.className = "legend-swatch";
    swatch.style.background = seriesColor(index);

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

  const hemi = new THREE.HemisphereLight(0x3d5346, 0x05070a, 0.65);
  scene.add(hemi);
  const ambient = new THREE.AmbientLight(0xffffff, 0.12);
  scene.add(ambient);

  const key = new THREE.DirectionalLight(0xffffff, 1.9);
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

  const fill = new THREE.DirectionalLight(0x8aa6ff, 0.4);
  fill.position.set(-300, 220, -180);
  scene.add(fill);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(2400, 2400),
    new THREE.MeshStandardMaterial({
      color: 0x0b120f,
      roughness: 0.95,
      metalness: 0,
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const grid = new THREE.GridHelper(2000, 40, 0x37493f, 0x1c2620);
  grid.position.y = 0.05;
  grid.material.transparent = true;
  grid.material.opacity = 0.7;
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
  scene3d.raycaster.params.Line = { threshold: 4 };
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
  const isModeChange = scene3d.currentMode !== "bar";
  scene3d.currentMode = "bar";

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
  const projectedMaterial = new THREE.MeshStandardMaterial({
    color: PROJECTED_BAR_COLOR,
    roughness: 0.42,
    metalness: 0.1,
    transparent: true,
    opacity: 0.55,
  });

  latest.forEach((point, index) => {
    const h = Math.max(2, max ? (point.value / max) * maxH : 0);
    const geom = new THREE.BoxGeometry(barW, h, barD);
    const mesh = new THREE.Mesh(
      geom,
      point.projected ? projectedMaterial : material,
    );
    const cx = (index - (n - 1) / 2) * slot;
    mesh.position.set(cx, h / 2, 0);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = { point };
    scene3d.barGroup.add(mesh);

    const valDiv = document.createElement("div");
    valDiv.className = "label-3d label-value";
    valDiv.textContent =
      formatValue(point.value) + (point.projected ? " (est.)" : "");
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
  if (isModeChange) {
    scene3d.camera.position.set(420, 320, 520);
  }
  scene3d.controls.target.set(0, Math.min(maxH * 0.4, 120), 0);
  scene3d.controls.maxDistance = span * 2.5;
  scene3d.controls.update();
  resizeThree();
  startAnimation();
}

function renderLineChart3D() {
  ensureThreeScene();
  clearBars3D();
  const isModeChange = scene3d.currentMode !== "line";
  scene3d.currentMode = "line";

  const ranked = latestRowsByCountry(state.data).sort(
    (a, b) => b.value - a.value,
  );
  if (!ranked.length) {
    stopAnimation();
    return;
  }

  const seriesByCode = new Map(
    groupByCountry(state.data).map((series) => [series[0].countryCode, series]),
  );
  renderLegend(
    ranked.map((row) => seriesByCode.get(row.countryCode) || [row]),
  );

  const years = unique(state.data.map((item) => item.year)).sort(
    (a, b) => a - b,
  );
  const xDomain = [years[0], years[years.length - 1]];
  const yDomain = paddedDomain(state.data.map((item) => item.value));

  const n = ranked.length;
  const rowDepth = 24;
  const spanX = 420;
  const maxH = 240;

  const mapX = (year) => scale(year, xDomain, [-spanX / 2, spanX / 2]);
  const mapY = (value) => scale(value, yDomain, [0, maxH]);
  const mapZ = (index) => (index - (n - 1) / 2) * rowDepth;

  ranked.forEach((row, index) => {
    const series = (seriesByCode.get(row.countryCode) || [])
      .slice()
      .sort((a, b) => a.year - b.year);
    if (!series.length) return;

    const color = seriesColor(index);
    const z = mapZ(index);
    const plotted = series.map((point) => ({
      ...point,
      _plotX: mapX(point.year),
    }));
    const toVec = (point) =>
      new THREE.Vector3(mapX(point.year), mapY(point.value), z);

    const actualPoints = plotted.filter((point) => !point.projected);
    const projectedPoints = plotted.filter((point) => point.projected);

    if (actualPoints.length > 1) {
      const geometry = new THREE.BufferGeometry().setFromPoints(
        actualPoints.map(toVec),
      );
      const line = new THREE.Line(
        geometry,
        new THREE.LineBasicMaterial({ color }),
      );
      line.userData = { series: plotted };
      scene3d.barGroup.add(line);
    }

    if (projectedPoints.length) {
      const bridge = actualPoints.length
        ? [actualPoints[actualPoints.length - 1], ...projectedPoints]
        : projectedPoints;
      const geometry = new THREE.BufferGeometry().setFromPoints(
        bridge.map(toVec),
      );
      const line = new THREE.Line(
        geometry,
        new THREE.LineDashedMaterial({
          color,
          dashSize: 6,
          gapSize: 5,
          transparent: true,
          opacity: 0.85,
        }),
      );
      line.computeLineDistances();
      line.userData = { series: plotted };
      scene3d.barGroup.add(line);
    }

    const last = plotted[plotted.length - 1];
    const lastVec = toVec(last);

    const nameDiv = document.createElement("div");
    nameDiv.className = "label-3d label-country";
    nameDiv.textContent = row.countryName;
    const nameLabel = new CSS2DObject(nameDiv);
    nameLabel.position.set(lastVec.x + 26, lastVec.y, lastVec.z);
    scene3d.labelGroup.add(nameLabel);
  });

  const depth = n * rowDepth;
  addAxisTicks({
    xDomain,
    yDomain,
    spanX,
    maxH,
    depth,
    values: state.data.map((item) => item.value),
  });

  if (isModeChange) {
    scene3d.camera.position.set(
      spanX * 0.55,
      maxH * 1.15 + 60,
      depth * 0.85 + 260,
    );
  }
  scene3d.controls.target.set(0, maxH * 0.3, 0);
  scene3d.controls.maxDistance = Math.max(spanX, depth) * 2.4;
  scene3d.controls.update();
  resizeThree();
  startAnimation();
}

function addAxisTicks({ xDomain, yDomain, spanX, maxH, depth, values }) {
  const backZ = -(depth / 2 + 20);
  const trueMin = Math.min(...values);
  const trueMax = Math.max(...values);

  const maxLabel = document.createElement("div");
  maxLabel.className = "label-3d label-tick";
  maxLabel.textContent = `MAX ${formatValue(trueMax)}`;
  const maxObj = new CSS2DObject(maxLabel);
  maxObj.position.set(-spanX / 2 - 70, maxH, backZ + 40);
  scene3d.labelGroup.add(maxObj);

  const minLabel = document.createElement("div");
  minLabel.className = "label-3d label-tick";
  minLabel.textContent = `MIN ${formatValue(trueMin)}`;
  const minObj = new CSS2DObject(minLabel);
  minObj.position.set(-spanX / 2 - 70, 0, backZ + 40);
  scene3d.labelGroup.add(minObj);

  makeYearTicks(xDomain[0], xDomain[1]).forEach((year) => {
    const div = document.createElement("div");
    div.className = "label-3d label-tick";
    div.textContent = year;
    const obj = new CSS2DObject(div);
    obj.position.set(
      scale(year, xDomain, [-spanX / 2, spanX / 2]),
      0,
      backZ - 14,
    );
    scene3d.labelGroup.add(obj);
  });
}

function bindRaycasterTooltip() {
  const canvas = scene3d.renderer.domElement;
  canvas.addEventListener("mousemove", (event) => {
    const rect = canvas.getBoundingClientRect();
    scene3d.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    scene3d.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    scene3d.raycaster.setFromCamera(scene3d.pointer, scene3d.camera);
    const hits = scene3d.raycaster.intersectObjects(
      scene3d.barGroup.children,
      false,
    );
    if (!hits.length) {
      clearTooltip();
      return;
    }
    const hit = hits[0];
    if (hit.object.userData.point) {
      showTooltip3D(event, hit.object.userData.point);
    } else if (hit.object.userData.series) {
      const nearest = nearestSeriesPoint(hit.object.userData.series, hit.point.x);
      if (nearest) {
        showTooltip3D(event, nearest);
      } else {
        clearTooltip();
      }
    } else {
      clearTooltip();
    }
  });
  canvas.addEventListener("mouseleave", clearTooltip);
}

function nearestSeriesPoint(series, x) {
  let nearest = null;
  let bestDist = Infinity;
  series.forEach((point) => {
    const dist = Math.abs(point._plotX - x);
    if (dist < bestDist) {
      bestDist = dist;
      nearest = point;
    }
  });
  return nearest;
}

function showTooltip3D(event, point) {
  const rect = elements.chartWrap.getBoundingClientRect();
  elements.tooltip.hidden = false;
  elements.tooltip.innerHTML = `
    <strong>${point.countryName}</strong><br>
    ${point.year}: ${formatValue(point.value)} ${getIndicator().unit || ""}${point.projected ? " (projected)" : ""}
  `;
  elements.tooltip.style.left = `${Math.min(rect.width - 240, event.clientX - rect.left + 12)}px`;
  elements.tooltip.style.top = `${Math.max(8, event.clientY - rect.top - 46)}px`;
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
    "projected",
  ];
  const rows = state.data.map((row) => [
    row.countryCode,
    row.countryName,
    row.year,
    getIndicator().code,
    row.indicatorName,
    row.value,
    row.projected ? "yes" : "no",
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
