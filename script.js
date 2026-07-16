import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createCountryFillGeometries } from "./country-fill-geometry.mjs";
import { createCalloutController } from "./callout-controller.mjs";
import { foregroundForColor, resolveCssColor } from "./theme-colors.mjs";
import {
  buildDetailStatus,
  displayGroupLabel,
  prioritizedMilestoneYears,
} from "./status-insights.mjs";
import {
  METRICS,
  formatCount,
} from "./metrics.mjs";
import {
  buildDetailColumns,
  buildDetailRows,
  selectDetailCountries,
  sortDetailCountries,
} from "./detail-table.mjs";
import {
  convertAlpha3ToAlpha2,
  loadPopulationData,
  flagIconUrl
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
import { getAppElements } from "./ui-elements.mjs";
import { buildCountrySummary } from "./country-summary-model.mjs";
import { parseUrlState, serializeUrlState } from "./url-state.mjs";
import {
  adjacentMilestoneYears,
  createTourController,
} from "./tour-controller.mjs";
import { createCountryChartGeometry } from "./country-chart.mjs";
import { createSparklineGeometry } from "./sparkline-chart.mjs";
import { TREND_CHART_PADDING } from "./trend-chart.mjs";
import {
  cancelChartAnimations,
  runChartAnimation,
} from "./chart-animation.mjs";
import {
  buildLinePath,
  chartXFor,
  chartYFor,
  computeValueRange,
} from "./chart-math.mjs";
import { forceSimulation, forceX, forceY, forceCollide } from "d3-force";
import {
  classifyCountry,
  forceStrengthFor,
  radiusForPopulation,
  refineArchetypeForPhase,
  PHASE_ONE_START_YEAR,
  PHASE_ONE_END_YEAR,
} from "./cluster-model.mjs";

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
// its real shape when the chart first appears (see renderTrendChart).
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
  getViewMode: () => viewMode,
  isTransitioning: () => !!transition,
  getColor: colorFor,
  getPopulation: (country) => country.populations[currentYearIndex],
  formatPopulation: formatPeakPopulation,
  getTextColor: (color) =>
    foregroundForColor(`#${color.getHexString()}`),
  onOpenCountry: openCountryDetail,
});
scene.add(calloutController.group);

const hoverCountryGroup = new THREE.Group();
scene.add(hoverCountryGroup);
let hoverCountry = null;
// Rebuilding a large country's fill — especially the globe tessellation
// pass — on every single re-hover gets expensive fast, and jittering the
// mouse across a dense dot cluster's edge re-triggers it repeatedly for
// geometry that hasn't changed. Cache built meshes per iso3+viewMode (the
// two projections aren't interchangeable) and only dispose on eviction,
// not on every hover-out.
const hoverFillCache = new Map(); // `${iso3}:${viewMode}` -> THREE.Mesh[]
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
let currentYearIndex = -1;
let historicalCutoffYear = Infinity;
let globalMetricsByYear = new Map();
let highMetricsByYear = new Map();
let lowMetricsByYear = new Map();
let globalTrendMilestones = new Map();
let countryDemographicMetrics = null;
// Simplified country outline rings ({ [iso3]: [[lon,lat], ...][] }), lazily
// loaded — see showHoverCountryFill(). null until it resolves; hovering
// before then just doesn't draw a fill for that hover, same tradeoff as the
// demographic-metrics deferred load.
let countryBorders = null;
// Set synchronously in <head> (before this module even loads) so first
// paint never flashes the wrong theme — this just picks it up.
let currentTheme = document.documentElement.dataset.theme || "dark";
let colorMode = "region";
let clusterColorMode = "region";
let viewMode = "globe";
let selectedLegend = null;
// A single country "drill-down" view, entered either straight from a dot
// click or from a row inside the group table above — selectedLegend is left
// untouched in the latter case so the back button can restore that exact
// table (same group, same sort) instead of just closing everything.
let selectedCountry = null;
// Cached population-chart layout (max value + coordinate mapper) so the
// per-year marker/sparkline update is a cheap reposition rather than a full
// chart rebuild every time the slider moves.
let countryChartLayout = null;
let countrySparklineInstances = [];
const countryChartAnimationHandles = [];
let trendChartAnimationHandle = null;
let detailSort = { key: "population", direction: "desc" };
let chartPanelActive = false;
let plotActive = false;
let clusterActive = false;
let chartMetricKey = "ageDependencyRatio";
let chartProjectionScenario = "medium";
// Insertion-order array (not a Set) so a country keeps the same line color
// for as long as it stays selected, even as others are toggled around it.
let selectedChartCountries = ["USA", "JPN", "IND", "DEU", "NGA"];
// Whether the picker shows the "Country list N" summary pill or the full
// chip/search editor — collapsed by default so the topbar stays one line
// regardless of how many countries are selected.
let chartCountryPickerExpanded = false;
// Separate from detailSort (the group table's own sort) so switching one
// doesn't surprise the other the next time it's opened.
let chartTableSort = { key: "population", direction: "desc" };
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

function colorFor(country, mode = colorMode) {
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
  return viewMode === "map" ? country._xyzMap : country._xyzGlobe;
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
  if (!rings) return;

  const cacheKey = `${country.iso3}:${viewMode}`;
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
    viewMode,
    projectPoint: (lon, lat) =>
      viewMode === "map"
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
// isProjected distinguishes an observed peak (year <= historicalCutoffYear)
// from a modeled one (year > historicalCutoffYear) — without it, a
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
  const isProjected = year > historicalCutoffYear;
  const metrics = globalMetricsByYear.get(year);
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
  const isProjected = year > historicalCutoffYear;
  if (selectedCountry && !elements.detailPanel.hidden) {
    updateMilestoneNav(null);
    renderCountrySummary(
      buildCountrySummary({
        country: selectedCountry,
        year,
        years: yearsData,
        historicalCutoffYear,
        formatPopulation: formatPeakPopulation,
      }),
    );
    return;
  }
  if (selectedLegend && !elements.detailPanel.hidden) {
    updateMilestoneNav(null);
    renderDetailStatus(
      buildDetailStatus({
        year,
        countries: groupCountries ?? selectedCountries(),
        allCountries: countriesData,
        currentYearIndex,
        isProjected,
        legend: selectedLegend,
        metricFor,
      }),
    );
    return;
  }

  const peakCountries = countriesData.filter(
    (country) => country.peakYear === year,
  );
  const milestone = globalTrendMilestones.get(year);
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
  typeStatus(
    [yearLead, leadText, globalPopulationStatus].filter(Boolean).join(" "),
    elements.status,
    { instant },
  );
}

// Milestone years in chronological order, so "Milestone #N" counts forward
// through history the same way the ‹/› buttons step through it.
function sortedMilestoneYears() {
  return [...globalTrendMilestones.keys()].sort((a, b) => a - b);
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
// mutating currentYearIndex directly and leaving those controls stale.
function goToYear(year) {
  elements.yearSlider.value = year;
  elements.yearSlider.dispatchEvent(new Event("input", { bubbles: true }));
  elements.yearSlider.dispatchEvent(new Event("change", { bubbles: true }));
}

function stepMilestone(delta) {
  tourController.stop();
  const { prev, next } = adjacentMilestoneYears(
    sortedMilestoneYears(),
    yearsData[currentYearIndex],
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
  getCurrentYear: () => yearsData[currentYearIndex],
  goToYear,
  onPlayingChange: setTourButtonState,
  onProgressReset: resetTourProgress,
  onProgressStart: animateTourProgress,
});

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
  { instant = false } = {},
) {
  const token = ++statusTypingToken;
  if (instant) {
    const textNode = document.createElement("div");
    textNode.textContent = text;
    el.replaceChildren(textNode);
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
    }
  };
  step();
}

function renderCountrySummary(summary) {
  const caption = document.createElement("div");
  caption.className = "caption mono-uppercase";
  caption.textContent = summary.caption;

  if (summary.flagUrl) {
    elements.detailFlag.style.backgroundImage = `url(${summary.flagUrl})`;
    elements.detailFlag.hidden = false;
  } else {
    elements.detailFlag.hidden = true;
    elements.detailFlag.style.backgroundImage = "";
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
  elements.detailSummary.replaceChildren(caption, copy);
}

function renderDetailStatus(status) {
  elements.detailFlag.hidden = true;
  elements.detailFlag.style.backgroundImage = "";
  const badge = document.createElement("span");
  badge.className = "caption mono-uppercase";
  badge.textContent = status.period;
  elements.detailSummary.replaceChildren(badge, ` ${status.text}`);
}

function applyYear(year, { instant = false } = {}) {
  const yearIndex = yearsData.indexOf(year);
  if (yearIndex === -1) return;
  const isFirstCall = currentYearIndex === -1;
  currentYearIndex = yearIndex;

  // The 3D scene is fully hidden behind the chart overlay while it's open,
  // so repositioning every dot on each year change here would be pure
  // wasted work — this keeps year-scrubbing (e.g. the draggable chart
  // marker) cheap by touching only what's actually visible. Closing the
  // overlay (setchartPanelActive) does one full applyYear() call to catch
  // the 3D scene up to wherever this left it.
  if (chartPanelActive) {
    updateYearLabels(year);
    renderTrendChart();
    renderChartTable();
    syncUrlFromState();
    return;
  }

  // Same reasoning as the chartPanelActive branch above — the 3D scene is
  // hidden behind the plot overlay, so it's cheaper to skip it and just
  // reposition the (already-built) cards. setPlotActive(false) does the
  // 3D catch-up when the overlay closes.
  if (plotActive) {
    updateYearLabels(year);
    updatePlotYear(year);
    syncUrlFromState();
    return;
  }

  // Same reasoning again — the 3D scene is hidden behind the cluster
  // overlay, so skip repositioning it and just reclassify/reposition the
  // (already-built) particles instead. setClusterActive(false) does the 3D
  // catch-up when the overlay closes.
  if (clusterActive) {
    updateYearLabels(year);
    updateClusterYear(year);
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
    const pop = country.populations[yearIndex];
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

  const isProjected = year > historicalCutoffYear;
  isProjectedYear = isProjected;

  updateYearLabels(year);
  renderDetailPanel();
  if (selectedCountry) {
    updateCountryDetailForYear(year);
    updateStatusPanel(year, { instant });
  } else if (!selectedLegend) {
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
  const year = Math.round(min + ratio * (max - min));
  if (year === Number(slider.value)) {
    elements.yearHoverValue.hidden = true;
    return;
  }
  const thumbCenter = slider.offsetLeft + thumbSize / 2 + ratio * trackWidth;
  elements.yearHoverValue.textContent = String(year);
  elements.yearHoverValue.style.setProperty(
    "--thumb-position",
    `${thumbCenter}px`,
  );
  elements.yearHoverValue.hidden = false;
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
  const mode = modeOverride ?? (clusterActive ? clusterColorMode : colorMode);
  const entries = legendEntriesFor(mode);
  elements.legend.replaceChildren(
    ...entries.map(([label, color]) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "legend-item";
      item.dataset.label = label;
      item.classList.toggle(
        "active",
        selectedLegend?.mode === mode && selectedLegend?.label === label,
      );
      const swatch = document.createElement("span");
      swatch.className = "legend-swatch";
      item.style.setProperty("--color-legend", color);
      const text = document.createElement("span");
      text.textContent = displayGroupLabel(label);
      item.append(swatch, text);
      item.addEventListener("click", () => {
        if (clusterActive) setClusterActive(false);
        selectLegendItem(label, color, mode);
      });
      return item;
    }),
  );
}

function metricFor(country, key) {
  return countryDemographicMetrics?.countries?.[country.iso3]?.[key]?.[
    currentYearIndex
  ];
}

// Demographic shape, not raw scale — deliberately excludes population size
// itself, which would just cluster large countries together regardless of
// how their populations are actually trending.
const SIMILAR_COUNTRY_METRIC_KEYS = [
  "fertility",
  "medianAge",
  "lifeExpectancy",
  "populationGrowth",
  "ageDependencyRatio",
];
const SIMILAR_COUNTRY_METRIC_LABELS = {
  fertility: "fertility",
  medianAge: "median age",
  lifeExpectancy: "life expectancy",
  populationGrowth: "population growth",
  ageDependencyRatio: "age dependency ratio",
};
const SIMILAR_COUNTRY_LIMIT = 4;

// Nearest neighbors by current-year demographic profile — each metric
// normalized by its spread across all countries this year (min-max, not
// z-score: simple and enough here) so life expectancy's ~40-90yr range
// doesn't dominate population growth's sub-1% range just by having bigger
// raw numbers. Read once when a country opens (via currentYearIndex at that
// moment) rather than kept live on every slider tick — a "next to see" list
// that keeps reshuffling under someone scrubbing the year would read as
// noise, not a suggestion.
function computeSimilarCountries(country) {
  if (!countryDemographicMetrics) return [];
  const target = SIMILAR_COUNTRY_METRIC_KEYS.map((key) => metricFor(country, key));
  if (target.some((value) => value == null)) return [];

  const ranges = SIMILAR_COUNTRY_METRIC_KEYS.map((key) => {
    const values = countriesData
      .map((candidate) => metricFor(candidate, key))
      .filter((value) => value != null);
    return Math.max(...values) - Math.min(...values) || 1;
  });

  return countriesData
    .filter((candidate) => candidate.iso3 !== country.iso3)
    .map((candidate) => {
      const values = SIMILAR_COUNTRY_METRIC_KEYS.map((key) =>
        metricFor(candidate, key),
      );
      if (values.some((value) => value == null)) return null;
      let distanceSquared = 0;
      let closestKey = null;
      let closestDiff = Infinity;
      values.forEach((value, i) => {
        const diff = Math.abs(value - target[i]) / ranges[i];
        distanceSquared += diff * diff;
        if (diff < closestDiff) {
          closestDiff = diff;
          closestKey = SIMILAR_COUNTRY_METRIC_KEYS[i];
        }
      });
      return { country: candidate, distance: Math.sqrt(distanceSquared), closestKey };
    })
    .filter(Boolean)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, SIMILAR_COUNTRY_LIMIT);
}

function renderSimilarCountries(country) {
  const matches = computeSimilarCountries(country);
  elements.countrySimilar.hidden = matches.length === 0;
  if (!matches.length) return;
  elements.countrySimilarList.replaceChildren(
    ...matches.map(({ country: match, closestKey }) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "country-similar-item";
      const flag = document.createElement("span");
      flag.className = "country-similar-flag";
      flag.style.backgroundImage = `url(${flagIconUrl(match.iso3)})`;
      const text = document.createElement("span");
      text.className = "country-similar-text";
      const name = document.createElement("span");
      name.className = "country-similar-name";
      name.textContent = match.name;
      // const reason = document.createElement("span");
      // reason.className = "country-similar-reason";
      // reason.textContent = `Similar ${SIMILAR_COUNTRY_METRIC_LABELS[closestKey]}`;
      text.append(name);
      item.append(flag, text);
      item.addEventListener("click", () => openCountryDetail(match));
      return item;
    }),
  );
}

function selectedCountries() {
  if (!selectedLegend) return [];
  return selectDetailCountries({
    countries: countriesData,
    legend: selectedLegend,
    columns: detailColumns(),
    sort: detailSort,
  });
}

// Single source of truth for the detail-panel table: each column knows how
// to read its own sort value (used both for sorting and for the population
// ratio bar) and how to format it for display. Header cells are generated
// from this list too, so clicking one always lines up with the right column.
function detailColumns() {
  return buildDetailColumns({ currentYearIndex, metricFor });
}

// Keep the comparison table focused on the chart's current question:
// country and population are always present, followed by the selected
// metric when it is not population itself.
function chartTableColumns() {
  // Country + whichever metric #chartMetricTabs currently has active — not
  // Population plus that metric, which crowded the table with a column
  // most tabs don't need repeated alongside their own. The radar tab plots
  // five metrics at once, so it gets all five columns instead of one.
  const metricKeys =
    chartMetricKey === CHART_RADAR_KEY
      ? RADAR_CHART_METRICS
      : [chartMetricKey];
  // metricFor/populationFor read off each item's own .series() rather than
  // the global metricFor()/chartPopulationSeries(), so the same columns
  // work whether rows are real countries (Country mode) or aggregated
  // Region/Income groups (see chartItems()).
  return buildDetailColumns({
    currentYearIndex,
    metricFor: (item, key) => item.series(key)[currentYearIndex],
    metricKeys,
    populationFor: (item) => item.series("population")[currentYearIndex],
  });
}

// Fixed reference lines for the trend chart's Y axis, keyed by metric.
// Fertility's 2.1 is the UN's global replacement-level rate. Age dependency
// ratio's 45/70 and life expectancy's bands are the UN Human Development
// Index thresholds. Drawn in renderTrendChart.
const CHART_BENCHMARK_LINES = {
  fertility: [{ value: 2.1, label: "2.1" }],
  ageDependencyRatio: [
    { value: 70, label: "High" },
    { value: 45, label: "Low" },
  ],
  lifeExpectancy: [
    { value: 80, label: "Very high" },
    { value: 75, label: "High" },
    { value: 70, label: "Low" },
  ],
};

function createDetailCell(text, className = "") {
  const cell = document.createElement("div");
  cell.className = `detail-cell ${className}`.trim();
  const inner = document.createElement("span");
  inner.className = "detail-name";
  inner.textContent = text;
  cell.append(inner);
  return cell;
}

// Shared by the group-detail table and the chart table: builds sortable
// header cells (with the active sort's arrow) and per-country rows from the
// same column/row-building helpers, wiring header clicks to onSort and row
// clicks to onRowClick. Sorting happens here rather than being the caller's
// job, so both tables stay correct even if handed an unsorted country list.
function renderSortableTable({
  headerEl,
  rowsEl,
  columns,
  sort,
  countries,
  onSort,
  onRowClick,
  gridTemplateColumns,
  // Optional: per-row --detail-color (tints .detail-cell.country's ratio
  // bar — see styles.css). Left unset, rows just inherit whatever
  // --detail-color the panel around the table already has — the group
  // table's one shared group color, unchanged from before this existed.
  // The chart table passes each row its own item's line color instead,
  // since a row there can represent any of several differently-colored
  // countries or categories, not one shared group.
  colorFor,
}) {
  if (gridTemplateColumns) {
    headerEl.style.gridTemplateColumns = gridTemplateColumns;
  } else {
    headerEl.style.removeProperty("grid-template-columns");
  }
  headerEl.replaceChildren(
    ...columns.map((column) => {
      const arrow =
        sort.key === column.key
          ? sort.direction === "asc"
            ? " ↑"
            : " ↓"
          : "";
      const cell = createDetailCell(
        `${column.label}${arrow}`,
        `${column.className} sortable`,
      );
      cell.classList.toggle("active", sort.key === column.key);
      cell.addEventListener("click", () => onSort(column.key));
      return cell;
    }),
  );

  const sorted = sortDetailCountries(countries, columns, sort);
  const rows = buildDetailRows(sorted, columns).map((detailRow) => {
    const row = document.createElement("div");
    row.style.setProperty("--ratio", detailRow.ratio);
    row.className = "detail-row";
    if (gridTemplateColumns) {
      row.style.gridTemplateColumns = gridTemplateColumns;
    }
    if (colorFor) {
      const color = colorFor(detailRow.country);
      if (color) row.style.setProperty("--detail-color", color);
    }
    row.append(
      ...detailRow.cells.map((cell) => createDetailCell(cell.text, cell.className)),
    );
    row.addEventListener("click", () => onRowClick(detailRow.country));
    return row;
  });
  rowsEl.replaceChildren(...rows);
}

