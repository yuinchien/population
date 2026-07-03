import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const DATA_URL = "./data/population-dots.json";
const GLOBAL_METRICS_URL = "./data/population-global.json";
const INCOME_GROUPS_URL = "./data/country-income-groups.json";
const COUNTRY_DEMOGRAPHICS_URL = "./data/country-demographic-metrics.json";
const COUNTRY_GNI_URL = "./data/country-gni.json";
const COUNTRY_ISO2_URL = "./data/country-iso2.json";
const FLAG_URL = (iso2) => `./flags/${iso2}.svg`;
const PEOPLE_PER_DOT = 500_000;
const GLOBE_RADIUS = 200;
const DOT_SIZE = 3.2;
const MAP_DOT_SIZE = 1.5;
const DOT_OPACITY = 0.9;
const PULSE_AMPLITUDE = 7;
const PULSE_FREQ_MIN = 0.8;
const PULSE_FREQ_RANGE = 2.0;
const MAP_WIDTH = 400;
const MAP_HEIGHT = 200;
// A view-mode switch runs through three phases instead of a direct morph:
// dots fly apart into a scrambled cloud filling the globe's volume, hang
// there for a beat, then fly into their final target formation.
const SCRAMBLE_IN_MS = 800;
const SCRAMBLE_HOLD_MS = 400;
const SCRAMBLE_OUT_MS = 800;
// Contracting the scramble cloud to a smaller volume than the globe itself
// keeps dots from having to travel all the way out to full radius and
// back, so the fly-apart/fly-together motion reads as tighter, less
// "stretchy" over the same duration.
const SCRAMBLE_RADIUS = GLOBE_RADIUS * 0.6;
const VIEW_TRANSITION_MS = SCRAMBLE_IN_MS + SCRAMBLE_HOLD_MS + SCRAMBLE_OUT_MS;
const GLOBE_AUTO_ROTATE_SPEED = 0.35;
const GLOBE_CAMERA_POS = new THREE.Vector3(0, 0, GLOBE_RADIUS * 3.1);
const MAP_CAMERA_POS = new THREE.Vector3(0, 0, 480);

// "Peak population year" callouts: a leader line drawn along the surface
// normal at a country's location, from a country whose modeled population
// peaks in the currently selected year.
const CALLOUT_GLOBE_EXTEND = GLOBE_RADIUS * 1.12;
const CALLOUT_MAP_EXTEND = 80;
// Keep callout labels clear of the fixed sidebar (#overlay is 240px wide).
const CALLOUT_LEFT_CLEARANCE = 260;

const REGION_COLORS = {
  "East Asia & Pacific": "#a5aaa8",
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
  titleYear: document.querySelector("#titleYear"),
  status: document.querySelector("#status"),
  peakFlags: document.querySelector("#peakFlags"),
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
  calloutLayer: document.querySelector("#calloutLayer"),
  detailPanel: document.querySelector("#detailPanel"),
  detailTitle: document.querySelector("#detailTitle"),
  detailSubtitle: document.querySelector("#detailSubtitle"),
  detailSummary: document.querySelector("#detailSummary"),
  detailHeader: document.querySelector("#detailHeader"),
  detailRows: document.querySelector("#detailRows"),
  detailClose: document.querySelector("#detailClose"),
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

const calloutGroup = new THREE.Group();
scene.add(calloutGroup);
let peakCallouts = []; // { country, anchor, outward, line, labelEl }

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

function displayGroupLabel(label) {
  if (label.includes("Afghanistan & Pakistan")) {
    return "Middle East & North Africa";
  }
  return label.replace(" countries", "");
}

function formatYears(value) {
  if (value == null) return "N/A";
  return `${Number(value).toFixed(1)} yrs`;
}

function formatPopulation(value) {
  if (value == null) return "N/A";
  return Math.round(value).toLocaleString();
}

function formatPercent(value) {
  if (value == null) return "N/A";
  return `${Number(value).toFixed(2)}%`;
}

function formatFertility(value) {
  if (value == null) return "N/A";
  return Number(value).toFixed(2);
}

function createDotTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, "rgba(255, 255, 255, 1)");
  gradient.addColorStop(0.46, "rgba(255, 255, 255, 1)");
  gradient.addColorStop(0.74, "rgba(255, 255, 255, 0.72)");
  gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.LinearFilter;
  return texture;
}

// The pulse (and the globe/map position blend) used to be recomputed on the
// CPU for every active dot, every frame — the single most expensive thing
// in the render loop once dot counts climbed into the tens of thousands.
// Moving it into the vertex shader means the CPU only writes the *base*
// (unpulsed) position when the year or view mode actually changes; the GPU
// displaces every vertex in parallel on every frame for free. The size
// attenuation formula (uScale / -mvPosition.z) is copied from Three.js's
// own PointsMaterial shader chunk so dot sizing looks identical to before.
const DOT_VERTEX_SHADER = `
  uniform float uTime;
  uniform float uSize;
  uniform float uScale;
  uniform float uPulseAmplitude;
  uniform float uFreqMul;
  uniform float uAmpMul;
  uniform float uGlobeRadius;
  uniform float uIsMap;

  attribute vec3 color;
  attribute float aFrequency;
  attribute float aPhase;

  varying vec3 vColor;

  void main() {
    vColor = color;

    float wave = sin(uTime * aFrequency * uFreqMul + aPhase) * uPulseAmplitude * uAmpMul;

    vec3 pulsed;
    if (uIsMap > 0.5) {
      // No shared "outward" direction on a flat map, so pulse toward/away
      // from the camera along Z instead (matches the old CPU behavior).
      pulsed = vec3(position.x, position.y, position.z + wave);
    } else {
      // Globe (and the scrambled cloud) points already sit at a fixed
      // radius from the origin, so scaling the position vector is the
      // same as displacing along the surface normal.
      float scale = 1.0 + wave / uGlobeRadius;
      pulsed = position * scale;
    }

    vec4 mvPosition = modelViewMatrix * vec4(pulsed, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = uSize * (uScale / -mvPosition.z);
  }
`;

const DOT_FRAGMENT_SHADER = `
  uniform sampler2D map;
  uniform float uOpacity;

  varying vec3 vColor;

  void main() {
    vec4 texColor = texture2D(map, gl_PointCoord);
    gl_FragColor = vec4(vColor * texColor.rgb, uOpacity * texColor.a);
    // Three's THREE.Color stores values in linear space (color management
    // is on by default since r152) and built-in materials convert back to
    // the renderer's output color space via this exact chunk before
    // writing gl_FragColor. A bare custom ShaderMaterial skips that unless
    // asked, which is why colors came out darker/desaturated after moving
    // off PointsMaterial — this restores the same conversion.
    #include <colorspace_fragment>
  }
`;

