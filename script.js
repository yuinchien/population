import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createCalloutController } from "./callout-controller.mjs";
import { foregroundForColor, resolveCssColor } from "./theme-colors.mjs";
import {
  displayGroupLabel,
  prioritizedMilestoneYears,
} from "./status-insights.mjs";
import { METRICS, formatCount } from "./metrics.mjs";
import {
  AGE_CATEGORIES,
  AGE_COLUMN_KEYS,
  MIGRATION_CATEGORIES,
  MIGRATION_COLUMN_KEYS,
  subgroupPopulationFor,
  subgroupPopulationLabelFor,
} from "./detail-group-categories.mjs";
import {
  buildDetailColumns,
  selectDetailCountries,
} from "./detail-table.mjs";
import { nextSortState, renderSortableTable } from "./detail-table-view.mjs";
import { createCountryDetailController } from "./country-detail-controller.mjs";
import {
  convertAlpha3ToAlpha2,
  loadPopulationData,
  flagIconUrl,
  preloadFlagIcons,
} from "./data-loader.mjs";
import {
  DEFAULT_COLOR,
  DOT_CONFIG,
  INCOME_GROUP_COLORS,
  PEOPLE_PER_DOT,
  REGION_COLORS,
  UNCLASSIFIED_COLOR,
  UNCLASSIFIED_INCOME,
  VIEW_CONFIG,
} from "./view-config.mjs";
import { assertElements, getAppElements } from "./ui-elements.mjs";
import { buildCountrySummary } from "./country-summary-model.mjs";
import {
  buildAgingMilestoneInsight,
  buildCountryDemographicNarrative,
} from "./country-aging-narrative.mjs";
import { parseUrlState, serializeUrlState } from "./url-state.mjs";
import {
  adjacentMilestoneYears,
  createTourController,
} from "./tour-controller.mjs";
import { createClusterController } from "./cluster-controller.mjs";
import { createChartController } from "./chart-controller.mjs";
import { CLUSTER_ARCHETYPES, clusterStatusForYear } from "./cluster-config.mjs";
import {
  createProjectionScenarioData,
  isProjectionScenario,
} from "./projection-scenario-data.mjs";
import {
  createTooltipLine,
  hideTooltip as hideTooltipElement,
  showTooltipContent,
  showTooltipLine,
} from "./tooltip-controller.mjs";
import { createInitialAppState } from "./app-state.mjs";
import {
  createCountryCombobox,
  matchCountries,
} from "./country-combobox.mjs";
import { createOverlayController } from "./overlay-controller.mjs";
import { createChartViewLifecycle } from "./chart-view-lifecycle.mjs";
import { createSearchViewLifecycle } from "./search-view-lifecycle.mjs";
import { createClusterViewLifecycle } from "./cluster-view-lifecycle.mjs";
import { createViewRouter } from "./view-router.mjs";
import { createCountryBorderHitTester } from "./country-border-hit-test.mjs";
import { createUiStateRenderer } from "./ui-state-renderer.mjs";

const GLOBE_RADIUS = VIEW_CONFIG.globe.radius;
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

// How long each trend-chart line takes to grow up from a flat baseline into
// its real shape when the chart first appears (see chart-controller.mjs's
// renderChart, and country-detail-controller.mjs which reuses this value).
const CHART_LINE_GROW_MS = 500;
// How long markers/labels take to fade in once their curve has finished
// growing — used by both the main country chart and its sparklines so a
// marker never appears sitting on a curve that hasn't caught up to it yet.
const CHART_MARKER_FADE_IN_MS = 320;

// "Peak population year" callouts: a leader line drawn along the surface
// normal at a country's location, from a country whose modeled population
// peaks in the currently selected year.
// Keep callout labels clear of the fixed sidebar (#overlay is 240px wide).
const CALLOUT_LEFT_CLEARANCE = 260;

const elements = getAppElements();
assertElements(
  elements,
  [
    "menuToggle",
    "menuShim",
    "infoButton",
    "infoPanel",
    "infoClose",
    "status",
    "tooltip",
    "chartTooltip",
    "clusterArchetypeTooltip",
    "yearSlider",
    "yearValue",
    "colorMode",
    "legend",
    "viewMode",
    "calloutLayer",
    "detailPanel",
    "detailFlag",
    "detailTitle",
    "detailSubtitle",
    "detailNav",
    "detailHeader",
    "detailRows",
    "detailClose",
    "countryPanel",
    "countryFlag",
    "countryTitle",
    "countrySubtitle",
    "countryClose",
    "countryDetail",
    "chartPanel",
    "clusterView",
    "clusterCanvas",
  ],
  "app shell",
);

const COUNTRY_DETAIL_ELEMENT_KEYS = [
  "countryChart",
  "countryChartValue",
  "countrySparklines",
  "countryPyramidCard",
  "countryPyramidStage",
  "countryPyramid",
  "countrySimilar",
  "countrySimilarList",
];

const CHART_VIEW_ELEMENT_KEYS = [
  "chartMetricTabs",
  "trendChart",
  "radarChart",
  "chartCountryPicker",
  "chartCountryPickerSummary",
  "chartCountryPickerSummaryFlags",
  // "chartCountryPickerCancel",
  "chartProjectionScenario",
  "chartCountryChips",
  "chartCountrySearch",
  "chartCountrySuggestions",
  "chartTableHeader",
  "chartTableRows",
];

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  40,
  window.innerWidth / window.innerHeight,
  1,
  4000,
);
camera.position.set(0, 0, VIEW_CONFIG.globe.cameraDistance);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const calloutController = createCalloutController({
  camera,
  layer: elements.calloutLayer,
  globeRadius: GLOBE_RADIUS,
  viewConfig: VIEW_CONFIG,
  leftClearance: CALLOUT_LEFT_CLEARANCE,
  getCountries: () => countriesData,
  getViewMode: () => appState.viewMode,
  isTransitioning: () => !!transition,
  getColor: colorFor,
  getPeakYear: activePeakYear,
  getPopulation: (country) => activePopulationAt(country),
  formatPopulation: formatPeakPopulation,
  getTextColor: (color) =>
    foregroundForColor(`#${color.getHexString()}`),
  onOpenCountry: openCountryDetail,
  onHoverCountry: showCalloutCountryHover,
  onLeaveCountry: clearCalloutCountryHover,
});
scene.add(calloutController.group);

const hoverCountryGroup = new THREE.Group();
scene.add(hoverCountryGroup);
let hoverCountry = null;
// Rebuilding a large country's fill — especially the globe tessellation
// pass — on every single re-hover gets expensive fast, and jittering the
// mouse across a dense dot cluster's edge re-triggers it repeatedly for
// geometry that hasn't changed. Cache built meshes per iso3+appState.viewMode (the
// two projections aren't interchangeable) and only dispose on eviction,
// not on every hover-out.
const hoverFillCache = new Map(); // `${iso3}:${appState.viewMode}` -> THREE.Mesh[]
const HOVER_FILL_CACHE_LIMIT = 12;

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = VIEW_CONFIG.globe.minDistance;
controls.maxDistance = VIEW_CONFIG.globe.maxDistance;
controls.autoRotate = true;
controls.autoRotateSpeed = VIEW_CONFIG.globe.autoRotateSpeed;
controls.enablePan = false;

const raycaster = new THREE.Raycaster();
raycaster.params.Points = { threshold: VIEW_CONFIG.globe.dotSize * 1.5 };
const pointer = new THREE.Vector2(Infinity, Infinity);
const hoverGlobe = new THREE.Sphere(
  new THREE.Vector3(0, 0, 0),
  GLOBE_RADIUS,
);
const hoverMapPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
const hoverSurfacePoint = new THREE.Vector3();
// Latest pointermove event, consumed by animate()'s throttled tooltip
// hit-test rather than raycasting on every single mousemove.
let lastPointerEvent = null;

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
    (lon / 180) * (VIEW_CONFIG.map.width / 2),
    (lat / 90) * (VIEW_CONFIG.map.height / 2),
    0,
  );
}

function regionColor(region) {
  return new THREE.Color(
    resolveCssColor(REGION_COLORS[region?.trim()] || DEFAULT_COLOR),
  );
}

function incomeGroupLabel(iso3, incomeGroups) {
  if (!incomeGroups) return UNCLASSIFIED_INCOME;
  const code = incomeGroups.countryIncomeCodes[iso3];
  return (code && incomeGroups.incomeCodes[code]) || UNCLASSIFIED_INCOME;
}

