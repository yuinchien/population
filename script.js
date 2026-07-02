import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const DATA_URL = "./data/population-dots.json";
const GLOBAL_METRICS_URL = "./data/population-global.json";
const INCOME_GROUPS_URL = "./data/country-income-groups.json";
const PEOPLE_PER_DOT = 500_000;
const GLOBE_RADIUS = 200;
const DOT_SIZE = 6;
const MAP_DOT_SIZE = 4;
const DOT_OPACITY = 0.72;
const PULSE_AMPLITUDE = 5;
const PULSE_FREQ_MIN = 0.5;
const PULSE_FREQ_RANGE = 2.0;
const MAP_WIDTH = 400;
const MAP_HEIGHT = 200;
// A view-mode switch runs through three phases instead of a direct morph:
// dots fly apart into a scrambled cloud filling the globe's volume, hang
// there for a beat, then fly into their final target formation.
const SCRAMBLE_IN_MS = 1200;
const SCRAMBLE_HOLD_MS = 500;
const SCRAMBLE_OUT_MS = 1200;
// Contracting the scramble cloud to a smaller volume than the globe itself
// keeps dots from having to travel all the way out to full radius and
// back, so the fly-apart/fly-together motion reads as tighter, less
// "stretchy" over the same duration.
const SCRAMBLE_RADIUS = GLOBE_RADIUS * 0.6;
const VIEW_TRANSITION_MS = SCRAMBLE_IN_MS + SCRAMBLE_HOLD_MS + SCRAMBLE_OUT_MS;
const GLOBE_AUTO_ROTATE_SPEED = 0.35;
const SCRAMBLE_AUTO_ROTATE_SPEED = 5.0;
const GLOBE_CAMERA_POS = new THREE.Vector3(0, 0, GLOBE_RADIUS * 3.1);
const MAP_CAMERA_POS = new THREE.Vector3(0, 0, 480);

const REGION_COLORS = {
  "East Asia & Pacific": "#ac936e",
  "Europe & Central Asia": "#e6b5c9",
  "Latin America & Caribbean": "#bd8ca6",
  "Middle East, North Africa, Afghanistan & Pakistan": "#a5aaa8",
  "North America": "#82d8d5",
  "South Asia": "#5ec8e5",
  "Sub-Saharan Africa": "#62c2b1",
};
const DEFAULT_COLOR = "#5fe39a";