// Single B/M/K abbreviator behind both the metrics-panel population figure
// and the smaller peak-population numbers shown per flag — they used to be
// near-identical copies differing only in decimal precision and null
// handling, which the options below make explicit instead of duplicated.
function formatCount(value, options = {}) {
  const {
    billionsDecimals = 2,
    millionsDecimals = 1,
    thousandsDecimals = 0,
    nullFallback = null,
    roundWholeNumbers = false,
  } = options;
  if (value == null) return nullFallback ?? `${value}`;
  if (value >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(billionsDecimals)}B`;
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(millionsDecimals)}M`;
  }
  if (value >= 1_000) return `${(value / 1_000).toFixed(thousandsDecimals)}K`;
  return roundWholeNumbers ? Math.round(value).toLocaleString() : `${value}`;
}

function formatPeakPopulation(value) {
  return formatCount(value, {
    billionsDecimals: 1,
    thousandsDecimals: 1,
    nullFallback: "N/A",
    roundWholeNumbers: true,
  });
}

// data/population-global.json holds one series per indicator, each an
// array of {year, value} rows; index by year so applyYear() can look up
// all five in O(1) as the slider moves. "variants" (High/Low UN scenarios)
// is a nested object, not a flat series, so it's excluded here and indexed
// separately by buildVariantIndex().
function buildGlobalMetricsIndex(globalData) {
  const byYear = new Map();
  Object.entries(globalData).forEach(([series, rows]) => {
    if (series === "variants") return;
    rows.forEach(({ year, value }) => {
      if (!byYear.has(year)) byYear.set(year, {});
      byYear.get(year)[series] = value;
    });
  });
  return byYear;
}

// Same shape as buildGlobalMetricsIndex, but for a single variant's series
// object (globalData.variants.high or .low).
function buildVariantIndex(variantSeries) {
  const byYear = new Map();
  Object.entries(variantSeries).forEach(([series, rows]) => {
    rows.forEach(({ year, value }) => {
      if (!byYear.has(year)) byYear.set(year, {});
      byYear.get(year)[series] = value;
    });
  });
  return byYear;
}

function metricRows(globalData, key) {
  return [...(globalData[key] || [])].sort((a, b) => a.year - b.year);
}

function firstMetricYear(globalData, key, predicate) {
  return metricRows(globalData, key).find(({ value }) => predicate(value));
}

function addMilestone(milestones, year, text, priority = 0) {
  if (!Number.isFinite(year)) return;
  const current = milestones.get(year);
  if (!current || priority > current.priority) {
    milestones.set(year, { text, priority });
  }
}

function computeGlobalTrendMilestones(globalData) {
  const milestones = new Map();
  const populationRows = metricRows(globalData, "population");
  const peakPopulation = populationRows.reduce(
    (best, row) => (!best || row.value > best.value ? row : best),
    null,
  );
  if (peakPopulation) {
    addMilestone(
      milestones,
      peakPopulation.year,
      `${peakPopulation.year} is the projected turning point for global population: it tops out near ${formatCount(peakPopulation.value)} before edging downward.`,
      5,
    );
  }

  const tenBillion = firstMetricYear(
    globalData,
    "population",
    (value) => value >= 10_000_000_000,
  );
  if (tenBillion) {
    addMilestone(
      milestones,
      tenBillion.year,
      `${tenBillion.year} is the first year the medium projection puts the world above 10B people.`,
      4,
    );
  }

  const replacementFertility = firstMetricYear(
    globalData,
    "fertility",
    (value) => value < 2.1,
  );
  if (replacementFertility) {
    addMilestone(
      milestones,
      replacementFertility.year,
      `${replacementFertility.year} is when global fertility is projected to slip below replacement, at ${replacementFertility.value.toFixed(3)} births per woman.`,
      4,
    );
  }

  const slowGrowth = firstMetricYear(
    globalData,
    "populationGrowth",
    (value) => value < 0.5,
  );
  if (slowGrowth) {
    addMilestone(
      milestones,
      slowGrowth.year,
      `${slowGrowth.year} marks a slower-growth world: global population growth falls below 0.5% for the first time in the projection.`,
      3,
    );
  }

  const life80 = firstMetricYear(
    globalData,
    "lifeExpectancy",
    (value) => value >= 80,
  );
  if (life80) {
    addMilestone(
      milestones,
      life80.year,
      `${life80.year} is the first projected year global life expectancy reaches 80 years.`,
      3,
    );
  }

  return milestones;
}

// Writes a metric's headline value, plus — for projected years — a
// smaller "Low – High" range line sourced from the UN's Low/High variant
// scenarios, so the further out the slider goes, the more visibly
// uncertain the number becomes (instead of reading as a flat fact).
function setMetricValue(el, mainText, rangeText) {
  el.textContent = "";
  el.append(document.createTextNode(mainText));
  if (rangeText) {
    const rangeEl = document.createElement("span");
    rangeEl.className = "metric-range";
    rangeEl.textContent = rangeText;
    el.append(rangeEl);
  }
}

function updateMetricsPanel(year) {
  const metrics = globalMetricsByYear.get(year);
  if (!metrics) {
    elements.metrics.hidden = true;
    return;
  }
  elements.metrics.hidden = false;

  const isProjected = year > historicalCutoffYear;
  const hi = isProjected ? highMetricsByYear.get(year) : null;
  const lo = isProjected ? lowMetricsByYear.get(year) : null;

  // formatRangeNum lets a metric use a bare-number range (e.g. "1.98–2.48")
  // instead of repeating the main value's unit on both ends of the range.
  function apply(el, key, formatNum, formatRangeNum) {
    const mainText = formatNum(metrics[key]);
    let rangeText = "";
    if (hi && lo && hi[key] != null && lo[key] != null) {
      rangeText = formatRangeNum
        ? `${formatRangeNum(lo[key])} — ${formatRangeNum(hi[key])}`
        : `${formatNum(lo[key])} — ${formatNum(hi[key])}`;
    }
    setMetricValue(el, mainText, rangeText);
  }

  apply(elements.metricPopulation, "population", formatCount);
  apply(
    elements.metricFertility,
    "fertility",
    (v) => `${v.toFixed(2)} births/woman`,
    (v) => v.toFixed(2),
  );
  apply(
    elements.metricLifeExpectancy,
    "lifeExpectancy",
    (v) => `${v.toFixed(1)} yrs`,
    (v) => v.toFixed(1),
  );
  apply(
    elements.metricMedianAge,
    "medianAge",
    (v) => `${v.toFixed(1)} yrs`,
    (v) => v.toFixed(1),
  );
  apply(
    elements.metricPopulationGrowth,
    "populationGrowth",
    (v) => `${v.toFixed(2)}%`,
  );
}