function incomeColor(label) {
  return new THREE.Color(
    resolveCssColor(INCOME_GROUP_COLORS[label] || UNCLASSIFIED_COLOR),
  );
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
  // Globe<->map view transitions morph every dot through a scrambled cloud
  // over ~2s. That target changes every frame, unlike the pulse (constant
  // per-dot frequency/phase) — so unlike the pulse, it can't just read a
  // fixed per-dot attribute; the two endpoints it's morphing between this
  // frame have to be supplied. Lerping them here means the CPU only writes
  // aMorphFrom/aMorphTo when the *phase* changes (a few times per
  // transition) instead of writing every vertex's position every frame.
  uniform float uMorphActive;
  uniform float uMorphT;
  attribute vec3 aMorphFrom;
  attribute vec3 aMorphTo;

  attribute vec3 color;
  attribute float aFrequency;
  attribute float aPhase;

  varying vec3 vColor;

  void main() {
    vColor = color;

    vec3 basePos = uMorphActive > 0.5
      ? mix(aMorphFrom, aMorphTo, uMorphT)
      : position;

    float wave = sin(uTime * aFrequency * uFreqMul + aPhase) * uPulseAmplitude * uAmpMul;

    vec3 pulsed;
    if (uIsMap > 0.5) {
      // No shared "outward" direction on a flat map, so pulse toward/away
      // from the camera along Z instead (matches the old CPU behavior).
      pulsed = vec3(basePos.x, basePos.y, basePos.z + wave);
    } else {
      // Globe (and the scrambled cloud) points already sit at a fixed
      // radius from the origin, so scaling the position vector is the
      // same as displacing along the surface normal.
      float scale = 1.0 + wave / uGlobeRadius;
      pulsed = basePos * scale;
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

function formatPeakPopulation(value) {
  return formatCount(value, {
    billionsDecimals: 1,
    thousandsDecimals: 1,
    nullFallback: "N/A",
    roundWholeNumbers: true,
  });
}

let pointsMesh = null;
let basePositions = null; // pre-pulse baseline, rebuilt whenever the year changes
let frequencies = null;
let phases = null;
let currentDotSize = VIEW_CONFIG.globe.dotSize; // logical size (unscaled by pixelRatio)
let dotCountry = [];
let activeTotal = 0;
// Set once in setupScene() rather than rescanned on every legendEntriesFor()
// call — the set of income labels present is fixed once countries load.
let hasUnclassifiedIncome = false;
let countriesData = [];
let yearsData = [];
const projectionData = createProjectionScenarioData();
let countryDemographicMetrics = null;
let countryTrajectory = null;
// Age-structure shares for the country-detail population pyramid, lazily
// loaded (see country-pyramid.mjs). null until it resolves; a country opened
// before then just renders without its pyramid until the data lands.
let countryAgeStructure = null;
// Simplified country outline rings ({ [iso3]: [[lon,lat], ...][] }), lazily
// loaded — see showHoverCountryFill(). null until it resolves; hovering
// before then just doesn't draw a fill for that hover, same tradeoff as the
// demographic-metrics deferred load.
let countryBorders = null;
let countryBorderHitTester = null;
let createCountryFillGeometries = null;
let countryFillGeometryModulePromise = null;
let loadCountryDemographicMetrics = async () => null;
let loadCountryTrajectory = async () => null;
let loadCountryAgeStructure = async () => null;
let loadCountryBorders = async () => null;
// Set synchronously in <head> (before this module even loads) so first
// paint never flashes the wrong theme — this just picks it up.
const appState = createInitialAppState({
  theme: document.documentElement.dataset.theme || "dark",
});
const uiStateRenderer = createUiStateRenderer();
const updateUiState = (patch) => uiStateRenderer.update(patch);
let lifetimeController = null;
let lifetimeControllerPromise = null;
let lifetimeRequestedActive = false;
let dotLocalIndex = null;
let transition = null;
let isScrambledPhase = false;
let isHoldPhase = false;

function activePopulationSeries(country) {
  return projectionData.populationSeries(country);
}

async function ensureCountryDemographics() {
  if (countryDemographicMetrics) return countryDemographicMetrics;
  const data = await loadCountryDemographicMetrics();
  if (!data) return null;
  countryDemographicMetrics = data;
  if (appState.chartPanelActive) {
    chartController.renderChart();
    chartController.renderTable();
  }
  if (appState.clusterActive) clusterController.render(appState.currentYearIndex);
  if (lifetimeController?.isActive()) lifetimeController.render();
  if (appState.selectedCountry) countryDetailController.refreshDemographics();
  else if (appState.selectedLegend) renderDetailPanel();
  return data;
}

async function ensureCountryTrajectory() {
  if (countryTrajectory) return countryTrajectory;
  countryTrajectory = await loadCountryTrajectory();
  if (countryTrajectory && lifetimeController?.isActive()) {
    lifetimeController.render();
  }
  return countryTrajectory;
}

async function ensureCountryAgeStructure() {
  if (countryAgeStructure) return countryAgeStructure;
  countryAgeStructure = await loadCountryAgeStructure();
  if (countryAgeStructure && appState.selectedCountry) {
    countryDetailController.refreshAgeStructure();
  }
  return countryAgeStructure;
}

async function ensureCountryBorders() {
  if (countryBorders) return countryBorders;
  countryBorders = await loadCountryBorders();
  if (countryBorders) {
    countryBorderHitTester = createCountryBorderHitTester(countryBorders);
  }
  return countryBorders;
}

async function ensureCountryFillGeometryModule() {
  countryFillGeometryModulePromise ??= import("./country-fill-geometry.mjs");
  const module = await countryFillGeometryModulePromise;
  createCountryFillGeometries = module.createCountryFillGeometries;
  return createCountryFillGeometries;
}

function activePopulationAt(country, index = appState.currentYearIndex) {
  return projectionData.populationAt(country, index);
}

function activePeakYear(country) {
  return projectionData.peakYear(country);
}

function activeGlobalMetricsForYear(year) {
  return projectionData.globalMetricsForYear(year);
}

function activeGlobalMetricsMap() {
  return projectionData.globalMetricsMap();
}

function activeGlobalTrendMilestones() {
  return projectionData.globalTrendMilestones();
}
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

function colorFor(country, mode = appState.colorMode) {
  return mode === "income" ? country._incomeColor : country._regionColor;
}

function writeDotColor(colorAttr, slot, country) {
  const color = colorFor(country);
  colorAttr.setXYZ(slot, color.r, color.g, color.b);
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
  hasUnclassifiedIncome = false;
  countries.forEach((country) => {
    country._regionColor = regionColor(country.region);
    country._incomeLabel = incomeGroupLabel(country.iso3, incomeGroups);
    country._incomeColor = incomeColor(country._incomeLabel);
    if (country._incomeLabel === UNCLASSIFIED_INCOME) {
      hasUnclassifiedIncome = true;
    }
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
      country._freqs[i] =
        DOT_CONFIG.pulseFrequencyMin +
        Math.random() * DOT_CONFIG.pulseFrequencyRange;
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
  // Scratch endpoints for the GPU-side transition morph (see
  // DOT_VERTEX_SHADER) — only written when setViewMode()/updateTransition()
  // actually have a transition in flight; otherwise unused.
  geometry.setAttribute(
    "aMorphFrom",
    new THREE.BufferAttribute(new Float32Array(maxTotal * 3), 3),
  );
  geometry.setAttribute(
    "aMorphTo",
    new THREE.BufferAttribute(new Float32Array(maxTotal * 3), 3),
  );
  geometry.setDrawRange(0, 0);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      map: { value: createDotTexture() },
      uTime: { value: 0 },
      uSize: { value: VIEW_CONFIG.globe.dotSize * renderer.getPixelRatio() },
      uScale: { value: renderer.domElement.height * 0.5 },
      uOpacity: { value: DOT_CONFIG.opacity },
      uPulseAmplitude: { value: DOT_CONFIG.pulseAmplitude },
      uFreqMul: { value: 1 },
      uAmpMul: { value: 1 },
      uGlobeRadius: { value: GLOBE_RADIUS },
      uIsMap: { value: 0 },
      uMorphActive: { value: 0 },
      uMorphT: { value: 0 },
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
  currentDotSize = VIEW_CONFIG.globe.dotSize;
}

function setDotSize(size) {
  currentDotSize = size;
  pointsMesh.material.uniforms.uSize.value = size * renderer.getPixelRatio();
  raycaster.params.Points.threshold = size * 1.5;
}

function positionsFor(country) {
  return appState.viewMode === "map" ? country._xyzMap : country._xyzGlobe;
}

// Nudges the fill just outside the globe surface/dot pulse range (up to
// ±DOT_CONFIG.pulseAmplitude) so it reads as sitting on the country rather
// than a pulsing dot occasionally poking through it, and just toward the
// camera on the flat map for the same reason.
const HOVER_FILL_GLOBE_RADIUS = GLOBE_RADIUS + DOT_CONFIG.pulseAmplitude + 4;
const HOVER_FILL_MAP_Z = 2;

// Only detaches meshes from the scene — doesn't dispose them, since they
// may still be sitting in hoverFillCache for reuse. Disposal happens solely
// on cache eviction in showHoverCountryFill().
function clearHoverCountryFill() {
  if (!hoverCountry) return;
  hoverCountryGroup.clear();
  hoverCountry = null;
}

// Every cached mesh's material.color was baked from whatever theme was
// active when it was built — a theme change makes the whole cache stale at
// once, unlike a normal per-country eviction.
function clearHoverFillCache() {
  hoverFillCache.forEach((meshes) =>
    meshes.forEach((mesh) => {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }),
  );
  hoverFillCache.clear();
}

// Fills a country's outline (one shape per ring — most countries are a
// single polygon, but archipelagos/exclaves are several) on whichever
// surface is currently showing, in a darkened version of its own dot color
// (an outline this same color, even drawn at several px wide, read as too
// close to the dot cloud underneath to make out — a filled, darker shape
// doesn't have that problem). Border data is lazy-loaded and keyed by
// iso3 (see init()); hovering before it's arrived just skips drawing one,
// same as any other deferred data here.
function showHoverCountryFill(country) {
  if (hoverCountry === country) return;
  clearHoverCountryFill();
  hoverCountry = country;
  const rings = countryBorders?.[country.iso3];
  if (!rings || !createCountryFillGeometries) {
    Promise.all([
      ensureCountryBorders(),
      ensureCountryFillGeometryModule(),
    ]).then(() => {
      if (hoverCountry !== country) return;
      hoverCountry = null;
      showHoverCountryFill(country);
    });
    return;
  }

  const cacheKey = `${country.iso3}:${appState.viewMode}`;
  const cached = hoverFillCache.get(cacheKey);
  if (cached) {
    cached.forEach((mesh) => hoverCountryGroup.add(mesh));
    return;
  }

  // 5% toward black — enough to read as "darker" without muddying the
  // region color.
  const color = colorFor(country).clone().lerp(new THREE.Color(0x000000), 0.05);
  const meshes = [];
  const geometries = createCountryFillGeometries({
    rings,
    viewMode: appState.viewMode,
    projectPoint: (lon, lat) =>
      appState.viewMode === "map"
        ? latLonToMapVector3(lat, lon).setZ(HOVER_FILL_MAP_Z)
        : latLonToVector3(lat, lon, HOVER_FILL_GLOBE_RADIUS),
  });
  geometries.forEach((geometry) => {
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.85,
      // Reprojecting a flat triangulation onto a sphere can flip a
      // triangle's winding relative to the camera depending on where on
      // the globe it lands — DoubleSide avoids backface-culling some of
      // them away.
      side: THREE.DoubleSide,
      // Same reasoning as the dots' own depthWrite: false — nothing should
      // stop this from painting over the point cloud underneath it.
      depthTest: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = 10;
    hoverCountryGroup.add(mesh);
    meshes.push(mesh);
  });

  hoverFillCache.set(cacheKey, meshes);
  if (hoverFillCache.size > HOVER_FILL_CACHE_LIMIT) {
    // Map iteration order is insertion order, so the first entry here is
    // the oldest — evict it. The entry just inserted above is always last,
    // so this can never evict what was just built.
    const [oldestKey, oldestMeshes] = hoverFillCache.entries().next().value;
    oldestMeshes.forEach((mesh) => {
      mesh.geometry.dispose();
      mesh.material.dispose();
    });
    hoverFillCache.delete(oldestKey);
  }
}

// Callout labels sit above the WebGL canvas, so entering one does not send a
// pointerleave to the canvas. Stop its throttled raycast explicitly while the
// label owns hover; otherwise the last canvas position can immediately replace
// (or clear) the callout country's fill on the next tooltip update.
function showCalloutCountryHover(country) {
  lastPointerEvent = null;
  elements.tooltip.hidden = true;
  renderer.domElement.classList.remove("hovering-dot");
  showHoverCountryFill(country);
}

function clearCalloutCountryHover() {
  clearHoverCountryFill();
}

const formatter = new Intl.ListFormat("en", {
  style: "long",
  type: "conjunction",
});

function getPeakCountryName(peakCountries) {
  const names = peakCountries.map((country) => country.name);
  return formatter.format(names);
}

// Picks a phrasing for the peak-year status line based on how many countries
// peak in the given year. Country names live in the detail rows below the
// status, so the copy stays focused on the year and count.
// isProjected distinguishes an observed peak (year <= appState.historicalCutoffYear)
// from a modeled one (year > appState.historicalCutoffYear) — without it, a
// projected-year copy like "France's population peaks in 2061" reads as a
// stated fact rather than the UN Medium-variant projection it actually is.
function buildPeakStatus(year, peakCountries, isProjected) {
  const pick = (variants) =>
    variants[Math.floor(Math.random() * variants.length)];
  const count = peakCountries.length;
  if (count === 0) {
    return "";
    // return pick(
    //   isProjected
    //     ? [
    //         `No country's population is projected to peak in ${year}.`,
    //         `${year} is projected to pass quietly — no country's population is expected to hit its peak.`,
    //         `No population peaks are projected for ${year}. Try another spot on the timeline.`,
    //       ]
    //     : [
    //         `No country's population peaked in ${year}.`,
    //         `${year} passed quietly — no country's population hit its peak.`,
    //         `Not a single population peak that year. Try another spot on the timeline.`,
    //       ],
    // );
  }

  if (count === 1) {
    return pick(
      isProjected
        ? [
            `${peakCountries[0].name} is projected to reach its population peak in ${year}.`,
            `${year} is projected to be a population high point for ${peakCountries[0].name}.`,
            `${peakCountries[0].name} population is projected to top out in ${year}.`,
          ]
        : [
            `${peakCountries[0].name} reached its population peak in ${year}.`,
            `${year} was the population high point for ${peakCountries[0].name}.`,
            `${peakCountries[0].name} population topped out in ${year}.`,
          ],
    );
  }

  if (count <= 3) {
    return pick(
      isProjected
        ? [
            `${getPeakCountryName(peakCountries)} are projected to reach their population peak in ${year}.`,
            `${year} is projected to mark the population high point for ${getPeakCountryName(peakCountries)}.`,
            `${getPeakCountryName(peakCountries)} population are projected to top out in ${year}.`,
          ]
        : [
            `${getPeakCountryName(peakCountries)} reached their population peak in ${year}.`,
            `${year} marked the population high point for ${getPeakCountryName(peakCountries)}.`,
            `${getPeakCountryName(peakCountries)} population topped out in ${year}.`,
          ],
    );
  }

  return pick(
    isProjected
      ? [
          `${getPeakCountryName(peakCountries)} countries are projected to reach their population peak in ${year}.`,
          `${year} is projected to be a busy peak year, with ${getPeakCountryName(peakCountries)} population topping out.`,
          `A wave of projected population peaks lands in ${year}: ${getPeakCountryName(peakCountries)}.`,
        ]
      : [
          `${getPeakCountryName(peakCountries)} reached their population peak in ${year}.`,
          `${year} was a busy peak year, with ${getPeakCountryName(peakCountries)} population topping out.`,
          `A wave of population peaks landed in ${year}: ${getPeakCountryName(peakCountries)}.`,
        ],
  );
}

// Trails the global status line with headline world numbers for the
// selected year — the milestone/peak copy above is about a specific trend
// or country, so these figures themselves would otherwise never appear on
// the main (no country/group selected) view.
function buildGlobalPopulationStatus(year) {
  const isProjected = year > appState.historicalCutoffYear;
  const metrics = activeGlobalMetricsForYear(year);
  const population = metrics?.population;
  if (population == null) return "";
  const verb = isProjected ? "is" : "was";
  const parts = [`Global total ${verb} ${formatPeakPopulation(population)}`];
  if (metrics.lifeExpectancy != null) {
    parts.push(
      `life expectancy ${verb} ${METRICS.lifeExpectancy.format(metrics.lifeExpectancy)}`,
    );
  }
  if (metrics.populationGrowth != null) {
    parts.push(
      `population growth ${verb} ${METRICS.populationGrowth.format(metrics.populationGrowth)}`,
    );
  }
  return `${parts.join(", ")}.`;
}

// groupCountries lets a caller that already has the filtered+sorted group
// list (renderDetailPanel, right after building its table from the same
// list) hand it over instead of this recomputing selectDetailCountries()
// a second time on every year change; other callers just omit it and it's
// computed here as before.
function updateStatusPanel(year, { instant = false, groupCountries } = {}) {
  const isProjected = year > appState.historicalCutoffYear;
  if (appState.selectedCountry && !elements.countryPanel.hidden) {
    updateMilestoneNav(null);
    const migrationNarrative = buildCountryDemographicNarrative({
      country: appState.selectedCountry,
      years: yearsData,
      currentYearIndex: appState.currentYearIndex,
      historicalCutoffYear: appState.historicalCutoffYear,
      seriesFor: (key) =>
        key === "population"
          ? activePopulationSeries(appState.selectedCountry)
          : countryDemographicMetrics?.countries?.[appState.selectedCountry.iso3]?.[
              key
            ] ?? [],
    });
    // The aging milestone (formerly its own card) now closes the summary; the
    // migration sentence, when present, precedes it.
    const agingInsight = buildAgingMilestoneInsight({
      country: appState.selectedCountry,
      years: yearsData,
      currentYearIndex: appState.currentYearIndex,
      historicalCutoffYear: appState.historicalCutoffYear,
      olderPopulationShare:
        countryDemographicMetrics?.countries?.[appState.selectedCountry.iso3]
          ?.olderPopulationShare,
    });
    const demographicNarrative = [migrationNarrative, agingInsight?.text]
      .filter(Boolean)
      .join(" ");
    renderCountrySummary(
      buildCountrySummary({
        country: appState.selectedCountry,
        year,
        years: yearsData,
        historicalCutoffYear: appState.historicalCutoffYear,
        formatPopulation: formatPeakPopulation,
        populationSeries: activePopulationSeries(appState.selectedCountry),
        demographicNarrative,
      }),
    );
    return;
  }
  if (appState.selectedLegend && !elements.detailPanel.hidden) {
    updateMilestoneNav(null);
    return;
  }

  const peakCountries = countriesData.filter(
    (country) => activePeakYear(country) === year,
  );
  const milestone = activeGlobalTrendMilestones().get(year);
  updateMilestoneNav(year);
  const leadText = milestone
    ? `${milestone.text}${
        peakCountries.length
          ? ` ${buildPeakStatus(year, peakCountries, isProjected)}`
          : ""
      }`
    : buildPeakStatus(year, peakCountries, isProjected);
  const globalPopulationStatus = buildGlobalPopulationStatus(year);
  // Neither the milestone blurb nor the peak-year line mentions the year on
  // its own — normally one of them is present and does, but buildPeakStatus
  // returns "" when nothing peaked that year, which (off a milestone year
  // too) would leave the global figures below as the only copy, with no
  // year attached to them at all.
  const yearLead = leadText
    ? ""
    : `${year}${isProjected ? " projection" : ""}:`;
  showStatus(
    [yearLead, leadText, globalPopulationStatus].filter(Boolean).join(" "),
    { instant },
  );
}

// Milestone years in chronological order, so "Milestone #N" counts forward
// through history the same way the ‹/› buttons step through it.
function sortedMilestoneYears() {
  return [...activeGlobalTrendMilestones().keys()].sort((a, b) => a - b);
}

// Off a milestone year, prev/next target the nearest milestone on either
// side rather than being disabled outright — the slider can land anywhere
// (dragging, deep links, chart-marker scrubbing), and these buttons are the
// fastest way back onto the story from wherever that leaves you.
// year is null while a country/group detail view is showing its own status
// instead of the global story — milestone nav isn't relevant there, so both
// buttons are simply disabled rather than pointed at the global timeline.
function updateMilestoneNav(year) {
  const years = sortedMilestoneYears();
  const index = year == null ? -1 : years.indexOf(year);
  const hasMilestone = index !== -1;
  // #milestoneCaption's markup was commented out along with the rest of
  // the old #milestoneRow, but this counter update wasn't — left in place,
  // it throws on every year change (elements.milestoneCaption is null),
  // which is what was actually breaking data loading via updateStatusPanel.
  if (elements.milestoneCaption) {
    elements.milestoneCaption.textContent = hasMilestone
      ? `${index + 1} / ${years.length}`
      : "";
  }
  if (year == null) {
    elements.milestonePrev.disabled = true;
    elements.milestoneNext.disabled = true;
    return;
  }
  const { prev, next } = adjacentMilestoneYears(years, year);
  elements.milestonePrev.disabled = prev == null;
  elements.milestoneNext.disabled = next == null;
}

// Mirrors selectYearFromClientY()'s slider-driven navigation, so jumping to
// a milestone year keeps the slider/timeline/thumb in sync rather than
// mutating appState.currentYearIndex directly and leaving those controls stale.
function goToYear(year) {
  elements.yearSlider.value = year;
  elements.yearSlider.dispatchEvent(new Event("input", { bubbles: true }));
  elements.yearSlider.dispatchEvent(new Event("change", { bubbles: true }));
}

function stepMilestone(delta) {
  tourController.stop();
  const { prev, next } = adjacentMilestoneYears(
    sortedMilestoneYears(),
    yearsData[appState.currentYearIndex],
  );
  const target = delta < 0 ? prev : next;
  if (target == null) return;
  goToYear(target);
}

// Guided "story mode": auto-advances through milestones one at a time,
// dwelling on each long enough to read the status text before moving on.
// A fixed dwell (rather than measuring text length) is simplest and the
// milestone blurbs are all similar, short-paragraph lengths.
function setTourButtonState(playing) {
  elements.milestoneTourIcon.textContent = playing ? "pause" : "play_arrow";
  const label = playing ? "Pause milestone tour" : "Play milestone tour";
  elements.milestoneTour.setAttribute("aria-label", label);
  elements.milestoneTour.title = playing ? "Pause tour" : "Play tour";
}

// Resets the fill to empty with no transition (a mid-fade snap-back would
// read as a glitch rather than "tour stopped").
function resetTourProgress() {
  const fill = elements.milestoneProgressFill;
  fill.style.transition = "none";
  fill.style.width = "0%";
}

// Restarts the fill-to-100% sweep timed to exactly one dwell period, so it
// reads as "time remaining on this milestone" rather than decoration.
function animateTourProgress(durationMs) {
  const fill = elements.milestoneProgressFill;
  fill.style.transition = "none";
  fill.style.width = "0%";
  // Force a reflow so the 0%-width reset above is committed before the
  // transition is re-enabled — otherwise the browser coalesces both style
  // writes and the fill just jumps straight to 100% with no visible sweep.
  void fill.offsetWidth;
  fill.style.transition = `width ${durationMs}ms linear`;
  fill.style.width = "100%";
}

const tourController = createTourController({
  getMilestoneYears: sortedMilestoneYears,
  getCurrentYear: () => yearsData[appState.currentYearIndex],
  goToYear,
  onPlayingChange: setTourButtonState,
  onProgressReset: resetTourProgress,
  onProgressStart: animateTourProgress,
});

// Swaps the status line's text in with a quick fade, so the peak-year
// callout catches the eye instead of silently changing as the year slider
// drags. Removing the animation class and forcing a reflow before re-adding
// it restarts the CSS fade even though the element itself persists across
// year changes.
function showStatus(text, { instant = false } = {}) {
  const el = elements.status;
  const textNode = document.createElement("div");
  // innerHTML, not textContent — the global-figures portion of `text` comes
  // from METRICS[key].format(), which wraps its unit in <span class="suffix">
  // (metrics.mjs) for spacing; textContent would print that markup literally.
  textNode.innerHTML = text;
  el.replaceChildren(textNode);
  if (instant) return;

  el.classList.remove("status-fade-in");
  void el.offsetWidth;
  el.classList.add("status-fade-in");
}

// Cluster's own #status narration — a handful of ~30-40 year chapters
// (CLUSTER_STATUS_PERIODS, cluster-config.mjs) rather than a per-year
// figure like Globe/Map's own status text, since there's no single number
// that sums up "which of the five archetypes is this year's picture."
// Only calls showStatus() on an actual chapter change (see
// appState.clusterStatusPeriod above) so scrubbing within one chapter doesn't
// retrigger its fade every year.
function applyClusterStatus(year, options) {
  const period = clusterStatusForYear(year);
  if (period === appState.clusterStatusPeriod) return;
  appState.clusterStatusPeriod = period;
  showStatus(`${period.title}. ${period.text}`, options);
}

// Cluster's own take on #milestoneTour's play button: rather than hopping
// between milestone years (the global tour's job), it sweeps through every
// year from 1950 to 2100 once and stops — a single pass through the full
// archetype narrative rather than a looping story. Reuses goToYear() so
// each step still runs through the slider's normal input/change pipeline
// (cluster particles, #status chapter caption, URL sync all update exactly
// as they would from a manual drag) and setTourButtonState() so the same
// play/pause icon serves both playback modes.
let clusterPlaybackTimer = null;
// 150 year-steps at 90ms lands the full sweep around 13.5s — quick enough
// to hold attention, slow enough that each archetype phase is still
// readable as it passes rather than a blur.
const CLUSTER_PLAYBACK_STEP_MS = 90;

function isClusterPlaying() {
  return clusterPlaybackTimer !== null;
}

function stopClusterPlayback() {
  if (clusterPlaybackTimer === null) return;
  clearTimeout(clusterPlaybackTimer);
  clusterPlaybackTimer = null;
  setTourButtonState(false);
}

function playClusterTimelineOnce() {
  if (isClusterPlaying()) {
    stopClusterPlayback();
    return;
  }
  setTourButtonState(true);
  goToYear(yearsData[0]);
  const step = () => {
    const nextIndex = appState.currentYearIndex + 1;
    if (nextIndex >= yearsData.length) {
      stopClusterPlayback();
      return;
    }
    goToYear(yearsData[nextIndex]);
    clusterPlaybackTimer = setTimeout(step, CLUSTER_PLAYBACK_STEP_MS);
  };
  clusterPlaybackTimer = setTimeout(step, CLUSTER_PLAYBACK_STEP_MS);
}

function renderCountrySummary(summary) {
  elements.countrySummary.hidden = false;
  // Same .sparkline-caption label/value pattern the other cards use (e.g.
  // the Population card's "Population" / "115.1M"), so this card's caption
  // reads as one of the set rather than a one-off badge.
  const caption = document.createElement("div");
  caption.className = "sparkline-caption monospace";
  const label = document.createElement("div");
  label.className = "sparkline-label";
  label.textContent = "Summary";
  const value = document.createElement("div");
  value.className = "sparkline-value";
  value.innerHTML = badgeLabel();
  caption.append(label, value);

  if (summary.flagUrl) {
    elements.countryFlag.style.backgroundImage = `url(${summary.flagUrl})`;
    elements.countryFlag.hidden = false;
  } else {
    elements.countryFlag.hidden = true;
    elements.countryFlag.style.backgroundImage = "";
  }

  const copy = document.createElement("div");
  copy.className = "country-summary-copy paragraph";
  summary.segments.forEach((segment) => {
    if (!segment.className) {
      copy.append(document.createTextNode(segment.text));
      return;
    }
    const span = document.createElement("span");
    span.className = segment.className;
    span.textContent = segment.text;
    copy.append(span);
  });
  elements.countrySummary.replaceChildren(caption, copy);
}

function applyYear(year, { instant = false } = {}) {
  const yearIndex = yearsData.indexOf(year);
  if (yearIndex === -1) return;
  const isFirstCall = appState.currentYearIndex === -1;
  appState.currentYearIndex = yearIndex;

  // The 3D scene is fully hidden behind the chart overlay while it's open,
  // so repositioning every dot on each year change here would be pure
  // wasted work — this keeps year-scrubbing (e.g. the draggable chart
  // marker) cheap by touching only what's actually visible. Closing the
  // overlay (setChartPanelActive) does one full applyYear() call to catch
  // the 3D scene up to wherever this left it.
  if (appState.chartPanelActive) {
    updateYearLabels(year);
    chartController.renderChart();
    chartController.renderTable();
    syncUrlFromState();
    return;
  }

  // Same reasoning as the appState.chartPanelActive branch above — the 3D scene is
  // hidden behind the cluster overlay, so skip repositioning it and just
  // reclassify/reposition the (already-built) particles instead.
  // setClusterActive(false) does the 3D catch-up when the overlay closes.
  if (appState.clusterActive) {
    updateYearLabels(year);
    clusterController.setYear(year);
    applyClusterStatus(year, { instant });
    syncUrlFromState();
    return;
  }

  // The lifetime overlay covers the 3D scene too; the slider just re-frames
  // the personal story for the selected year (setLifetimeActive(false) catches
  // the 3D scene up on close).
  if (lifetimeController?.isActive()) {
    updateYearLabels(year);
    lifetimeController.render();
    syncUrlFromState();
    return;
  }

  if (!pointsMesh) return;
  // Skip the pulse on the very first call (initial page load) — there's no
  // prior year for this one to visibly change *from*, so it would just
  // read as an unexplained flash rather than communicating a change.
  if (!isFirstCall) triggerYearChangePulse();
  elements.tooltip.hidden = true;
  // A slider move (or closing an initially deep-linked chart view) during a
  // view transition invalidates the tween's dot-index mapping. Fully disable
  // the GPU morph before rebuilding: merely nulling `transition` leaves
  // uMorphActive enabled and freezes the dots at their last scramble frame.
  settleViewTransition();

  const posAttr = pointsMesh.geometry.getAttribute("position");
  const colorAttr = pointsMesh.geometry.getAttribute("color");
  let cursor = 0;

  countriesData.forEach((country) => {
    const pop = activePopulationAt(country, yearIndex);
    if (pop == null) return;
    const activeCount = Math.min(
      country.dots.length,
      Math.max(1, Math.round(pop / PEOPLE_PER_DOT)),
    );
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
      writeDotColor(colorAttr, cursor, country);
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

  const isProjected = year > appState.historicalCutoffYear;
  appState.isProjectedYear = isProjected;

  updateYearLabels(year);
  renderDetailPanel();
  if (appState.selectedCountry) {
    countryDetailController.updateYear(year);
    updateStatusPanel(year, { instant });
  } else if (!appState.selectedLegend) {
    updateStatusPanel(year, { instant });
  }
  calloutController.rebuild(year);
  syncUrlFromState();
}

// Cheap recolor for switching between Region/Income group modes: reuses
// the already-active dot set (positions, pulse identity) and only rewrites
// the color buffer, instead of rerunning applyYear()'s full rebuild.
function recolor() {
  if (!pointsMesh || !activeTotal) return;
  const colorAttr = pointsMesh.geometry.getAttribute("color");
  for (let i = 0; i < activeTotal; i++) {
    writeDotColor(colorAttr, i, dotCountry[i]);
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
  const slider = elements.yearSlider;
  const min = Number(slider.min || 0);
  const max = Number(slider.max || 100);
  const percentage = (Number(slider.value) - min) / (max - min);
  const thumbSize = 8;
  const thumbCenter =
    slider.offsetLeft + thumbSize / 2 +
    percentage * Math.max(0, slider.clientWidth - thumbSize);
  elements.yearValue.style.setProperty('--thumb-position', `${thumbCenter}px`);

  elements.yearValue.textContent = `${year}`;
}

function updateYearHoverLabel(event) {
  const slider = elements.yearSlider;
  const min = Number(slider.min);
  const max = Number(slider.max);
  const thumbSize = 8;
  const rect = slider.getBoundingClientRect();
  const trackWidth = Math.max(1, rect.width - thumbSize);
  const ratio = Math.min(
    1,
    Math.max(0, (event.clientX - rect.left - thumbSize / 2) / trackWidth),
  );
}

function legendEntriesFor(mode) {
  if (mode !== "income") return Object.entries(REGION_COLORS);
  return [
    ...Object.entries(INCOME_GROUP_COLORS),
    ...(hasUnclassifiedIncome
      ? [[UNCLASSIFIED_INCOME, UNCLASSIFIED_COLOR]]
      : []),
  ];
}

function renderLegend(modeOverride = null) {
  const mode =
    modeOverride ??
    (appState.clusterActive ? clusterController.getColorMode() : appState.colorMode);
  const entries = legendEntriesFor(mode);
  elements.legend.replaceChildren(
    ...entries.map(([label, color]) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "legend-item";
      item.dataset.label = label;
      item.dataset.color = color;
      item.dataset.mode = mode;
      item.classList.toggle(
        "active",
        appState.selectedLegend?.mode === mode && appState.selectedLegend?.label === label,
      );
      const swatch = document.createElement("span");
      swatch.className = "legend-swatch";
      item.style.setProperty("--color-legend", color);
      const text = document.createElement("span");
      text.textContent = displayGroupLabel(label);
      item.append(swatch, text);
      return item;
    }),
  );
}

function getDetailNav() {
  const sections = [
    { label: "Age", mode: "age", items: AGE_CATEGORIES },
    { label: "Migration", mode: "migration", items: MIGRATION_CATEGORIES },
    {
      label: "Region",
      mode: "region",
      items: legendEntriesFor("region").map(([label, color]) => ({
        key: label,
        label,
        color,
      })),
    },
    {
      label: "Income group",
      mode: "income",
      items: legendEntriesFor("income").map(([label, color]) => ({
        key: label,
        label,
        color,
      })),
    },
  ];

  const result =
    sections.map(({ label: sectionLabel, mode, items }) => {
    const section = document.createElement("div");
    section.className = "detail-nav-section";
    const heading = document.createElement("div");
    heading.className = "detail-nav-section-label";
    heading.textContent = sectionLabel;
    section.append(
      heading,
      ...items.map((item) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "detail-nav-item";
        button.dataset.mode = mode;
        button.dataset.key = item.key;
        button.dataset.label = item.label;
        button.dataset.color = item.color;
        if (item.sortKey) button.dataset.sortKey = item.sortKey;
        if (item.sortDirection) button.dataset.sortDirection = item.sortDirection;
        button.classList.toggle(
          "active",
          appState.selectedLegend?.mode === mode && appState.selectedLegend?.key === item.key,
        );
        button.textContent = displayGroupLabel(item.label);
        return button;
      }),
    );
    return section;
  });

  return result;
}

// The detail panel's own left-column nav — unlike the outer #legend
// sidebar (which shows only one of region/income, picked via #appState.colorMode),
// this lists all four groupings side by side so a reader can jump straight
// from e.g. "Aged society" to "Europe & Central Asia" without leaving the
// panel. Re-rendered on every renderDetailPanel() call so its "active" item
// stays in sync with whichever group is currently shown.
function renderDetailNav() {
  if (!elements.detailNav) return;
  elements.detailNav.replaceChildren(...getDetailNav());
}

function metricFor(country, key) {
  return countryDemographicMetrics?.countries?.[country.iso3]?.[key]?.[
    appState.currentYearIndex
  ];
}

function selectedCountries() {
  if (!appState.selectedLegend) return [];
  return selectDetailCountries({
    countries: countriesData,
    legend: appState.selectedLegend,
    columns: detailColumns(),
    sort: appState.detailSort,
    metricFor,
  });
}

// Single source of truth for the detail-panel table: each column knows how
// to read its own sort value (used both for sorting and for the population
// ratio bar) and how to format it for display. Header cells are generated
// from this list too, so clicking one always lines up with the right column.
// Age/migration groupings get their own curated metric set instead of the
// full region/income column list, since most of those columns wouldn't be
// relevant to (e.g.) a "Migration inflow" cohort.
function detailColumns() {
  const metricKeys =
    appState.selectedLegend?.mode === "age"
      ? AGE_COLUMN_KEYS
      : appState.selectedLegend?.mode === "migration"
        ? MIGRATION_COLUMN_KEYS
        : undefined;
  // Age/migration curated tables show the subgroup's own population (e.g.
  // Super-aged society's 65+ headcount) rather than each country's total —
  // region/income keep the plain country total.
  const populationFor =
    appState.selectedLegend?.mode === "age" || appState.selectedLegend?.mode === "migration"
      ? (country) =>
          subgroupPopulationFor(appState.selectedLegend, {
            population: activePopulationAt(country),
            olderPopulationShare: metricFor(country, "olderPopulationShare"),
            youthDependencyRatio: metricFor(country, "youthDependencyRatio"),
            ageDependencyRatio: metricFor(country, "ageDependencyRatio"),
            netMigrationRate: metricFor(country, "netMigrationRate"),
          })
      : activePopulationAt;
  const populationLabel =
    appState.selectedLegend?.mode === "age" || appState.selectedLegend?.mode === "migration"
      ? subgroupPopulationLabelFor(appState.selectedLegend)
      : undefined;
  return buildDetailColumns({
    currentYearIndex: appState.currentYearIndex,
    metricFor,
    metricKeys,
    populationFor,
    populationLabel,
  });
}

function setDetailSort(key) {
  const next = nextSortState(appState.detailSort, key, detailColumns());
  if (!next) return;
  appState.detailSort = next;
  renderDetailPanel();
}

// Keeps other UI in sync with the detail panels' visibility. Switching view
// mode while either panel is open would rebuild the active dot set out from
// under its population-ratio bars and callout anchors mid-read, so the
// toggle is disabled whenever one is visible; the body class lets
// stylesheets target "detail panel open" state generally (layout, canvas
// dimming, etc.) without every consumer re-deriving it from the panels.
function updateViewModeAvailability() {
  const groupDetailOpen = !elements.detailPanel.hidden;
  const countryDetailOpen = !elements.countryPanel.hidden;
  const isOpen = groupDetailOpen || countryDetailOpen;
  elements.viewMode.querySelectorAll("button").forEach((btn) => {
    btn.disabled = isOpen;
  });
  const nextUiState = updateUiState({ groupDetailOpen, countryDetailOpen });
  if (!nextUiState.menuOpen) {
    elements.menuToggle.setAttribute("aria-expanded", "false");
  }
}

function renderDetailPanel() {
  // A country drill-down (from a row click or a dot click) takes over the
  // country panel; re-running this on the next year change would otherwise
  // stomp it back to the group table.
  if (!appState.selectedLegend || appState.selectedCountry || appState.currentYearIndex < 0) return;
  // Group tables use demographic columns that are no longer part of the
  // initial Globe payload. Opening a group is their first-use boundary;
  // ensureCountryDemographics() memoizes the request and re-renders this
  // panel when it resolves.
  if (!countryDemographicMetrics) ensureCountryDemographics();

  const columns = detailColumns();
  const countries = selectedCountries();
  const year = yearsData[appState.currentYearIndex];
  elements.detailPanel.style.setProperty(
    "--detail-color",
    appState.selectedLegend.color,
  );
  elements.detailTitle.textContent = displayGroupLabel(appState.selectedLegend.label);
  elements.detailSubtitle.textContent = `${countries.length} countries · ${year}`;
  renderDetailNav();

  renderSortableTable({
    headerEl: elements.detailHeader,
    rowsEl: elements.detailRows,
    columns,
    sort: appState.detailSort,
    countries,
    barMode: "country-cell",
    barMetric: "population",
    onSort: setDetailSort,
    onRowClick: openCountryDetail,
  });
  countryOverlay.close({ restoreFocus: false });
  detailOverlay.open({ focus: false });
  updateViewModeAvailability();
  updateStatusPanel(year, { groupCountries: countries });
}

function closeDetailPanel() {
  countryDetailController.reset();
  appState.selectedLegend = null;
  appState.selectedCountry = null;
  detailOverlay.close();
  countryOverlay.close();
  updateViewModeAvailability();
  renderLegend();
  // Match chart-view close behavior: the underlying global status was
  // already established before opening the detail overlay, so restore it
  // immediately instead of replaying the typewriter animation.
  if (appState.currentYearIndex >= 0) {
    updateStatusPanel(yearsData[appState.currentYearIndex], { instant: true });
  }
  // If this country/group detail was opened from inside Chart or Cluster
  // (a table row click, or a cluster-particle click), restore that mode
  // instead of always landing back on whichever of Globe/Map is
  // underneath — this is the single place both navigation paths (a direct
  // close, and closeCountryDetail()'s fallback once there's no group table
  // left to return to) funnel through on their way fully out. Each of the
  // set*Active(true) calls below does its own syncUrlFromState(), so the
  // plain call at the end only runs when there's nothing to restore.
  const restoreMode = appState.detailEntryMode;
  appState.detailEntryMode = null;
  if (restoreMode === "chart") {
    setChartPanelActive(true);
  } else if (restoreMode === "cluster") {
    setClusterActive(true);
  } else if (restoreMode === "search") {
    // Back to the bare list: drop the chip but stay in search view.
    appState.searchSelectedIso3 = null;
    renderSearchCountryChip();
    syncUrlFromState();
  } else if (restoreMode === "lifetime") {
    // preserveStory: true — the story's DOM/scroll position was left exactly
    // as it was (see the "Explore Country's Dataset" onOpenCountry callback),
    // so this just makes the same section visible again.
    setLifetimeActive(true, { preserveStory: true });
  } else {
    syncUrlFromState();
  }
}

function openInfoPanel() {
  infoOverlay.open();
  updateUiState({ infoOpen: true });
  elements.menuToggle.setAttribute("aria-expanded", "false");
}

function closeInfoPanel() {
  infoOverlay.close();
  updateUiState({ infoOpen: false });
}

// Returns to the group table this country was opened from (if any),
// otherwise closes the whole panel — mirrors closeDetailPanel()'s job but
// one level up the navigation stack.
function closeCountryDetail() {
  countryDetailController.reset();
  appState.selectedCountry = null;
  if (appState.selectedLegend) {
    renderDetailPanel();
  } else {
    closeDetailPanel();
  }
  syncUrlFromState();
}

// --- Deep linking ---------------------------------------------------------
// Mirrors "which page am I looking at" into the URL query string (via
// replaceState, so it doesn't spam browser history with every year the
// slider passes through) so a copied link reopens to the same view —
// country/group detail, or the chart view with its metric and selected
// countries — instead of always landing back on the plain globe.
function urlStateFromApp() {
  const state = { mode: appState.viewMode, projection: projectionData.scenario() };
  if (appState.chartPanelActive) {
    Object.assign(state, { view: "chart", metric: appState.chartMetricKey, countries: appState.selectedChartCountries });
  } else if (appState.clusterActive) {
    Object.assign(state, { view: "cluster" });
  } else if (appState.searchActive) {
    Object.assign(state, {
      view: "search",
      ...(appState.searchSelectedIso3 ? { country: appState.searchSelectedIso3 } : {}),
    });
  } else if (lifetimeController?.isActive()) {
    lifetimeController.applyToUrlState(state);
  } else if (appState.selectedCountry) {
    Object.assign(state, { view: "country", country: appState.selectedCountry.iso3 });
  } else if (appState.selectedLegend) {
    Object.assign(state, { view: "group", groupMode: appState.selectedLegend.mode, group: appState.selectedLegend.key });
  }
  if (appState.currentYearIndex >= 0) state.year = yearsData[appState.currentYearIndex];
  return state;
}

function syncUrlFromState() {
  const query = serializeUrlState(urlStateFromApp());
  const url = `${window.location.pathname}${query ? `?${query}` : ""}`;
  window.history.replaceState(null, "", url);
}

// Applied once at startup, after the default year and legend have already
// rendered — it only overrides that default when the URL actually asks for
// something, so a plain visit behaves exactly as it always has. Takes the
// search string as an argument (captured before init() started calling
// syncUrlFromState()) rather than reading window.location.search live,
// since by this point that's already been overwritten with default state.
function applyUrlStateFromLocation(search) {
  const state = parseUrlState(search, {
    years: yearsData,
    countryCodes: countriesData.map((country) => country.iso3),
  });
  if (state.projection) setProjectionScenario(state.projection, { sync: false });
  if (state.year != null) goToYear(state.year);
  if (state.mode === "map") setViewMode("map");

  if (state.view === "chart") {
    if (state.countries.length) appState.selectedChartCountries = state.countries;
    // Countries/metric are settled before the panel opens, so its own
    // renderChart({ animate: true }) call is both the first one that
    // reflects the deep-linked state and the only one that's actually
    // visible — no need for a redundant plain re-render after it.
    if (state.metric) chartController.setMetric(state.metric);
    chartController.renderCountryChips();
    setChartPanelActive(true);
  } else if (state.view === "cluster") {
    setClusterActive(true);
  } else if (state.view === "search") {
    setSearchActive(true);
    if (state.country) selectSearchCountry(state.country);
  } else if (state.view === "lifetime") {
    lifetimeRequestedActive = true;
    ensureCountryDemographics();
    ensureCountryTrajectory();
    ensureCountryAgeStructure();
    ensureLifetimeController().then((controller) => {
      if (!lifetimeRequestedActive) return;
      controller.applyUrlState(state);
      controller.setActive(true);
    });
  } else if (state.view === "country") {
    const country = countriesData.find((c) => c.iso3 === state.country);
    if (country) openCountryDetail(country);
  } else if (state.view === "group") {
    if (state.groupMode === "region" || state.groupMode === "income") {
      if (state.groupMode !== appState.colorMode) setColorMode(state.groupMode);
      const entry = legendEntriesFor(state.groupMode).find(
        ([label]) => label === state.group,
      );
      if (entry) selectLegendItem(entry[0], entry[1]);
    } else {
      const categories =
        state.groupMode === "age" ? AGE_CATEGORIES : MIGRATION_CATEGORIES;
      const category = categories.find((c) => c.key === state.group);
      if (category) {
        selectDetailGroup(
          state.groupMode,
          category.key,
          category.label,
          category.color,
          category.sortKey,
          category.sortDirection,
        );
      }
    }
  }
}

function selectLegendItem(label, color, mode = appState.colorMode) {
  if (appState.selectedLegend?.mode === mode && appState.selectedLegend?.key === label) {
    // closeDetailPanel();
    return;
  }

  appState.detailSort = { key: 'population', direction: "desc" };

  tourController.stop();
  appState.selectedLegend = { mode, key: label, label, color };
  renderLegend(mode);
  renderDetailPanel();
  syncUrlFromState();
}

// Selects an age/migration cohort from the detail panel's own nav — unlike
// selectLegendItem (region/income, shared with the outer #legend sidebar),
// this never touches the outer legend, since "age"/"migration" aren't modes
// it knows how to render. `sortKey`/`sortDirection`, when given, are the
// metric and direction that actually explain the category (e.g. descending
// oldAgeDependencyRatio for "Aged society", or ascending netMigrationRate
// for "Migration outflow" so the strongest — most negative — outflows sort
// first), so the table opens sorted by the number that matters instead of
// always falling back to population.
function selectDetailGroup(mode, key, label, color, sortKey, sortDirection) {
  if (appState.selectedLegend?.mode === mode && appState.selectedLegend?.key === key) {
    // closeDetailPanel();
    return;
  }
  tourController.stop();
  appState.selectedLegend = { mode, key, label, color };
  if (sortKey) {
    appState.detailSort = { key: sortKey, direction: sortDirection ?? "desc" };
  }
  renderDetailPanel();
  syncUrlFromState();
}

// --- Country detail view ------------------------------------------------
// A single-country drill-down that replaces the 3D canvas area with charts
// (same fixed/glass panel the group table uses) — entered by clicking a dot
// on the globe/map, or a row inside the group table above.

// --- Chart view (Globe/Map's third mode) ---------------------------------
// A full-width multi-country trend chart, independent of the 3D dot scene
// and the single-year snapshot the rest of the app is built around. Most of
// its logic lives in chart-controller.mjs; script.js retains only the
// app-level orchestration below (tooltip wrappers shared with Cluster,
// overlay wiring, and the entry points into/out of the full country detail
// panel).
function showChartTooltip(event, text, color = null) {
  showTooltipLine(elements.chartTooltip, event, text, color);
}

function hideChartTooltip() {
  hideTooltipElement(elements.chartTooltip);
}

// Cluster-only: shows an archetype's full description on hovering its
// canvas-drawn title — a dedicated element rather than reusing
// #chartTooltip, since that one's compact single-line pill styling is used
// broadly elsewhere (chart lines, sparklines, cluster particles) and this
// needs to wrap a full paragraph instead.
function showClusterArchetypeTooltip(event, archetype) {
  const definition = CLUSTER_ARCHETYPES[archetype];
  if (!definition) return;
  const summary = document.createElement("p");
  summary.className = "tooltip-summary";
  summary.textContent = definition.summary;
  showTooltipContent(elements.clusterArchetypeTooltip, event, summary);
}

function hideClusterArchetypeTooltip() {
  hideTooltipElement(elements.clusterArchetypeTooltip);
}

const detailOverlay = createOverlayController({
  panel: elements.detailPanel,
  labelledBy: elements.detailTitle.id,
  initialFocus: () => elements.detailClose,
  requestClose: closeDetailPanel,
});
const countryOverlay = createOverlayController({
  panel: elements.countryPanel,
  labelledBy: elements.countryTitle.id,
  initialFocus: () => elements.countryClose,
  requestClose: closeCountryDetail,
});
const infoOverlay = createOverlayController({
  panel: elements.infoPanel,
  labelledBy: "settingsTitle",
  trigger: elements.infoButton,
  scrim: elements.menuShim,
  initialFocus: () => elements.infoClose,
  requestClose: closeInfoPanel,
});

const countryDetailController = createCountryDetailController({
  elements,
  getYears: () => yearsData,
  getCurrentYearIndex: () => appState.currentYearIndex,
  setCurrentYearIndex: (index) => {
    appState.currentYearIndex = index;
  },
  getHistoricalCutoffYear: () => appState.historicalCutoffYear,
  getCountries: () => countriesData,
  getPopulationSeries: activePopulationSeries,
  getColorMode: () => appState.colorMode,
  getDemographicMetrics: () => countryDemographicMetrics,
  getAgeStructure: () => countryAgeStructure,
  colorFor,
  formatPopulation: formatPeakPopulation,
  easeOut: easeOutCubic,
  chartLineGrowMs: CHART_LINE_GROW_MS,
  chartMarkerFadeInMs: CHART_MARKER_FADE_IN_MS,
  updateStatusPanel,
  updateViewModeAvailability,
  stopTour: () => tourController.stop(),
  goToYear,
  showTooltip: showChartTooltip,
  hideTooltip: hideChartTooltip,
  onOpenCountry: openCountryDetail,
});

function openCountryDetail(country) {
  if (!country || appState.currentYearIndex < 0) return;
  ensureCountryDemographics();
  ensureCountryAgeStructure();
  // A row click in the chart view's own table drills into the same full
  // country detail panel the group table uses — that panel and the chart
  // overlay are both full-screen, so the chart has to step aside first.
  // Remembered (see appState.detailEntryMode) so closing back out restores Chart
  // instead of landing on whichever of Globe/Map is underneath.
  if (appState.chartPanelActive) {
    appState.detailEntryMode = "chart";
    setChartPanelActive(false);
  }
  tourController.stop();
  appState.selectedCountry = country;
  elements.tooltip.hidden = true;
  recordRecentCountry(country.iso3);
  renderCountryDetail();
  syncUrlFromState();
}

function renderCountryDetail(options = { animate: true }) {
  const country = appState.selectedCountry;
  if (!country || appState.currentYearIndex < 0) return;
  assertElements(elements, COUNTRY_DETAIL_ELEMENT_KEYS, "country detail");
  // Both chart builders derive their viewBox from the rendered SVG size.
  // Make the panel measurable before building them; rendering while hidden
  // makes clientWidth/clientHeight zero and forces fallback dimensions that
  // `preserveAspectRatio="none"` then stretches into the responsive layout.
  detailOverlay.close({ restoreFocus: false });
  countryOverlay.open({ focus: false });
  countryDetailController.render(country, options);
  if (options.animate !== false) countryOverlay.open();
  updateViewModeAvailability();
}

function setProjectionScenario(scenario, { sync = true } = {}) {
  if (!isProjectionScenario(scenario)) return;
  if (scenario === projectionData.scenario()) {
    if (elements.chartProjectionScenario) {
      elements.chartProjectionScenario.value = scenario;
    }
    if (sync) syncUrlFromState();
    return;
  }
  projectionData.setScenario(scenario);
  if (elements.chartProjectionScenario) {
    elements.chartProjectionScenario.value = scenario;
  }

  if (appState.chartPanelActive) {
    chartController.renderChart();
    chartController.renderTable();
  } else if (appState.clusterActive) {
    clusterController.refreshData(appState.currentYearIndex);
    if (appState.currentYearIndex >= 0) updateYearLabels(yearsData[appState.currentYearIndex]);
  } else if (lifetimeController?.isActive()) {
    lifetimeController.render();
    if (appState.currentYearIndex >= 0) updateYearLabels(yearsData[appState.currentYearIndex]);
  } else if (appState.currentYearIndex >= 0) {
    applyYear(yearsData[appState.currentYearIndex], { instant: true });
    if (appState.selectedCountry) renderCountryDetail({ animate: false });
  }

  if (sync) syncUrlFromState();
}

// Population comes from the dots dataset (same series peakYear/dots are
// built from); every other chart metric comes from the demographics file,
// keyed and indexed identically to yearsData.
const chartController = createChartController({
  elements,
  getCountries: () => countriesData,
  getYears: () => yearsData,
  getDemographicMetrics: () => countryDemographicMetrics,
  getPopulationSeries: activePopulationSeries,
  getSelectedCountries: () => appState.selectedChartCountries,
  getMetricKey: () => appState.chartMetricKey,
  setMetricKey: (key) => {
    appState.chartMetricKey = key;
  },
  getCurrentYearIndex: () => appState.currentYearIndex,
  setCurrentYearIndex: (index) => {
    appState.currentYearIndex = index;
  },
  getHistoricalCutoffYear: () => appState.historicalCutoffYear,
  getPickerExpanded: () => appState.chartCountryPickerExpanded,
  setPickerExpanded: (expanded) => {
    appState.chartCountryPickerExpanded = expanded;
  },
  getTableSort: () => appState.chartTableSort,
  setTableSort: (sort) => {
    appState.chartTableSort = sort;
  },
  showTooltip: showChartTooltip,
  hideTooltip: hideChartTooltip,
  stopTour: () => tourController.stop(),
  commitYear: goToYear,
  onOpenCountry: openCountryDetail,
  syncUrl: syncUrlFromState,
});

let searchCountryCombobox;

// --- Cluster view (physics-based demographic clustering) -----------------
// Canvas rendering, physics, hit-testing, and phase-specific annotations live
// in cluster-controller.mjs. This file retains only app-level view orchestration.
const clusterController = createClusterController({
  canvas: elements.clusterCanvas,
  getCountries: () => countriesData,
  getYears: () => yearsData,
  chartSeriesFor: chartController.chartSeriesFor,
  valueAtYear: chartController.valueAtFractionalYear,
  colorFor: (country, mode) =>
    `#${colorFor(country, mode).getHexString()}`,
  showTooltip: showChartTooltip,
  hideTooltip: hideChartTooltip,
  showArchetypeTooltip: showClusterArchetypeTooltip,
  hideArchetypeTooltip: hideClusterArchetypeTooltip,
  onCountryClick: (country) => {
    // Remembered (see appState.detailEntryMode) so closing the detail panel back
    // out restores Cluster instead of landing on whichever of Globe/Map
    // is underneath.
    appState.detailEntryMode = "cluster";
    setClusterActive(false);
    openCountryDetail(country);
  },
});

// Shared by every setXActive(active) toggle below (and the initial
// bind-events setup) — #appState.viewMode stays visible while a full-screen overlay
// (Search/Chart/Cluster) is open rather than being hidden behind it, so its
// "active" highlight has to track that overlay's own mode string instead of
// just the underlying Globe/Map appState.viewMode.
function syncViewModeButtons(activeMode) {
  elements.viewMode.querySelectorAll("button").forEach((btn) =>
    btn.classList.toggle("active", btn.dataset.mode === activeMode),
  );
}

const clusterViewLifecycle = createClusterViewLifecycle({
  state: appState,
  view: elements.clusterView,
  updateUiState,
  assertReady: () =>
    assertElements(elements, ["clusterView", "clusterCanvas"], "cluster view"),
  syncModeButtons: syncViewModeButtons,
  underlyingMode: () => appState.viewMode,
  stopTour: () => tourController.stop(),
  enter: () => {
    ensureCountryDemographics();
    updateColorModeControls(clusterController.getColorMode());
    renderLegend();
    clusterController.activate(appState.currentYearIndex);
    if (appState.currentYearIndex >= 0) {
      applyClusterStatus(yearsData[appState.currentYearIndex]);
    }
  },
  exit: () => {
    stopClusterPlayback();
    clusterController.deactivate();
    updateColorModeControls(appState.colorMode);
    renderLegend();
    // Forces the next applyClusterStatus() call (reactivating, possibly at
    // a different year) to treat it as a fresh chapter instead of a no-op
    // just because it happens to match whatever was cached from this visit.
    appState.clusterStatusPeriod = null;
    if (appState.currentYearIndex >= 0) {
      // Cluster took applyYear()'s cheap fast path (see there) while open,
      // leaving the 3D scene stale — catch it up now that it's visible
      // again.
      applyYear(yearsData[appState.currentYearIndex], { instant: true });
    }
  },
  syncUrl: syncUrlFromState,
});

function setClusterActive(active) {
  clusterViewLifecycle.setActive(active);
}

function setLifetimeActive(active, options) {
  lifetimeRequestedActive = active;
  if (active) {
    ensureCountryDemographics();
    ensureCountryTrajectory();
    ensureCountryAgeStructure();
    return ensureLifetimeController().then((controller) => {
      if (lifetimeRequestedActive) controller.setActive(true, options);
    });
  }
  lifetimeController?.setActive(active, options);
}

async function ensureLifetimeController() {
  if (lifetimeController) return lifetimeController;
  lifetimeControllerPromise ??= import("./lifetime-controller.mjs").then(
    ({ createLifetimeController }) => {
      lifetimeController = createLifetimeController({
        elements,
        getCountryTrajectory: () => countryTrajectory,
        getCountries: () => countriesData,
        getYears: () => yearsData,
        getGlobalMetricsByYear: activeGlobalMetricsMap,
        getPopulationSeries: activePopulationSeries,
        getProjectionScenario: () => projectionData.scenario(),
        getCountryDemographicMetrics: () => countryDemographicMetrics,
        getCountryAgeStructure: () => countryAgeStructure,
        getViewMode: () => appState.viewMode,
        formatPopulation: formatPeakPopulation,
        goToYear,
        syncUrl: syncUrlFromState,
        stopTour: () => tourController.stop(),
        catchUpScene: () => {
          if (appState.currentYearIndex >= 0) {
            applyYear(yearsData[appState.currentYearIndex], { instant: true });
          }
        },
        updateUiState,
        onOpenCountry: (country) => {
          appState.detailEntryMode = "lifetime";
          setLifetimeActive(false, { preserveStory: true });
          openCountryDetail(country);
        },
      });
      lifetimeController.bindEvents();
      lifetimeController.setBirthYearMax();
      return lifetimeController;
    },
  );
  return lifetimeControllerPromise;
}

// --- Recently viewed countries ---------------------------------------------
// Persisted across sessions (localStorage) so the search bar can offer a
// quick way back in before the user has typed anything. Recorded from
// openCountryDetail() — the single funnel every entry point (search, group
// table, dot clicks, similar-countries, the Lifetime "Explore Dataset" link,
// deep-linked URLs) already opens a country detail through.
const RECENT_COUNTRIES_STORAGE_KEY = "recentCountries";
const RECENT_COUNTRIES_LIMIT = 5;

function getRecentCountryIsos() {
  try {
    const stored = JSON.parse(
      localStorage.getItem(RECENT_COUNTRIES_STORAGE_KEY) ?? "[]",
    );
    return Array.isArray(stored) ? stored : [];
  } catch {
    return [];
  }
}

function recordRecentCountry(iso3) {
  if (!iso3) return;
  const withoutCurrent = getRecentCountryIsos().filter(
    (code) => code !== iso3,
  );
  const next = [iso3, ...withoutCurrent].slice(0, RECENT_COUNTRIES_LIMIT);
  try {
    localStorage.setItem(RECENT_COUNTRIES_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable (private browsing, quota, etc.) — recent-countries
    // is a convenience, not core functionality, so just skip persisting.
  }
}

// Resolved against the live country list (rather than trusted blindly) so a
// stale iso3 from an older dataset version can't produce a broken entry.
function getRecentCountries() {
  const isos = getRecentCountryIsos();
  return isos
    .map((iso3) => countriesData.find((country) => country.iso3 === iso3))
    .filter(Boolean);
}

// --- Search view ----------------------------------------------------------
// A full, alphabetized country list plus a single-select chip search bar.
// Picking a country (from the list or the search box) opens the shared
// country-detail overlay on top; the button dock and search bar stay pinned
// (see the body.view-search.detail CSS override) so the chip's X is the way
// back to the bare list.
const SEARCH_SUGGESTION_LIMIT = 8;

const searchViewLifecycle = createSearchViewLifecycle({
  state: appState,
  view: elements.searchView,
  bar: elements.searchBar,
  updateUiState,
  assertReady: () =>
    assertElements(
      elements,
      ["searchView", "searchBar", "searchCategoryGrid", "searchCountryGrid", "searchCountryInput"],
      "search view",
    ),
  syncModeButtons: syncViewModeButtons,
  underlyingMode: () => appState.viewMode,
  stopTour: () => tourController.stop(),
  prepare: () => {
    appState.searchSelectedIso3 = null;
    renderCategoryGrid();
    renderSearchCountryGrid();
    renderSearchCountryChip();
    elements.searchCountryInput.value = "";
    searchCountryCombobox?.hide();
  },
  teardown: () => {
    // Leaving search entirely tears down any open detail this view opened,
    // without routing through closeDetailPanel() (whose "search" restore
    // would just reactivate this view). appState.detailEntryMode is cleared first for
    // the same reason.
    if (appState.selectedCountry && appState.detailEntryMode === "search") {
      appState.detailEntryMode = null;
      countryDetailController.reset();
      appState.selectedCountry = null;
      countryOverlay.close({ restoreFocus: false });
      updateViewModeAvailability();
      renderLegend();
      if (appState.currentYearIndex >= 0) {
        updateStatusPanel(yearsData[appState.currentYearIndex], { instant: true });
      }
    }
    appState.searchSelectedIso3 = null;
    renderSearchCountryChip();
  },
  syncUrl: syncUrlFromState,
});

function setSearchActive(active) {
  searchViewLifecycle.setActive(active);
}

function renderCategoryGrid() {
  // const categories = [...AGE_CATEGORIES, ...MIGRATION_CATEGORIES];
  // let items = categories.map((item, index) => {
  //   const button = document.createElement("button");
  //   button.className = "search-category-item";
  //   button.dataset.mode = item.mode;
  //   button.dataset.key = item.key;
  //   button.dataset.label = item.label;
  //   button.dataset.color = item.color;
  //   if (item.sortKey) button.dataset.sortKey = item.sortKey;
  //   if (item.sortDirection) button.dataset.sortDirection = item.sortDirection;
  //   button.textContent = displayGroupLabel(item.label);
  //   return button;
  // });
  const items = getDetailNav();
  elements.searchCategoryGrid.replaceChildren(...items);
}

function renderSearchCountryGrid() {
  const sortedCountries = [...countriesData].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  preloadFlagIcons(sortedCountries.map((country) => country.iso3));
  const items = sortedCountries
    .map((country, index) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "search-country-item";
      item.dataset.iso3 = country.iso3;
      const flag = document.createElement("span");
      flag.className = "search-country-item-flag";
      flag.style.backgroundImage = `url(${flagIconUrl(country.iso3)})`;
      const label = document.createElement("span");
      label.textContent = country.name;
      item.append(flag, label);
      return item;
    });
  elements.searchCountryGrid.replaceChildren(...items);
}

function renderSearchCountryChip() {
  const country =
    appState.searchSelectedIso3 &&
    countriesData.find((c) => c.iso3 === appState.searchSelectedIso3);
  elements.searchCountryPicker.classList.toggle("has-selection", !!country);
  if (!country) {
    elements.searchCountryChips.replaceChildren();
    return;
  }
  preloadFlagIcons([country.iso3]);
  const chip = document.createElement("span");
  chip.className = "chip";
  const flag = document.createElement("span");
  flag.className = "chip-flag";
  flag.style.backgroundImage = `url(${flagIconUrl(country.iso3)})`;
  const label = document.createElement("span");
  label.textContent = country.name;
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "chip-remove";
  remove.dataset.iso3 = country.iso3;
  remove.setAttribute("aria-label", `Remove ${country.name}`);
  const icon = document.createElement("span");
  icon.className = "material-symbols-outlined";
  icon.textContent = "close";
  remove.append(icon);
  chip.append(flag, label, remove);
  elements.searchCountryChips.replaceChildren(chip);
}

function selectSearchCountry(iso3) {
  const country = countriesData.find((c) => c.iso3 === iso3);
  if (!country) return;
  appState.searchSelectedIso3 = iso3;
  renderSearchCountryChip();
  elements.searchCountryInput.value = "";
  searchCountryCombobox?.hide();
  // Remembered so closeDetailPanel() returns here (see its "search" branch)
  // rather than to whichever of Globe/Map is underneath.
  appState.detailEntryMode = "search";
  openCountryDetail(country);
}

// A category tile in the search view's grid opens the same group-detail
// panel #detailNav's own age/migration items do — same as selectSearchCountry
// above, appState.detailEntryMode is set first so closing the panel comes back here
// instead of Globe/Map.
function selectSearchCategory(mode, key, label, color, sortKey, sortDirection) {
  appState.detailEntryMode = "search";
  selectDetailGroup(mode, key, label, color, sortKey, sortDirection);
}

// Both ways out of a selection — the chip's X and the detail panel's own
// close button — funnel through closeDetailPanel()'s "search" restore, which
// clears the chip and re-shows the list.
function clearSearchCountry() {
  if (appState.selectedCountry && appState.detailEntryMode === "search") {
    closeDetailPanel();
  } else {
    appState.searchSelectedIso3 = null;
    renderSearchCountryChip();
    syncUrlFromState();
  }
  elements.searchCountryInput?.focus();
}


function capitalizeFirstLetter(str) {
  if (!str) return ""; // Handle empty strings safely
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function badgeLabel() {
  return yearsData[appState.currentYearIndex] < appState.historicalCutoffYear
    ? `Historical`
    : `${capitalizeFirstLetter(projectionData.scenario())} Projection`;
}

// Chart is a full-screen overlay, not a real member of the Globe/Map
// toggle's selection state — opening it never touches which of those two
// is "active", so whichever was selected before is still the one shown
// (and still marked active) once the overlay closes.
const chartViewLifecycle = createChartViewLifecycle({
  state: appState,
  panel: elements.chartPanel,
  updateUiState,
  assertReady: () =>
    assertElements(elements, CHART_VIEW_ELEMENT_KEYS, "chart view"),
  syncModeButtons: syncViewModeButtons,
  underlyingMode: () => appState.viewMode,
  stopTour: () => tourController.stop(),
  render: () => {
    ensureCountryDemographics();
    chartController.renderChart({ animate: true });
    chartController.renderTable();
  },
  closeCountryPicker: () => {
    // Always reopens collapsed, regardless of how it was left — an editor
    // left expanded from last time isn't state worth remembering the way
    // the selected countries themselves are.
    chartController.setCountryPickerExpanded(false);
  },
  cancelAnimation: () => chartController.cancelAnimation(),
  catchUpScene: () => {
    if (appState.currentYearIndex < 0) return;
    // While the overlay was open, applyYear() took its chart-only fast path
    // and left the 3D scene stale (still showing whatever year it had
    // before) — catch it up now that it's visible again. instant: true
    // skips #status's typewriter replay here — chart view already showed
    // this year's own text (via renderChart/renderTable) the whole time, so
    // retyping it from scratch on close would just be redundant animation.
    applyYear(yearsData[appState.currentYearIndex], { instant: true });
  },
  syncUrl: syncUrlFromState,
});

function setChartPanelActive(active) {
  chartViewLifecycle.setActive(active);
}

const THEME_STORAGE_KEY = "theme"; // must match the inline <head> script in index.html

function updateThemeToggleUI() {
  const isLight = appState.currentTheme === "light";
  elements.themeToggle?.setAttribute(
    "aria-pressed",
    String(!isLight),
  );
  elements.themeToggleLight?.setAttribute("aria-pressed", String(isLight));
  elements.themeToggle?.classList.toggle("active", !isLight);
  elements.themeToggleLight?.classList.toggle("active", isLight);

  const legacyIcon = elements.themeToggle?.querySelector(
    ".material-symbols-outlined",
  );
  if (legacyIcon) {
    elements.themeToggle.setAttribute(
      "aria-label",
      isLight ? "Switch to dark theme" : "Switch to light theme",
    );
    legacyIcon.textContent = isLight ? "dark_mode" : "light_mode";
  }
}

// Most of the app's colors are plain CSS var() references (region/income
// swatches, chart lines, group-detail panels) and repaint for free the
// instant the theme's custom properties change, via the ordinary cascade —
// no JS involved. The few exceptions are values baked into something other
// than a live CSS property at the moment they were built: the GPU dot color
// buffer, cached hover-fill mesh materials, peak-callout label colors,
// (only while a single country's own detail panel is open) --detail-color,
// which is resolved to a literal hex rather than left as a var() reference
// because colorFor() also has to double as a THREE.Color for the globe, and
// the Cluster view's canvas — its archetype titles and particle labels are
// resolveCssColor()'d straight to literal pixels at draw time, which only
// happens on the next simulation tick; once the simulation settles (alpha
// decays to 0) nothing repaints it on its own, so a toggle while Cluster is
// open would otherwise leave stale-theme text frozen on screen.
// Those are exactly what this re-derives and pushes out again.
function applyTheme(theme, { persist = true } = {}) {
  if (theme === appState.currentTheme) return;
  appState.currentTheme = theme;
  document.documentElement.dataset.theme = theme;
  if (persist) localStorage.setItem(THEME_STORAGE_KEY, theme);
  updateThemeToggleUI();

  if (!countriesData.length) return; // toggled before data loaded — nothing baked yet
  countriesData.forEach((country) => {
    country._regionColor = regionColor(country.region);
    country._incomeColor = incomeColor(country._incomeLabel);
  });
  clearHoverCountryFill();
  clearHoverFillCache();
  recolor();
  if (appState.currentYearIndex >= 0) {
    calloutController.rebuild(yearsData[appState.currentYearIndex]);
  }
  if (appState.selectedCountry && !elements.countryPanel.hidden) {
    elements.countryPanel.style.setProperty(
      "--detail-color",
      `#${colorFor(appState.selectedCountry).getHexString()}`,
    );
  }
  if (clusterController.isActive()) clusterController.redraw();
  // Chart-view line/legend colors are var() references too, except the chip
  // text color — chosen per-chip by contrast against the chip's background
  // at render time, and *baked in as one of two variable names*
  // (--color-bg/--color-text). Those two swap which one is actually the
  // darker/lighter option between themes, so a decision made before this
  // toggle is now backwards, not just stale — this needs to re-run
  // regardless of whether chart view happens to be open right now, or it
  // stays wrong (inverted, not just outdated) until something else happens
  // to touch the chip list (adding/removing a country).
  chartController.renderCountryChips();
}

function updateColorModeControls(mode) {
  elements.colorMode
    .querySelectorAll("button")
    .forEach((btn) =>
      btn.classList.toggle("active", btn.dataset.mode === mode),
    );
}

function setClusterColorMode(mode) {
  if (mode === clusterController.getColorMode()) return;
  clusterController.setColorMode(mode);
  updateColorModeControls(mode);
  renderLegend();
}

function setColorMode(mode) {
  if (mode === appState.colorMode) return;
  const keepDetailOpen = appState.selectedLegend && !elements.detailPanel.hidden;
  appState.colorMode = mode;
  updateColorModeControls(mode);

  if (keepDetailOpen) {
    // Switching Region/Income while browsing a group's detail should let
    // the user keep exploring, not boot them back to the globe — land on
    // that mode's first legend entry instead of closing the panel.
    const [label, color] = legendEntriesFor(mode)[0];
    appState.selectedLegend = { mode, key: label, label, color };
  } else {
    appState.selectedLegend = null;
    detailOverlay.close({ restoreFocus: false });
    updateViewModeAvailability();
  }
  recolor();
  if (keepDetailOpen) renderDetailPanel();
  calloutController.rebuild(yearsData[appState.currentYearIndex]);
  syncUrlFromState();
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
    .setLength(VIEW_CONFIG.globe.cameraDistance)
    .add(target);
}

// Points the GPU morph at a new pair of endpoints (see DOT_VERTEX_SHADER) —
// called once when a transition starts (from -> scramble) and once more
// when it flies back out (scramble -> to), rather than every frame.
function setMorphEndpoints(fromArr, toArr) {
  const morphFrom = pointsMesh.geometry.getAttribute("aMorphFrom");
  const morphTo = pointsMesh.geometry.getAttribute("aMorphTo");
  morphFrom.array.set(fromArr);
  morphTo.array.set(toArr);
  morphFrom.needsUpdate = true;
  morphTo.needsUpdate = true;
}

function applySettledViewControls() {
  controls.enabled = true;
  if (appState.viewMode === "globe") {
    controls.enableRotate = true;
    controls.enablePan = false;
    controls.autoRotate = true;
    controls.autoRotateSpeed = VIEW_CONFIG.globe.autoRotateSpeed;
    controls.minDistance = VIEW_CONFIG.globe.minDistance;
    controls.maxDistance = VIEW_CONFIG.globe.maxDistance;
    // Restores OrbitControls' own defaults (left-drag rotates, one-finger
    // touch rotates) — needed because map mode below overwrites them on the
    // same shared `controls` instance, and switching back to globe would
    // otherwise leave left-drag silently mapped to an action (pan) that
    // enablePan just turned off, breaking rotate entirely.
    controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    controls.touches.ONE = THREE.TOUCH.ROTATE;
  } else {
    controls.enableRotate = false;
    controls.enablePan = true;
    controls.autoRotate = false;
    controls.minDistance = VIEW_CONFIG.map.minDistance;
    controls.maxDistance = VIEW_CONFIG.map.maxDistance;
    // OrbitControls' default left-drag action is ROTATE, gated behind
    // enableRotate — which is false here, so a plain left-drag hit that
    // gate and did nothing (pan was only reachable via Ctrl/Shift+drag or
    // the right mouse button — neither discoverable). Remapping left-drag
    // (and one-finger touch) straight to PAN is what actually makes
    // dragging the canvas pan in map mode.
    controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
    controls.touches.ONE = THREE.TOUCH.PAN;
  }
  // Map is the only mode where dragging the canvas pans rather than orbits
  // or does nothing — the grab cursor is the only hint that's true, since
  // nothing else about a flat field of dots suggests it's draggable.
  renderer.domElement.classList.toggle("pannable", appState.viewMode === "map");
}

// Keeps map pan from wandering the camera off into empty space with no way
// back short of switching views and back — clamps controls.target (what the
// map-mode camera, at a fixed offset with rotation disabled, is effectively
// centered on) to the map's own bounds plus one screen-ish of slack, moving
// the camera by the same delta so the offset — and therefore zoom — doesn't
// change underneath the clamp.
function clampMapPanTarget() {
  if (appState.viewMode !== "map" || transition) return;
  const maxX = VIEW_CONFIG.map.width * 0.75;
  const maxY = VIEW_CONFIG.map.height * 0.75;
  const clampedX = THREE.MathUtils.clamp(controls.target.x, -maxX, maxX);
  const clampedY = THREE.MathUtils.clamp(controls.target.y, -maxY, maxY);
  const dx = clampedX - controls.target.x;
  const dy = clampedY - controls.target.y;
  if (dx === 0 && dy === 0) return;
  controls.target.x = clampedX;
  controls.target.y = clampedY;
  camera.position.x += dx;
  camera.position.y += dy;
}
controls.addEventListener("change", clampMapPanTarget);

// URL-selected map mode is initial state, not a user-triggered transition.
// Configure the camera, controls, material, and dot sizing before the first
// population layout is written so the globe never flashes or scrambles in.
function initializeViewMode(mode) {
  if (mode !== "map") return;
  appState.viewMode = "map";
  camera.position.set(0, 0, VIEW_CONFIG.map.cameraDistance);
  controls.target.set(0, 0, 0);
  setDotSize(VIEW_CONFIG.map.dotSize);
  pointsMesh.material.uniforms.uIsMap.value = 1;
  applySettledViewControls();
  controls.update();
}

// Snaps an interrupted morph to the destination view. applyYear() immediately
// rewrites the position buffer after this; this helper owns all the remaining
// transition state that otherwise survives in the shader/camera/controls.
function settleViewTransition() {
  if (!transition) return;
  camera.position.copy(transition.toCamPos);
  controls.target.copy(transition.toTarget);
  setDotSize(transition.toDotSize);
  pointsMesh.material.uniforms.uMorphActive.value = 0;
  pointsMesh.material.uniforms.uMorphT.value = 0;
  transition = null;
  isScrambledPhase = false;
  isHoldPhase = false;
  applySettledViewControls();
}

function setViewMode(mode) {
  if (mode === appState.viewMode || !activeTotal) return;

  const fromPositions = basePositions.slice(0, activeTotal * 3);
  const scramblePositions = computeScramblePositions(activeTotal);
  const toPositions = computeTargetPositions(mode);
  appState.viewMode = mode;
  // Anchors are computed from the globe/map basis, so a mode toggle needs
  // its own rebuild even though the selected year hasn't changed.
  calloutController.rebuild(yearsData[appState.currentYearIndex]);

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
      ? new THREE.Vector3(0, 0, VIEW_CONFIG.map.cameraDistance)
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
    toDotSize:
      mode === "map" ? VIEW_CONFIG.map.dotSize : VIEW_CONFIG.globe.dotSize,
    start: performance.now(),
    // Whether the scramble -> final-formation GPU endpoints have been set
    // yet — flips once, the first frame updateTransition() sees elapsed
    // cross into the out phase.
    outPhaseStarted: false,
  };
  setMorphEndpoints(fromPositions, scramblePositions);
  pointsMesh.material.uniforms.uMorphActive.value = 1;
  pointsMesh.material.uniforms.uMorphT.value = 0;
  // Auto-rotate is stopped immediately (rather than only once the fly-out
  // phase begins) and the camera glides toward its final position across
  // the whole transition below — letting it keep spinning through the
  // scramble made the final heading unpredictable, which meant the camera
  // sometimes had to cover a large arc in a hurry after the dots had
  // already settled into place. That mismatch read as a jarring, delayed
  // "snap" rather than the two animating together.
  controls.enabled = false;
  controls.autoRotate = false;
  renderer.domElement.classList.remove("pannable");

  elements.viewMode
    .querySelectorAll("button")
    .forEach((btn) =>
      btn.classList.toggle("active", btn.dataset.mode === mode),
    );
  syncUrlFromState();
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

  // Only a single float (uMorphT) needs computing here each frame now —
  // the GPU does the actual position lerp (see DOT_VERTEX_SHADER) between
  // whichever pair of endpoints setViewMode()/the out-phase branch below
  // last wrote into aMorphFrom/aMorphTo.
  let morphT;
  isHoldPhase = false;
  if (elapsed < SCRAMBLE_IN_MS) {
    morphT = easeInCubic(Math.min(1, elapsed / SCRAMBLE_IN_MS));
    isScrambledPhase = true;
  } else if (elapsed < outPhaseStart) {
    // Holding at the scramble cloud is just "fully at aMorphTo" (already
    // scramblePositions from the in-phase) — no attribute rewrite needed.
    morphT = 1;
    isScrambledPhase = true;
    isHoldPhase = true;
  } else {
    if (!transition.outPhaseStarted) {
      transition.outPhaseStarted = true;
      setMorphEndpoints(transition.scramblePositions, transition.toPositions);
    }
    morphT = easeOutCubic(
      Math.min(1, (elapsed - outPhaseStart) / SCRAMBLE_OUT_MS),
    );
    isScrambledPhase = false;
  }
  pointsMesh.material.uniforms.uMorphT.value = morphT;

  const camE = easeInOutCubic(overallT);
  camera.position.lerpVectors(transition.fromCamPos, transition.toCamPos, camE);
  controls.target.lerpVectors(transition.fromTarget, transition.toTarget, camE);
  setDotSize(
    transition.fromDotSize +
      (transition.toDotSize - transition.fromDotSize) * camE,
  );

  if (overallT >= 1) {
    // Settle the CPU-side base positions (read by applyYear()'s per-year
    // rebuild and by raycasting) to match where the GPU morph ended up, and
    // hand rendering back to the plain `position` attribute now that
    // there's no morph left to track.
    basePositions.set(transition.toPositions);
    const posAttr = pointsMesh.geometry.getAttribute("position");
    posAttr.array.set(
      basePositions.subarray(0, transition.toPositions.length),
    );
    posAttr.needsUpdate = true;
    pointsMesh.material.uniforms.uMorphActive.value = 0;

    transition = null;
    isScrambledPhase = false;
    isHoldPhase = false;
    applySettledViewControls();
  }
}

// The following bind*Events() functions each wire up one cohesive area of
// the UI (year slider, color mode, legend, ...) — split out of init() so
// that function stays a readable top-to-bottom sequence of named steps
// instead of one flat run of ~30 addEventListener calls. Each is called
// exactly once, from init(), in the same order this wiring always ran in.

function bindYearSliderEvents({ minYear, maxYear, defaultYear }) {
  elements.yearSlider.min = minYear;
  elements.yearSlider.max = maxYear;
  elements.yearSlider.step = 1;
  elements.yearSlider.value = defaultYear;
  // elements.yearControl.hidden = false;
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
    // Cluster particles are cheap to reposition (no dot-buffer rewrite
    // like the 3D scene needs), so — unlike the globe/map content below —
    // they get to move live during the drag itself rather than waiting
    // for "change". The chapter caption rides along too (it's cheap: a
    // no-op unless the drag actually crossed into a new period) — without
    // it, dragging from one end of the timeline to the other would show
    // "The Postwar Boom" the entire time and only jump to the right
    // chapter once the drag is released, well after the particles
    // themselves had already moved on.
    if (appState.clusterActive) {
      const year = Number(elements.yearSlider.value);
      clusterController.setYear(year);
      applyClusterStatus(year);
    }
  });
  elements.yearSlider.addEventListener("change", () => {
    applyYear(Number(elements.yearSlider.value));
  });
  // "pointerdown" (not "input"/"change") is the tour's cue to stop, since
  // goToYear() itself only dispatches "input"/"change" — using those to
  // cancel would make the tour immediately cancel its own steps. Same
  // reasoning covers the cluster sweep, which drives the slider the same way.
  elements.yearSlider.addEventListener("pointerdown", () => {
    tourController.stop();
    stopClusterPlayback();
  });
  elements.yearSlider.addEventListener("pointermove", updateYearHoverLabel);
}

function bindColorModeEvents() {
  elements.colorMode.hidden = false;
  elements.colorMode.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (appState.clusterActive) {
        setClusterColorMode(btn.dataset.mode);
      } else {
        setColorMode(btn.dataset.mode);
      }
    });
  });
}