// Shared asc/desc toggle: clicking the already-active column flips
// direction; clicking a different one switches to that column's own
// default direction (e.g. population defaults to desc, country name to
// asc). Returns null for an unrecognized key so callers can skip the
// re-render rather than sorting by a column that doesn't exist.
function nextSortState(sort, key, columns) {
  const column = columns.find((c) => c.key === key);
  if (!column) return null;
  return sort.key === key
    ? { key, direction: sort.direction === "asc" ? "desc" : "asc" }
    : { key, direction: column.defaultDirection };
}

function setDetailSort(key) {
  const next = nextSortState(detailSort, key, detailColumns());
  if (!next) return;
  detailSort = next;
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
  document.body.classList.toggle(
    "country-detail",
    isOpen && !elements.countryDetail.hidden,
  );
  // The mobile hamburger menu and the detail panel are both glass overlays
  // that can stack on small screens — leaving the menu open behind the
  // panel would show through its translucent background.
  if (isOpen) {
    document.body.classList.remove("menu-open");
    elements.menuToggle.setAttribute("aria-expanded", "false");
  }
}

function renderDetailPanel() {
  // A country drill-down (from a row click or a dot click) takes over the
  // panel; re-running this on the next year change would otherwise stomp
  // it back to the group table underneath.
  if (!selectedLegend || selectedCountry || currentYearIndex < 0) return;

  const columns = detailColumns();
  const countries = selectedCountries();
  const year = yearsData[currentYearIndex];
  elements.detailPanel.style.setProperty(
    "--detail-color",
    selectedLegend.color,
  );
  elements.detailTitle.textContent = displayGroupLabel(selectedLegend.label);
  elements.detailSubtitle.textContent = `${countries.length} countries · ${year}`;

  renderSortableTable({
    headerEl: elements.detailHeader,
    rowsEl: elements.detailRows,
    columns,
    sort: detailSort,
    countries,
    onSort: setDetailSort,
    onRowClick: openCountryDetail,
  });
  // Keep the summary in the panel's second grid row. Country detail uses the
  // flexible third row; moving the summary inside it would leave row two
  // empty and allow the min-height:0 chart container to collapse there.
  elements.detailTable.before(elements.detailSummary);
  elements.countryDetail.hidden = true;
  elements.detailTable.hidden = false;
  elements.detailPanel.hidden = false;
  updateViewModeAvailability();
  updateStatusPanel(year, { groupCountries: countries });
}

function closeDetailPanel() {
  cancelChartAnimations(countryChartAnimationHandles);
  selectedLegend = null;
  selectedCountry = null;
  countryChartLayout = null;
  countrySparklineInstances = [];
  elements.detailPanel.hidden = true;
  updateViewModeAvailability();
  renderLegend();
  // Match chart-view close behavior: the underlying global status was
  // already established before opening the detail overlay, so restore it
  // immediately instead of replaying the typewriter animation.
  if (currentYearIndex >= 0) {
    updateStatusPanel(yearsData[currentYearIndex], { instant: true });
  }
  syncUrlFromState();
}

// Returns to the group table this country was opened from (if any),
// otherwise closes the whole panel — mirrors closeDetailPanel()'s job but
// one level up the navigation stack.
function closeCountryDetail() {
  cancelChartAnimations(countryChartAnimationHandles);
  selectedCountry = null;
  countryChartLayout = null;
  countrySparklineInstances = [];
  if (selectedLegend) {
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
  const state = { mode: viewMode };
  if (chartPanelActive) {
    Object.assign(state, { view: "chart", metric: chartMetricKey, countries: selectedChartCountries });
  } else if (plotActive) {
    Object.assign(state, { view: "plot" });
  } else if (clusterActive) {
    Object.assign(state, { view: "cluster" });
  } else if (selectedCountry) {
    Object.assign(state, { view: "country", country: selectedCountry.iso3 });
  } else if (selectedLegend) {
    Object.assign(state, { view: "group", groupMode: selectedLegend.mode, group: selectedLegend.label });
  }
  if (currentYearIndex >= 0) state.year = yearsData[currentYearIndex];
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
  if (state.year != null) goToYear(state.year);
  if (state.mode === "map") setViewMode("map");

  if (state.view === "chart") {
    if (state.countries.length) selectedChartCountries = state.countries;
    // Countries/metric are settled before the panel opens, so its own
    // renderTrendChart({ animate: true }) call is both the first one that
    // reflects the deep-linked state and the only one that's actually
    // visible — no need for a redundant plain re-render after it.
    if (state.metric) setChartMetric(state.metric);
    renderChartCountryChips();
    setchartPanelActive(true);
  } else if (state.view === "plot") {
    setPlotActive(true);
  } else if (state.view === "cluster") {
    setClusterActive(true);
  } else if (state.view === "country") {
    const country = countriesData.find((c) => c.iso3 === state.country);
    if (country) openCountryDetail(country);
  } else if (state.view === "group") {
      if (state.groupMode !== colorMode) setColorMode(state.groupMode);
      const entry = legendEntriesFor(state.groupMode).find(
        ([label]) => label === state.group,
      );
      if (entry) selectLegendItem(entry[0], entry[1]);
  }
}

function selectLegendItem(label, color, mode = colorMode) {
  if (selectedLegend?.mode === mode && selectedLegend?.label === label) {
    closeDetailPanel();
    return;
  }
  tourController.stop();
  selectedLegend = { mode, label, color };
  renderLegend(mode);
  renderDetailPanel();
  syncUrlFromState();
}

// --- Country detail view ------------------------------------------------
// A single-country drill-down that replaces the 3D canvas area with charts
// (same fixed/glass panel the group table uses) — entered by clicking a dot
// on the globe/map, or a row inside the group table above.

const SVG_NS = "http://www.w3.org/2000/svg";

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  return el;
}

const COUNTRY_CHART_WIDTH = 760;
const COUNTRY_CHART_HEIGHT = 220;
// Top padding is deliberately generous because the current-year marker
// label floats above its dot, and when that dot sits near the series max
// there needs to be real room for the label above y=0.
const COUNTRY_CHART_PADDING = { top: 24, right: 12, bottom: 24, left: 12 };
const COUNTRY_CHART_LABEL_MIN_Y = 12;
const COUNTRY_SPARKLINE_METRIC_KEYS = [
  "fertility",
  "lifeExpectancy",
  "medianAge",
  "populationGrowth",
  "ageDependencyRatio",
  "netMigrationRate",
];

// --- Chart view (Globe/Map's third mode) ---------------------------------
// A full-width multi-country trend chart, independent of the 3D dot scene
// and the single-year snapshot the rest of the app is built around.
const CHART_METRIC_KEYS = [
  "population",
  "populationGrowth",
  "netMigrationRate",
  "fertility",
  "lifeExpectancy",
  "ageDependencyRatio",
];
// A radar/spider snapshot tab, alongside the time-series metric tabs above
// — not a real entry in METRICS since it plots five metrics against each
// other at once rather than being one itself. Kept as its own sentinel key
// so chartMetricKey, the tab list, and the table columns can each
// special-case it in one place.
const CHART_RADAR_KEY = "radar";
// Clockwise from the top spoke — see renderRadarChart's angleFor.
const RADAR_CHART_METRICS = [
  "populationGrowth",
  "fertility",
  "netMigrationRate",
  "lifeExpectancy",
  "ageDependencyRatio",
];
// Generous left/right padding: axis labels like "Age dependency ratio" run
// off the side spokes horizontally rather than wrapping.
const RADAR_CHART_PADDING = { top: 56, right: 132, bottom: 48, left: 132 };
// A plain categorical color set assigned by selection order, not by the
// country's actual region — two countries in the same region are a
// near-certainty among any handful of selections, so coloring by region
// here would make their lines indistinguishable. Starts with the region
// palette (for visual consistency with the rest of the app) extended with
// a few more distinct hues, since the country grid invites selecting well
// past 7.
const CHART_LINE_COLORS = [
  ...Object.values(REGION_COLORS),
  "#4C75F0",
  "#A99BEA",
  "#F46E54",
  "#5CC8BB",
  "#E9A0E2",
];

// A dedicated tooltip (separate from #tooltip, which the 3D canvas's own
// hover system clears on a 100ms timer even while this panel is open) for
// hovering a trend line, the main chart's marker dot, or a sparkline's
// current-value dot.
function createTooltipLine(text, color = null) {
  const line = document.createElement("div");
  line.className = "tooltip-line mono-uppercase";
  if (color) {
    const swatch = document.createElement("span");
    swatch.className = "legend-swatch";
    swatch.style.setProperty("--color-legend", color);
    line.append(swatch);
  }
  const label = document.createElement("span");
  label.textContent = text;
  line.append(label);
  return line;
}

function showChartTooltip(event, text, color = null) {
  if (!text) return;
  elements.chartTooltip.hidden = false;
  elements.chartTooltip.replaceChildren(createTooltipLine(text, color));
  elements.chartTooltip.style.left = `${event.clientX}px`;
  elements.chartTooltip.style.top = `${event.clientY}px`;
}

function hideChartTooltip() {
  elements.chartTooltip.hidden = true;
}

function openCountryDetail(country) {
  if (!country || currentYearIndex < 0) return;
  // A row click in the chart view's own table drills into the same full
  // country detail panel the group table uses — that panel and the chart
  // overlay are both full-screen, so the chart has to step aside first.
  if (chartPanelActive) setchartPanelActive(false);
  tourController.stop();
  selectedCountry = country;
  elements.tooltip.hidden = true;
  renderCountryDetail();
  syncUrlFromState();
}

function renderCountryDetail() {
  const country = selectedCountry;
  if (!country || currentYearIndex < 0) return;
  const year = yearsData[currentYearIndex];

  elements.detailPanel.style.setProperty(
    "--detail-color",
    `#${colorFor(country).getHexString()}`,
  );
  elements.detailTitle.textContent = country.name;

  elements.detailTable.hidden = true;
  elements.countryDetail.hidden = false;
  // Country detail's hero is a two-column composition: summary on the left,
  // population chart on the right, followed by full-width sparklines.
  // Keep the structured summary inside that grid instead of leaving it in
  // the panel's standalone group-summary row.
  elements.countryDetail.prepend(elements.detailSummary);
  // Laid out (panel visible, chart card sized) before measuring its actual
  // width in buildCountryCharts() — otherwise clientWidth reads 0 while the
  // panel is still display:none, and the chart falls back to a fixed size
  // that doesn't match the container it's stretched into.
  elements.detailPanel.hidden = false;
  // Summary text is set before the charts are measured, not after: it can
  // wrap to a different number of lines than whatever was showing before,
  // which changes the panel's content height and can toggle its scrollbar
  // on/off — and that changes the chart's available width. Measuring before
  // this settles is exactly what left the chart/sparklines a few pixels
  // narrower than their final size.
  updateStatusPanel(year);
  buildCountryCharts(country, { animate: true });
  updateCountryDetailForYear(year);
  renderSimilarCountries(country);
  updateViewModeAvailability();
}

// Builds the population chart (band + historical/projected lines + peak
// marker) once per country open — none of that depends on the currently
// selected year, only on the country's own time series. The coordinate
// mapper is cached on countryChartLayout so updateCountryDetailForYear()
// can cheaply reposition the marker on every slider tick instead of
// rebuilding the whole chart.
function buildCountryCharts(country, { animate = false } = {}) {
  cancelChartAnimations(countryChartAnimationHandles);
  // Sized to the chart's actual rendered box (panel is already visible by
  // this point) rather than fixed constants — the SVG uses
  // preserveAspectRatio="none" to fill that box exactly, so a mismatched
  // viewBox (width now, height since .country-chart switched to
  // aspect-ratio: 4/1 instead of a fixed height) is what stretches it.
  const chartWidth = elements.countryChart.clientWidth || COUNTRY_CHART_WIDTH;
  const chartHeight =
    elements.countryChart.clientHeight || COUNTRY_CHART_HEIGHT;
  const svg = elements.countryChart;
  svg.setAttribute("viewBox", `0 0 ${chartWidth} ${chartHeight}`);
  const pad = COUNTRY_CHART_PADDING;
  const {
    count: n,
    cutoffIndex,
    baselineY,
    xyFor,
  } = createCountryChartGeometry({
    country,
    years: yearsData,
    historicalCutoffYear,
    width: chartWidth,
    height: chartHeight,
    padding: pad,
  });

  svg.replaceChildren();
  const growingBars = [];
  const revealElements = [];

  if (cutoffIndex < n - 1) {
    let top = "";
    for (let i = cutoffIndex; i < n; i++) {
      const [x, y] = xyFor(i, country.populationsHigh[i]);
      top += `${top ? " L " : "M "}${x.toFixed(2)} ${y.toFixed(2)}`;
    }
    let bottom = "";
    for (let i = n - 1; i >= cutoffIndex; i--) {
      const [x, y] = xyFor(i, country.populationsLow[i]);
      bottom += ` L ${x.toFixed(2)} ${y.toFixed(2)}`;
    }
    const band = svgEl("path", {
      class: "country-chart-band",
      d: `${top}${bottom} Z`,
    });
    if (animate) band.style.opacity = "0";
    revealElements.push(band);
    svg.append(band);
  }

  // One vertical stroke per year (from the baseline up to that year's
  // value) rather than a connected curve — historical years solid,
  // projected years dashed, matching the sparklines' bar-code treatment.
  const bars = document.createDocumentFragment();
  for (let i = 0; i < n; i++) {
    const value = country.populations[i];
    if (value == null) continue;
    const [x, y] = xyFor(i, value);
    const isProjected = i >= cutoffIndex;
    const bar = svgEl("line", {
      class: `country-chart-bar${isProjected ? " projected" : ""}`,
      x1: x.toFixed(2),
      x2: x.toFixed(2),
      y1: baselineY,
      y2: animate ? baselineY : y.toFixed(2),
    });
    if (animate) growingBars.push({ bar, targetY: y });
    bars.append(bar);
  }
  svg.append(bars);

  const axisY = chartHeight - 6;
  const peakIndex = yearsData.indexOf(country.peakYear);
  const peakDotSize = 8.2;
  if (peakIndex !== -1) {
    const [px, py] = xyFor(peakIndex, country.populations[peakIndex]);
    const peakLine = svgEl("line", {
        class: "country-chart-peak-line",
        x1: px,
        x2: px,
        y1: baselineY,
        y2: py.toFixed(2),
      });
    const peakDot = svgEl("rect", {
        class: "country-chart-peak-dot",
        x: (px - peakDotSize/2).toFixed(2),
        y: (py - peakDotSize/2).toFixed(2),
        width: peakDotSize,
        height: peakDotSize,
      });
    if (animate) {
      peakLine.style.opacity = "0";
      peakDot.style.opacity = "0";
    }
    revealElements.push(peakLine, peakDot);
    svg.append(peakLine, peakDot);
    const peakTextAnchor =
      peakIndex > n * 0.85 ? "end" : peakIndex < n * 0.15 ? "start" : "middle";
    const peakLabel = svgEl("text", {
      class: "country-chart-peak-label",
      x: px,
      y: axisY-2,
      "text-anchor": peakTextAnchor,
    });
    peakLabel.textContent = `PEAK`;
    if (animate) peakLabel.style.opacity = "0";
    revealElements.push(peakLabel);
    svg.append(peakLabel);
  }

  const [x0] = xyFor(0, 0);
  const [x1] = xyFor(n - 1, 0);
  const labelFirst = svgEl("text", {
    class: "country-chart-axis-label",
    x: x0,
    y: axisY-2,
    "text-anchor": "start",
  });
  labelFirst.textContent = yearsData[0];
  const labelLast = svgEl("text", {
    class: "country-chart-axis-label",
    x: x1,
    y: axisY-2,
    "text-anchor": "end",
  });
  labelLast.textContent = yearsData[n - 1];
  if (animate) {
    labelFirst.style.opacity = "0";
    labelLast.style.opacity = "0";
  }
  revealElements.push(labelFirst, labelLast);
  svg.append(labelFirst, labelLast);

  const markerDot = svgEl("circle", {
    id: "countryChartMarkerDot",
    class: "country-chart-marker-dot",
    r: 4.5,
  });
  const markerLabel = svgEl("text", {
    id: "countryChartMarkerLabel",
    class: "country-chart-marker-label",
  });

  const markerLine = svgEl("line", {
    id: "countryChartMarkerLine",
    class: "country-chart-marker-line",
    y2: baselineY,
  });
  const markerDragHit = svgEl("rect", {
    class: "country-chart-year-drag",
    y: pad.top,
    width: 18,
    height: Math.max(0, baselineY - pad.top),
  });
  if (animate) {
    markerLine.style.opacity = "0";
    markerDot.style.opacity = "0";
    markerLabel.style.opacity = "0";
  }
  revealElements.push(markerLine, markerDot, markerLabel);
  svg.append(markerLine, markerDot, markerLabel, markerDragHit);

  countryChartLayout = {
    populations: country.populations,
    xyFor,
    markerLine,
    markerDot,
    markerLabel,
    markerDragHit,
  };

  function yearForClientX(clientX) {
    const rect = svg.getBoundingClientRect();
    const localX = ((clientX - rect.left) / rect.width) * chartWidth;
    const [firstX] = xyFor(0, 0);
    const [lastX] = xyFor(n - 1, 0);
    const ratio = (localX - firstX) / (lastX - firstX);
    const index = Math.round(ratio * (n - 1));
    return yearsData[Math.min(n - 1, Math.max(0, index))];
  }

  function previewCountryYear(clientX) {
    const year = yearForClientX(clientX);
    const index = yearsData.indexOf(year);
    if (index === -1 || index === currentYearIndex) return;
    currentYearIndex = index;
    updateCountryDetailForYear(year);
  }

  let draggingYearMarker = false;
  markerDragHit.addEventListener("pointerdown", (event) => {
    draggingYearMarker = true;
    tourController.stop();
    markerDragHit.setPointerCapture(event.pointerId);
    previewCountryYear(event.clientX);
  });
  markerDragHit.addEventListener("pointermove", (event) => {
    if (draggingYearMarker) previewCountryYear(event.clientX);
  });
  const endYearMarkerDrag = () => {
    if (!draggingYearMarker) return;
    draggingYearMarker = false;
    goToYear(yearsData[currentYearIndex]);
  };
  markerDragHit.addEventListener("pointerup", endYearMarkerDrag);
  markerDragHit.addEventListener("pointercancel", endYearMarkerDrag);

  if (animate && growingBars.length) {
    const totalDuration = CHART_LINE_GROW_MS + CHART_MARKER_FADE_IN_MS;
    countryChartAnimationHandles.push(runChartAnimation({
      duration: totalDuration,
      onFrame: (_eased, progress) => {
        const elapsed = progress * totalDuration;
        const growT = easeOutCubic(
          Math.min(1, elapsed / CHART_LINE_GROW_MS),
        );
        growingBars.forEach(({ bar, targetY }) => {
          bar.setAttribute(
            "y2",
            baselineY + (targetY - baselineY) * growT,
          );
        });

        const fadeT = Math.min(
          1,
          Math.max(0, (elapsed - CHART_LINE_GROW_MS) / CHART_MARKER_FADE_IN_MS),
        );
        revealElements.forEach((element) => {
          element.style.opacity = String(fadeT);
        });
      },
    }));
  }

  elements.countrySparklines.replaceChildren();
  countrySparklineInstances = COUNTRY_SPARKLINE_METRIC_KEYS.map((key) => {
    const series =
      countryDemographicMetrics?.countries?.[country.iso3]?.[key] ?? [];
    // Card (and its still-empty svg) is appended before measuring so
    // clientWidth reflects its real grid-column size — same fix as the main
    // chart above, needed because the sparkline is just as vulnerable to
    // preserveAspectRatio="none" stretching from a mismatched viewBox.
    const instance = buildCountrySparklineCard(key);
    elements.countrySparklines.append(instance.card);
    populateCountrySparkline(instance, series, cutoffIndex, key, { animate });
    return { key, series, ...instance };
  });
}