let pointsMesh = null;
let basePositions = null; // pre-pulse baseline, rebuilt whenever the year changes
let frequencies = null;
let phases = null;
let currentDotSize = DOT_SIZE; // logical size (unscaled by pixelRatio)
let dotCountry = [];
let activeTotal = 0;
let countriesData = [];
let yearsData = [];
let currentYearIndex = -1;
let historicalCutoffYear = Infinity;
let globalMetricsByYear = new Map();
let highMetricsByYear = new Map();
let lowMetricsByYear = new Map();
let globalTrendMilestones = new Map();
let countryDemographicMetrics = null;
let countryGni = {};
let countryIso2 = {};
let colorMode = "region";
let viewMode = "globe";
let selectedLegend = null;
let detailSort = { key: "population", direction: "desc" };
let statusTypingToken = 0;
let dotLocalIndex = null;
let transition = null;
let isScrambledPhase = false;
let isHoldPhase = false;
let isProjectedYear = false;
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
  geometry.setAttribute(
    "aFrequency",
    new THREE.BufferAttribute(new Float32Array(maxTotal), 1),
  );
  geometry.setAttribute(
    "aPhase",
    new THREE.BufferAttribute(new Float32Array(maxTotal), 1),
  );
  geometry.setDrawRange(0, 0);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      map: { value: createDotTexture() },
      uTime: { value: 0 },
      uSize: { value: DOT_SIZE * renderer.getPixelRatio() },
      uScale: { value: renderer.domElement.height * 0.5 },
      uOpacity: { value: DOT_OPACITY },
      uPulseAmplitude: { value: PULSE_AMPLITUDE },
      uFreqMul: { value: 1 },
      uAmpMul: { value: 1 },
      uGlobeRadius: { value: GLOBE_RADIUS },
      uIsMap: { value: 0 },
    },
    vertexShader: DOT_VERTEX_SHADER,
    fragmentShader: DOT_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });

  pointsMesh = new THREE.Points(geometry, material);
  scene.add(pointsMesh);

  basePositions = new Float32Array(maxTotal * 3);
  frequencies = geometry.getAttribute("aFrequency").array;
  phases = geometry.getAttribute("aPhase").array;
  dotCountry = new Array(maxTotal);
  dotLocalIndex = new Int32Array(maxTotal);
  currentDotSize = DOT_SIZE;
}

function setDotSize(size) {
  currentDotSize = size;
  pointsMesh.material.uniforms.uSize.value = size * renderer.getPixelRatio();
  raycaster.params.Points.threshold = size * 1.5;
}

function positionsFor(country) {
  return viewMode === "map" ? country._xyzMap : country._xyzGlobe;
}

// The year a country's modeled population is highest — i.e. where it
// crests and starts declining. Boundary years (1950, 2100) are excluded:
// a max at either edge of the series usually just means "still rising/
// falling when the data runs out," not a genuine peak.
function computePeakYear(populations, years) {
  let maxIndex = -1;
  let maxValue = -Infinity;
  for (let i = 0; i < populations.length; i++) {
    const v = populations[i];
    if (v != null && v > maxValue) {
      maxValue = v;
      maxIndex = i;
    }
  }
  if (maxIndex <= 0 || maxIndex >= populations.length - 1) return null;
  return years[maxIndex];
}

// Centroid of a country's precomputed dot cloud in the current view basis,
// re-projected onto the globe's surface (averaging points on a sphere
// lands inside it, not on it) or left on the flat map plane as-is.
function computeCountryAnchor(country) {
  const src = viewMode === "map" ? country._xyzMap : country._xyzGlobe;
  const n = src.length / 3;
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = 0; i < n; i++) {
    x += src[i * 3];
    y += src[i * 3 + 1];
    z += src[i * 3 + 2];
  }
  const v = new THREE.Vector3(x / n, y / n, z / n);
  if (viewMode !== "map") v.normalize().multiplyScalar(GLOBE_RADIUS);
  return v;
}

function computeOutwardPoint(anchor) {
  if (viewMode === "map") {
    return anchor.clone().add(new THREE.Vector3(0, 0, CALLOUT_MAP_EXTEND));
  }
  return anchor.clone().normalize().multiplyScalar(CALLOUT_GLOBE_EXTEND);
}

function clearPeakCallouts() {
  peakCallouts.forEach(({ line, labelEl }) => {
    calloutGroup.remove(line);
    line.geometry.dispose();
    line.material.dispose();
    labelEl.remove();
  });
  peakCallouts = [];
}

// Rebuilds the leader-line + label for every country whose peak year
// matches the year currently on the slider. Also called from setViewMode()
// since the anchor/outward points depend on the globe/map basis.
function updatePeakCallouts(year) {
  clearPeakCallouts();
  if (!countriesData.length) return;

  countriesData
    .filter((country) => country.peakYear === year)
    .forEach((country) => {
      const anchor = computeCountryAnchor(country);
      const outward = computeOutwardPoint(anchor);
      const dotColor = colorFor(country);

      const geometry = new THREE.BufferGeometry().setFromPoints([
        anchor,
        outward,
      ]);
      const material = new THREE.LineBasicMaterial({
        color: dotColor,
        transparent: true,
        opacity: 0.9,
      });
      const line = new THREE.Line(geometry, material);
      calloutGroup.add(line);

      const labelEl = document.createElement("div");
      labelEl.className = "peak-callout-label glass";
      labelEl.textContent = country.name;
      labelEl.style.setProperty(
        "--color-callout",
        `#${dotColor.getHexString()}`,
      );
      elements.calloutLayer.append(labelEl);

      peakCallouts.push({ country, anchor, outward, line, labelEl });
    });
}