function bindLegendEvents() {
  elements.legend.addEventListener("click", (event) => {
    const item = event.target.closest(".legend-item[data-label]");
    if (!item || !elements.legend.contains(item)) return;
    // Remembered (see appState.detailEntryMode) so closing the detail panel
    // back out restores Cluster instead of landing on whichever of
    // Globe/Map is underneath.
    if (appState.clusterActive) {
      appState.detailEntryMode = "cluster";
      setClusterActive(false);
    }
    selectLegendItem(
      item.dataset.label,
      item.dataset.color,
      item.dataset.mode,
    );
  });
}

function bindDetailNavEvents() {
  elements.detailNav?.addEventListener("click", (event) => {
    const item = event.target.closest(".detail-nav-item[data-key]");
    if (!item || !elements.detailNav.contains(item)) return;
    const { mode, key, label, color, sortKey, sortDirection } = item.dataset;
    if (mode === "region" || mode === "income") {
      selectLegendItem(label, color, mode);
    } else {
      selectDetailGroup(mode, key, label, color, sortKey, sortDirection);
    }
  });
}

function bindViewRouter() {
  elements.viewMode.hidden = false;
  syncViewModeButtons(appState.viewMode);
  const lifetimeViewLifecycle = {
    name: "lifetime",
    isActive: () => lifetimeRequestedActive,
    activate: (options) => setLifetimeActive(true, options),
    deactivate: (options) => setLifetimeActive(false, options),
  };
  const viewRouter = createViewRouter({
    lifecycles: [
      searchViewLifecycle,
      chartViewLifecycle,
      clusterViewLifecycle,
      lifetimeViewLifecycle,
    ],
    setBaseView: setViewMode,
    closeMenu: () => {
      updateUiState({ menuOpen: false });
      elements.menuToggle.setAttribute("aria-expanded", "false");
    },
  });
  viewRouter.bind(elements.viewMode);
}