function buildCountrySparklineCard(key) {
  const definition = METRICS[key];
  const svg = svgEl("svg", {
    class: "sparkline-svg",
    preserveAspectRatio: "none",
  });
  const dotLine = svgEl("line", { class: "sparkline-dot-line" });
  const dot = svgEl("circle", { class: "sparkline-dot", r: 4 });

  const titleCaption = document.createElement("div");
  titleCaption.className = "sparkline-caption";

  const card = document.createElement("div");
  card.className = "sparkline-card";
  const label = document.createElement("div");
  label.className = "sparkline-label mono-uppercase";
  label.textContent = definition.label;
  const value = document.createElement("div");
  value.className = "sparkline-value";
  // value always holds the current year's already-formatted reading (e.g.
  // "1.9 births/woman"), so the tooltip just echoes it back rather than
  // reformatting the number a second time.
  dot.addEventListener("pointerenter", (event) =>
    showChartTooltip(event, value.textContent),
  );
  dot.addEventListener("pointermove", (event) =>
    showChartTooltip(event, value.textContent),
  );
  dot.addEventListener("pointerleave", hideChartTooltip);
  titleCaption.append(label, value);
  card.append(titleCaption, svg);

  return { card, svg, dotLine, dot, valueEl: value };
}

// Each year is its own vertical stroke from the baseline up to that year's
// value (a "bar code" sparkline) rather than a connected curve — historical
// years solid, projected years dashed, mirroring the main chart's
// historical/projected line treatment. Metrics with a defined
// referenceValue (currently just fertility, at the UN's 2.1
// replacement-level threshold) bar from that line instead of the bottom
// edge, so bars visibly flip below it once a country drops under
// replacement rather than just shrinking toward a floor.
function populateCountrySparkline(
  instance,
  series,
  cutoffIndex,
  key,
  { animate = false } = {},
) {
  const { svg, dotLine, dot } = instance;
  const width = svg.clientWidth || 160;
  const height = svg.clientHeight || 40;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

  // Metrics without a meaningful universal threshold (life expectancy,
  // median age — unlike fertility's 2.1 replacement line or growth's 0%)
  // fall back to the series' own minimum, so every sparkline still draws a
  // baseline for visual consistency even though it has nothing to flip
  // below.
  const configuredReferenceValue = METRICS[key]?.referenceValue;
  const { min } = computeValueRange(series, configuredReferenceValue);
  const referenceValue = configuredReferenceValue ?? min;
  const n = series.length;
  const { baselineY, toXY, yFor, pathFor, areaFor } =
    createSparklineGeometry({
      series,
      cutoffIndex,
      width,
      height,
      referenceValue: configuredReferenceValue,
    });

  const elementsToAppend = [];
  const initialYFor = animate ? () => baselineY : yFor;
  const historicalArea = svgEl("path", {
    class: "sparkline-area historical",
    d: areaFor(0, cutoffIndex, initialYFor),
  });
  const projectedArea = svgEl("path", {
    class: "sparkline-area projected",
    d: areaFor(cutoffIndex, n - 1, initialYFor),
  });
  // Filled area between the curve and the baseline, drawn first so the
  // baseline/curve/dot render on top of it.
  elementsToAppend.push(
    historicalArea,
    projectedArea,
  );
  if (referenceValue != null) {
    elementsToAppend.push(
      svgEl("line", {
        class: "sparkline-baseline",
        x1: 0,
        x2: width,
        y1: baselineY.toFixed(1),
        y2: baselineY.toFixed(1),
      }),
    );
    const format = METRICS[key]?.format ?? ((value) => `${value}`);
    const baselineLabel = svgEl("text", {
      class: "sparkline-baseline-label",
      x: 0,
      // Clamped so a reference value sitting near the very top of the
      // scale (label would float above it) doesn't get clipped by the
      // SVG's own edge.
      y: Math.max(baselineY - 4, 8).toFixed(1),
      "text-anchor": "start",
    });
    // A bare "0" reads as the natural zero line; the formatted version
    // ("0.0 yrs", "0.00%") adds precision and units that don't mean
    // anything at exactly zero.
    baselineLabel.textContent =
      referenceValue === 0 ? "0" : format(referenceValue);
    elementsToAppend.push(baselineLabel);
  }
  const historicalPath = svgEl("path", {
    class: "sparkline-path historical",
    d: pathFor(0, cutoffIndex, initialYFor),
  });
  const projectedPath = svgEl("path", {
    class: "sparkline-path projected",
    d: pathFor(cutoffIndex, n - 1, initialYFor),
  });
  elementsToAppend.push(historicalPath, projectedPath);
  // The dot/connector line mark this metric's exact value for the
  // currently selected year — showing them at full opacity while the
  // curve underneath is still growing up from the baseline would leave
  // them floating over a shape that hasn't caught up to their position
  // yet, so they fade in only once the curve finishes (same two-phase
  // timeline as the main chart's own marker, just without the bar grow).
  if (animate) {
    dot.style.opacity = "0";
    dotLine.style.opacity = "0";
  }
  svg.append(...elementsToAppend, dotLine, dot);

  if (animate) {
    const totalDuration = CHART_LINE_GROW_MS + CHART_MARKER_FADE_IN_MS;
    countryChartAnimationHandles.push(runChartAnimation({
      duration: totalDuration,
      onFrame: (_eased, progress) => {
        const elapsed = progress * totalDuration;
        const growT = easeOutCubic(Math.min(1, elapsed / CHART_LINE_GROW_MS));
        const animatedYFor = (value) =>
          baselineY + (yFor(value) - baselineY) * growT;
        historicalPath.setAttribute(
          "d",
          pathFor(0, cutoffIndex, animatedYFor),
        );
        projectedPath.setAttribute(
          "d",
          pathFor(cutoffIndex, n - 1, animatedYFor),
        );
        historicalArea.setAttribute(
          "d",
          areaFor(0, cutoffIndex, animatedYFor),
        );
        projectedArea.setAttribute(
          "d",
          areaFor(cutoffIndex, n - 1, animatedYFor),
        );

        const fadeT = Math.min(
          1,
          Math.max(0, (elapsed - CHART_LINE_GROW_MS) / CHART_MARKER_FADE_IN_MS),
        );
        dot.style.opacity = String(fadeT);
        dotLine.style.opacity = String(fadeT);
      },
    }));
  }

  instance.toXY = toXY;
  instance.baselineY = baselineY;
}

// Cheap per-year update shared by the main chart's marker and the four
// metric sparklines — called on every slider tick while a country is open,
// as opposed to buildCountryCharts() which only runs once per country open.
function updateCountryDetailForYear(year) {
  if (!countryChartLayout || !selectedCountry) return;
  const index = yearsData.indexOf(year);
  if (index === -1) return;

  const groupLabel =
    colorMode === "income"
      ? selectedCountry._incomeLabel
      : displayGroupLabel(selectedCountry.region);
  elements.detailSubtitle.textContent = `${groupLabel} · ${year}`;

  const {
    populations,
    xyFor,
    markerLine,
    markerDot,
    markerLabel,
    markerDragHit,
  } =
    countryChartLayout;
  const population = populations[index];
  const [x, y] = xyFor(index, population ?? 0);
  if (markerLine && markerDot && markerLabel) {
    markerLine.setAttribute("x1", x);
    markerLine.setAttribute("x2", x);
    markerLine.setAttribute("y1", y);
    markerDot.setAttribute("cx", x);
    markerDot.setAttribute("cy", y);
    markerLabel.setAttribute("x", x);
    markerLabel.setAttribute("y", Math.max(y - 14, COUNTRY_CHART_LABEL_MIN_Y));
    markerLabel.textContent =
      population != null ? formatPeakPopulation(population) : "";
    markerDragHit?.setAttribute("x", x - 9);
  }

  countrySparklineInstances.forEach(
    ({ key, series, dotLine, dot, valueEl, toXY, baselineY }) => {
      const value = series[index];
      const definition = METRICS[key];
      const format = definition.formatPanel ?? definition.format;
      valueEl.textContent = format(value);
      if (value != null) {
        const [dx, dy] = toXY(index, value);
        dotLine.setAttribute("x1", dx);
        dotLine.setAttribute("x2", dx);
        dotLine.setAttribute("y1", dy);
        dotLine.setAttribute("y2", baselineY);
        dot.setAttribute("cx", dx);
        dot.setAttribute("cy", dy);
        dotLine.style.display = "";
        dot.style.display = "";
      } else {
        dotLine.style.display = "none";
        dot.style.display = "none";
      }
    },
  );
}

// Population comes from the dots dataset (same series peakYear/dots are
// built from); every other chart metric comes from the demographics file,
// keyed and indexed identically to yearsData.
function chartSeriesFor(country, key) {
  if (key === "population") return chartPopulationSeries(country);
  return countryDemographicMetrics?.countries?.[country.iso3]?.[key] ?? [];
}

function chartPopulationSeries(country) {
  if (chartProjectionScenario === "high") {
    return country.populationsHigh ?? country.populations;
  }
  if (chartProjectionScenario === "low") {
    return country.populationsLow ?? country.populations;
  }
  return country.populations;
}

function chartCountryList() {
  return selectedChartCountries
    .map((iso3) => countriesData.find((country) => country.iso3 === iso3))
    .filter(Boolean);
}

function chartColorFor(iso3) {
  const index = selectedChartCountries.indexOf(iso3);
  if (index === -1) return null;
  return CHART_LINE_COLORS[index % CHART_LINE_COLORS.length];
}

// Category aggregate for Region/Income mode: population sums across the
// group's countries (matching how the app reports group/global totals
// everywhere else), other metrics use a simple unweighted mean (matching
// computeMetricStats() in status-insights.mjs's own group-vs-rest
// comparisons, rather than introducing a second, population-weighted
// convention just for this chart).
function groupMetricSeries(members, key) {
  const isPopulation = key === "population";
  return yearsData.map((_, i) => {
    const values = members
      .map((country) => chartSeriesFor(country, key)[i])
      .filter((value) => value != null);
    if (!values.length) return null;
    const sum = values.reduce((total, value) => total + value, 0);
    return isPopulation ? sum : sum / values.length;
  });
}

// .detail-panel and .chart-view are both full-screen overlays — same
// reasoning as openCountryDetail() stepping the chart aside first. Also
// switches colorMode to match so the globe/map's own Region/Income legend
// (which selectLegendItem() reads via the ambient colorMode, not a
// parameter) opens the right group instead of misreading this label under
// whatever mode the globe happened to be left in.
function openChartGroupDetail(legendMode, label, color) {
  setchartPanelActive(false);
  if (legendMode !== colorMode) setColorMode(legendMode);
  selectLegendItem(label, color);
}

// Country mode plots one line per hand-picked country; Region/Income modes
// plot one aggregated line per category instead, with no picking needed
// since that list is small and fixed. Both funnel through this same item
// shape so renderTrendChart/renderChartTable/renderChartInsight don't need
// to know or care which one is active.
function chartItems() {
  const mode = elements.selectChartContent.value;
  if (mode === "country") {
    return chartCountryList().map((country) => ({
      name: country.name,
      label: convertAlpha3ToAlpha2(country.iso3) ?? country.iso3,
      color: chartColorFor(country.iso3),
      series: (key) => chartSeriesFor(country, key),
      onClick: () => openCountryDetail(country),
    }));
  }
  const legendMode = mode === "income-group" ? "income" : "region";
  // groupMetricSeries() aggregates across every member country for every
  // year — cheap once, but .series(key) gets called many times per render
  // (sort comparisons, ratio-bar sizing, each row's own cell) for the same
  // (group, key) pair. Cached per chartItems() call rather than at module
  // scope: it only needs to survive one render pass, not outlive it.
  const seriesCache = new Map();
  return legendEntriesFor(legendMode).map(([label, color]) => {
    const members = countriesData.filter((country) =>
      legendMode === "income"
        ? country._incomeLabel === label
        : country.region?.trim() === label,
    );
    const name = displayGroupLabel(label);
    return {
      name,
      label: name,
      color,
      series: (key) => {
        const cacheKey = `${label}:${key}`;
        if (!seriesCache.has(cacheKey)) {
          seriesCache.set(cacheKey, groupMetricSeries(members, key));
        }
        return seriesCache.get(cacheKey);
      },
      onClick: () => openChartGroupDetail(legendMode, label, color),
    };
  });
}

// Resolves any valid CSS <color> value (var(), color-mix(), etc.) to the
// browser's own computed rgb() — lets foregroundForColor() work with a
// color-mix() expression it can't parse directly (theme-colors.mjs only
// understands hex/rgb and var() references, not color-mix() syntax), by
// letting the real CSS engine do the resolving instead of reimplementing
// color-mix's math in JS.
function resolveComputedColor(cssColorValue) {
  const probe = document.createElement("span");
  probe.style.display = "none";
  probe.style.color = cssColorValue;
  document.body.appendChild(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();
  return resolved;
}

function addChartCountry(iso3) {
  if (selectedChartCountries.includes(iso3)) return;
  selectedChartCountries.push(iso3);
  renderChartCountryChips();
  renderTrendChart();
  renderChartTable();
  syncUrlFromState();
}

function removeChartCountry(iso3) {
  const index = selectedChartCountries.indexOf(iso3);
  if (index === -1) return;
  selectedChartCountries.splice(index, 1);
  renderChartCountryChips();
  renderTrendChart();
  renderChartTable();
  syncUrlFromState();
}


function renderChartCountryChips() {
  elements.chartCountryPickerSummaryFlags.replaceChildren(
    ...chartCountryList().map((country) => {
      const flag = document.createElement("span");
      flag.className = "chip-input-summary-flag";
      flag.style.backgroundImage = `url(${flagIconUrl(country.iso3)})`;
      return flag;
    }),
  );
  elements.chartCountryChips.replaceChildren(
    ...chartCountryList().map((country) => {
      const color = chartColorFor(country.iso3);
      const chip = document.createElement("span");
      chip.className = "chip";
      if (color) {
        chip.style.setProperty("--chart-line-color", color);
        // .chip's own background lightens `color` via color-mix() (see
        // styles.css) — picking a readable text color against the
        // *unmixed* line color picks wrong for anything color-mix
        // lightens substantially, so resolve the actual rendered
        // background first. Wrapped defensively: this ran once,
        // unconditionally, during init (line below), and a computed-style
        // format this doesn't recognize previously threw there and took
        // the whole app's init down with it — a decorative contrast pick
        // should never be able to do that. Falls back to the CSS
        // default (--color-text) on any failure.
        try {
          const background = resolveComputedColor(
            `color-mix(in srgb, ${color} 90%, white)`,
          );
          chip.style.setProperty(
            "--chip-text-color",
            foregroundForColor(background),
          );
        } catch (error) {
          console.error("chip text-color contrast pick failed:", error);
        }
      }

      const flag = document.createElement("span");
      flag.className = "chip-flag";
      flag.style.backgroundImage = `url(${flagIconUrl(country.iso3)})`;

      const label = document.createElement("span");
      label.textContent = country.name;

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "chip-remove";
      remove.setAttribute("aria-label", `Remove ${country.name}`);
      const icon = document.createElement("span");
      icon.className = "material-symbols-outlined";
      icon.textContent = "close";
      remove.append(icon);
      remove.addEventListener("click", () =>
        removeChartCountry(country.iso3),
      );

      chip.append(flag, label, remove);
      return chip;
    }),
  );
}

const CHART_COUNTRY_SUGGESTION_LIMIT = 8;

// Which suggestion Up/Down arrow keys have moved to, -1 meaning none yet
// (Enter then falls back to the top match, as it always has). Reset
// whenever the list itself changes, since a stale index from the previous
// keystroke's results wouldn't line up with the new ones.
let chartSuggestionActiveIndex = -1;

// Common informal abbreviations people search by that don't match the
// official ISO 3166-1 alpha-2 code — "UK" for the United Kingdom, whose
// actual code is "GB", is the everyday example.
const CHART_COUNTRY_CODE_ALIASES = {
  uk: "GB",
};

function chartCountryMatches(query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const aliasIso2 = CHART_COUNTRY_CODE_ALIASES[q];
  return countriesData
    .filter((country) => {
      if (selectedChartCountries.includes(country.iso3)) return false;
      const iso2 = convertAlpha3ToAlpha2(country.iso3);
      return (
        country.name.toLowerCase().includes(q) ||
        (iso2 && iso2.toLowerCase().includes(q)) ||
        (aliasIso2 && iso2 === aliasIso2)
      );
    })
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, CHART_COUNTRY_SUGGESTION_LIMIT);
}

function hideChartCountrySuggestions() {
  elements.chartCountrySuggestions.hidden = true;
  elements.chartCountrySuggestions.replaceChildren();
  chartSuggestionActiveIndex = -1;
}

function setChartCountryPickerExpanded(expanded) {
  if (expanded === chartCountryPickerExpanded) return;
  chartCountryPickerExpanded = expanded;
  elements.chartCountryPicker.classList.toggle("expanded", expanded);
  if (expanded) {
    elements.chartCountrySearch.focus();
  } else {
    elements.chartCountrySearch.value = "";
    hideChartCountrySuggestions();
  }
}

// Region/Income group modes plot aggregate trend lines per category rather
// than per hand-picked country, so the country picker (chip list + search)
// only makes sense — and only shows — in Country mode. chartItems() (used
// by renderTrendChart/renderChartTable) already reads the select's current
// value directly, so switching modes just needs a plain re-render.
function updateChartContentMode() {
  const isCountryMode = elements.selectChartContent.value === "country";
  elements.chartCountryPicker.hidden = !isCountryMode;
  if (!isCountryMode) setChartCountryPickerExpanded(false);
  renderTrendChart({ animate: true });
  renderChartTable();
}

function selectChartCountrySuggestion(iso3) {
  addChartCountry(iso3);
  elements.chartCountrySearch.value = "";
  hideChartCountrySuggestions();
  elements.chartCountrySearch.focus();
}