const INCOME_GROUP_COLORS = {
  "High-income countries": "#00a95c",
  "Middle-income countries": "#765ba7",
  "Low-income countries": "#ff6c2f",
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
  viewMode: document.querySelector("#viewMode"),
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
controls.autoRotateSpeed = GLOBE_AUTO_ROTATE_SPEED;
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

function latLonToMapVector3(lat, lon) {
  return new THREE.Vector3(
    (lon / 180) * (MAP_WIDTH / 2),
    (lat / 90) * (MAP_HEIGHT / 2),
    0,
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
let viewMode = "globe";
let dotLocalIndex = null;
let transition = null;
let isScrambledPhase = false;
let isHoldPhase = false;
const timer = new THREE.Timer();
timer.connect(document);

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
// Arrives at the scramble point already moving (no decel-to-a-stop), so
// it can flow straight into easeOutCubic's departure without a stall.
function easeInCubic(t) {
  return t * t * t;
}
// Leaves the scramble point at full speed and decelerates into rest.
function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function colorFor(country) {
  return colorMode === "income" ? country._incomeColor : country._regionColor;
}

// Uniformly-distributed random points inside a sphere a bit smaller than
// the globe itself — the "scrambled" mid-transition cloud.
function computeScramblePositions(count) {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const r = SCRAMBLE_RADIUS * Math.cbrt(Math.random());
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const i3 = i * 3;
    positions[i3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i3 + 1] = r * Math.cos(phi);
    positions[i3 + 2] = r * Math.sin(phi) * Math.sin(theta);
  }
  return positions;
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
    country._xyzGlobe = new Float32Array(country.dots.length * 3);
    country._xyzMap = new Float32Array(country.dots.length * 3);
    country._freqs = new Float32Array(country.dots.length);
    country._phases = new Float32Array(country.dots.length);
    country.dots.forEach(([lat, lon], i) => {
      const globePoint = latLonToVector3(lat, lon, GLOBE_RADIUS);
      country._xyzGlobe[i * 3] = globePoint.x;
      country._xyzGlobe[i * 3 + 1] = globePoint.y;
      country._xyzGlobe[i * 3 + 2] = globePoint.z;
      const mapPoint = latLonToMapVector3(lat, lon);
      country._xyzMap[i * 3] = mapPoint.x;
      country._xyzMap[i * 3 + 1] = mapPoint.y;
      country._xyzMap[i * 3 + 2] = mapPoint.z;
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
    opacity: DOT_OPACITY,
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
  dotLocalIndex = new Int32Array(maxTotal);
}

function positionsFor(country) {
  return viewMode === "map" ? country._xyzMap : country._xyzGlobe;
}

function applyYear(year) {
  const yearIndex = yearsData.indexOf(year);
  if (yearIndex === -1 || !pointsMesh) return;
  currentYearIndex = yearIndex;
  // A slider move mid-transition invalidates the in-flight tween's index
  // mapping (activeTotal/dotCountry are about to be rebuilt), so just cut
  // straight to the target view's positions instead of finishing the morph.
  transition = null;

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
    const positions = positionsFor(country);
    for (let i = 0; i < activeCount; i++) {
      const i3 = cursor * 3;
      const src3 = i * 3;
      const x = positions[src3];
      const y = positions[src3 + 1];
      const z = positions[src3 + 2];
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
      dotLocalIndex[cursor] = i;
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
  elements.status.textContent = `${activeTotal.toLocaleString()} dots · 1 dot ≈ ${formatCount(PEOPLE_PER_DOT)} people`;
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

function updateSliderProgress() {
  const slider = elements.yearSlider;
  const min = Number(slider.min);
  const max = Number(slider.max);
  const pct = ((Number(slider.value) - min) / (max - min)) * 100;
  slider.style.setProperty("--progress", `${pct}%`);
}

function renderLegend() {
  const entries =
    colorMode === "income"
      ? [
          ...Object.entries(INCOME_GROUP_COLORS),
          [UNCLASSIFIED_INCOME, UNCLASSIFIED_COLOR],
        ]
      : Object.entries(REGION_COLORS);
  elements.legend.replaceChildren(
    ...entries.map(([label, color]) => {
      const item = document.createElement("div");
      item.className = "legend-item";
      const swatch = document.createElement("span");
      swatch.className = "legend-swatch";
      swatch.style.background = color;
      const text = document.createElement("span");
      if (label.includes("Afghanistan & Pakistan")) {
        text.textContent = "Middle East & North Africa";
      } else {
        text.textContent = label.replace(" countries", "");
      }
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
    .forEach((btn) =>
      btn.classList.toggle("active", btn.dataset.mode === mode),
    );
  recolor();
}

// Reads target positions straight out of each active dot's precomputed
// globe/map array, in the exact cursor order applyYear() last laid out
// (dotCountry[slot] + dotLocalIndex[slot] together identify which of that
// country's dots occupies this slot).
function computeTargetPositions(mode) {
  const target = new Float32Array(activeTotal * 3);
  for (let slot = 0; slot < activeTotal; slot++) {
    const country = dotCountry[slot];
    const src3 = dotLocalIndex[slot] * 3;
    const source = mode === "map" ? country._xyzMap : country._xyzGlobe;
    const i3 = slot * 3;
    target[i3] = source[src3];
    target[i3 + 1] = source[src3 + 1];
    target[i3 + 2] = source[src3 + 2];
  }
  return target;
}

function currentGlobeCameraPosition(target = controls.target) {
  return camera.position
    .clone()
    .sub(target)
    .setLength(GLOBE_CAMERA_POS.length())
    .add(target);
}

function setViewMode(mode) {
  if (mode === viewMode || !activeTotal) return;

  const fromPositions = basePositions.slice(0, activeTotal * 3);
  const scramblePositions = computeScramblePositions(activeTotal);
  const toPositions = computeTargetPositions(mode);
  viewMode = mode;

  transition = {
    fromPositions,
    scramblePositions,
    toPositions,
    toCamPos:
      mode === "map" ? MAP_CAMERA_POS.clone() : GLOBE_CAMERA_POS.clone(),
    toTarget: new THREE.Vector3(0, 0, 0),
    toDotSize: mode === "map" ? MAP_DOT_SIZE : DOT_SIZE,
    previousAutoRotateSpeed: controls.autoRotateSpeed,
    outCamCaptured: false,
    start: performance.now(),
  };
  // Leave autoRotate as-is (still spinning if we're leaving globe mode) and
  // block user drag input only — updateTransition() lets controls.update()
  // keep rotating through the scramble-in/hold phases, and only takes the
  // camera over once the fly-out phase begins.
  controls.enabled = false;
  controls.autoRotate = true;
  controls.autoRotateSpeed = SCRAMBLE_AUTO_ROTATE_SPEED;

  elements.viewMode
    .querySelectorAll("button")
    .forEach((btn) =>
      btn.classList.toggle("active", btn.dataset.mode === mode),
    );
}

// Three-phase morph: current formation -> scrambled cloud filling the
// globe's volume -> final formation. The scramble is regenerated fresh
// each call (setViewMode), so consecutive toggles never repeat the same
// "explosion" pattern. The camera is left alone (still auto-rotating, if
// it already was) through the fly-apart/hold phases, and only takes over
// to glide toward the final view once the fly-out phase starts — so a
// globe->map switch keeps spinning right up until it commits to flattening.
function updateTransition() {
  if (!transition) return;
  const elapsed = performance.now() - transition.start;
  const overallT = Math.min(1, elapsed / VIEW_TRANSITION_MS);
  const outPhaseStart = SCRAMBLE_IN_MS + SCRAMBLE_HOLD_MS;

  let from, to, localT, ease;
  isHoldPhase = false;
  if (elapsed < SCRAMBLE_IN_MS) {
    from = transition.fromPositions;
    to = transition.scramblePositions;
    localT = elapsed / SCRAMBLE_IN_MS;
    ease = easeInCubic;
    isScrambledPhase = true;
  } else if (elapsed < outPhaseStart) {
    from = transition.scramblePositions;
    to = transition.scramblePositions;
    localT = 0;
    ease = easeInCubic;
    isScrambledPhase = true;
    isHoldPhase = true;
  } else {
    from = transition.scramblePositions;
    to = transition.toPositions;
    localT = (elapsed - outPhaseStart) / SCRAMBLE_OUT_MS;
    ease = easeOutCubic;
    isScrambledPhase = false;

    if (!transition.outCamCaptured) {
      transition.outCamPos = camera.position.clone();
      transition.outTarget = controls.target.clone();
      if (viewMode === "globe") {
        transition.toCamPos = currentGlobeCameraPosition(transition.toTarget);
      }
      transition.outDotSize = pointsMesh.material.size;
      transition.outCamCaptured = true;
      controls.autoRotate = false;
      controls.autoRotateSpeed = transition.previousAutoRotateSpeed;
    }
  }
  const e = ease(Math.min(1, localT));

  for (let k = 0; k < transition.toPositions.length; k++) {
    basePositions[k] = from[k] + (to[k] - from[k]) * e;
  }

  if (transition.outCamCaptured) {
    const outT = Math.min(1, (elapsed - outPhaseStart) / SCRAMBLE_OUT_MS);
    const camE = easeInOutCubic(outT);
    camera.position.lerpVectors(
      transition.outCamPos,
      transition.toCamPos,
      camE,
    );
    controls.target.lerpVectors(
      transition.outTarget,
      transition.toTarget,
      camE,
    );
    pointsMesh.material.size =
      transition.outDotSize +
      (transition.toDotSize - transition.outDotSize) * camE;
    raycaster.params.Points.threshold = pointsMesh.material.size * 1.5;
  }

  if (overallT >= 1) {
    transition = null;
    isScrambledPhase = false;
    controls.enabled = true;
    if (viewMode === "globe") {
      controls.enableRotate = true;
      controls.enablePan = false;
      controls.autoRotate = true;
      controls.autoRotateSpeed = GLOBE_AUTO_ROTATE_SPEED;
      controls.minDistance = GLOBE_RADIUS * 1.3;
      controls.maxDistance = GLOBE_RADIUS * 8;
    } else {
      controls.enableRotate = false;
      controls.enablePan = true;
      controls.autoRotate = false;
      controls.minDistance = 250;
      controls.maxDistance = 1200;
    }
  }
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
      updateSliderProgress();
      applyYear(Number(elements.yearSlider.value));
    });

    elements.colorMode.hidden = false;
    elements.colorMode.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => setColorMode(btn.dataset.mode));
    });

    elements.viewMode.hidden = false;
    elements.viewMode.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => setViewMode(btn.dataset.mode));
    });

    updateSliderProgress();
    applyYear(defaultYear);
    renderLegend();
  } catch (error) {
    elements.status.textContent = `Could not load data: ${error.message}`;
  }
}