// Projects each callout's outward endpoint to screen space every frame
// (the camera orbits continuously, so this can't be computed just once).
// On the globe, a callout for a country currently on the far side is
// hidden — its anchor direction points away from the camera direction.
function updateCalloutLabels() {
  if (!peakCallouts.length) return;
  const camDir = camera.position.clone().normalize();
  // A callout's line/label are anchored to the resting globe/map position,
  // which doesn't exist mid-transition (dots are off in the scrambled
  // cloud) — so both are hidden together rather than left pointing at a
  // now-stale spot, which reads as broken/frozen rather than "in motion".
  const inTransition = !!transition;
  peakCallouts.forEach(({ anchor, outward, line, labelEl }) => {
    if (inTransition) {
      line.visible = false;
      labelEl.hidden = true;
      return;
    }
    if (viewMode !== "map") {
      const facing = anchor.clone().normalize().dot(camDir);
      if (facing < 0.1) {
        line.visible = false;
        labelEl.hidden = true;
        return;
      }
    }
    line.visible = true;
    labelEl.hidden = false;
    const projected = outward.clone().project(camera);
    const x = (projected.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-projected.y * 0.5 + 0.5) * window.innerHeight;
    const margin = 12;
    labelEl.style.left = `${Math.min(Math.max(x, CALLOUT_LEFT_CLEARANCE), window.innerWidth - margin)}px`;
    labelEl.style.top = `${Math.min(Math.max(y, margin + 20), window.innerHeight - margin)}px`;
  });
}

// Picks a phrasing for the peak-year status line based on how many countries
// peak in the given year. Country names live in the detail rows below the
// status, so the copy stays focused on the year and count.
// isProjected distinguishes an observed peak (year <= historicalCutoffYear)
// from a modeled one (year > historicalCutoffYear) — without it, a
// projected-year copy like "France's population peaks in 2061" reads as a
// stated fact rather than the UN Medium-variant projection it actually is.
function buildPeakStatus(year, peakCountries, isProjected) {
  const pick = (variants) =>
    variants[Math.floor(Math.random() * variants.length)];
  const count = peakCountries.length;

  if (count === 0) {
    return pick(
      isProjected
        ? [
            `No country's population is projected to peak in ${year}.`,
            `${year} is projected to pass quietly — no country's population is expected to hit its peak.`,
            `No population peaks are projected for ${year}. Try another spot on the timeline.`,
          ]
        : [
            `No country's population peaked in ${year}.`,
            `${year} passed quietly — no country's population hit its peak.`,
            `Not a single population peak that year. Try another spot on the timeline.`,
          ],
    );
  }

  if (count === 1) {
    return pick(
      isProjected
        ? [
            `One country is projected to reach its population peak in ${year}.`,
            `${year} is projected to be a population high point for one country.`,
            `A single country is projected to top out in ${year}.`,
          ]
        : [
            `One country reached its population peak in ${year}.`,
            `${year} was the population high point for one country.`,
            `A single country topped out in ${year}.`,
          ],
    );
  }

  if (count <= 3) {
    return pick(
      isProjected
        ? [
            `${count} countries are projected to reach their population peak in ${year}.`,
            `${year} is projected to mark the population high point for ${count} countries.`,
            `${count} countries are projected to top out in ${year}.`,
          ]
        : [
            `${count} countries reached their population peak in ${year}.`,
            `${year} marked the population high point for ${count} countries.`,
            `${count} countries topped out in ${year}.`,
          ],
    );
  }

  return pick(
    isProjected
      ? [
          `${count} countries are projected to reach their population peak in ${year}.`,
          `${year} is projected to be a busy peak year, with ${count} countries topping out.`,
          `A wave of projected population peaks lands in ${year}: ${count} countries in all.`,
        ]
      : [
          `${count} countries reached their population peak in ${year}.`,
          `${year} was a busy peak year, with ${count} countries topping out.`,
          `A wave of population peaks landed in ${year}: ${count} countries in all.`,
        ],
  );
}

function countriesWithNumericValue(countries, value) {
  return countries
    .map((country) => ({ country, value: value(country) }))
    .filter((entry) => Number.isFinite(entry.value));
}

function maxEntry(entries) {
  return entries.reduce(
    (best, entry) => (!best || entry.value > best.value ? entry : best),
    null,
  );
}

function minEntry(entries) {
  return entries.reduce(
    (best, entry) => (!best || entry.value < best.value ? entry : best),
    null,
  );
}

function averageValue(entries) {
  if (!entries.length) return null;
  return entries.reduce((sum, entry) => sum + entry.value, 0) / entries.length;
}

// buildDetailStatus() needs this same entries/otherEntries/average/max/min
// bundle for growth, fertility, life expectancy, and median age alike — one
// call per metric here instead of four hand-copied variable groups.
function computeMetricStats(countries, otherCountries, key) {
  const entries = countriesWithNumericValue(countries, (country) =>
    metricFor(country, key),
  );
  const otherEntries = countriesWithNumericValue(otherCountries, (country) =>
    metricFor(country, key),
  );
  return {
    entries,
    otherEntries,
    average: averageValue(entries),
    otherAverage: averageValue(otherEntries),
    max: maxEntry(entries),
    min: minEntry(entries),
  };
}

function formatAverageYears(value) {
  return `${Number(value).toFixed(1)} yrs`;
}