// Moves the Up/Down-arrow highlight, clamped to the list's bounds (rather
// than wrapping) — simpler to reason about, and matches most desktop
// autocomplete widgets. Scrolled into view since the list can scroll while
// only a few rows show at once.
function moveChartSuggestionActiveIndex(delta) {
  const items = elements.chartCountrySuggestions.querySelectorAll(
    ".chip-suggestion",
  );
  if (!items.length) return;
  chartSuggestionActiveIndex = Math.min(
    items.length - 1,
    Math.max(0, chartSuggestionActiveIndex + delta),
  );
  items.forEach((item, i) => {
    item.classList.toggle("highlighted", i === chartSuggestionActiveIndex);
  });
  items[chartSuggestionActiveIndex].scrollIntoView({ block: "nearest" });
}

function renderChartCountrySuggestions() {
  const query = elements.chartCountrySearch.value.trim();
  if (!query) {
    hideChartCountrySuggestions();
    return;
  }
  const matches = chartCountryMatches(query);
  elements.chartCountrySuggestions.hidden = false;
  // The list itself just changed (new keystroke), so whatever the arrow
  // keys had highlighted before no longer lines up with anything.
  chartSuggestionActiveIndex = -1;
  if (!matches.length) {
    const empty = document.createElement("div");
    empty.className = "chip-suggestions-empty";
    empty.textContent = "No matching countries";
    elements.chartCountrySuggestions.replaceChildren(empty);
    return;
  }
  elements.chartCountrySuggestions.replaceChildren(
    ...matches.map((country) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "chip-suggestion";

      const flag = document.createElement("span");
      flag.className = "chip-suggestion-flag";
      flag.style.backgroundImage = `url(${flagIconUrl(country.iso3)})`;

      const label = document.createElement("span");
      label.textContent = country.name;

      item.append(flag, label);
      item.addEventListener("click", () =>
        selectChartCountrySuggestion(country.iso3),
      );
      return item;
    }),
  );
}

function setChartMetric(key) {
  if (key === chartMetricKey || (!METRICS[key] && key !== CHART_RADAR_KEY)) {
    return;
  }
  chartMetricKey = key;
  elements.chartMetricTabs.querySelectorAll("button").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.key === key);
  });
  updateProjectionScenarioVisibility();
  renderTrendChart();
  renderChartTable();
  syncUrlFromState();
}

function updateProjectionScenarioVisibility() {
  elements.chartProjectionScenario.hidden =
    chartMetricKey !== "population";
}

function renderChartMetricTabs() {
  elements.chartMetricTabs.replaceChildren(
    // The radar tab (see renderRadarChart/CHART_RADAR_KEY) is implemented
    // but temporarily withheld from this list pending a visual pass —
    // switch this back to [...CHART_METRIC_KEYS, CHART_RADAR_KEY] once
    // it's ready.
    ...CHART_METRIC_KEYS.map((key) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "mono-uppercase";
      btn.dataset.key = key;
      btn.textContent =
        key === CHART_RADAR_KEY ? "Radar chart" : METRICS[key].label;
      btn.classList.toggle("active", key === chartMetricKey);
      btn.addEventListener("click", () => setChartMetric(key));
      return btn;
    }),
  );
}

// Rebuilt from scratch on every metric/selection change rather than
// incrementally updated — infrequent enough (explicit tab/flag clicks) that
// a full rebuild is simpler and cheap at this scale (a handful of countries
// × 151 years).
function renderTrendChart({ animate = false } = {}) {
  // The radar tab swaps in a completely different chart type (a single-year
  // snapshot plotted on five metrics at once, not a time series) rather
  // than being a variant of the line chart below — renderRadarChart owns
  // its own SVG so the two don't have to share layout logic that doesn't
  // apply to both.
  const isRadar = chartMetricKey === CHART_RADAR_KEY;
  // Plain .hidden assignment doesn't reliably reflect to the `hidden`
  // content attribute on SVG elements in every engine — setAttribute/
  // removeAttribute always does, so the [hidden] CSS rule actually applies.
  elements.trendChart.toggleAttribute("hidden", isRadar);
  elements.radarChart.toggleAttribute("hidden", !isRadar);
  trendChartAnimationHandle?.cancel();
  trendChartAnimationHandle = null;
  if (isRadar) {
    renderRadarChart();
    return;
  }

  const svg = elements.trendChart;
  const width = svg.clientWidth || 900;
  const height = svg.clientHeight || 360;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

  const items = chartItems();
  const key = chartMetricKey;
  const definition = METRICS[key];
  const n = yearsData.length;
  const cutoffIndex = Math.max(0, yearsData.indexOf(historicalCutoffYear));
  // Left padding fits the Y axis's value labels (e.g. "10.29B", "80.0
  // yrs"). The right edge stays compact now that the chart does not render
  // endpoint labels.
  const pad = TREND_CHART_PADDING;
  const chartTop = 4;
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;

  const allValues = [];
  items.forEach((item) => {
    item.series(key).forEach((value) => {
      if (Number.isFinite(value)) allValues.push(value);
    });
  });
  const referenceValue = definition?.referenceValue;
  const { min, max, range } = computeValueRange(allValues, referenceValue);

  function yFor(value) {
    return chartYFor(value, min, range, innerH, pad.top);
  }
  function xFor(index) {
    return chartXFor(index, n, innerW, pad.left);
  }
  function pathFor(series, from, to) {
    return buildLinePath(series, from, to, xFor, yFor);
  }

  const elementsToAppend = [];
  // Population's own .format spells out the full number ("701,283,707"),
  // right for a single-value table cell but too wide and precise for an
  // axis with several ticks stacked close together — millions keeps every
  // tick on this metric in one consistent, compact unit.
  const tickFormat =
    key === "population"
      ? (value) => `${Math.round(value / 1_000_000).toLocaleString()}M`
      : (definition?.format ?? ((value) => `${value}`));

  // Y axis: a spine at the left edge plus a handful of evenly-spaced value
  // ticks (gridline + short tick mark + label), so the plotted lines read
  // against an actual scale instead of just relative shape.
  const Y_TICK_COUNT = 2;
  elementsToAppend.push(
    svgEl("line", {
      class: "trend-chart-axis",
      x1: pad.left,
      x2: pad.left,
      y1: chartTop,
      y2: height - pad.bottom,
    }),
  );

  // elementsToAppend.push(
  //   svgEl("line", {
  //     class: "trend-chart-axis",
  //     x1: width - pad.right,
  //     x2: width - pad.right,
  //     y1: pad.top,
  //     y2: height - pad.bottom,
  //   }),
  // );

  elementsToAppend.push(
    svgEl("line", {
      class: "trend-chart-axis",
      x1: pad.left,
      x2: width - pad.right,
      y1: height - pad.bottom,
      y2: height - pad.bottom,
    }),
  );

  for (let i = 0; i < Y_TICK_COUNT; i++) {
    const tickValue = min + (range / (Y_TICK_COUNT - 1)) * i;
    const y = yFor(tickValue).toFixed(1);
    elementsToAppend.push(
      svgEl("line", {
        class: "trend-chart-tick-line",
        x1: pad.left,
        x2: width - pad.right,
        y1: y,
        y2: y,
      }),
      svgEl("line", {
        class: "trend-chart-tick",
        x1: pad.left - 4,
        x2: pad.left,
        y1: y,
        y2: y,
      }),
    );
    const tickLabel = svgEl("text", {
      class: "trend-chart-axis-label",
      x: pad.left - 8,
      y: (Number(y) + 3).toFixed(1),
      "text-anchor": "end",
    });
    tickLabel.textContent = tickValue === 0 ? "0" : tickFormat(tickValue);
    elementsToAppend.push(tickLabel);
  }

  for (const benchmark of CHART_BENCHMARK_LINES[key] ?? []) {
    const benchmarkY = yFor(benchmark.value).toFixed(1);
    elementsToAppend.push(
      svgEl("line", {
        class: "trend-chart-baseline",
        x1: pad.left,
        x2: width - pad.right,
        y1: benchmarkY,
        y2: benchmarkY,
      }),
    );
    const benchmarkLabel = svgEl("text", {
      class: "trend-chart-baseline-label",
      x: pad.left - 8,
      y: Math.max(yFor(benchmark.value) +3, 12).toFixed(1),
      "text-anchor": "end",
    });
    benchmarkLabel.textContent = benchmark.label;
    elementsToAppend.push(benchmarkLabel);
  }

  const axisY = height - 6;
  const labelFirst = svgEl("text", {
    class: "trend-chart-axis-label",
    x: pad.left,
    y: axisY,
    "text-anchor": "start",
  });
  labelFirst.textContent = yearsData[0];
  const labelLast = svgEl("text", {
    class: "trend-chart-axis-label",
    x: width - pad.right,
    y: axisY,
    "text-anchor": "end",
  });
  labelLast.textContent = yearsData[n - 1];
  elementsToAppend.push(labelFirst, labelLast);

  // Bottom of the plot area — every line starts flattened here and grows
  // up into its real shape below, when animate is on.
  const baselineY = pad.top + innerH;
  const growingLines = [];
  items.forEach((item) => {
    const color = item.color;
    const series = item.series(key);
    const historicalPath = svgEl("path", {
      class: "trend-line historical",
      d: animate
        ? buildLinePath(series, 0, cutoffIndex, xFor, () => baselineY)
        : pathFor(series, 0, cutoffIndex),
      stroke: color,
    });
    const projectedPath = svgEl("path", {
      class: "trend-line projected",
      d: animate
        ? buildLinePath(series, cutoffIndex, n - 1, xFor, () => baselineY)
        : pathFor(series, cutoffIndex, n - 1),
      stroke: color,
    });
    // A transparent, wider copy of each path makes thin curves easy to hit
    // without changing their appearance. Its tooltip uses item.name rather
    // than the old abbreviated endpoint labels, so Country, Region, and
    // Income group modes all expose a readable legend on demand.
    const historicalHitPath = svgEl("path", {
      class: "trend-line-hit",
      d: pathFor(series, 0, cutoffIndex),
    });
    const projectedHitPath = svgEl("path", {
      class: "trend-line-hit",
      d: pathFor(series, cutoffIndex, n - 1),
    });
    [historicalHitPath, projectedHitPath].forEach((hitPath) => {
      hitPath.addEventListener("pointerenter", (event) =>
        showChartTooltip(event, item.name, color),
      );
      hitPath.addEventListener("pointermove", (event) =>
        showChartTooltip(event, item.name, color),
      );
      hitPath.addEventListener("pointerleave", hideChartTooltip);
    });
    elementsToAppend.push(
      historicalPath,
      projectedPath,
      historicalHitPath,
      projectedHitPath,
    );
    if (animate) {
      growingLines.push(
        { el: historicalPath, series, from: 0, to: cutoffIndex },
        { el: projectedPath, series, from: cutoffIndex, to: n - 1 },
      );
    }
  });

  // Marks the year the rest of the app (table below) is currently showing,
  // so the chart reads as "here's where that number comes from" instead of
  // a plot floating free of the year — and doubles as this view's only way
  // to scrub years, now that #timelineContainer stays hidden here.
  if (currentYearIndex >= 0 && currentYearIndex < n) {
    const markerX = xFor(currentYearIndex).toFixed(1);
    const markerPillWidth = 32;
    const markerPillHeight = 18;
    const markerPillY = chartTop;
    const markerLine = svgEl("line", {
      class: "trend-chart-year-marker",
      x1: markerX,
      x2: markerX,
      y1: markerPillY + markerPillHeight,
      y2: height - pad.bottom,
    });
    const markerPill = svgEl("rect", {
      class: "trend-chart-year-pill",
      x: (Number(markerX) - markerPillWidth / 2).toFixed(1),
      y: markerPillY,
      width: markerPillWidth,
      height: markerPillHeight,
      rx: 4,
    });
    const markerLabel = svgEl("text", {
      class: "trend-chart-year-label",
      x: markerX,
      y: markerPillY + 13,
      "text-anchor": "middle",
    });
    markerLabel.textContent = yearsData[currentYearIndex];
    const DRAG_HIT_HALF_WIDTH = 10;
    const dragHit = svgEl("rect", {
      class: "trend-chart-year-drag",
      x: (Number(markerX) - DRAG_HIT_HALF_WIDTH).toFixed(1),
      y: markerPillY + markerPillHeight,
      width: DRAG_HIT_HALF_WIDTH * 2,
      height: height - pad.bottom - markerPillY - markerPillHeight,
    });

    function yearForClientX(clientX) {
      const rect = svg.getBoundingClientRect();
      const localX = ((clientX - rect.left) / rect.width) * width;
      const ratio = (localX - pad.left) / innerW;
      const index = Math.round(ratio * (n - 1));
      return yearsData[Math.min(n - 1, Math.max(0, index))];
    }

    // Cheap live preview while dragging: moves the marker and updates the
    // table directly (both untouched by the SVG's own re-renders) without
    // going through applyYear()'s full year-change pipeline — that only
    // runs once, at drag end, via goToYear() below. Re-rendering this SVG
    // mid-drag would also drop the pointer capture, since setPointerCapture
    // is tied to the specific DOM node it was called on.
    let chartTableRenderScheduled = false;
    function previewYear(year) {
      const index = yearsData.indexOf(year);
      if (index === -1 || index === currentYearIndex) return;
      const x = xFor(index).toFixed(1);
      markerLine.setAttribute("x1", x);
      markerLine.setAttribute("x2", x);
      markerPill.setAttribute(
        "x",
        (Number(x) - markerPillWidth / 2).toFixed(1),
      );
      markerLabel.setAttribute("x", x);
      markerLabel.textContent = year;
      dragHit.setAttribute("x", (Number(x) - DRAG_HIT_HALF_WIDTH).toFixed(1));
      currentYearIndex = index;
      // pointermove can fire far more often than every animation frame, but
      // renderChartTable() tears down and rebuilds every cell (and re-attaches
      // every click listener) from scratch — coalescing to one rebuild per
      // frame keeps a fast drag smooth instead of visibly stuttering.
      if (!chartTableRenderScheduled) {
        chartTableRenderScheduled = true;
        requestAnimationFrame(() => {
          chartTableRenderScheduled = false;
          renderChartTable();
        });
      }
    }

    let dragging = false;
    dragHit.addEventListener("pointerdown", (event) => {
      dragging = true;
      tourController.stop();
      dragHit.setPointerCapture(event.pointerId);
      previewYear(yearForClientX(event.clientX));
    });
    dragHit.addEventListener("pointermove", (event) => {
      if (dragging) previewYear(yearForClientX(event.clientX));
    });
    const endDrag = () => {
      if (!dragging) return;
      dragging = false;
      // Commits the previewed year through the normal pipeline — syncs the
      // (hidden) slider, the URL, and the 3D scene's own year once chart
      // view closes.
      goToYear(yearsData[currentYearIndex]);
    };
    dragHit.addEventListener("pointerup", endDrag);
    dragHit.addEventListener("pointercancel", endDrag);

    elementsToAppend.push(markerLine, markerPill, markerLabel, dragHit);
  }

  svg.replaceChildren(...elementsToAppend);

  if (growingLines.length) {
    trendChartAnimationHandle = runChartAnimation({
      duration: CHART_LINE_GROW_MS,
      easing: easeOutCubic,
      onFrame: (eased) => {
      growingLines.forEach(({ el, series, from, to }) => {
        el.setAttribute(
          "d",
          buildLinePath(series, from, to, xFor, (value) =>
            baselineY + (yFor(value) - baselineY) * eased,
          ),
        );
      });
      },
      onFinish: () => {
        trendChartAnimationHandle = null;
      },
    });
  }
}