// On the globe, each dot pulses outward along its own surface normal
// (equivalent to scaling the position vector from the sphere's center,
// since every base position already sits exactly GLOBE_RADIUS from
// origin). On the flat map there's no "outward" direction shared with the
// origin, so dots instead pulse toward/away from the camera along Z —
// same twinkle feel, without the map-center dots barely moving.
// During the (brief) hold at the scramble cloud, dots pulse faster and
// harder than the ambient shimmer — reads as "the system is computing"
// rather than a freeze-frame — before flying out to their final shape.
const HOLD_FREQ_MULTIPLIER = 7;
const HOLD_AMPLITUDE_MULTIPLIER = 2.5;

function pulseDots(elapsedTime) {
  if (!pointsMesh || !activeTotal) return;
  const positionAttribute = pointsMesh.geometry.getAttribute("position");
  const array = positionAttribute.array;
  const isMap = viewMode === "map" && !isScrambledPhase;
  const freqMul = isHoldPhase ? HOLD_FREQ_MULTIPLIER : 1;
  const ampMul = isHoldPhase ? HOLD_AMPLITUDE_MULTIPLIER : 1;
  for (let i = 0; i < activeTotal; i++) {
    const i3 = i * 3;
    const ox = basePositions[i3];
    const oy = basePositions[i3 + 1];
    const oz = basePositions[i3 + 2];
    const wave =
      Math.sin(elapsedTime * frequencies[i] * freqMul + phases[i]) *
      PULSE_AMPLITUDE *
      ampMul;
    if (isMap) {
      array[i3] = ox;
      array[i3 + 1] = oy;
      array[i3 + 2] = oz + wave;
    } else {
      const scale = 1 + wave / GLOBE_RADIUS;
      array[i3] = ox * scale;
      array[i3 + 1] = oy * scale;
      array[i3 + 2] = oz * scale;
    }
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
  const groupColor = colorFor(country);

  const line1 = document.createElement("div");
  line1.className = "tooltip-line1";
  line1.textContent = `${country.name}: ${pop.toLocaleString()}`;

  const swatch = document.createElement("span");
  swatch.className = "legend-swatch";
  swatch.style.background = `#${groupColor.getHexString()}`;

  const groupText = document.createElement("span");
  groupText.textContent = groupLabel;

  const line2 = document.createElement("div");
  line2.className = "tooltip-line2";
  line2.append(swatch, groupText);

  elements.tooltip.hidden = false;
  elements.tooltip.replaceChildren(line1, line2);
  elements.tooltip.style.left = `${event ? event.clientX : 0}px`;
  elements.tooltip.style.top = `${event ? event.clientY : 0}px`;
}

let lastPointerEvent = null;
renderer.domElement.addEventListener("pointermove", (event) => {
  lastPointerEvent = event;
});

function animate(timestamp) {
  requestAnimationFrame(animate);
  timer.update(timestamp);
  updateTransition();
  controls.update(timer.getDelta());
  pulseDots(timer.getElapsed());
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