function bindChartControlsEvents() {
  assertElements(elements, CHART_VIEW_ELEMENT_KEYS, "chart controls");
  elements.chartProjectionScenario.value = projectionData.scenario();
  // updateProjectionScenarioVisibility();
  elements.chartProjectionScenario.addEventListener("change", () => {
    const scenario = elements.chartProjectionScenario.value;
    setProjectionScenario(scenario);
  });
  chartController.bindEvents();
  chartController.renderMetricTabs();
  chartController.renderCountryChips();
}

function bindSearchViewEvents() {
  // Search view: full list + single-select chip search bar.
  elements.searchCountryGrid.addEventListener("click", (event) => {
    const item = event.target.closest(".search-country-item[data-iso3]");
    if (!item || !elements.searchCountryGrid.contains(item)) return;
    selectSearchCountry(item.dataset.iso3);
  });
  elements.searchCategoryGrid?.addEventListener("click", (event) => {
    const item = event.target.closest(".detail-nav-item[data-key]");
    if (!item || !elements.searchCategoryGrid.contains(item)) return;
    const { mode, key, label, color, sortKey, sortDirection } = item.dataset;
    if (mode === "region" || mode === "income") {
      appState.detailEntryMode = "search";
      selectLegendItem(label, color, mode);
    } else {
      selectSearchCategory(mode, key, label, color, sortKey, sortDirection);
    }
  });
  elements.searchCountryChips.addEventListener("click", (event) => {
    const button = event.target.closest(".chip-remove[data-iso3]");
    if (!button || !elements.searchCountryChips.contains(button)) return;
    clearSearchCountry();
  });
  searchCountryCombobox = createCountryCombobox({
    input: elements.searchCountryInput,
    list: elements.searchCountrySuggestions,
    container: elements.searchCountryPicker,
    getCandidates: (query) =>
      query
        ? matchCountries(query, {
            countries: countriesData,
            convertCode: convertAlpha3ToAlpha2,
            limit: SEARCH_SUGGESTION_LIMIT,
          })
        : getRecentCountries(),
    onSelect: (country) => selectSearchCountry(country.iso3),
    flagUrl: flagIconUrl,
    preloadFlags: preloadFlagIcons,
    renderPrefix: (query) => {
      if (query) return null;
      const label = document.createElement("div");
      label.className = "chip-suggestions-label";
      label.textContent = "Recently viewed";
      return label;
    },
  });
}