// A radar/spider chart plotting five metrics as spokes around a wheel for
// every selected item at the currently selected year — a snapshot, not a
// time series, so unlike renderTrendChart this rebuilds completely on every
// year change rather than owning a persistent line shape that a year
// marker slides across. Chosen over a bubble/scatter layout because a
// scatter plot reads poorly with only a couple of points selected; a
// radar chart's shape comparison still works with as few as two items.
function renderRadarChart() {
  const svg = elements.radarChart;
  const width = svg.clientWidth || 900;
  const height = svg.clientHeight || 360;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

  const items = chartItems();
  const n = yearsData.length;
  const pad = RADAR_CHART_PADDING;
  const innerW = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const cx = pad.left + innerW / 2;
  const cy = pad.top + plotHeight / 2;
  const maxR = Math.max(20, Math.min(innerW, plotHeight) / 2);
  const axisCount = RADAR_CHART_METRICS.length;

  // Clockwise from the top: population growth, fertility, migration, life
  // expectancy, dependency ratio.
  function angleFor(i) {
    return (-90 + (360 / axisCount) * i) * (Math.PI / 180);
  }
  function spokePoint(i, r) {
    const angle = angleFor(i);
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  }

  const points = items
    .map((item) => ({
      item,
      values: RADAR_CHART_METRICS.map(
        (key) => item.series(key)[currentYearIndex],
      ),
    }))
    // A radar polygon needs all five vertices — one missing metric leaves no
    // sensible way to draw that item's shape, so it's dropped rather than
    // interpolated or zeroed.
    .filter(({ values }) => values.every(Number.isFinite));

  const elementsToAppend = [];

  // The year scrubber (see below) still needs to render even with no
  // plottable points, so it's built after this early return rather than
  // wrapping the whole function.
  if (!points.length) {
    const message = svgEl("text", {
      class: "trend-chart-axis-label",
      x: (width / 2).toFixed(1),
      y: (height / 2).toFixed(1),
      "text-anchor": "middle",
    });
    message.textContent =
      "No comparable data is available for the selected countries.";
    elementsToAppend.push(message);
  } else {
    // Each spoke is normalized independently against the selected items'
    // own min/max — a radar chart's shape only means something relative to
    // what's actually plotted, not against each metric's global range, and
    // the five metrics don't share units anyway.
    const domains = RADAR_CHART_METRICS.map((_, axisIndex) => {
      const values = points.map((p) => p.values[axisIndex]);
      return { min: Math.min(...values), max: Math.max(...values) };
    });
    function normalize(value, axisIndex) {
      const { min, max } = domains[axisIndex];
      return max === min ? 0.5 : (value - min) / (max - min);
    }

    // Concentric rings at 25/50/75/100% give the eye a scale to read
    // distance-from-center against, the same role the trend chart's Y
    // ticks play.
    [0.25, 0.5, 0.75, 1].forEach((fraction) => {
      const ringPoints = RADAR_CHART_METRICS.map((_, i) => {
        const p = spokePoint(i, maxR * fraction);
        return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
      }).join(" ");
      elementsToAppend.push(
        svgEl("circle", { class: "radar-grid-ring", cx: width/2, cy: height/2, r: fraction*maxR }),
        // svgEl("polygon", { class: "radar-grid-ring", points: ringPoints }),
      );
    });

    RADAR_CHART_METRICS.forEach((key, i) => {
      const outer = spokePoint(i, maxR);
      elementsToAppend.push(
        svgEl("line", {
          class: "trend-chart-axis",
          x1: cx.toFixed(1),
          y1: cy.toFixed(1),
          x2: outer.x.toFixed(1),
          y2: outer.y.toFixed(1),
        }),
      );
      const labelPoint = spokePoint(i, maxR + 14);
      const cos = Math.cos(angleFor(i));
      const anchor = cos > 0.3 ? "start" : cos < -0.3 ? "end" : "middle";
      const label = svgEl("text", {
        class: "trend-chart-axis-label",
        x: labelPoint.x.toFixed(1),
        y: (labelPoint.y + 4).toFixed(1),
        "text-anchor": anchor,
      });
      label.textContent = METRICS[key].label;
      elementsToAppend.push(label);
    });

    points.forEach(({ item, values }) => {
      const vertices = values.map((value, axisIndex) =>
        spokePoint(axisIndex, normalize(value, axisIndex) * maxR),
      );
      const polygon = svgEl("polygon", {
        class: "radar-polygon",
        points: vertices
          .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
          .join(" "),
        fill: item.color,
        stroke: item.color,
      });
      polygon.addEventListener("pointerenter", (event) =>
        showChartTooltip(event, item.name, item.color),
      );
      polygon.addEventListener("pointermove", (event) =>
        showChartTooltip(event, item.name, item.color),
      );
      polygon.addEventListener("pointerleave", hideChartTooltip);
      elementsToAppend.push(polygon);
      vertices.forEach((p) => {
        elementsToAppend.push(
          svgEl("circle", {
            class: "radar-vertex",
            cx: p.x.toFixed(1),
            cy: p.y.toFixed(1),
            r: 2.5,
            fill: item.color,
          }),
        );
      });
    });
  }

  // A compact year scrubber along the top edge — the only way to change
  // year while this tab is active, since #timelineContainer stays hidden
  // for the whole chart view and every polygon's shape (unlike the trend
  // chart's lines) is itself year-dependent. Mirrors renderTrendChart's own
  // marker: cheap live-drag preview that only moves the pill and
  // live-updates the table, committing the actual polygons through
  // goToYear()'s full pipeline at drag end — re-rendering this SVG
  // mid-drag would drop the pointer capture the drag depends on.
  if (currentYearIndex >= 0 && currentYearIndex < n) {
    const scrubberY = 4;
    const pillWidth = 32;
    const pillHeight = 18;
    const scrubberX = chartXFor(currentYearIndex, n, innerW, pad.left).toFixed(1);
    const scrubberLine = svgEl("line", {
      class: "trend-chart-year-marker",
      x1: scrubberX,
      x2: scrubberX,
      y1: scrubberY + pillHeight,
      y2: scrubberY + pillHeight + 6,
    });
    const scrubberPill = svgEl("rect", {
      class: "trend-chart-year-pill",
      x: (Number(scrubberX) - pillWidth / 2).toFixed(1),
      y: scrubberY,
      width: pillWidth,
      height: pillHeight,
      rx: 4,
    });
    const scrubberLabel = svgEl("text", {
      class: "trend-chart-year-label",
      x: scrubberX,
      y: scrubberY + 13,
      "text-anchor": "middle",
    });
    scrubberLabel.textContent = yearsData[currentYearIndex];
    const DRAG_HIT_HALF_WIDTH = 10;
    const scrubberDragHit = svgEl("rect", {
      class: "trend-chart-year-drag",
      x: (Number(scrubberX) - DRAG_HIT_HALF_WIDTH).toFixed(1),
      y: scrubberY,
      width: DRAG_HIT_HALF_WIDTH * 2,
      height: pillHeight + 6,
    });

    function yearForClientX(clientX) {
      const rect = svg.getBoundingClientRect();
      const localX = ((clientX - rect.left) / rect.width) * width;
      const ratio = (localX - pad.left) / innerW;
      const index = Math.round(ratio * (n - 1));
      return yearsData[Math.min(n - 1, Math.max(0, index))];
    }

    let chartTableRenderScheduled = false;
    function previewYear(year) {
      const index = yearsData.indexOf(year);
      if (index === -1 || index === currentYearIndex) return;
      const x = chartXFor(index, n, innerW, pad.left).toFixed(1);
      scrubberLine.setAttribute("x1", x);
      scrubberLine.setAttribute("x2", x);
      scrubberPill.setAttribute("x", (Number(x) - pillWidth / 2).toFixed(1));
      scrubberLabel.setAttribute("x", x);
      scrubberLabel.textContent = year;
      scrubberDragHit.setAttribute(
        "x",
        (Number(x) - DRAG_HIT_HALF_WIDTH).toFixed(1),
      );
      currentYearIndex = index;
      if (!chartTableRenderScheduled) {
        chartTableRenderScheduled = true;
        requestAnimationFrame(() => {
          chartTableRenderScheduled = false;
          renderChartTable();
        });
      }
    }

    let dragging = false;
    scrubberDragHit.addEventListener("pointerdown", (event) => {
      dragging = true;
      tourController.stop();
      scrubberDragHit.setPointerCapture(event.pointerId);
      previewYear(yearForClientX(event.clientX));
    });
    scrubberDragHit.addEventListener("pointermove", (event) => {
      if (dragging) previewYear(yearForClientX(event.clientX));
    });
    const endDrag = () => {
      if (!dragging) return;
      dragging = false;
      goToYear(yearsData[currentYearIndex]);
    };
    scrubberDragHit.addEventListener("pointerup", endDrag);
    scrubberDragHit.addEventListener("pointercancel", endDrag);

    elementsToAppend.push(scrubberLine, scrubberPill, scrubberLabel, scrubberDragHit);
  }

  svg.replaceChildren(...elementsToAppend);
}

// --- Plot view (Globe/Map/Chart's fourth mode) --------------------------
// A hybrid 2D isometric world: a native SVG grid floor + axes, overlaid
// with GPU-accelerated HTML cards (one per country, positioned via CSS
// transform) placed by three demographic metrics at once — fertility (X),
// life expectancy (Y, vertical), and net migration rate (Z). The year
// slider drives every card's position simultaneously, so a trend reads as
// motion through the grid rather than a redrawn chart.
let plotDomains = null; // { fertility: {min,max}, ... } — global across every country/year, computed once
let plotCardsBuilt = false;
let plotCardEntries = []; // [{ country, el }]
let plotLayoutCache = null; // { scale, centerX, centerY } from the last renderPlotGrid()

const PLOT_AXES = { x: "fertility", y: "lifeExpectancy", z: "netMigrationRate" };
// Classic 30° axonometric projection (rotate the ground plane 45°, squash
// vertically) — baked-in constants rather than recomputed every call.
const ISO_COS30 = Math.cos(Math.PI / 6);
const ISO_SIN30 = Math.sin(Math.PI / 6);
// How tall the Y (life expectancy) axis reads relative to the ground
// plane's own diagonal span. 1 keeps the whole iso-space symmetric around
// the origin (see plotLayout), which is what makes centering it in the
// viewport a matter of just centering on iso (0, 0).
const PLOT_HEIGHT_SCALE = 1;
// Kept tight — every pixel handed back here goes straight into scale (see
// plotLayout), which is what actually makes a given year-to-year data
// change move a card further. Sized just wide/tall enough for the
// shortened axis-name labels (PLOT_AXIS_LABELS) plus their min/max
// ticks, not the full METRICS[key].label + value strings used elsewhere.
const PLOT_MARGIN = { top: 60, right: 0, bottom: 0, left: 0 };
const PLOT_GRID_DIVISIONS = 3;
// Depth-sort buckets for z-index (see positionPlotCards) — deliberately
// coarse. z-index has no interpolation, so every reorder is an instant,
// visible cut; a fine-grained bucket count reshuffles ~200 overlapping
// cards on nearly every frame during the region-select timeline sweep
// (playPlotTimelineOnce), which reads as flicker. This few buckets is
// still plenty to keep "further toward the viewer" cards on top — exact
// ordering within a band doesn't matter for a cluster of flag icons.
const PLOT_ZINDEX_BUCKETS = 20;
// With tick values hidden, the axis/grid only need to communicate
// direction, not a precise scale — so cards (not the axis lines or their
// labels, which stay at the literal [0,1] mapping) get stretched away from
// the center of each axis to amplify how far a country's position and
// year-to-year movement actually read. 1 is a no-op; >1 exaggerates.
const PLOT_MOVEMENT_SCALE = 1.1;

function amplifyPlotMovement(normalized) {
  return 0.5 + (normalized - 0.5) * PLOT_MOVEMENT_SCALE;
}
// Shorter than METRICS[key].label ("Net migration rate" etc.) — every
// character here is width the axis's own margin has to reserve, at the
// direct expense of the plot's scale.
const PLOT_AXIS_LABELS = {
  fertility: "Fertility rate",
  lifeExpectancy: "Life expectancy",
  netMigrationRate: "Migration rate",
};

// One entry per real region (same taxonomy as REGION_COLORS/the Globe-Map
// legend, plus a one-line summary of that region's demographic story) — the
// left-panel list this drives doubles as a filter (see
// setPlotGroupFilter): every country is always plotted, selecting one of
// these just hides the rest so a single cluster is easier to pick out.
const PLOT_REGIONS = [
  {
    label: "Sub-Saharan Africa",
    summary: "Still-rising fertility and the fastest population growth of any region.",
  },
  {
    label: "East Asia & Pacific",
    summary: "A wide mix — China and Japan's ultra-low fertility alongside Pacific islands with very different profiles.",
  },
  {
    label: "Europe & Central Asia",
    summary: "Aging populations kept from shrinking mainly by immigration rather than fertility.",
  },
  {
    label: "Latin America & Caribbean",
    summary: "Fertility moderating quickly, tracking a generation or two behind East Asia.",
  },
  {
    label: "Middle East, North Africa, Afghanistan & Pakistan",
    summary: "A wide range — Gulf states with extreme migration inflows alongside still-high-fertility Afghanistan and Pakistan.",
  },
  {
    label: "North America",
    summary: "Steady growth driven by immigration rather than fertility.",
  },
  {
    label: "South Asia",
    summary: "The world's most populous region, now mid-transition as fertility falls.",
  },
].map((region) => ({
  kind: "region",
  label: region.label,
  summary: region.summary,
  color: REGION_COLORS[region.label] ?? DEFAULT_COLOR,
}));

// Same idea, sliced by income tier instead of geography — a different lens
// on the same underlying countries/cards, not a second independent filter
// (see plotSelectedGroup — only one of region/income can be active at
// once).
const PLOT_INCOME_GROUPS = [
  {
    label: "High-income countries",
    summary: "Sub-replacement fertility and historic longevity. An aging demographic relying on net migration to sustain its peak.",
  },
  {
    label: "Middle-income countries",
    summary: "The global engine. A vast, mid-transition population driving the bulk of current urban and economic expansion.",
  },
  {
    label: "Low-income countries",
    summary: "High fertility paired with emerging lifespans. A highly youthful, rapidly growing tier concentrated in Sub-Saharan Africa.",
  }
].map((group) => ({
  kind: "income",
  label: group.label,
  summary: group.summary,
  color: INCOME_GROUP_COLORS[group.label] ?? DEFAULT_COLOR,
}));

// null = every country visible; otherwise one entry from PLOT_REGIONS or
// PLOT_INCOME_GROUPS, and every country outside it has its card hidden
// (see positionPlotCards). Reset whenever Plot closes (setPlotActive)
// so each visit starts unfiltered.
let plotSelectedGroup = null;
// Which of PLOT_REGIONS/PLOT_INCOME_GROUPS the summary panel currently
// shows — a separate, Plot-local concept from plotSelectedGroup (which
// filter is applied to the cards) and from the Globe/Map legend's own
// colorMode: the two panels look alike (both reuse .tab-group) but Plot's
// filter+replay click behavior has nothing to do with colorMode's
// recolor+drill-down, so they don't share state or DOM.
let plotGroupTab = "region";

function plotGroupKey(group) {
  return `${group.kind}:${group.label}`;
}

function normalizePlotValue(value, domain) {
  if (!domain) return 0.5;
  const { min, max } = domain;
  if (max === min) return 0.5;
  // Values outside the percentile-clipped domain (see computePlotDomains)
  // pin to the edge rather than pushing a card off the grid entirely.
  return Math.min(1, Math.max(0, (value - min) / (max - min)));
}

// nx/nz are the ground-plane axes (fertility/migration), ny is height
// (life expectancy), each normalized to [0, 1].
function plotProject(nx, ny, nz) {
  const isoX = (nx - nz) * ISO_COS30;
  const isoY = (nx + nz) * ISO_SIN30 - ny * PLOT_HEIGHT_SCALE;
  return { isoX, isoY };
}

// iso (0,0) sits at the pixel center of the available plot area — the
// bounding box is symmetric in both isoX ([-cos30, cos30]) and isoY
// ([-1, 1]) around that point (see PLOT_HEIGHT_SCALE), so this also
// happens to be the geometric center of the whole shape, not just the
// origin corner's own projection.
function plotLayout(width, height) {
  const availW = width - PLOT_MARGIN.left - PLOT_MARGIN.right;
  const availH = height - PLOT_MARGIN.top - PLOT_MARGIN.bottom;
  const isoWidthUnits = 2 * ISO_COS30;
  const isoHeightUnits = 2;
  const scale = Math.max(
    20,
    Math.min(availW / isoWidthUnits, availH / isoHeightUnits),
  );
  return {
    scale,
    centerX: width / 2,
    centerY: PLOT_MARGIN.top + availH / 2,
  };
}

function plotPixel(nx, ny, nz, layout) {
  const { isoX, isoY } = plotProject(nx, ny, nz);
  return {
    x: layout.centerX + isoX * layout.scale,
    y: layout.centerY + isoY * layout.scale,
  };
}

// Inverse of plotPixel at floor level (ny = 0) — given a pixel, which
// ground-plane (nx, nz) projects there. Used only to figure out how far the
// grid floor (see renderPlotGrid) needs to extend to cover a canvas
// corner; not needed for card placement, which only ever goes pixel-space.
function plotUnproject(pixelX, pixelY, layout) {
  const isoX = (pixelX - layout.centerX) / layout.scale;
  const isoY = (pixelY - layout.centerY) / layout.scale;
  // Inverting isoX = (nx-nz)*cos30, isoY = (nx+nz)*sin30.
  const nx = (isoX / ISO_COS30 + isoY / ISO_SIN30) / 2;
  const nz = (isoY / ISO_SIN30 - isoX / ISO_COS30) / 2;
  return { nx, nz };
}

