import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const DATA_URL = "./data/population-dots.json";
const GLOBAL_METRICS_URL = "./data/population-global.json";
const INCOME_GROUPS_URL = "./data/country-income-groups.json";
const PEOPLE_PER_DOT = 1_000_000;
const GLOBE_RADIUS = 200;
const DOT_SIZE = 4.4;
const PULSE_AMPLITUDE = 5;
const PULSE_FREQ_MIN = 0.5;
const PULSE_FREQ_RANGE = 2.0;

const REGION_COLORS = {
  "East Asia & Pacific": "#FF48B0",
  "Europe & Central Asia": "#4EA8FF",
  "Latin America & Caribbean": "#00838A",
  "Middle East, North Africa, Afghanistan & Pakistan": "#FF8E91",
  "North America": "#F6A04D",
  "South Asia": "#00AA93",
  "Sub-Saharan Africa": "#FFB454",
};
const DEFAULT_COLOR = "#5fe39a";

const INCOME_GROUP_COLORS = {
  "High-income countries": "#4EA8FF",
  "Middle-income countries": "#FFB454",
  "Low-income countries": "#FF6B6B",
};
const UNCLASSIFIED_INCOME = "Not classified";
const UNCLASSIFIED_COLOR = "#999999";

const elements = {
  status: document.querySelector("#status"),
  tooltip: document.querySelector("#tooltip"),
  yearControl: document.querySelector("#yearControl"),
  yearSlider: document.querySelector("#yearSlider"),
  yearValue: document.querySelector("#yearValue"),
  metrics: document.querySelector("#metrics"),
  metricPopulation: document.querySelector("#metricPopulation"),
  metricFertility: document.querySelector("#metricFertility"),
  metricLifeExpectancy: document.querySelector("#metricLifeExpectancy"),
  metricMedianAge: document.querySelector("#metricMedianAge"),
  metricPopulationGrowth: document.querySelector("#metricPopulationGrowth"),
  colorMode: document.querySelector("#colorMode"),
  legend: document.querySelector("#legend"),
};

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  40,
  window.innerWidth / window.innerHeight,
  1,
  4000,
);
camera.position.set(0, 0, GLOBE_RADIUS * 3.1);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = GLOBE_RADIUS * 1.3;
controls.maxDistance = GLOBE_RADIUS * 8;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.35;
controls.enablePan = false;

const raycaster = new THREE.Raycaster();
raycaster.params.Points = { threshold: DOT_SIZE * 1.5 };
const pointer = new THREE.Vector2(Infinity, Infinity);

function latLonToVector3(lat, lon, radius) {
  const phi = ((90 - lat) * Math.PI) / 180;
  const theta = ((lon + 180) * Math.PI) / 180;
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  );
}

function regionColor(region) {
  return new THREE.Color(REGION_COLORS[region.trim()] || DEFAULT_COLOR);
}

function incomeGroupLabel(iso3, incomeGroups) {
  if (!incomeGroups) return UNCLASSIFIED_INCOME;
  const code = incomeGroups.countryIncomeCodes[iso3];
  return (code && incomeGroups.incomeCodes[code]) || UNCLASSIFIED_INCOME;
}

function incomeColor(label) {
  return new THREE.Color(INCOME_GROUP_COLORS[label] || UNCLASSIFIED_COLOR);
}

function createDotTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  gradient.addColorStop(0, "rgba(255, 255, 255, 1)");
  gradient.addColorStop(0.5, "rgba(255, 255, 255, 0.7)");
  gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(canvas);
}