function bindPanelCloseEvents() {
  elements.detailClose.addEventListener("click", closeDetailPanel);
  elements.countryClose.addEventListener("click", closeCountryDetail);
  elements.infoButton.addEventListener("click", openInfoPanel);
  elements.infoClose.addEventListener("click", closeInfoPanel);
  // elements.detailBack.addEventListener("click", () => {
  //   if (appState.selectedCountry) {
  //     closeCountryDetail();
  //   } else {
  //     closeDetailPanel();
  //   }
  // });
}

function bindMilestoneEvents() {
  elements.milestonePrev.addEventListener("click", () => stepMilestone(-1));
  elements.milestoneNext.addEventListener("click", () => stepMilestone(1));
  // Cluster repurposes this same button for its own once-through 1950-2100
  // sweep instead of the milestone-hopping tour — see playClusterTimelineOnce.
  elements.milestoneTour.addEventListener("click", () => {
    if (appState.clusterActive) {
      playClusterTimelineOnce();
    } else {
      tourController.toggle();
    }
  });
  // #exploreMilestones' markup is gone along with the old #milestoneRow —
  // guarded the same way as its .hidden toggle above, rather than
  // assuming it won't come back.
  elements.exploreMilestones?.addEventListener("click", tourController.toggle);
}

function bindMenuEvents() {
  elements.menuToggle.addEventListener("click", () => {
    const { menuOpen } = uiStateRenderer.getState();
    const nextState = updateUiState({ menuOpen: !menuOpen });
    elements.menuToggle.setAttribute(
      "aria-expanded",
      String(nextState.menuOpen),
    );
  });
  elements.menuShim.addEventListener("click", () => {
    updateUiState({ menuOpen: false });
    elements.menuToggle.setAttribute("aria-expanded", "false");
  });
}