function percentile(sortedValues, p) {
  const index = (sortedValues.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sortedValues[lower];
  return (
    sortedValues[lower] * (upper - index) + sortedValues[upper] * (index - lower)
  );
}

// Global (not per-year) domain per axis, across every country and every
// year — the space itself needs to stay fixed for a year change to read as
// motion through it rather than the grid rescaling under the cards. Returns
// null if the (lazily loaded) demographics data isn't in yet.
function computePlotDomains() {
  const domains = {};
  for (const key of Object.values(PLOT_AXES)) {
    const values = [];
    countriesData.forEach((country) => {
      chartSeriesFor(country, key).forEach((value) => {
        if (Number.isFinite(value)) values.push(value);
      });
    });
    if (!values.length) {
      domains[key] = null;
      continue;
    }
    values.sort((a, b) => a - b);
    // A handful of tiny-population territories post extreme swings
    // (especially in migration rate — a huge percentage move on a tiny
    // population base) that would otherwise stretch the whole axis and
    // collapse every other country into one corner of the grid. Clipping
    // to the 3rd/97th percentile keeps the space readable for the vast
    // majority; genuine outliers just sit pinned at the edge instead of
    // dictating the whole scale (see normalizePlotValue's clamp).
    const min = percentile(values, 0.03);
    const max = percentile(values, 0.97);
    domains[key] =
      min < max
        ? { min, max }
        : { min: values[0], max: values[values.length - 1] };
  }
  return Object.values(domains).every(Boolean) ? domains : null;
}

function ensurePlotDomains() {
  if (plotDomains) return true;
  plotDomains = computePlotDomains();
  return plotDomains != null;
}

function plotRegionColor(country) {
  return REGION_COLORS[country.region?.trim()] ?? DEFAULT_COLOR;
}

function buildPlotCards() {
  if (plotCardsBuilt) return;
  plotCardEntries = countriesData.map((country) => {
    const color = plotRegionColor(country);
    const el = document.createElement("div");
    el.className = "plot-card";
    el.style.setProperty("--card-color", color);
    const flag = document.createElement("span");
    flag.className = "plot-card-flag";
    flag.style.backgroundImage = `url(${flagIconUrl(country.iso3, false)})`;
    const name = document.createElement("span");
    name.className = "plot-card-name";
    name.textContent = country.name;
    el.append(flag, name);
    el.addEventListener("pointerenter", (event) =>
      showChartTooltip(event, country.name, color),
    );
    el.addEventListener("pointermove", (event) =>
      showChartTooltip(event, country.name, color),
    );
    el.addEventListener("pointerleave", hideChartTooltip);
    // el.addEventListener("click", () => {
    //   setPlotActive(false);
    //   openCountryDetail(country);
    // });
    return { country, el, lastZIndex: null };
  });
  elements.plotCards.replaceChildren(
    ...plotCardEntries.map((entry) => entry.el),
  );
  plotCardsBuilt = true;
}

// Cheap per-year update: only moves/recolors existing cards, never touches
// the grid or rebuilds any DOM — safe to call on every year-slider "input"
// frame while dragging.
// yearIndex may be fractional (see playPlotTimelineOnce) — years data
// only has one value per whole year, so a fractional index linearly
// interpolates between the two nearest years' values instead of picking
// one. A whole-number index (every other caller) degenerates to exactly
// that year's value, so this is a drop-in generalization, not a behavior
// change for them.
function valueAtFractionalYear(country, key, yearIndex) {
  const series = chartSeriesFor(country, key);
  const lower = Math.floor(yearIndex);
  const upper = Math.min(series.length - 1, lower + 1);
  const a = series[lower];
  const b = series[upper];
  if (!Number.isFinite(a)) return b;
  if (!Number.isFinite(b)) return a;
  return a + (b - a) * (yearIndex - lower);
}

function positionPlotCards(yearIndex) {
  if (!plotLayoutCache || yearIndex == null || yearIndex < 0) return;
  plotCardEntries.forEach((entry) => {
    const { country, el } = entry;
    if (plotSelectedGroup) {
      const value =
        plotSelectedGroup.kind === "income"
          ? country._incomeLabel
          : country.region?.trim();
      if (value !== plotSelectedGroup.label) {
        el.style.opacity = "0";
        el.style.pointerEvents = "none";
        return;
      }
    }
    const x = valueAtFractionalYear(country, PLOT_AXES.x, yearIndex);
    const y = valueAtFractionalYear(country, PLOT_AXES.y, yearIndex);
    const z = valueAtFractionalYear(country, PLOT_AXES.z, yearIndex);
    if (![x, y, z].every(Number.isFinite)) {
      el.style.opacity = "0";
      el.style.pointerEvents = "none";
      return;
    }
    // Amplified (see PLOT_MOVEMENT_SCALE) for the card's own position and
    // depth sort — the axis lines/grid/ticks below are built separately in
    // renderPlotGrid, from the un-amplified [0,1] mapping, and are
    // unaffected by this.
    const nx = amplifyPlotMovement(
      normalizePlotValue(x, plotDomains[PLOT_AXES.x]),
    );
    const ny = amplifyPlotMovement(
      normalizePlotValue(y, plotDomains[PLOT_AXES.y]),
    );
    const nz = amplifyPlotMovement(
      normalizePlotValue(z, plotDomains[PLOT_AXES.z]),
    );
    const point = plotPixel(nx, ny, nz, plotLayoutCache);
    el.style.transform = `translate3d(${point.x.toFixed(1)}px, ${point.y.toFixed(1)}px, 0) translate(-50%, -50%)`;
    // Ground-plane depth (nx+nz) sorts cards the way an isometric scene
    // should — one further "toward the viewer" (bigger nx+nz, lower on
    // screen) overlaps one further back, regardless of paint order. Written
    // only when the (coarse — see PLOT_ZINDEX_BUCKETS) bucket actually
    // changes: touching z-index forces the browser to re-evaluate
    // stacking/paint order even when the value is identical, worth
    // skipping on a property this many elements update every drag frame.
    const zIndex = Math.round((nx + nz) * PLOT_ZINDEX_BUCKETS);
    if (entry.lastZIndex !== zIndex) {
      el.style.zIndex = String(zIndex);
      entry.lastZIndex = zIndex;
    }
    el.style.opacity = "1";
    el.style.pointerEvents = "auto";
  });
}

function renderPlotGrid() {
  const svg = elements.plotGrid;
  const width = svg.clientWidth || 900;
  const height = svg.clientHeight || 600;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  const layout = plotLayout(width, height);
  plotLayoutCache = layout;

  const elementsToAppend = [];

  // The grid floor covers the whole canvas, not just the [0,1] cube the
  // axes/data actually span — unproject the four canvas corners back to
  // ground-plane coordinates to find how far out each line needs to run,
  // then snap that range to the same spacing the [0,1] cube already uses
  // so the two look like one continuous grid rather than two mismatched
  // ones.
  const spacing = 1 / PLOT_GRID_DIVISIONS;
  const corners = [
    plotUnproject(0, 0, layout),
    plotUnproject(width, 0, layout),
    plotUnproject(0, height, layout),
    plotUnproject(width, height, layout),
  ];
  const nxMin = Math.floor(Math.min(...corners.map((c) => c.nx)) / spacing) * spacing;
  const nxMax = Math.ceil(Math.max(...corners.map((c) => c.nx)) / spacing) * spacing;
  const nzMin = Math.floor(Math.min(...corners.map((c) => c.nz)) / spacing) * spacing;
  const nzMax = Math.ceil(Math.max(...corners.map((c) => c.nz)) / spacing) * spacing;

  // Lines of constant nz, spanning the full nx range (and vice versa) —
  // each line only needs to be as long as the whole canvas's nx/nz extent,
  // not just its own, since drawing a little past the visible edge is
  // harmless (the SVG's overflow: visible just lets it run off).
  for (let nz = nzMin; nz <= nzMax + spacing / 2; nz += spacing) {
    const a = plotPixel(nxMin, 0, nz, layout);
    const b = plotPixel(nxMax, 0, nz, layout);
    elementsToAppend.push(
      svgEl("line", {
        class: "plot-grid-line",
        x1: a.x.toFixed(1),
        y1: a.y.toFixed(1),
        x2: b.x.toFixed(1),
        y2: b.y.toFixed(1),
      }),
    );
  }
  for (let nx = nxMin; nx <= nxMax + spacing / 2; nx += spacing) {
    const c = plotPixel(nx, 0, nzMin, layout);
    const d = plotPixel(nx, 0, nzMax, layout);
    elementsToAppend.push(
      svgEl("line", {
        class: "plot-grid-line",
        x1: c.x.toFixed(1),
        y1: c.y.toFixed(1),
        x2: d.x.toFixed(1),
        y2: d.y.toFixed(1),
      }),
    );
  }

  const origin = plotPixel(0, 0, 0, layout);
  const axisEnds = {
    [PLOT_AXES.x]: { end: plotPixel(1, 0, 0, layout), anchor: "start", dx: 10, dy: 4 },
    [PLOT_AXES.z]: { end: plotPixel(0, 0, 1, layout), anchor: "end", dx: -10, dy: 4 },
    [PLOT_AXES.y]: { end: plotPixel(0, 1, 0, layout), anchor: "middle", dx: 0, dy: -12 },
  };

  Object.entries(axisEnds).forEach(([key, { end, anchor, dx, dy }]) => {
    elementsToAppend.push(
      svgEl("line", {
        class: "plot-axis-line",
        x1: origin.x.toFixed(1),
        y1: origin.y.toFixed(1),
        x2: end.x.toFixed(1),
        y2: end.y.toFixed(1),
      }),
    );
    const definition = METRICS[key];
    const domain = plotDomains?.[key];
    // Name only (no value) right at the endpoint — kept short so
    // PLOT_MARGIN can stay tight; the actual min/max values live in the
    // two ticks below instead.
    const nameLabel = svgEl("text", {
      class: "plot-axis-label",
      x: (end.x + dx).toFixed(1),
      y: (end.y + dy).toFixed(1),
      "text-anchor": anchor,
    });
    nameLabel.textContent = PLOT_AXIS_LABELS[key];
    elementsToAppend.push(nameLabel);
    if (!domain) return;
    // Both ticks sit a little way in from their respective ends, along
    // this axis's own direction — close enough to read as "the start/end
    // of this spoke" without the three axes' ticks overlapping each other
    // at the shared origin, and without the max tick colliding with the
    // name label right at the endpoint.
    [
      { t: 0.12, value: domain.min, offset: 0.6 },
      { t: 0.82, value: domain.max, offset: 0.75 },
    ].forEach(({ t, value, offset }) => {
      const point = plotPixel(
        key === PLOT_AXES.x ? t : 0,
        key === PLOT_AXES.y ? t : 0,
        key === PLOT_AXES.z ? t : 0,
        layout,
      );
      const tick = svgEl("text", {
        class: "plot-tick-label",
        x: (point.x + dx * offset).toFixed(1),
        y: (point.y + dy * offset + 3).toFixed(1),
        "text-anchor": anchor,
      });
      tick.textContent = definition.format(value);
      elementsToAppend.push(tick);
    });
  });

  svg.replaceChildren(...elementsToAppend);
}

let plotSummaryBuilt = false;
let plotPlaybackFrame = null;
const PLOT_PLAYBACK_DURATION_MS = 9000;

function stopPlotPlayback() {
  // .plot-card's own transition (a nicety for occasional updates — a
  // manual drag, a single click) actively works against a 60fps JS-driven
  // sweep: every position write mid-transition forces the compositor to
  // resample and retarget instead of just jumping to the new value, and
  // that retargeting cost compounds across ~200 cards every ~16ms for the
  // full 9s sweep. Switching regions mid-sweep used to make this worse by
  // starting a second overlapping retarget chain right on top of the
  // first's still-settling one — is-playing turns the transition off for
  // the whole sweep instead, so there's nothing left to retarget.
  elements.plotCards.classList.remove("is-playing");
  if (plotPlaybackFrame == null) return;
  cancelAnimationFrame(plotPlaybackFrame);
  plotPlaybackFrame = null;
}

// Sweeps the year slider from the very first year to the very last, once,
// so a newly selected region's cluster reads as trending across the whole
// dataset instead of sitting frozen wherever the slider happened to be.
// Mirrors the trend chart's own scrubber: cheap live updates (slider
// value/labels/card positions) every frame, committed through the real
// applyYear pipeline (goToYear) only once, at the end.
function playPlotTimelineOnce() {
  stopPlotPlayback();
  if (!plotActive || yearsData.length < 2) return;
  elements.plotCards.classList.add("is-playing");
  const lastYear = yearsData[yearsData.length - 1];
  const startTime = performance.now();

  function frame(now) {
    const t = Math.min(1, (now - startTime) / PLOT_PLAYBACK_DURATION_MS);
    // 150 years over PLOT_PLAYBACK_DURATION_MS is only ~60ms per whole
    // year — rounding to the nearest year index before positioning cards
    // meant most of the 60fps rAF frames recomputed the exact same
    // position, then jumped a visible amount every ~4th frame once the
    // rounded index finally ticked over. positionPlotCards now accepts a
    // fractional index and interpolates between the two nearest years, so
    // every single frame moves cards a little instead of most doing
    // nothing and one doing a lot — the slider/label still snap to whole
    // years since that's the only unit yearsData actually has.
    const fractionalIndex = t * (yearsData.length - 1);
    const index = Math.round(fractionalIndex);
    const year = yearsData[index];
    elements.yearSlider.value = year;
    updateSliderProgress();
    updateYearLabels(year);
    positionPlotCards(fractionalIndex);
    if (t < 1) {
      plotPlaybackFrame = requestAnimationFrame(frame);
    } else {
      plotPlaybackFrame = null;
      elements.plotCards.classList.remove("is-playing");
      goToYear(lastYear);
    }
  }
  plotPlaybackFrame = requestAnimationFrame(frame);
}

// Toggles the region/income filter (see plotSelectedGroup/
// positionPlotCards): clicking the already-selected group clears it, same
// as the Globe/Map legend's own selectLegendItem toggle. Cheap — only
// touches existing cards' opacity/transform, never rebuilds the grid or
// DOM. Selecting a group (not clearing one) also replays the whole timeline
// once, so its cluster's trend is visible immediately rather than needing a
// manual drag.
function setPlotGroupFilter(group) {
  const isDeselecting =
    plotSelectedGroup != null &&
    plotGroupKey(plotSelectedGroup) === plotGroupKey(group);
  plotSelectedGroup = isDeselecting ? null : group;
  elements.plotGroups.querySelectorAll(".plot-group-item").forEach((item) => {
    item.classList.toggle(
      "active",
      plotSelectedGroup != null &&
        item.dataset.groupKey === plotGroupKey(plotSelectedGroup),
    );
  });
  if (isDeselecting) {
    stopPlotPlayback();
    positionPlotCards(currentYearIndex);
  } else {
    // No positionPlotCards(currentYearIndex) call here — during an
    // active sweep currentYearIndex is stale (the sweep drives the slider
    // directly, not through applyYear, until it commits at the end), so
    // that call would only draw one frame at the wrong year immediately
    // before playPlotTimelineOnce's own first frame overwrote it anyway.
    playPlotTimelineOnce();
  }
}

function buildPlotGroupList(groups) {
  const list = document.createElement("div");
  list.className = "plot-group-list";
  list.append(
    ...groups.map((group) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "plot-group-item";
      item.dataset.groupKey = plotGroupKey(group);
      item.style.setProperty("--color-legend", group.color);
      const header = document.createElement("div");
      header.className = "plot-group-header";
      const swatch = document.createElement("span");
      swatch.className = "legend-swatch";
      const label = document.createElement("span");
      label.textContent = displayGroupLabel(group.label);
      header.append(swatch, label);
      const summary = document.createElement("p");
      summary.className = "plot-group-summary paragraph";
      summary.textContent = group.summary;
      item.append(header, summary);
      item.addEventListener("click", () => setPlotGroupFilter(group));
      return item;
    }),
  );
  return list;
}

// Switches which of PLOT_REGIONS/PLOT_INCOME_GROUPS the panel shows — both
// lists are built once (see renderPlotSummary) and just toggled via
// [hidden], the same way the item summaries below stay in the DOM
// (collapsed via CSS) rather than getting torn down, so an expanded
// description or the active filter's highlight survives switching tabs and
// back.
function setPlotGroupTab(tab) {
  if (tab === plotGroupTab) return;
  plotGroupTab = tab;
  elements.plotGroupMode.querySelectorAll("button").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === tab);
  });
  elements.plotGroups.querySelectorAll(".plot-group-list").forEach((list) => {
    list.hidden = list.dataset.tab !== tab;
  });
}

// Static explanation of each region/income group — doesn't depend on year
// or domains, so it's built once and left alone; each button also doubles
// as that group's filter trigger (setPlotGroupFilter).
function renderPlotSummary() {
  if (plotSummaryBuilt) return;
  const regionList = buildPlotGroupList(PLOT_REGIONS);
  regionList.dataset.tab = "region";
  const incomeList = buildPlotGroupList(PLOT_INCOME_GROUPS);
  incomeList.dataset.tab = "income";
  incomeList.hidden = true;
  elements.plotGroups.replaceChildren(regionList, incomeList);
  elements.plotGroupMode.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => setPlotGroupTab(btn.dataset.mode));
  });
  plotSummaryBuilt = true;
}

// Full (re)build: grid + card DOM + initial positions. Only needed once per
// activation or resize — the domains (and so the coordinate space itself)
// never change between frames, only the year does (see updatePlotYear).
function renderPlotLayout() {
  if (!plotActive) return;
  renderPlotSummary();
  if (!ensurePlotDomains()) {
    // Demographics data hasn't loaded yet — the countryDemographicMetrics
    // promise handler retries this once it resolves.
    elements.plotCards.replaceChildren();
    elements.plotGrid.replaceChildren();
    return;
  }
  buildPlotCards();
  renderPlotGrid();
  positionPlotCards(currentYearIndex);
}

function updatePlotYear(year) {
  if (!plotActive || !plotDomains) return;
  const yearIndex = yearsData.indexOf(year);
  if (yearIndex === -1) return;
  positionPlotCards(yearIndex);
}

function setPlotActive(active) {
  if (active === plotActive) return;
  plotActive = active;
  elements.plotView.hidden = !active;
  document.body.classList.toggle("view-plot", active);
  // setViewMode() only ever toggles between "globe"/"map" — same reasoning
  // as setchartPanelActive's own #viewMode resync.
  elements.viewMode.querySelectorAll("button").forEach((btn) =>
    btn.classList.toggle(
      "active",
      btn.dataset.mode === (active ? "plot" : viewMode),
    ),
  );
  if (active) {
    tourController.stop();
    renderPlotLayout();
  } else {
    stopPlotPlayback();
    // Each visit starts unfiltered, on the Region tab, rather than
    // remembering the last group/tab — the summary panel's DOM is only
    // built once (plotSummaryBuilt), so this needs to clear things by hand
    // rather than just resetting the underlying state.
    plotSelectedGroup = null;
    elements.plotGroups
      .querySelectorAll(".plot-group-item.active")
      .forEach((item) => item.classList.remove("active"));
    setPlotGroupTab("region");
    if (currentYearIndex >= 0) {
      // Plot took applyYear()'s cheap fast path (see there) while open,
      // leaving the 3D scene stale — catch it up now that it's visible
      // again.
      applyYear(yearsData[currentYearIndex], { instant: true });
    }
  }
  syncUrlFromState();
}

// --- Cluster view (physics-based demographic clustering) -----------------
// Every country is a particle pulled toward one of several named "gravity
// wells" (see cluster-model.mjs) by a d3-force simulation. Unlike Plot's
// literal 3-axis mapping, a country's position here is emergent: which well
// it's pulled toward is reclassified fresh every year from its own
// fertility/migration/life-expectancy data, not a direct metric->pixel
// formula. Phase 1 (1950-1999) exposes Golden Boom/Emerging Surge; Phase 2
// (2000-2100) exposes Growth/Migrant Buffers/Silver Decline.
const CLUSTER_AXES = {
  fertility: "fertility",
  migration: "netMigrationRate",
  growth: "populationGrowth",
  age: "medianAge",
  population: "population",
  lifeExpectancy: "lifeExpectancy",
};
const CLUSTER_RADIUS_OPTIONS = { minRadius: 9, maxRadius: 128 };
const CLUSTER_ARCHETYPE_LABELS = {
  goldenBoom: "Golden Boom",
  emergingSurge: "Emerging Surge",
  growth: "Growth",
  bufferedGrowth: "Migrant Buffers",
  silverDecline: "Silver Decline",
};
const CLUSTER_ARCHETYPE_SUMMARIES = {
  goldenBoom: [
    "Positive natural increase",
    "Life expectancy of 65 years or more",
    "Post-war growth in longer-lived populations",
  ],
  emergingSurge: [
    "Positive natural increase",
    "Life expectancy below 65 years",
    "Earlier-stage mortality transition",
  ],
  growth: [
    "Positive natural increase",
    "Population grows without migration support",
    "Includes demographic momentum below replacement",
  ],
  bufferedGrowth: [
    "Natural change is negative or near zero",
    "High net-positive immigration",
    "Total population remains stable or growing",
  ],
  silverDecline: [
    "Net population decline",
    "Migration is insufficient to prevent contraction",
    "Includes sustained, significant loss from peak",
  ],
};
// Growth sits top-center (where almost everyone starts, in 1950); Migrant Buffers
// bottom-left and Silver Decline bottom-right mirror the left/right split in
// the reference mockup. Golden Boom/Emerging Surge flank that same top
// band left/right — they're never on screen at the same time as Growth
// (see refineArchetypeForPhase), so reusing that vertical position is safe.
const CLUSTER_ANCHOR_RATIOS = {
  emergingSurge: { x: 0.35, y: 0.4 },
  goldenBoom: { x: 0.8, y: 0.65 },
  growth: { x: 0.25, y: 0.38 },
  bufferedGrowth: { x: 0.5, y: 0.8 },
  silverDecline: { x: 0.78, y: 0.5 },
};
const CLUSTER_LABEL_HEIGHT = 32;
const CLUSTER_LABEL_PADDING_X = 14;
const CLUSTER_LABEL_PARTICLE_GAP = 6;
// Which annotation cards are relevant for a given year — Growth's card only
// makes sense outside Phase 1, Golden Boom/Emerging Surge only inside it;
// Migrant Buffers/Silver Decline are always potentially relevant (see
// classifyCountry — a country can dip below replacement any year).
const CLUSTER_PHASE_ONE_KEYS = new Set([
  "goldenBoom",
  "emergingSurge",
]);
const CLUSTER_DEFAULT_PHASE_KEYS = new Set([
  "growth",
  "bufferedGrowth",
  "silverDecline",
]);

function isClusterPhaseOneYear(year) {
  return (
    year != null && year >= PHASE_ONE_START_YEAR && year <= PHASE_ONE_END_YEAR
  );
}

let clusterCanvasCtx = null;
let clusterSimulation = null;
let clusterNodes = [];
let clusterNodesBuilt = false;
let clusterInteractionBound = false;
let clusterAnchors = null; // { growth: {x,y}, bufferedGrowth: {x,y}, silverDecline: {x,y} } — fixed pixel coords, recomputed on resize
let clusterLabelRects = [];
let clusterMedianAgeDomain = null; // { min, max } — global, percentile-clipped, computed once
let clusterPopulationMax = null; // global max population across every country/year
let clusterHoveredNode = null;
let clusterSortedNodes = []; // descending-by-radius draw order, reused for hit-testing
let clusterFont = null;
let clusterTitleFont = null;
let clusterAnnotationPhaseIsOne = null; // tracks which canvas titles are shown; null forces the first sync