function buildDetailStatus(year, countries, isProjected, legend) {
  const label = displayGroupLabel(legend.label);
  const projected = isProjected ? "projected " : "";
  const yearLead = isProjected ? `${year} projection:` : `${year}:`;
  const populationEntries = countriesWithNumericValue(
    countries,
    (country) => country.populations[currentYearIndex],
  );

  if (!populationEntries.length) {
    return `No ${projected}country population data is available for ${label} in ${year}.`;
  }

  const otherCountries = countriesData.filter((country) =>
    legend.mode === "income"
      ? country._incomeLabel !== legend.label
      : country.region.trim() !== legend.label,
  );

  const growth = computeMetricStats(
    countries,
    otherCountries,
    "populationGrowth",
  );
  const decliningCount = growth.entries.filter(
    (entry) => entry.value < 0,
  ).length;
  const growingCount = growth.entries.filter((entry) => entry.value > 0).length;
  const fastestGrowth = growth.max;
  const steepestDecline = growth.min;

  const fertility = computeMetricStats(countries, otherCountries, "fertility");
  const belowReplacementCount = fertility.entries.filter(
    (entry) => entry.value < 2.1,
  ).length;
  const belowReplacementShare =
    belowReplacementCount / fertility.entries.length;
  const fertilityContext = fertility.entries.length
    ? ` ${belowReplacementCount} of ${fertility.entries.length} countries are below replacement fertility.`
    : "";
  const growthComparison =
    Number.isFinite(growth.average) && Number.isFinite(growth.otherAverage)
      ? ` average growth is ${formatPercent(growth.average)}, versus ${formatPercent(growth.otherAverage)} outside this group.`
      : "";
  const fertilityComparison =
    Number.isFinite(fertility.average) &&
    Number.isFinite(fertility.otherAverage)
      ? ` Average fertility is ${formatFertility(fertility.average)}, versus ${formatFertility(fertility.otherAverage)} outside this group.`
      : "";

  if (legend.mode === "income") {
    const life = computeMetricStats(
      countries,
      otherCountries,
      "lifeExpectancy",
    );
    const medianAge = computeMetricStats(
      countries,
      otherCountries,
      "medianAge",
    );
    const oldest = medianAge.max;
    const youngest = medianAge.min;
    const longestLived = life.max;
    const shortestLived = life.min;

    if (
      Number.isFinite(medianAge.average) &&
      Number.isFinite(medianAge.otherAverage) &&
      medianAge.average - medianAge.otherAverage >= 4
    ) {
      return `${yearLead} ${label} has the oldest age profile among income groups. Median age averages ${formatAverageYears(medianAge.average)}, versus ${formatAverageYears(medianAge.otherAverage)} outside this group; ${oldest.country.name} is highest at ${formatYears(oldest.value)}.`;
    }

    if (
      Number.isFinite(medianAge.average) &&
      Number.isFinite(medianAge.otherAverage) &&
      medianAge.otherAverage - medianAge.average >= 4
    ) {
      return `${yearLead} ${label} has the youngest age profile among income groups. Median age averages ${formatAverageYears(medianAge.average)}, versus ${formatAverageYears(medianAge.otherAverage)} outside this group; ${youngest.country.name} is lowest at ${formatYears(youngest.value)}.`;
    }

    if (
      Number.isFinite(life.average) &&
      Number.isFinite(life.otherAverage) &&
      Math.abs(life.average - life.otherAverage) >= 2
    ) {
      const direction = life.average > life.otherAverage ? "higher" : "lower";
      const edgeCountry =
        life.average > life.otherAverage ? longestLived : shortestLived;
      return `${yearLead} life expectancy is ${direction} in ${label}. The group averages ${formatAverageYears(life.average)}, versus ${formatAverageYears(life.otherAverage)} outside it; ${edgeCountry.country.name} defines the edge at ${formatYears(edgeCountry.value)}.`;
    }
  }

  if (fertility.entries.length && belowReplacementShare >= 0.6) {
    return `${yearLead} low fertility is the standout pattern in ${label};${fertilityContext}${fertilityComparison}`;
  }

  if (growth.entries.length && decliningCount > growingCount) {
    return `${yearLead} population decline is the stronger signal in ${label}; ${decliningCount} of ${growth.entries.length} countries show negative growth, led by ${steepestDecline.country.name} at ${formatPercent(steepestDecline.value)}.${growthComparison}${fertilityContext}`;
  }

  if (growth.entries.length && growingCount > decliningCount) {
    return `${yearLead} ${label} still leans toward growth, with ${growingCount} of ${growth.entries.length} countries increasing. ${fastestGrowth.country.name} has the fastest rate at ${formatPercent(fastestGrowth.value)}.${growthComparison}${fertilityContext}`;
  }

  return `${yearLead} ${label} is balanced between growth and decline.${growthComparison}${fertilityContext}`;
}

function updateStatusPanel(year) {
  const isProjected = year > historicalCutoffYear;
  if (selectedLegend && !elements.detailPanel.hidden) {
    typeStatus(
      buildDetailStatus(year, selectedCountries(), isProjected, selectedLegend),
      elements.detailSummary,
      { instant: true },
    );
    return;
  }

  const peakCountries = countriesData.filter(
    (country) => country.peakYear === year,
  );
  const milestone = globalTrendMilestones.get(year);
  // Cleared immediately (rather than left showing the previous year's
  // flags) so nothing mismatched lingers while the new line types out, and
  // rendered only once typing finishes rather than alongside it — doing
  // both at once meant the flags row popped in at its full height while
  // #status was still just one short line, then kept getting shoved
  // further down as more lines wrapped in underneath it.
  elements.peakFlags.replaceChildren();
  typeStatus(
    milestone
      ? `${milestone.text}${
          peakCountries.length
            ? ` ${buildPeakStatus(year, peakCountries, isProjected)}`
            : ""
        }`
      : buildPeakStatus(year, peakCountries, isProjected),
    elements.status,
    { onComplete: () => renderPeakFlags(peakCountries) },
  );
}

// Shows every peak country's flag and peak-year population, not just the
// couple named in the status text's 4+-country preview.
function renderPeakFlags(peakCountries) {
  elements.peakFlags.replaceChildren(
    ...peakCountries
      .map((country) => {
        const iso2 = countryIso2[country.iso3];
        if (!iso2) return null;
        const row = document.createElement("div");
        row.className = "peak-flag-row";

        const img = document.createElement("img");
        img.className = "peak-flag";
        img.src = FLAG_URL(iso2);
        img.alt = country.name;
        img.title = country.name;
        img.loading = "lazy";

        const value = document.createElement("span");
        value.className = "peak-flag-population";
        value.textContent = `${country.name}: ${formatPeakPopulation(
          country.populations[currentYearIndex],
        )}`;
        value.title = `${country.name}: ${formatPopulation(
          country.populations[currentYearIndex],
        )}`;

        row.append(img, value);
        return row;
      })
      .filter(Boolean),
  );
}