function bindThemeEvents() {
  updateThemeToggleUI();
  elements.themeToggle?.addEventListener("click", () => {
    applyTheme("dark");
  });
  elements.themeToggleLight?.addEventListener("click", () => {
    applyTheme("light");
  });
}

async function init() {
  // Captured before anything else runs — applyYear() and friends call
  // syncUrlFromState() as they go, which would otherwise overwrite the
  // deep link's query string with default state before it's ever read.
  const initialSearch = window.location.search;
  try {

    const appData = await loadPopulationData();
    loadCountryDemographicMetrics = appData.loadCountryDemographicMetrics;
    loadCountryTrajectory = appData.loadCountryTrajectory;
    loadCountryAgeStructure = appData.loadCountryAgeStructure;
    loadCountryBorders = appData.loadCountryBorders;
    countriesData = appData.countries;
    yearsData = appData.years;
    preloadFlagIcons(appState.selectedChartCountries);
    appState.historicalCutoffYear = appData.historicalCutoffYear;
    projectionData.configure({
      countries: countriesData,
      years: yearsData,
      historicalCutoffYear: appState.historicalCutoffYear,
      globalMetricsByYear: appData.globalMetricsByYear,
      globalTrendMilestones: appData.globalTrendMilestones,
      highMetricsByYear: appData.highMetricsByYear,
      lowMetricsByYear: appData.lowMetricsByYear,
    });


    setupScene(countriesData, appData.incomeGroups);
    const initialUrlState = parseUrlState(initialSearch, {
      years: yearsData,
      countryCodes: countriesData.map((country) => country.iso3),
    });
    if (initialUrlState.projection) {
      projectionData.setScenario(initialUrlState.projection);
    }
    initializeViewMode(initialUrlState.mode);

    const minYear = yearsData[0];
    const maxYear = yearsData[yearsData.length - 1];
    // Randomized per page load from the same data-driven milestones used in
    // the status copy, rather than maintaining a second hardcoded year list.
    const defaultYears = prioritizedMilestoneYears(activeGlobalTrendMilestones(), {
      minYear,
      maxYear,
    });
    const defaultYear =
      defaultYears[Math.floor(Math.random() * defaultYears.length)] ?? minYear;

    bindYearSliderEvents({ minYear, maxYear, defaultYear });
    bindColorModeEvents();
    bindLegendEvents();
    bindDetailNavEvents();
    bindViewRouter();
    bindChartControlsEvents();
    bindSearchViewEvents();
    bindPanelCloseEvents();
    bindMilestoneEvents();
    bindMenuEvents();
    bindThemeEvents();

    updateSliderProgress();
    applyYear(defaultYear);
    renderLegend();
    applyUrlStateFromLocation(initialSearch);
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

// A one-shot decaying burst (independent of the hold-phase boost above)
// that fires whenever a year selection is actually committed — from the
// slider, the vertical timeline, or a keyboard step — so a change reads as
// a visible "beat" across every dot even if the new year's layout looks
// similar to the last one. Tracked on the wall clock (performance.now())
// rather than the shader's own elapsed-time uniform, since it just needs a
// simple countdown, not continuity with the ambient sine wave.
let yearChangePulseStart = -Infinity;
const YEAR_CHANGE_PULSE_DURATION_MS = 1000;
// Amplitude-only on purpose: the vertex shader's sine wave is
// sin(uTime * aFrequency * uFreqMul + aPhase), and uTime is the *absolute*
// elapsed session time, not something that resets per-pulse. Modulating
// uFreqMul therefore jumps the wave's instantaneous phase rate by an
// amount proportional to however long the page has been open — the same
// pulse looked mild seconds into a session and increasingly chaotic
// minutes in. uAmpMul is a plain linear scale on the output with no such
// dependency, so it stays identical every time regardless of session age.
const YEAR_CHANGE_PULSE_AMP_MULTIPLIER = 3;

function triggerYearChangePulse() {
  yearChangePulseStart = performance.now();
}

function updateDotUniforms(elapsedTime) {
  if (!pointsMesh) return;
  const u = pointsMesh.material.uniforms;
  u.uTime.value = elapsedTime;
  u.uIsMap.value = appState.viewMode === "map" && !isScrambledPhase ? 1 : 0;

  const pulseT = Math.min(
    1,
    (performance.now() - yearChangePulseStart) / YEAR_CHANGE_PULSE_DURATION_MS,
  );
  // Decays fast then tapers off, like a struck bell rather than a linear
  // fade — most of the "snap" reads in the first couple frames.
  const pulseBoost = pulseT < 1 ? (1 - pulseT) ** 2 : 0;

  u.uFreqMul.value = isHoldPhase ? HOLD_FREQ_MULTIPLIER : 1;
  u.uAmpMul.value = isHoldPhase
    ? HOLD_AMPLITUDE_MULTIPLIER
    : 1 + (YEAR_CHANGE_PULSE_AMP_MULTIPLIER - 1) * pulseBoost;
}

renderer.domElement.addEventListener("pointermove", (event) => {
  pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
  lastPointerEvent = event;
  if (!countryBorderHitTester) ensureCountryBorders();
});
renderer.domElement.addEventListener("pointerleave", () => {
  pointer.set(Infinity, Infinity);
  lastPointerEvent = null;
  clearCanvasHover();
});

// Distinguishes an actual click from the end of an orbit-drag (OrbitControls
// doesn't suppress the native "click" event itself) by checking how far the
// pointer moved between down and up, rather than relying on "click" alone.
let canvasPointerDownPos = null;
const CANVAS_CLICK_MAX_DRAG_PX = 6;

function geographicPointAtPointer() {
  if (appState.viewMode === "map") {
    const point = raycaster.ray.intersectPlane(
      hoverMapPlane,
      hoverSurfacePoint,
    );
    if (!point) return null;
    const lon = (point.x / (VIEW_CONFIG.map.width / 2)) * 180;
    const lat = (point.y / (VIEW_CONFIG.map.height / 2)) * 90;
    if (Math.abs(lon) > 180 || Math.abs(lat) > 90) return null;
    return { lon, lat };
  }

  const point = raycaster.ray.intersectSphere(hoverGlobe, hoverSurfacePoint);
  if (!point) return null;
  const lat = THREE.MathUtils.radToDeg(
    Math.asin(point.y / GLOBE_RADIUS),
  );
  const lon = THREE.MathUtils.radToDeg(Math.atan2(-point.z, point.x));
  return { lon, lat };
}

// Shared by click and hover. Once border data is available, ownership comes
// from the geographic polygon under the pointer, not from whichever sparse
// population dot happens to be closest. Particle raycasting remains only as
// a first-hover fallback while the lazy border payload loads.
function hitCountryAtPointer() {
  raycaster.setFromCamera(pointer, camera);
  if (countryBorderHitTester) {
    const geographicPoint = geographicPointAtPointer();
    if (!geographicPoint) return null;
    const iso3 = countryBorderHitTester.countryAt(
      geographicPoint.lon,
      geographicPoint.lat,
    );
    return iso3
      ? countriesData.find((country) => country.iso3 === iso3) ?? null
      : null;
  }
  const hits = raycaster.intersectObject(pointsMesh);
  return hits.length ? dotCountry[hits[0].index] : null;
}

renderer.domElement.addEventListener("pointerdown", (event) => {
  canvasPointerDownPos = { x: event.clientX, y: event.clientY };
});

renderer.domElement.addEventListener("pointerup", (event) => {
  const downPos = canvasPointerDownPos;
  canvasPointerDownPos = null;
  if (!downPos || !pointsMesh || !activeTotal) return;
  const dragDistance = Math.hypot(
    event.clientX - downPos.x,
    event.clientY - downPos.y,
  );
  if (dragDistance > CANVAS_CLICK_MAX_DRAG_PX) return;
  // The `position` attribute stops tracking dots mid-transition (the morph
  // runs entirely on the GPU now — see DOT_VERTEX_SHADER), so a raycast
  // here would hit wherever dots sat before the transition started, not
  // where they visually are. Orbit controls are already disabled for the
  // same window; this just extends that to clicks.
  if (transition) return;

  const country = hitCountryAtPointer();
  if (country) openCountryDetail(country);
});

// Dots are click-to-open-country-detail targets, so the cursor should read
// as such only while actually over one — toggled here rather than for the
// whole canvas, since most of it is just rotate/pan surface.
function clearCanvasHover() {
  elements.tooltip.hidden = true;
  renderer.domElement.classList.remove("hovering-dot");
  clearHoverCountryFill();
}

function updateTooltip(event) {
  if (!pointsMesh || !activeTotal) return;
  // The detail panels (group table or country detail) sit above the canvas
  // and block real clicks/hover from reaching it — but the raycast here
  // runs off whatever pointer position was last seen, so without this check
  // a tooltip from before a panel opened keeps reappearing underneath it.
  if (!elements.detailPanel.hidden || !elements.countryPanel.hidden) {
    clearCanvasHover();
    return;
  }
  // Same reasoning as the pointerup guard above: raycasting mid-transition
  // would test against pre-transition positions, since the morph itself
  // runs on the GPU rather than updating the CPU-side position attribute.
  if (transition) {
    clearCanvasHover();
    return;
  }
  const country = hitCountryAtPointer();
  if (!country) {
    clearCanvasHover();
    return;
  }
  renderer.domElement.classList.add("hovering-dot");
  showHoverCountryFill(country);

  // A country with an active peak-year callout already shows its own
  // "name: population" label on the globe — stacking the hover tooltip
  // right next to it just duplicates the same text.
  if (calloutController.hasCountry(country)) {
    elements.tooltip.hidden = true;
    return;
  }

  const pop = activePopulationAt(country) ?? country.population;
  const groupColor = colorFor(country);

  const tooltipColor = `#${groupColor.getHexString()}`;
  const line1 = createTooltipLine(
    `${country.name} ${formatPeakPopulation(pop)}`,
    tooltipColor,
  );

  const lines = [line1];

  elements.tooltip.hidden = false;
  elements.tooltip.replaceChildren(...lines);
  elements.tooltip.style.setProperty(
    "--tooltip-color",
    tooltipColor,
  );
  const cursorX = event?.clientX ?? 0;
  const cursorY = event?.clientY ?? 0;
  const gap = 24;
  const margin = 80;
  const tooltipWidth = elements.tooltip.offsetWidth;
  const tooltipHeight = elements.tooltip.offsetHeight;
  const fitsOnRight = cursorX + gap + tooltipWidth <= window.innerWidth - margin;
    const tooltipX = fitsOnRight
      ? cursorX + gap
      : Math.max(margin, cursorX - gap - tooltipWidth);
    const tooltipY = Math.min(
      Math.max(margin, cursorY - tooltipHeight / 2),
      window.innerHeight - margin - tooltipHeight,
  );
  elements.tooltip.style.left = `${tooltipX}px`;
  elements.tooltip.style.top = `${tooltipY}px`;
}

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
  calloutController.update();
  renderer.render(scene, camera);
}

function createDebouncedResizeHandler(callback, delay = 120) {
  let timerId = null;
  return () => {
    clearTimeout(timerId);
    timerId = setTimeout(callback, delay);
  };
}

// Panel/canvas subviews each own their own debounce. Sharing one timer meant
// whichever branch ran last during resize could cancel the others.
const resizeCountryDetail = createDebouncedResizeHandler(() => {
  // Re-checked rather than trusting the `appState.selectedCountry` value at resize
  // event time: the panel can close during the debounce window.
  if (!appState.selectedCountry) return;
  countryDetailController.resize(appState.selectedCountry);
});
const resizeTrendChart = createDebouncedResizeHandler(() =>
  chartController.renderChart(),
);
const resizeCluster = createDebouncedResizeHandler(clusterController.resize);

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (appState.currentYearIndex >= 0) {
    updateYearLabels(yearsData[appState.currentYearIndex]);
  }
  if (pointsMesh) {
    pointsMesh.material.uniforms.uScale.value =
      renderer.domElement.height * 0.5;
  }
  if (appState.selectedCountry) {
    resizeCountryDetail();
  }
  if (appState.chartPanelActive) {
    resizeTrendChart();
  }
  if (appState.clusterActive) {
    resizeCluster();
  }
});

init();
animate();