// Global (not per-year) domains, mirroring computePlotDomains's reasoning —
// the space itself needs to stay fixed so a year change reads as motion
// through it, not the wells/scale rescaling under the particles.
function computeClusterDomains() {
  const medianAges = [];
  let maxPopulation = 0;
  countriesData.forEach((country) => {
    chartSeriesFor(country, CLUSTER_AXES.age).forEach((value) => {
      if (Number.isFinite(value)) medianAges.push(value);
    });
    chartSeriesFor(country, CLUSTER_AXES.population).forEach((value) => {
      if (Number.isFinite(value) && value > maxPopulation) maxPopulation = value;
    });
  });
  if (!medianAges.length || maxPopulation <= 0) return null;
  medianAges.sort((a, b) => a - b);
  const min = percentile(medianAges, 0.03);
  const max = percentile(medianAges, 0.97);
  return {
    medianAgeDomain:
      min < max
        ? { min, max }
        : { min: medianAges[0], max: medianAges[medianAges.length - 1] },
    populationMax: maxPopulation,
  };
}

function ensureClusterDomains() {
  if (clusterMedianAgeDomain && clusterPopulationMax) return true;
  const domains = computeClusterDomains();
  if (!domains) return false;
  clusterMedianAgeDomain = domains.medianAgeDomain;
  clusterPopulationMax = domains.populationMax;
  return true;
}

function computeClusterAnchors(width, height) {
  const anchors = {};
  for (const [key, ratio] of Object.entries(CLUSTER_ANCHOR_RATIOS)) {
    anchors[key] = { x: width * ratio.x, y: height * ratio.y };
  }
  return anchors;
}

function ensureClusterFont() {
  if (clusterFont) return clusterFont;
  const family =
    getComputedStyle(document.documentElement)
      .getPropertyValue("--font-mono")
      .trim() || "monospace";
  clusterFont = `600 11px ${family}`;
  return clusterFont;
}

function ensureClusterTitleFont() {
  if (clusterTitleFont) return clusterTitleFont;
  const family =
    getComputedStyle(document.documentElement)
      .getPropertyValue("--font-mono")
      .trim() || "monospace";
  clusterTitleFont = `600 14px ${family}`;
  return clusterTitleFont;
}

function updateClusterLabelRects(activeKeys) {
  if (!clusterCanvasCtx || !clusterAnchors) return;
  clusterCanvasCtx.font = ensureClusterTitleFont();
  clusterLabelRects = [...activeKeys].map((archetype) => {
    const anchor = clusterAnchors[archetype];
    const label = CLUSTER_ARCHETYPE_LABELS[archetype];
    const width =
      clusterCanvasCtx.measureText(label.toUpperCase()).width +
      CLUSTER_LABEL_PADDING_X * 2;
    return {
      archetype,
      label,
      x: anchor.x - width / 2,
      y: anchor.y - CLUSTER_LABEL_HEIGHT / 2,
      width,
      height: CLUSTER_LABEL_HEIGHT,
    };
  });
}

// HiDPI setup + anchor recompute — called once on activation and again
// (debounced) on resize. No existing helper for a live 2D canvas to reuse:
// the app's one other canvas.getContext("2d") call is an offscreen sprite
// for a THREE.CanvasTexture, unrelated.
function resizeClusterCanvas() {
  if (!clusterActive) return;
  const canvas = elements.clusterCanvas;
  const displayWidth = canvas.clientWidth || window.innerWidth;
  const displayHeight = canvas.clientHeight || window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(displayWidth * dpr);
  canvas.height = Math.round(displayHeight * dpr);
  if (!clusterCanvasCtx) clusterCanvasCtx = canvas.getContext("2d");
  clusterCanvasCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  clusterAnchors = computeClusterAnchors(displayWidth, displayHeight);
  const activeKeys = isClusterPhaseOneYear(
    yearsData[currentYearIndex] ?? null,
  )
    ? CLUSTER_PHASE_ONE_KEYS
    : CLUSTER_DEFAULT_PHASE_KEYS;
  updateClusterLabelRects(activeKeys);
  if (clusterSimulation) {
    // Anchor pixel coords moved — cached force targets (see
    // reinitializeClusterForces) must be rebuilt too, not just the alpha
    // reheated, or nodes keep drifting toward the pre-resize positions.
    // A full alpha(1) reheat (not a small bump) matters here: a resize can
    // move anchors by hundreds of pixels (e.g. portrait<->landscape), and
    // low-strength forces (see forceStrengthFor) need the full decay curve
    // to actually cover that distance rather than stalling partway.
    reinitializeClusterForces();
    clusterSimulation.alpha(1).restart();
  }
}

function buildClusterNodes() {
  if (clusterNodesBuilt) return;
  clusterNodes = countriesData.map((country) => ({
    country,
    iso2: convertAlpha3ToAlpha2(country.iso3) ?? country.iso3,
    // Seeded near the Growth anchor (not scattered randomly) so the very
    // first frame (1950, almost everyone high-fertility) doesn't visibly
    // snap from a random start.
    x: clusterAnchors.growth.x + (Math.random() - 0.5) * 40,
    y: clusterAnchors.growth.y + (Math.random() - 0.5) * 40,
    radius: 3,
    archetype: null,
    medianAge: null,
  }));
  clusterNodesBuilt = true;
}

function clusterAnchorFor(node) {
  return clusterAnchors[node.archetype] ?? clusterAnchors.growth;
}

let clusterForceX = null;
let clusterForceY = null;
let clusterForceCollide = null;
let clusterLabelAvoidanceForce = null;

function createClusterLabelAvoidanceForce() {
  let nodes = [];
  function force(alpha) {
    nodes.forEach((node) => {
      if (!node.archetype) return;
      clusterLabelRects.forEach((rect) => {
        const gap = node.radius + CLUSTER_LABEL_PARTICLE_GAP;
        const left = rect.x - gap;
        const right = rect.x + rect.width + gap;
        const top = rect.y - gap;
        const bottom = rect.y + rect.height + gap;
        if (
          node.x <= left ||
          node.x >= right ||
          node.y <= top ||
          node.y >= bottom
        ) {
          return;
        }
        const distances = [
          { axis: "x", target: left, distance: node.x - left },
          { axis: "x", target: right, distance: right - node.x },
          { axis: "y", target: top, distance: node.y - top },
          { axis: "y", target: bottom, distance: bottom - node.y },
        ];
        const nearest = distances.reduce((best, candidate) =>
          candidate.distance < best.distance ? candidate : best,
        );
        const strength = 0.7 + alpha * 0.3;
        if (nearest.axis === "x") {
          node.vx += (nearest.target - node.x) * strength;
        } else {
          node.vy += (nearest.target - node.y) * strength;
        }
      });
    });
  }
  force.initialize = (nextNodes) => {
    nodes = nextNodes;
  };
  return force;
}

function startClusterSimulation() {
  clusterForceX = forceX((d) => clusterAnchorFor(d).x).strength((d) =>
    forceStrengthFor(d.archetype, d.medianAge, clusterMedianAgeDomain),
  );
  clusterForceY = forceY((d) => clusterAnchorFor(d).y).strength((d) =>
    forceStrengthFor(d.archetype, d.medianAge, clusterMedianAgeDomain),
  );
  // 1950 (almost everyone in Growth) crowds ~190 nodes onto one anchor —
  // full strength + more iterations keeps that year fully separated
  // instead of settling with visible overlap.
  clusterForceCollide = forceCollide((d) => d.radius + 2)
    .strength(1)
    .iterations(10);
  clusterLabelAvoidanceForce = createClusterLabelAvoidanceForce();
  clusterSimulation = forceSimulation(clusterNodes)
    .force("x", clusterForceX)
    .force("y", clusterForceY)
    .force("collide", clusterForceCollide)
    .force("label-avoidance", clusterLabelAvoidanceForce)
    .alphaTarget(0)
    .on("tick", renderClusterFrame);
}

// forceX/forceY/forceCollide's accessor functions are only evaluated once,
// when the force is (re)initialized — d3-force caches the result per node
// internally (target x/y, strength, and collide radius), it does NOT call
// the accessor again on every tick. Since a node's target anchor/strength
// depends on its archetype/medianAge, and its collide radius on its
// population, all of which change every year, the caches must be rebuilt
// explicitly whenever those change (here) or whenever clusterAnchors itself
// changes (see resizeClusterCanvas) — otherwise every node stays pulled
// toward whatever anchor (and collides at whatever radius) it had the very
// first time the force was created, which for radius is the placeholder
// `3` seeded in buildClusterNodes, not its real size.
function reinitializeClusterForces() {
  clusterForceX?.initialize(clusterNodes);
  clusterForceY?.initialize(clusterNodes);
  clusterForceCollide?.initialize(clusterNodes);
  clusterLabelAvoidanceForce?.initialize(clusterNodes);
}

function populationDeclineContext(country, yearIndex, population) {
  const series = country.populations;
  if (!series?.length || !Number.isFinite(population)) {
    return { populationLossFromPeak: null, yearsSincePeak: null };
  }
  const endIndex = Math.min(series.length - 1, Math.floor(yearIndex));
  let peakPopulation = -Infinity;
  let peakIndex = -1;
  for (let index = 0; index <= endIndex; index++) {
    const value = series[index];
    if (Number.isFinite(value) && value > peakPopulation) {
      peakPopulation = value;
      peakIndex = index;
    }
  }
  if (peakIndex === -1 || peakPopulation <= 0) {
    return { populationLossFromPeak: null, yearsSincePeak: null };
  }
  const lowerIndex = Math.floor(yearIndex);
  const upperIndex = Math.min(yearsData.length - 1, Math.ceil(yearIndex));
  const fraction = yearIndex - lowerIndex;
  const currentYear =
    yearsData[lowerIndex] +
    (yearsData[upperIndex] - yearsData[lowerIndex]) * fraction;
  return {
    populationLossFromPeak: Math.max(
      0,
      (peakPopulation - population) / peakPopulation,
    ),
    yearsSincePeak: currentYear - yearsData[peakIndex],
  };
}

// Mutates the same node objects already inside the running simulation (no
// .nodes() re-call — that resets velocities). valueAtFractionalYear
// (defined above, for Plot) remains generic enough to interpolate if a
// fractional index is supplied.
function updateClusterNodesForYear(yearIndex) {
  if (yearIndex == null || yearIndex < 0) return;
  const year = yearsData[Math.round(yearIndex)] ?? null;
  clusterNodes.forEach((node) => {
    const fertility = valueAtFractionalYear(
      node.country,
      CLUSTER_AXES.fertility,
      yearIndex,
    );
    const netMigrationRate = valueAtFractionalYear(
      node.country,
      CLUSTER_AXES.migration,
      yearIndex,
    );
    const populationGrowth = valueAtFractionalYear(
      node.country,
      CLUSTER_AXES.growth,
      yearIndex,
    );
    const medianAge = valueAtFractionalYear(
      node.country,
      CLUSTER_AXES.age,
      yearIndex,
    );
    const population = valueAtFractionalYear(
      node.country,
      CLUSTER_AXES.population,
      yearIndex,
    );
    const lifeExpectancy = valueAtFractionalYear(
      node.country,
      CLUSTER_AXES.lifeExpectancy,
      yearIndex,
    );
    const declineContext = populationDeclineContext(
      node.country,
      yearIndex,
      population,
    );
    node.archetype = refineArchetypeForPhase(
      classifyCountry({
        fertility,
        netMigrationRate,
        populationGrowth,
        incomeLabel: node.country._incomeLabel,
        ...declineContext,
      }),
      year,
      lifeExpectancy,
    );
    node.medianAge = medianAge;
    node.radius = radiusForPopulation(
      population,
      clusterPopulationMax,
      CLUSTER_RADIUS_OPTIONS,
    );
  });
  reinitializeClusterForces();
  updateClusterAnnotationVisibility(year);
}

// Year-change path (manual drag, keyboard step, deep-link jump) — reheats
// once per change and lets the simulation decay naturally between changes.
function updateClusterYear(year) {
  if (!clusterActive || !clusterMedianAgeDomain) return;
  const yearIndex = yearsData.indexOf(year);
  if (yearIndex === -1) return;
  updateClusterNodesForYear(yearIndex);
  clusterSimulation?.alpha(Math.max(clusterSimulation.alpha(), 0.4)).restart();
}

function drawClusterNode(ctx, node) {
  ctx.beginPath();
  ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
  const fill = `#${colorFor(node.country, clusterColorMode).getHexString()}`;
  ctx.fillStyle = fill;
  ctx.fill();
  if (node === clusterHoveredNode) {
    ctx.lineWidth = 2;
    ctx.strokeStyle = resolveCssColor("var(--color-text)");
    ctx.stroke();
  }
  // ctx.font/fillStyle can't resolve CSS custom properties the way DOM
  // style properties can — bake a literal font once (ensureClusterFont)
  // and resolve foregroundForColor's var(...) reference through
  // resolveCssColor before using it as a canvas fillStyle.
  if (node.radius < 9) return; // too small for a legible 2-letter label
  ctx.fillStyle = resolveCssColor(foregroundForColor(fill));
  ctx.font = ensureClusterFont();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(node.iso2, node.x, node.y + 1);
}

function drawClusterLabels(ctx) {
  ctx.save();
  ctx.font = ensureClusterTitleFont();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 0;
  // ctx.strokeStyle = resolveCssColor("var(--color-border)");
  ctx.fillStyle = resolveCssColor("var(--color-text)");
  clusterLabelRects.forEach((rect) => {
    // Deliberately no fill: the rectangle is a transparent canvas object,
    // while the avoidance force keeps particles from compromising contrast.
    // ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
    ctx.fillText(
      rect.label.toUpperCase(),
      rect.x + rect.width / 2,
      rect.y + rect.height / 2,
    );
  });
  ctx.restore();
}

function renderClusterFrame() {
  const ctx = clusterCanvasCtx;
  if (!ctx || !clusterAnchors) return;
  const canvas = elements.clusterCanvas;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  ctx.clearRect(0, 0, width, height);
  // Largest first (drawn on the bottom), so a small country nested near a
  // large one stays visible on top of it.
  clusterSortedNodes = clusterNodes
    .filter((node) => node.archetype)
    .sort((a, b) => b.radius - a.radius);
  clusterSortedNodes.forEach((node) => drawClusterNode(ctx, node));
  drawClusterLabels(ctx);
}

// Reverse draw order (smallest/topmost first) so a small circle nested
// inside a larger one wins the hit test. ~200 nodes, a linear scan per
// pointermove is trivially cheap — no quadtree needed (d3-force's internal
// one for collision isn't exposed for this).
function clusterNodeAtClientPoint(clientX, clientY) {
  const rect = elements.clusterCanvas.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  for (let i = clusterSortedNodes.length - 1; i >= 0; i--) {
    const node = clusterSortedNodes[i];
    const dx = x - node.x;
    const dy = y - node.y;
    if (dx * dx + dy * dy <= node.radius * node.radius) return node;
  }
  return null;
}

function setupClusterCanvasInteraction() {
  if (clusterInteractionBound) return;
  const canvas = elements.clusterCanvas;
  canvas.addEventListener("pointermove", (event) => {
    const node = clusterNodeAtClientPoint(event.clientX, event.clientY);
    const hoverChanged = node !== clusterHoveredNode;
    clusterHoveredNode = node;
    if (hoverChanged) renderClusterFrame();
    canvas.style.cursor = node ? "pointer" : "default";
    if (node) {
      showChartTooltip(
        event,
        node.country.name,
        `#${colorFor(node.country, clusterColorMode).getHexString()}`,
      );
    } else {
      hideChartTooltip();
    }
  });
  canvas.addEventListener("pointerleave", () => {
    const hadHoveredNode = clusterHoveredNode !== null;
    clusterHoveredNode = null;
    if (hadHoveredNode) renderClusterFrame();
    hideChartTooltip();
  });
  canvas.addEventListener("click", (event) => {
    const node = clusterNodeAtClientPoint(event.clientX, event.clientY);
    if (!node) return;
    setClusterActive(false);
    openCountryDetail(node.country);
  });
  clusterInteractionBound = true;
}

// Growth's title only makes sense outside Phase 1, Golden Boom/Emerging
// Surge only inside it. Guarded so ordinary year updates do not rebuild the
// same canvas rectangles unnecessarily.
function updateClusterAnnotationVisibility(year) {
  const isPhaseOne = isClusterPhaseOneYear(year);
  if (isPhaseOne === clusterAnnotationPhaseIsOne) return;
  clusterAnnotationPhaseIsOne = isPhaseOne;
  const activeKeys = isPhaseOne
    ? CLUSTER_PHASE_ONE_KEYS
    : CLUSTER_DEFAULT_PHASE_KEYS;
  updateClusterLabelRects(activeKeys);
}

// Full (re)build: domains + canvas sizing + node DOM-free
// data + simulation. Only needed once per activation (or when demographics
// data finishes loading late) — subsequent year changes go through the
// much cheaper updateClusterYear/updateClusterNodesForYear instead.
function renderClusterLayout() {
  if (!clusterActive) return;
  if (!ensureClusterDomains()) {
    // Demographics data hasn't loaded yet — the countryDemographicMetrics
    // promise handler retries this once it resolves.
    if (clusterCanvasCtx) {
      clusterCanvasCtx.clearRect(
        0,
        0,
        elements.clusterCanvas.clientWidth,
        elements.clusterCanvas.clientHeight,
      );
    }
    return;
  }
  resizeClusterCanvas();
  buildClusterNodes();
  setupClusterCanvasInteraction();
  if (!clusterSimulation) startClusterSimulation();
  updateClusterNodesForYear(currentYearIndex);
  clusterSimulation.alpha(1).restart();
}

function setClusterActive(active) {
  if (active === clusterActive) return;
  clusterActive = active;
  elements.clusterView.hidden = !active;
  document.body.classList.toggle("view-cluster", active);
  elements.viewMode.querySelectorAll("button").forEach((btn) =>
    btn.classList.toggle(
      "active",
      btn.dataset.mode === (active ? "cluster" : viewMode),
    ),
  );
  if (active) {
    tourController.stop();
    updateColorModeControls(clusterColorMode);
    renderLegend();
    renderClusterLayout();
  } else {
    // A persistent physics loop (forceSimulation's own internal d3-timer),
    // not just a requestAnimationFrame id like Plot's sweep — has to be
    // stopped explicitly or it keeps ticking (and drawing to a hidden
    // canvas) in the background indefinitely.
    clusterSimulation?.stop();
    clusterSimulation = null;
    clusterForceX = null;
    clusterForceY = null;
    updateColorModeControls(colorMode);
    renderLegend();
    if (currentYearIndex >= 0) {
      // Cluster took applyYear()'s cheap fast path (see there) while open,
      // leaving the 3D scene stale — catch it up now that it's visible
      // again.
      applyYear(yearsData[currentYearIndex], { instant: true });
    }
  }
  syncUrlFromState();
}

function setChartTableSort(key) {
  const next = nextSortState(chartTableSort, key, chartTableColumns());
  if (!next) return;
  chartTableSort = next;
  renderChartTable();
}