function formatCount(value) {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}K`;
  return `${value}`;
}

// data/population-global.json holds one series per indicator, each an
// array of {year, value} rows; index by year so applyYear() can look up
// all five in O(1) as the slider moves.
function buildGlobalMetricsIndex(globalData) {
  const byYear = new Map();
  Object.entries(globalData).forEach(([series, rows]) => {
    rows.forEach(({ year, value }) => {
      if (!byYear.has(year)) byYear.set(year, {});
      byYear.get(year)[series] = value;
    });
  });
  return byYear;
}

function updateMetricsPanel(year) {
  const metrics = globalMetricsByYear.get(year);
  if (!metrics) {
    elements.metrics.hidden = true;
    return;
  }
  elements.metrics.hidden = false;
  elements.metricPopulation.textContent = formatCount(metrics.population);
  elements.metricFertility.textContent = `${metrics.fertility.toFixed(2)} births/woman`;
  elements.metricLifeExpectancy.textContent = `${metrics.lifeExpectancy.toFixed(1)} yrs`;
  elements.metricMedianAge.textContent = `${metrics.medianAge.toFixed(1)} yrs`;
  elements.metricPopulationGrowth.textContent = `${metrics.populationGrowth.toFixed(2)}%`;
}

let pointsMesh = null;
let basePositions = null; // pre-pulse baseline, rebuilt whenever the year changes
let frequencies = null;
let phases = null;
let dotCountry = [];
let activeTotal = 0;
let countriesData = [];
let yearsData = [];
let currentYearIndex = -1;
let historicalCutoffYear = Infinity;
let globalMetricsByYear = new Map();
let colorMode = "region";
const clock = new THREE.Clock();

function colorFor(country) {
  return colorMode === "income" ? country._incomeColor : country._regionColor;
}

// Allocates buffers sized to each country's maximum dot count (the most
// people it ever had across the whole time series), and precomputes each
// dot's fixed screen position + pulse identity so scrubbing the year slider
// only changes how many dots per country are drawn, not where they sit.
function setupScene(countries, incomeGroups) {
  countries.forEach((country) => {
    country._regionColor = regionColor(country.region);
    country._incomeLabel = incomeGroupLabel(country.iso3, incomeGroups);
    country._incomeColor = incomeColor(country._incomeLabel);
    country._xyz = new Float32Array(country.dots.length * 3);
    country._freqs = new Float32Array(country.dots.length);
    country._phases = new Float32Array(country.dots.length);
    country.dots.forEach(([lat, lon], i) => {
      const p = latLonToVector3(lat, lon, GLOBE_RADIUS);
      country._xyz[i * 3] = p.x;
      country._xyz[i * 3 + 1] = p.y;
      country._xyz[i * 3 + 2] = p.z;
      country._freqs[i] = PULSE_FREQ_MIN + Math.random() * PULSE_FREQ_RANGE;
      country._phases[i] = Math.random() * Math.PI * 2;
    });
  });

  const maxTotal = countries.reduce((sum, c) => sum + c.dots.length, 0);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(maxTotal * 3), 3),
  );
  geometry.setAttribute(
    "color",
    new THREE.BufferAttribute(new Float32Array(maxTotal * 3), 3),
  );
  geometry.setDrawRange(0, 0);

  const material = new THREE.PointsMaterial({
    size: DOT_SIZE,
    map: createDotTexture(),
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    sizeAttenuation: true,
    blending: THREE.NormalBlending,
  });

  pointsMesh = new THREE.Points(geometry, material);
  scene.add(pointsMesh);

  basePositions = new Float32Array(maxTotal * 3);
  frequencies = new Float32Array(maxTotal);
  phases = new Float32Array(maxTotal);
  dotCountry = new Array(maxTotal);
}

function applyYear(year) {
  const yearIndex = yearsData.indexOf(year);
  if (yearIndex === -1 || !pointsMesh) return;
  currentYearIndex = yearIndex;

  const posAttr = pointsMesh.geometry.getAttribute("position");
  const colorAttr = pointsMesh.geometry.getAttribute("color");
  let cursor = 0;
  let totalPop = 0;

  countriesData.forEach((country) => {
    const pop = country.populations[yearIndex];
    if (pop == null) return;
    totalPop += pop;
    const activeCount = Math.min(
      country.dots.length,
      Math.max(1, Math.round(pop / PEOPLE_PER_DOT)),
    );
    const color = colorFor(country);
    for (let i = 0; i < activeCount; i++) {
      const i3 = cursor * 3;
      const src3 = i * 3;
      const x = country._xyz[src3];
      const y = country._xyz[src3 + 1];
      const z = country._xyz[src3 + 2];
      basePositions[i3] = x;
      basePositions[i3 + 1] = y;
      basePositions[i3 + 2] = z;
      posAttr.array[i3] = x;
      posAttr.array[i3 + 1] = y;
      posAttr.array[i3 + 2] = z;
      colorAttr.array[i3] = color.r;
      colorAttr.array[i3 + 1] = color.g;
      colorAttr.array[i3 + 2] = color.b;
      frequencies[cursor] = country._freqs[i];
      phases[cursor] = country._phases[i];
      dotCountry[cursor] = country;
      cursor++;
    }
  });

  activeTotal = cursor;
  pointsMesh.geometry.setDrawRange(0, activeTotal);
  posAttr.needsUpdate = true;
  colorAttr.needsUpdate = true;

  const isProjected = year > historicalCutoffYear;
  elements.yearValue.textContent = `${year}${isProjected ? "" : ""}`;
  // Use the UN "World" total (same figure shown in the metrics panel)
  // rather than summing our 211-country subset, which excludes ~26 small
  // territories/dependencies and would otherwise show a slightly lower,
  // inconsistent number here.
  const worldPop = globalMetricsByYear.get(year)?.population ?? totalPop;
  elements.status.textContent = `${activeTotal.toLocaleString()} dots · 1 dot ≈ 1M people`;
  updateMetricsPanel(year);
}

// Cheap recolor for switching between Region/Income group modes: reuses
// the already-active dot set (positions, pulse identity) and only rewrites
// the color buffer, instead of rerunning applyYear()'s full rebuild.
function recolor() {
  if (!pointsMesh || !activeTotal) return;
  const colorAttr = pointsMesh.geometry.getAttribute("color");
  for (let i = 0; i < activeTotal; i++) {
    const color = colorFor(dotCountry[i]);
    const i3 = i * 3;
    colorAttr.array[i3] = color.r;
    colorAttr.array[i3 + 1] = color.g;
    colorAttr.array[i3 + 2] = color.b;
  }
  colorAttr.needsUpdate = true;
  renderLegend();
}

function renderLegend() {
  const entries =
    colorMode === "income"
      ? [...Object.entries(INCOME_GROUP_COLORS), [UNCLASSIFIED_INCOME, UNCLASSIFIED_COLOR]]
      : Object.entries(REGION_COLORS);
  elements.legend.replaceChildren(
    ...entries.map(([label, color]) => {
      const item = document.createElement("div");
      item.className = "legend-item";
      const swatch = document.createElement("span");
      swatch.className = "legend-swatch";
      swatch.style.background = color;
      const text = document.createElement("span");
      text.textContent = label.replace(" countries", "");
      item.append(swatch, text);
      return item;
    }),
  );
}

function setColorMode(mode) {
  if (mode === colorMode) return;
  colorMode = mode;
  elements.colorMode
    .querySelectorAll("button")
    .forEach((btn) => btn.classList.toggle("active", btn.dataset.mode === mode));
  recolor();
}

async function init() {
  try {
    const [dotsResponse, globalResponse, incomeResponse] = await Promise.all([
      fetch(DATA_URL),
      fetch(GLOBAL_METRICS_URL),
      fetch(INCOME_GROUPS_URL),
    ]);
    if (!dotsResponse.ok) throw new Error(`HTTP ${dotsResponse.status}`);
    if (!globalResponse.ok) throw new Error(`HTTP ${globalResponse.status}`);
    if (!incomeResponse.ok) throw new Error(`HTTP ${incomeResponse.status}`);
    const data = await dotsResponse.json();
    const globalData = await globalResponse.json();
    const incomeGroups = await incomeResponse.json();
    countriesData = data.countries;
    yearsData = data.years;
    historicalCutoffYear = data.historicalCutoffYear ?? Infinity;
    globalMetricsByYear = buildGlobalMetricsIndex(globalData);

    setupScene(countriesData, incomeGroups);

    const minYear = yearsData[0];
    const maxYear = yearsData[yearsData.length - 1];
    const defaultYear = Math.min(
      Math.max(new Date().getFullYear(), minYear),
      maxYear,
    );
    elements.yearSlider.min = minYear;
    elements.yearSlider.max = maxYear;
    elements.yearSlider.step = 1;
    elements.yearSlider.value = defaultYear;
    elements.yearControl.hidden = false;
    elements.yearSlider.addEventListener("input", () => {
      applyYear(Number(elements.yearSlider.value));
    });

    elements.colorMode.hidden = false;
    elements.colorMode.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => setColorMode(btn.dataset.mode));
    });

    applyYear(defaultYear);
    renderLegend();
  } catch (error) {
    elements.status.textContent = `Could not load data: ${error.message}`;
  }
}

function pulseDots(elapsedTime) {
  if (!pointsMesh || !activeTotal) return;
  const positionAttribute = pointsMesh.geometry.getAttribute("position");
  const array = positionAttribute.array;
  for (let i = 0; i < activeTotal; i++) {
    const i3 = i * 3;
    const ox = basePositions[i3];
    const oy = basePositions[i3 + 1];
    const oz = basePositions[i3 + 2];
    const wave =
      Math.sin(elapsedTime * frequencies[i] + phases[i]) * PULSE_AMPLITUDE;
    const scale = 1 + wave / GLOBE_RADIUS;
    array[i3] = ox * scale;
    array[i3 + 1] = oy * scale;
    array[i3 + 2] = oz * scale;
  }
  positionAttribute.needsUpdate = true;
}

renderer.domElement.addEventListener("pointermove", (event) => {
  pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
});
renderer.domElement.addEventListener("pointerleave", () => {
  pointer.set(Infinity, Infinity);
  elements.tooltip.hidden = true;
});

function updateTooltip(event) {
  if (!pointsMesh || !activeTotal) return;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObject(pointsMesh);
  if (!hits.length) {
    elements.tooltip.hidden = true;
    return;
  }
  const country = dotCountry[hits[0].index];
  if (!country) {
    elements.tooltip.hidden = true;
    return;
  }
  const pop = country.populations[currentYearIndex] ?? country.population;
  const groupLabel =
    colorMode === "income" ? country._incomeLabel : country.region;
  elements.tooltip.hidden = false;
  elements.tooltip.textContent = `${country.name} — ${pop.toLocaleString()} (${groupLabel})`;
  elements.tooltip.style.left = `${event ? event.clientX : 0}px`;
  elements.tooltip.style.top = `${event ? event.clientY : 0}px`;
}

let lastPointerEvent = null;
renderer.domElement.addEventListener("pointermove", (event) => {
  lastPointerEvent = event;
});

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  pulseDots(clock.getElapsedTime());
  if (lastPointerEvent) updateTooltip(lastPointerEvent);
  renderer.render(scene, camera);
}

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

init();
animate();