// Types the status line out character-by-character with a blinking cursor,
// so the peak-year callout actually catches the eye instead of silently
// swapping out as the year slider drags. Each call invalidates any typing
// still in flight (via the token) so rapid slider drags don't leave stale
// timers racing to finish an earlier, superseded string. The token is
// shared across targets rather than per-element: only one of #status /
// #detailSummary is ever being typed into at a time (they're mutually
// exclusive with the detail panel's visibility), so a new call anywhere
// should still invalidate whatever was previously in flight.
function typeStatus(
  text,
  el = elements.status,
  { instant = false, onComplete } = {},
) {
  const token = ++statusTypingToken;
  if (instant) {
    el.replaceChildren(document.createTextNode(text));
    onComplete?.();
    return;
  }

  const textNode = document.createTextNode("");
  const cursor = document.createElement("span");
  cursor.className = "status-cursor";
  el.replaceChildren(textNode, cursor);

  let i = 0;
  const step = () => {
    if (token !== statusTypingToken) return;
    textNode.textContent = text.slice(0, i);
    if (i < text.length) {
      i++;
      setTimeout(step, 15);
    } else {
      onComplete?.();
    }
  };
  step();
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

  countriesData.forEach((country) => {
    const pop = country.populations[yearIndex];
    if (pop == null) return;
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
  pointsMesh.geometry.getAttribute("aFrequency").needsUpdate = true;
  pointsMesh.geometry.getAttribute("aPhase").needsUpdate = true;

  const isProjected = year > historicalCutoffYear;
  isProjectedYear = isProjected;
  updateYearLabels(year);
  updateMetricsPanel(year);
  renderDetailPanel();
  if (!selectedLegend) updateStatusPanel(year);
  updatePeakCallouts(year);
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

// Cheap enough to run on every "input" tick while dragging, unlike
// applyYear()'s full rebuild — so the year figure still tracks the thumb
// live, even though the rest of the content waits for "change".
function updateYearLabels(year) {
  const isProjected = year > historicalCutoffYear;
  elements.yearValue.textContent = `${year}${isProjected ? "" : ""}`;
  elements.titleYear.textContent = year;
}

function legendEntriesFor(mode) {
  if (mode !== "income") return Object.entries(REGION_COLORS);
  const hasUnclassified = countriesData.some(
    (country) => country._incomeLabel === UNCLASSIFIED_INCOME,
  );
  return [
    ...Object.entries(INCOME_GROUP_COLORS),
    ...(hasUnclassified ? [[UNCLASSIFIED_INCOME, UNCLASSIFIED_COLOR]] : []),
  ];
}

function renderLegend() {
  const entries = legendEntriesFor(colorMode);
  elements.legend.replaceChildren(
    ...entries.map(([label, color]) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "legend-item";
      item.dataset.label = label;
      item.classList.toggle(
        "active",
        selectedLegend?.mode === colorMode && selectedLegend?.label === label,
      );
      const swatch = document.createElement("span");
      swatch.className = "legend-swatch";
      item.style.setProperty("--color-legend", color);
      const text = document.createElement("span");
      text.textContent = displayGroupLabel(label);
      item.append(swatch, text);
      item.addEventListener("click", () => selectLegendItem(label, color));
      return item;
    }),
  );
}

function metricFor(country, key) {
  return countryDemographicMetrics?.countries?.[country.iso3]?.[key]?.[
    currentYearIndex
  ];
}

// Single source of truth for the detail-panel table: each column knows how
// to read its own sort value (used both for sorting and for the population
// ratio bar) and how to format it for display. Header cells are generated
// from this list too, so clicking one always lines up with the right column.
const DETAIL_COLUMNS = [
  {
    key: "name",
    label: "Country",
    className: "country",
    defaultDirection: "asc",
    value: (country) => country.name,
    format: (value) => value,
  },
  {
    key: "population",
    label: "Population",
    className: "number",
    defaultDirection: "desc",
    value: (country) => country.populations[currentYearIndex],
    format: formatPopulation,
  },
  {
    key: "populationGrowth",
    label: "Growth rate",
    className: "number",
    defaultDirection: "desc",
    value: (country) => metricFor(country, "populationGrowth"),
    format: formatPercent,
  },
  {
    key: "fertility",
    label: "Fertility rate",
    className: "number",
    defaultDirection: "desc",
    value: (country) => metricFor(country, "fertility"),
    format: formatFertility,
  },
  {
    key: "lifeExpectancy",
    label: "Life expectancy",
    className: "number",
    defaultDirection: "desc",
    value: (country) => metricFor(country, "lifeExpectancy"),
    format: formatYears,
  },
  {
    key: "medianAge",
    label: "Median age",
    className: "number",
    defaultDirection: "desc",
    value: (country) => metricFor(country, "medianAge"),
    format: formatYears,
  },
];

function selectedCountries() {
  if (!selectedLegend) return [];
  const countries = countriesData.filter((country) =>
    selectedLegend.mode === "income"
      ? country._incomeLabel === selectedLegend.label
      : country.region.trim() === selectedLegend.label,
  );

  const column =
    DETAIL_COLUMNS.find((c) => c.key === detailSort.key) ?? DETAIL_COLUMNS[1];
  const sign = detailSort.direction === "asc" ? 1 : -1;

  return countries.sort((a, b) => {
    const aValue = column.value(a);
    const bValue = column.value(b);
    if (aValue == null && bValue == null) return a.name.localeCompare(b.name);
    if (aValue == null) return 1;
    if (bValue == null) return -1;
    if (aValue !== bValue) {
      return typeof aValue === "string"
        ? aValue.localeCompare(bValue) * sign
        : (aValue - bValue) * sign;
    }
    return a.name.localeCompare(b.name);
  });
}

function createDetailCell(text, className = "") {
  const cell = document.createElement("div");
  cell.className = `detail-cell ${className}`.trim();
  const inner = document.createElement("span");
  inner.className = "detail-name";
  inner.textContent = text;
  cell.append(inner);
  return cell;
}

function setDetailSort(key) {
  const column = DETAIL_COLUMNS.find((c) => c.key === key);
  if (!column) return;
  detailSort =
    detailSort.key === key
      ? { key, direction: detailSort.direction === "asc" ? "desc" : "asc" }
      : { key, direction: column.defaultDirection };
  renderDetailPanel();
}

// Keeps other UI in sync with the detail panel's visibility. Switching view
// mode while the panel is open would rebuild the active dot set out from
// under the panel's population-ratio bars and callout anchors mid-read, so
// the toggle is disabled whenever the panel is visible; the body class lets
// stylesheets target "detail panel open" state generally (layout, canvas
// dimming, etc.) without every consumer re-deriving it from #detailPanel.
function updateViewModeAvailability() {
  const isOpen = !elements.detailPanel.hidden;
  elements.viewMode.querySelectorAll("button").forEach((btn) => {
    btn.disabled = isOpen;
  });
  document.body.classList.toggle("detail", isOpen);
}

function renderDetailPanel() {
  if (!selectedLegend || currentYearIndex < 0) return;

  const countries = selectedCountries();
  const year = yearsData[currentYearIndex];
  elements.detailPanel.style.setProperty(
    "--detail-color",
    selectedLegend.color,
  );
  elements.detailTitle.textContent = displayGroupLabel(selectedLegend.label);
  elements.detailSubtitle.textContent = `${countries.length} countries · ${year}`;

  elements.detailHeader.replaceChildren(
    ...DETAIL_COLUMNS.map((column) => {
      const arrow =
        detailSort.key === column.key
          ? detailSort.direction === "asc"
            ? " ↑"
            : " ↓"
          : "";
      const cell = createDetailCell(
        `${column.label}${arrow}`,
        `${column.className} sortable`,
      );
      cell.classList.toggle("active", detailSort.key === column.key);
      cell.addEventListener("click", () => setDetailSort(column.key));
      return cell;
    }),
  );

  // Ratio bars are always population-based, so they stay accurate (and
  // re-normalize live) as the year slider changes each country's population.
  const populationColumn = DETAIL_COLUMNS[1];
  const highestValue = Math.max(
    ...countries.map(populationColumn.value).filter(Number.isFinite),
  );

  const rows = countries.map((country) => {
    const row = document.createElement("div");

    const ratio = populationColumn.value(country) / highestValue;
    row.style.setProperty("--ratio", Number.isFinite(ratio) ? ratio : 0);

    row.className = "detail-row";
    row.append(
      ...DETAIL_COLUMNS.map((column) =>
        createDetailCell(
          column.format(column.value(country)),
          column.className,
        ),
      ),
    );
    return row;
  });

  elements.detailRows.replaceChildren(...rows);
  elements.detailPanel.hidden = false;
  updateViewModeAvailability();
  updateStatusPanel(year);
}

function closeDetailPanel() {
  selectedLegend = null;
  elements.detailPanel.hidden = true;
  updateViewModeAvailability();
  renderLegend();
  if (currentYearIndex >= 0) updateStatusPanel(yearsData[currentYearIndex]);
}

function selectLegendItem(label, color) {
  if (selectedLegend?.mode === colorMode && selectedLegend?.label === label) {
    closeDetailPanel();
    return;
  }
  selectedLegend = { mode: colorMode, label, color };
  renderLegend();
  renderDetailPanel();
}

function setColorMode(mode) {
  if (mode === colorMode) return;
  const keepDetailOpen = selectedLegend && !elements.detailPanel.hidden;
  colorMode = mode;
  elements.colorMode
    .querySelectorAll("button")
    .forEach((btn) =>
      btn.classList.toggle("active", btn.dataset.mode === mode),
    );

  if (keepDetailOpen) {
    // Switching Region/Income while browsing a group's detail should let
    // the user keep exploring, not boot them back to the globe — land on
    // that mode's first legend entry instead of closing the panel.
    const [label, color] = legendEntriesFor(mode)[0];
    selectedLegend = { mode, label, color };
  } else {
    selectedLegend = null;
    elements.detailPanel.hidden = true;
    updateViewModeAvailability();
  }
  recolor();
  if (keepDetailOpen) renderDetailPanel();
  updatePeakCallouts(yearsData[currentYearIndex]);
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
  // Anchors are computed from the globe/map basis, so a mode toggle needs
  // its own rebuild even though the selected year hasn't changed.
  updatePeakCallouts(yearsData[currentYearIndex]);

  const fromTarget = controls.target.clone();
  const toTarget = new THREE.Vector3(0, 0, 0);
  // Globe-bound transitions preserve the camera's current heading (extended
  // out to globe viewing distance) rather than snapping to a canonical
  // angle, so returning from a panned map view lands roughly where you were
  // looking. Map-bound transitions always end at the same fixed front-on
  // position, since that's the only angle a flat 2D layout reads correctly
  // from.
  const toCamPos =
    mode === "map"
      ? MAP_CAMERA_POS.clone()
      : currentGlobeCameraPosition(fromTarget);

  transition = {
    fromPositions,
    scramblePositions,
    toPositions,
    fromCamPos: camera.position.clone(),
    fromTarget,
    toCamPos,
    toTarget,
    fromDotSize: currentDotSize,
    toDotSize: mode === "map" ? MAP_DOT_SIZE : DOT_SIZE,
    start: performance.now(),
  };
  // Auto-rotate is stopped immediately (rather than only once the fly-out
  // phase begins) and the camera glides toward its final position across
  // the whole transition below — letting it keep spinning through the
  // scramble made the final heading unpredictable, which meant the camera
  // sometimes had to cover a large arc in a hurry after the dots had
  // already settled into place. That mismatch read as a jarring, delayed
  // "snap" rather than the two animating together.
  controls.enabled = false;
  controls.autoRotate = false;

  elements.viewMode
    .querySelectorAll("button")
    .forEach((btn) =>
      btn.classList.toggle("active", btn.dataset.mode === mode),
    );
}

// Three-phase morph: current formation -> scrambled cloud filling the
// globe's volume -> final formation. The scramble is regenerated fresh
// each call (setViewMode), so consecutive toggles never repeat the same
// "explosion" pattern. The camera glides toward its final position across
// the *entire* transition (see setViewMode) in step with this same overall
// progress, so it always settles into its final angle at the same moment
// the dots settle into their final formation.
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
  }
  const e = ease(Math.min(1, localT));

  for (let k = 0; k < transition.toPositions.length; k++) {
    basePositions[k] = from[k] + (to[k] - from[k]) * e;
  }
  // The GPU shader only displaces whatever is currently in the position
  // buffer, so the interpolated (unpulsed) base positions still need to
  // reach the GPU each frame while a transition is in flight — this is
  // the one per-frame CPU cost the shader migration couldn't remove,
  // since the morph target itself changes every frame, not just the pulse.
  const posAttr = pointsMesh.geometry.getAttribute("position");
  posAttr.array.set(basePositions.subarray(0, transition.toPositions.length));
  posAttr.needsUpdate = true;

  const camE = easeInOutCubic(overallT);
  camera.position.lerpVectors(transition.fromCamPos, transition.toCamPos, camE);
  controls.target.lerpVectors(transition.fromTarget, transition.toTarget, camE);
  setDotSize(
    transition.fromDotSize +
      (transition.toDotSize - transition.fromDotSize) * camE,
  );

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
    const [
      dotsResponse,
      globalResponse,
      incomeResponse,
      countryDemographicsResponse,
      countryGniResponse,
      countryIso2Response,
    ] = await Promise.all([
      fetch(DATA_URL),
      fetch(GLOBAL_METRICS_URL),
      fetch(INCOME_GROUPS_URL),
      fetch(COUNTRY_DEMOGRAPHICS_URL),
      fetch(COUNTRY_GNI_URL),
      fetch(COUNTRY_ISO2_URL),
    ]);
    if (!dotsResponse.ok) throw new Error(`HTTP ${dotsResponse.status}`);
    if (!globalResponse.ok) throw new Error(`HTTP ${globalResponse.status}`);
    if (!incomeResponse.ok) throw new Error(`HTTP ${incomeResponse.status}`);
    if (!countryDemographicsResponse.ok) {
      throw new Error(`HTTP ${countryDemographicsResponse.status}`);
    }
    if (!countryGniResponse.ok)
      throw new Error(`HTTP ${countryGniResponse.status}`);
    if (!countryIso2Response.ok)
      throw new Error(`HTTP ${countryIso2Response.status}`);
    const data = await dotsResponse.json();
    const globalData = await globalResponse.json();
    const incomeGroups = await incomeResponse.json();
    countryDemographicMetrics = await countryDemographicsResponse.json();
    countryGni = (await countryGniResponse.json()).countries || {};
    countryIso2 = await countryIso2Response.json();
    countriesData = data.countries;
    yearsData = data.years;
    countriesData.forEach((country) => {
      country.peakYear = computePeakYear(country.populations, yearsData);
    });
    historicalCutoffYear = data.historicalCutoffYear ?? Infinity;
    globalMetricsByYear = buildGlobalMetricsIndex(globalData);
    globalTrendMilestones = computeGlobalTrendMilestones(globalData);
    if (globalData.variants) {
      highMetricsByYear = buildVariantIndex(globalData.variants.high);
      lowMetricsByYear = buildVariantIndex(globalData.variants.low);
    }

    setupScene(countriesData, incomeGroups);

    const minYear = yearsData[0];
    const maxYear = yearsData[yearsData.length - 1];
    const defaultYears = [2047, 2050, 2061, 2081, 2084];
    // Randomized per page load (rather than pinned to the current year) to show a different snapshot from a curated set each time.
    // 2047: global growth falls below 0.5%
    // 2050: fertility slips below replacement
    // 2061: world population crosses 10B
    // 2081: global life expectancy reaches 80 years
    // 2084: projected global population peak/turning point
    const defaultYear =
      defaultYears[Math.floor(Math.random() * defaultYears.length)];
    elements.yearSlider.min = minYear;
    elements.yearSlider.max = maxYear;
    elements.yearSlider.step = 1;
    elements.yearSlider.value = defaultYear;
    elements.yearControl.hidden = false;
    // "input" fires continuously while dragging — kept cheap (thumb/fill
    // tracking plus the year figure itself, so there's still feedback on
    // what year you'd land on) so the slider stays responsive. The actual
    // content update (dot repositioning, status line, metrics, detail
    // panel, callouts) is real work, so it's deferred to "change", which
    // only fires once the drag is released (or after a keyboard step),
    // instead of re-running on every intermediate value.
    elements.yearSlider.addEventListener("input", () => {
      updateSliderProgress();
      updateYearLabels(Number(elements.yearSlider.value));
    });
    elements.yearSlider.addEventListener("change", () => {
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

    elements.detailClose.addEventListener("click", closeDetailPanel);
    updateSliderProgress();
    applyYear(defaultYear);
    renderLegend();
  } catch (error) {
    elements.status.textContent = `Could not load data: ${error.message}`;
  }
}

// The pulse itself now runs in DOT_VERTEX_SHADER (see createDotTexture
// above) — this just pushes the handful of uniforms it depends on once per
// frame, an O(1) cost regardless of dot count, instead of the O(activeTotal)
// CPU loop this replaced.
// During the (brief) hold at the scramble cloud, dots pulse faster and
// harder than the ambient shimmer — reads as "the system is computing"
// rather than a freeze-frame — before flying out to their final shape.
const HOLD_FREQ_MULTIPLIER = 7;
const HOLD_AMPLITUDE_MULTIPLIER = 2.5;

function updateDotUniforms(elapsedTime) {
  if (!pointsMesh) return;
  const u = pointsMesh.material.uniforms;
  u.uTime.value = elapsedTime;
  u.uIsMap.value = viewMode === "map" && !isScrambledPhase ? 1 : 0;
  u.uFreqMul.value = isHoldPhase ? HOLD_FREQ_MULTIPLIER : 1;
  u.uAmpMul.value = isHoldPhase ? HOLD_AMPLITUDE_MULTIPLIER : 1;
}

renderer.domElement.addEventListener("pointermove", (event) => {
  pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
});
renderer.domElement.addEventListener("pointerleave", () => {
  pointer.set(Infinity, Infinity);
  lastPointerEvent = null;
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

  const swatch = document.createElement("span");
  swatch.className = "legend-swatch";
  swatch.style.background = `#${groupColor.getHexString()}`;

  const countryText = document.createElement("span");
  countryText.textContent = `${country.name}: ${pop.toLocaleString()}`;

  const line1 = document.createElement("div");
  line1.className = "tooltip-line1";
  line1.append(swatch, countryText);
  // line1.textContent = `${country.name}: ${pop.toLocaleString()}`;

  // const line2 = document.createElement("div");
  // line2.className = "tooltip-line2";
  // line2.append(swatch, groupText);

  const lines = [line1];
  const year = yearsData[currentYearIndex];
  if (year > historicalCutoffYear) {
    const hi = country.populationsHigh?.[currentYearIndex];
    const lo = country.populationsLow?.[currentYearIndex];
    if (hi != null && lo != null) {
      const line3 = document.createElement("div");
      line3.className = "tooltip-line2";
      line3.textContent = `Range: ${lo.toLocaleString()} – ${hi.toLocaleString()}`;
      lines.push(line3);
    }
  }

  elements.tooltip.hidden = false;
  elements.tooltip.replaceChildren(...lines);
  elements.tooltip.style.setProperty(
    "--tooltip-color",
    `#${groupColor.getHexString()}`,
  );
  elements.tooltip.style.left = `${event ? event.clientX : 0}px`;
  elements.tooltip.style.top = `${event ? event.clientY : 0}px`;
}

let lastPointerEvent = null;
renderer.domElement.addEventListener("pointermove", (event) => {
  lastPointerEvent = event;
});

// Raycasting activeTotal dots (up to ~33K) on every single animation frame
// is the most expensive per-frame cost in the app, and pointermove fires
// far more often than a tooltip needs to visibly update — so re-run the
// hit test on a timer instead of every frame.
const TOOLTIP_UPDATE_INTERVAL_MS = 100;
let lastTooltipUpdate = 0;

function animate(timestamp) {
  requestAnimationFrame(animate);
  timer.update(timestamp);
  updateTransition();
  controls.update(timer.getDelta());
  updateDotUniforms(timer.getElapsed());
  if (
    lastPointerEvent &&
    timestamp - lastTooltipUpdate >= TOOLTIP_UPDATE_INTERVAL_MS
  ) {
    lastTooltipUpdate = timestamp;
    updateTooltip(lastPointerEvent);
  }
  updateCalloutLabels();
  renderer.render(scene, camera);
}

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (pointsMesh) {
    pointsMesh.material.uniforms.uScale.value =
      renderer.domElement.height * 0.5;
  }
});

init();
animate();