// What each metric measures and, where it has one, the key benchmark value
// called out as a reference line on the chart (see CHART_BENCHMARK_LINES).
// Static per metric — the table below already covers the selected
// countries' actual numbers, so this teaches the metric itself instead of
// repeating them.
const CHART_METRIC_INSIGHTS = {
  population: "Population size drives a country's economic scale, infrastructure needs, and geopolitical weight — but the raw number says little without its growth trajectory and age structure alongside it.",
  populationGrowth: "Population growth rate measures how fast a population is expanding or shrinking each year. 0% is the natural threshold: above it, the population is still growing; below it, it's already shrinking (before accounting for migration).",
  fertility: "The replacement rate is the average number of children a woman needs to have to keep the population size stable across generations. This benchmark is 2.1 children per woman in developed countries, higher where child mortality is greater.",
  lifeExpectancy: "Life expectancy summarizes a population's overall health, nutrition, and access to care. The UN's Human Development Index treats 75 years and above as a high-development benchmark, and under 70 years as low.",
  medianAge: "Median age splits a population exactly in half by age — as many people younger as older. A rising median age signals an aging society with a shrinking future workforce.",
  ageDependencyRatio: "The age dependency ratio counts children and seniors per 100 working-age adults — how many dependents each worker effectively supports. Above 70 is considered a high dependency burden; below 45 is low.",
  netMigrationRate: "Net migration rate is the balance of people moving in versus out, per 1,000 residents. 0 is the tipping point: positive means more arrivals than departures, negative means the reverse.",
  radar: "This radar chart plots five metrics as spokes around a wheel — population growth, fertility, migration, life expectancy, and dependency ratio — so each country or region's overall demographic shape can be compared at a glance.",
};

function renderChartInsight() {
  elements.chartInsightCaption.textContent = yearsData[currentYearIndex];
  elements.chartInsightText.textContent =
    CHART_METRIC_INSIGHTS[chartMetricKey] ?? "";
}

// The same sortable table component the group view uses, reduced here to
// country, population, and the active chart metric.
function renderChartTable() {
  if (!elements.chartTableRows) return;
  const items = chartItems();
  renderChartInsight();
  const columns = chartTableColumns();
  if (!columns.some((column) => column.key === chartTableSort.key)) {
    // Used to always fall back to "population" specifically, which stopped
    // being a safe assumption once the table dropped its always-present
    // Population column — falls back to whichever metric column is
    // actually here instead (the "name" one is never a useful sort
    // default, so it's excluded).
    const fallback = columns.find((column) => column.key !== "name");
    chartTableSort = { key: fallback.key, direction: fallback.defaultDirection };
  }
  const metricColumnCount = columns.length - 1;
  const gridTemplateColumns =
    `minmax(150px, 1fr) repeat(${metricColumnCount}, minmax(120px, 0.8fr))`;
  renderSortableTable({
    headerEl: elements.chartTableHeader,
    rowsEl: elements.chartTableRows,
    columns,
    sort: chartTableSort,
    countries: items,
    onSort: setChartTableSort,
    onRowClick: (item) => item.onClick(),
    colorFor: (item) => item.color,
    gridTemplateColumns,
  });
}

// Chart is a full-screen overlay, not a real member of the Globe/Map
// toggle's selection state — opening it never touches which of those two
// is "active", so whichever was selected before is still the one shown
// (and still marked active) once the overlay closes.
function setchartPanelActive(active) {
  if (active === chartPanelActive) return;
  chartPanelActive = active;
  elements.chartPanel.hidden = !active;
  document.body.classList.toggle("view-chart", active);
  // #viewMode now stays visible while chart view is open rather than being
  // hidden behind it, so its active state needs to track "chart" here too —
  // setViewMode() only ever toggles between "globe"/"map", and would
  // otherwise leave "chart" stuck highlighted (or nothing highlighted)
  // after this panel opens or closes.
  elements.viewMode.querySelectorAll("button").forEach((btn) =>
    btn.classList.toggle(
      "active",
      btn.dataset.mode === (active ? "chart" : viewMode),
    ),
  );
  if (active) {
    tourController.stop();
    renderTrendChart({ animate: true });
    renderChartTable();
  } else {
    // Always reopens collapsed, regardless of how it was left — an editor
    // left expanded from last time isn't state worth remembering the way
    // the selected countries themselves are.
    setChartCountryPickerExpanded(false);
  }
  if (!active && currentYearIndex >= 0) {
    trendChartAnimationHandle?.cancel();
    trendChartAnimationHandle = null;
    // While the overlay was open, applyYear() took its chart-only fast path
    // and left the 3D scene stale (still showing whatever year it had
    // before) — catch it up now that it's visible again. instant: true
    // skips #status's typewriter replay here — chart view already showed
    // this year's own text (via renderChartTable) the whole time, so
    // retyping it from scratch on close would just be redundant animation.
    applyYear(yearsData[currentYearIndex], { instant: true });
  }
  syncUrlFromState();
}

const THEME_STORAGE_KEY = "theme"; // must match the inline <head> script in index.html

function updateThemeToggleUI() {
  const isLight = currentTheme === "light";
  elements.themeToggle.setAttribute(
    "aria-label",
    isLight ? "Switch to dark theme" : "Switch to light theme",
  );
  elements.themeToggle.querySelector(".material-symbols-outlined").textContent =
    isLight ? "dark_mode" : "light_mode";
}

// Most of the app's colors are plain CSS var() references (region/income
// swatches, chart lines, group-detail panels) and repaint for free the
// instant the theme's custom properties change, via the ordinary cascade —
// no JS involved. The few exceptions are values baked into something other
// than a live CSS property at the moment they were built: the GPU dot color
// buffer, cached hover-fill mesh materials, peak-callout label colors, and
// (only while a single country's own detail panel is open) --detail-color,
// which is resolved to a literal hex rather than left as a var() reference
// because colorFor() also has to double as a THREE.Color for the globe.
// Those are exactly what this re-derives and pushes out again.
function applyTheme(theme, { persist = true } = {}) {
  if (theme === currentTheme) return;
  currentTheme = theme;
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
  if (currentYearIndex >= 0) {
    calloutController.rebuild(yearsData[currentYearIndex]);
  }
  if (selectedCountry && !elements.detailPanel.hidden) {
    elements.detailPanel.style.setProperty(
      "--detail-color",
      `#${colorFor(selectedCountry).getHexString()}`,
    );
  }
  // Chart-view line/legend colors are var() references too, except the chip
  // text color — chosen per-chip by contrast against the chip's background
  // at render time, and *baked in as one of two variable names*
  // (--color-bg/--color-text). Those two swap which one is actually the
  // darker/lighter option between themes, so a decision made before this
  // toggle is now backwards, not just stale — this needs to re-run
  // regardless of whether chart view happens to be open right now, or it
  // stays wrong (inverted, not just outdated) until something else happens
  // to touch the chip list (adding/removing a country).
  renderChartCountryChips();
}

function updateColorModeControls(mode) {
  elements.colorMode
    .querySelectorAll("button")
    .forEach((btn) =>
      btn.classList.toggle("active", btn.dataset.mode === mode),
    );
}

function setClusterColorMode(mode) {
  if (mode === clusterColorMode) return;
  clusterColorMode = mode;
  updateColorModeControls(mode);
  renderLegend();
  renderClusterFrame();
}

function setColorMode(mode) {
  if (mode === colorMode) return;
  const keepDetailOpen = selectedLegend && !elements.detailPanel.hidden;
  colorMode = mode;
  updateColorModeControls(mode);

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
  calloutController.rebuild(yearsData[currentYearIndex]);
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
  if (viewMode === "globe") {
    controls.enableRotate = true;
    controls.enablePan = false;
    controls.autoRotate = true;
    controls.autoRotateSpeed = VIEW_CONFIG.globe.autoRotateSpeed;
    controls.minDistance = VIEW_CONFIG.globe.minDistance;
    controls.maxDistance = VIEW_CONFIG.globe.maxDistance;
  } else {
    controls.enableRotate = false;
    controls.enablePan = true;
    controls.autoRotate = false;
    controls.minDistance = VIEW_CONFIG.map.minDistance;
    controls.maxDistance = VIEW_CONFIG.map.maxDistance;
  }
}

// URL-selected map mode is initial state, not a user-triggered transition.
// Configure the camera, controls, material, and dot sizing before the first
// population layout is written so the globe never flashes or scrambles in.
function initializeViewMode(mode) {
  if (mode !== "map") return;
  viewMode = "map";
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
  if (mode === viewMode || !activeTotal) return;

  const fromPositions = basePositions.slice(0, activeTotal * 3);
  const scramblePositions = computeScramblePositions(activeTotal);
  const toPositions = computeTargetPositions(mode);
  viewMode = mode;
  // Anchors are computed from the globe/map basis, so a mode toggle needs
  // its own rebuild even though the selected year hasn't changed.
  calloutController.rebuild(yearsData[currentYearIndex]);

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

async function init() {
  // Captured before anything else runs — applyYear() and friends call
  // syncUrlFromState() as they go, which would otherwise overwrite the
  // deep link's query string with default state before it's ever read.
  const initialSearch = window.location.search;
  try {

    const appData = await loadPopulationData();
    // The biggest single data file and not needed for first paint (only a
    // country/group detail view or certain chart tabs read it) — resolves
    // in the background instead of blocking the initial render, and
    // refreshes whatever's already on screen once it lands.
    appData.countryDemographicMetricsPromise.then((data) => {
      countryDemographicMetrics = data;
      if (chartPanelActive) {
        renderTrendChart();
        renderChartTable();
      }
      if (plotActive) renderPlotLayout();
      if (clusterActive) renderClusterLayout();
      if (selectedCountry) {
        renderCountryDetail();
      } else if (selectedLegend) {
        renderDetailPanel();
      }
    });
    // Same deferred treatment — only used to draw a border under the
    // pointer on hover, never needed before then.
    appData.countryBordersPromise.then((data) => {
      countryBorders = data;
    });
    countriesData = appData.countries;
    yearsData = appData.years;
    historicalCutoffYear = appData.historicalCutoffYear;
    globalMetricsByYear = appData.globalMetricsByYear;
    globalTrendMilestones = appData.globalTrendMilestones;
    highMetricsByYear = appData.highMetricsByYear;
    lowMetricsByYear = appData.lowMetricsByYear;

    setupScene(countriesData, appData.incomeGroups);
    const initialUrlState = parseUrlState(initialSearch, {
      years: yearsData,
      countryCodes: countriesData.map((country) => country.iso3),
    });
    initializeViewMode(initialUrlState.mode);

    const minYear = yearsData[0];
    const maxYear = yearsData[yearsData.length - 1];
    // Randomized per page load from the same data-driven milestones used in
    // the status copy, rather than maintaining a second hardcoded year list.
    const defaultYears = prioritizedMilestoneYears(globalTrendMilestones, {
      minYear,
      maxYear,
    });
    const defaultYear =
      defaultYears[Math.floor(Math.random() * defaultYears.length)] ?? minYear;
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
      // Plot cards are cheap to reposition (no dot-buffer rewrite like the
      // 3D scene needs), so — unlike the globe/map content below — they get
      // to move live during the drag itself rather than waiting for
      // "change".
      if (plotActive) updatePlotYear(Number(elements.yearSlider.value));
      if (clusterActive) updateClusterYear(Number(elements.yearSlider.value));
    });
    elements.yearSlider.addEventListener("change", () => {
      applyYear(Number(elements.yearSlider.value));
    });
    // "pointerdown" (not "input"/"change") is the tour's cue to stop, since
    // goToYear() itself only dispatches "input"/"change" — using those to
    // cancel would make the tour immediately cancel its own steps. Same
    // reasoning applies to the plot region-select playback below.
    elements.yearSlider.addEventListener("pointerdown", tourController.stop);
    elements.yearSlider.addEventListener("pointerdown", stopPlotPlayback);
    elements.yearSlider.addEventListener("pointermove", updateYearHoverLabel);
    elements.yearSlider.addEventListener("pointerleave", () => {
      elements.yearHoverValue.hidden = true;
    });

    elements.colorMode.hidden = false;
    elements.colorMode.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (clusterActive) {
          setClusterColorMode(btn.dataset.mode);
        } else {
          setColorMode(btn.dataset.mode);
        }
      });
    });

    elements.viewMode.hidden = false;
    elements.viewMode.querySelectorAll("button").forEach((btn) =>
      btn.classList.toggle("active", btn.dataset.mode === viewMode),
    );
    elements.viewMode.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.dataset.mode === "chart") {
          setPlotActive(false);
          setClusterActive(false);
          setchartPanelActive(true);
          return;
        }
        if (btn.dataset.mode === "plot") {
          setchartPanelActive(false);
          setClusterActive(false);
          setPlotActive(true);
          return;
        }
        if (btn.dataset.mode === "cluster") {
          setchartPanelActive(false);
          setPlotActive(false);
          setClusterActive(true);
          return;
        }
        setchartPanelActive(false);
        setPlotActive(false);
        setClusterActive(false);
        setViewMode(btn.dataset.mode);
      });
    });
    elements.chartPanelClose.addEventListener("click", () =>
      setchartPanelActive(false),
    );
    elements.chartProjectionScenario.value = chartProjectionScenario;
    updateProjectionScenarioVisibility();
    elements.chartProjectionScenario.addEventListener("change", () => {
      const scenario = elements.chartProjectionScenario.value;
      if (!["medium", "high", "low"].includes(scenario)) return;
      chartProjectionScenario = scenario;
      renderTrendChart();
      renderChartTable();
    });
    renderChartMetricTabs();
    renderChartCountryChips();
    updateChartContentMode();
    elements.selectChartContent.addEventListener(
      "change",
      updateChartContentMode,
    );
    elements.chartCountrySearch.addEventListener(
      "input",
      renderChartCountrySuggestions,
    );
    elements.chartCountrySearch.addEventListener(
      "focus",
      renderChartCountrySuggestions,
    );
    elements.chartCountrySearch.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") {
        if (elements.chartCountrySuggestions.hidden) return;
        event.preventDefault();
        moveChartSuggestionActiveIndex(1);
      } else if (event.key === "ArrowUp") {
        if (elements.chartCountrySuggestions.hidden) return;
        event.preventDefault();
        moveChartSuggestionActiveIndex(-1);
      } else if (event.key === "Enter") {
        event.preventDefault();
        // Arrow keys pick a specific suggestion; without that, Enter falls
        // back to the top match, same as before arrow navigation existed.
        const matches = chartCountryMatches(elements.chartCountrySearch.value);
        const match =
          chartSuggestionActiveIndex >= 0
            ? matches[chartSuggestionActiveIndex]
            : matches[0];
        if (match) selectChartCountrySuggestion(match.iso3);
      } else if (
        event.key === "Backspace" &&
        !elements.chartCountrySearch.value &&
        selectedChartCountries.length
      ) {
        removeChartCountry(
          selectedChartCountries[selectedChartCountries.length - 1],
        );
      } else if (event.key === "Escape") {
        // First Escape just dismisses the suggestion list, matching how
        // the rest of the app's autocomplete-style inputs behave; a second
        // one (nothing left to dismiss) collapses the picker itself.
        if (!elements.chartCountrySuggestions.hidden) {
          hideChartCountrySuggestions();
        } else {
          setChartCountryPickerExpanded(false);
        }
      }
    });
    elements.chartCountryPickerSummary.addEventListener("click", () =>
      setChartCountryPickerExpanded(true),
    );
    elements.chartCountryPickerCancel.addEventListener("click", () =>
      setChartCountryPickerExpanded(false),
    );
    document.addEventListener("click", (event) => {
      // composedPath(), not contains(event.target) — selecting a suggestion
      // removes that button from the DOM (hideChartCountrySuggestions()'s
      // replaceChildren()) before this bubble-phase listener runs, which
      // detaches event.target and makes any contains() check on it false
      // even though the click genuinely originated inside the picker.
      // composedPath() is fixed at dispatch time, so it stays accurate.
      if (!event.composedPath().includes(elements.chartCountryPicker)) {
        hideChartCountrySuggestions();
        setChartCountryPickerExpanded(false);
      }
    });
    elements.detailClose.addEventListener("click", closeDetailPanel);
    // elements.detailBack.addEventListener("click", () => {
    //   if (selectedCountry) {
    //     closeCountryDetail();
    //   } else {
    //     closeDetailPanel();
    //   }
    // });
    elements.milestonePrev.addEventListener("click", () => stepMilestone(-1));
    elements.milestoneNext.addEventListener("click", () => stepMilestone(1));
    elements.milestoneTour.addEventListener("click", tourController.toggle);
    // #exploreMilestones' markup is gone along with the old #milestoneRow —
    // guarded the same way as its .hidden toggle above, rather than
    // assuming it won't come back.
    elements.exploreMilestones?.addEventListener("click", tourController.toggle);
    elements.menuToggle.addEventListener("click", () => {
      const isOpen = document.body.classList.toggle("menu-open");
      elements.menuToggle.setAttribute("aria-expanded", String(isOpen));
    });
    elements.menuShim.addEventListener("click", () => {
      document.body.classList.remove("menu-open");
      elements.menuToggle.setAttribute("aria-expanded", "false");
    });
    updateThemeToggleUI();
    elements.themeToggle.addEventListener("click", () => {
      applyTheme(currentTheme === "light" ? "dark" : "light");
    });
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
  u.uIsMap.value = viewMode === "map" && !isScrambledPhase ? 1 : 0;

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

// Shared by the click handler and the hover tooltip below — both just need
// "which country dot, if any, sits under the current pointer position."
function hitCountryAtPointer() {
  raycaster.setFromCamera(pointer, camera);
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
  // The detail panel (group table or country chart) sits above the canvas
  // and blocks real clicks/hover from reaching it — but the raycast here
  // runs off whatever pointer position was last seen, so without this check
  // a tooltip from before the panel opened keeps reappearing underneath it.
  if (!elements.detailPanel.hidden) {
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

  const pop = country.populations[currentYearIndex] ?? country.population;
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
  calloutController.update(timestamp);
  renderer.render(scene, camera);
}

// The country charts' viewBox is measured from the panel's actual pixel
// size at build time (see buildCountryCharts) rather than tracking it
// continuously, so a resize while one is open leaves that viewBox stale —
// stretching every path/dot until the chart is rebuilt against the new
// size. Debounced so a drag-resize doesn't rebuild on every intermediate
// frame, only once the size settles.
let countryChartResizeTimer = null;

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (currentYearIndex >= 0) {
    updateYearLabels(yearsData[currentYearIndex]);
  }
  if (pointsMesh) {
    pointsMesh.material.uniforms.uScale.value =
      renderer.domElement.height * 0.5;
  }
  if (selectedCountry) {
    clearTimeout(countryChartResizeTimer);
    countryChartResizeTimer = setTimeout(() => {
      // Re-checked rather than trusting the outer `if` above: the panel
      // can close during this 120ms debounce, and selectedCountry (read
      // live, not captured) would be null by the time this fires.
      if (!selectedCountry) return;
      buildCountryCharts(selectedCountry);
      updateCountryDetailForYear(yearsData[currentYearIndex]);
    }, 120);
  }
  if (chartPanelActive) {
    clearTimeout(countryChartResizeTimer);
    countryChartResizeTimer = setTimeout(renderTrendChart, 120);
  }
  if (plotActive) {
    clearTimeout(countryChartResizeTimer);
    countryChartResizeTimer = setTimeout(renderPlotLayout, 120);
  }
  if (clusterActive) {
    clearTimeout(countryChartResizeTimer);
    countryChartResizeTimer = setTimeout(resizeClusterCanvas, 120);
  }
});

init();
animate();
