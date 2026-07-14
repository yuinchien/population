import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TessellateModifier } from "three/addons/modifiers/TessellateModifier.js";
import {
  buildDetailStatus,
  displayGroupLabel,
  prioritizedMilestoneYears,
} from "./status-insights.mjs";
import {
  GLOBAL_METRIC_KEYS,
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
import { getAppElements, getMetricValueElements } from "./ui-elements.mjs";
import { buildCountrySummary } from "./country-summary-model.mjs";
import { parseUrlState, serializeUrlState } from "./url-state.mjs";
import {
  adjacentMilestoneYears,
  createTourController,
} from "./tour-controller.mjs";
import { createCountryChartGeometry } from "./country-chart.mjs";
import { createSparklineGeometry } from "./sparkline-chart.mjs";
import {
  separateTrendLineLabels,
  TREND_CHART_PADDING,
} from "./trend-chart.mjs";
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
const METRIC_VALUE_ELEMENTS = getMetricValueElements(elements);

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

const calloutGroup = new THREE.Group();
scene.add(calloutGroup);
let peakCallouts = []; // { country, anchor, outward, line, labelEl }

const hoverCountryGroup = new THREE.Group();
scene.add(hoverCountryGroup);
let hoverCountry = null;
const globeFillTessellator = new TessellateModifier(8, 6);

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
  return new THREE.Color(REGION_COLORS[region?.trim()] || DEFAULT_COLOR);
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

  function apply(key) {
    const definition = METRICS[key];
    const el = METRIC_VALUE_ELEMENTS[key];
    const formatMain = definition.formatPanel ?? definition.format;
    const formatRange = definition.formatRange ?? formatMain;
    const mainText = formatMain(metrics[key]);
    let rangeText = "";
    if (hi && lo && hi[key] != null && lo[key] != null) {
      rangeText = `${formatRange(lo[key])} — ${formatRange(hi[key])}`;
    }
    setMetricValue(el, mainText, rangeText);
  }

  GLOBAL_METRIC_KEYS.forEach(apply);
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
let colorMode = "region";
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
let chartViewActive = false;
let chartMetricKey = "population";
// Insertion-order array (not a Set) so a country keeps the same line color
// for as long as it stays selected, even as others are toggled around it.
let selectedChartCountries = ["USA", "CHN", "IND", "DEU", "NGA"];
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

function colorFor(country) {
  return colorMode === "income" ? country._incomeColor : country._regionColor;
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

function clearHoverCountryFill() {
  if (!hoverCountry) return;
  hoverCountryGroup.children.slice().forEach((mesh) => {
    hoverCountryGroup.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.dispose();
  });
  hoverCountry = null;
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
  // Same darkening CSS color-mix(in srgb, <color> 50%, black 50%) would
  // produce — halving each channel toward black.
  const color = colorFor(country).clone().lerp(new THREE.Color(0x000000), 0.05);
  // Russia's continental outline spans most of a hemisphere. Its flat
  // triangulation must be subdivided before spherical projection; otherwise
  // a handful of huge faces cut through and overlap the visible globe.
  const tessellateGlobeFill = viewMode === "globe" && country.iso3 === "RUS";

  rings.forEach((ring) => {
    // A ring under 3 points can't form a polygon — shouldn't occur in the
    // shipped data, but cheap to guard against rather than handing
    // THREE.Shape/ShapeGeometry a degenerate triangulation.
    if (ring.length < 3) return;
    // Triangulated in plain (lon, lat) space — flat and not geographically
    // accurate for a very large country, but plenty close at the size a
    // hover highlight actually needs to read correctly at.
    const shape = new THREE.Shape(
      ring.map(([lon, lat]) => new THREE.Vector2(lon, lat)),
    );
    let geometry = new THREE.ShapeGeometry(shape);
    if (tessellateGlobeFill) {
      const flatGeometry = geometry;
      geometry = globeFillTessellator.modify(flatGeometry);
      flatGeometry.dispose();
    }
    // Re-project every triangulated vertex from (lon, lat) onto the globe
    // surface or flat map, same basis the dots themselves use.
    const pos = geometry.getAttribute("position");
    for (let i = 0; i < pos.count; i++) {
      const lon = pos.getX(i);
      const lat = pos.getY(i);
      const p =
        viewMode === "map"
          ? latLonToMapVector3(lat, lon).setZ(HOVER_FILL_MAP_Z)
          : latLonToVector3(lat, lon, HOVER_FILL_GLOBE_RADIUS);
      pos.setXYZ(i, p.x, p.y, p.z);
    }
    pos.needsUpdate = true;
    geometry.computeVertexNormals();

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
  });
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
    return anchor
      .clone()
      .add(new THREE.Vector3(0, 0, VIEW_CONFIG.map.calloutExtend));
  }
  return anchor
    .clone()
    .normalize()
    .multiplyScalar(VIEW_CONFIG.globe.calloutExtend);
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

      const labelEl = document.createElement("button");
      labelEl.type = "button";
      labelEl.className = "peak-callout-label glass";
      labelEl.setAttribute("aria-label", `Open ${country.name} details`);
      labelEl.textContent = `${country.name} ${formatPeakPopulation(
        country.populations[currentYearIndex],
      )}`;
      labelEl.style.setProperty(
        "--color-callout",
        `#${dotColor.getHexString()}`,
      );
      labelEl.addEventListener("click", () => openCountryDetail(country));
      elements.calloutLayer.append(labelEl);

      peakCallouts.push({ country, anchor, outward, line, labelEl });
    });
}

// Projects each callout's outward endpoint to screen space every frame
// (the camera orbits continuously, so this can't be computed just once).
// On the globe, a callout for a country currently on the far side is
// hidden — its anchor direction points away from the camera direction.
// The three Vector3s below are scratch space reused every call instead of
// .clone()'d fresh each time — this runs once per frame for every active
// callout, so a fresh allocation per vector per callout adds up to steady
// GC churn in the render loop.
const calloutCamDir = new THREE.Vector3();
const calloutFacing = new THREE.Vector3();
const calloutProjected = new THREE.Vector3();

function updateCalloutLabels() {
  if (!peakCallouts.length) return;
  calloutCamDir.copy(camera.position).normalize();
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
      const facing = calloutFacing.copy(anchor).normalize().dot(calloutCamDir);
      if (facing < 0.1) {
        line.visible = false;
        labelEl.hidden = true;
        return;
      }
    }
    line.visible = true;
    labelEl.hidden = false;
    const projected = calloutProjected.copy(outward).project(camera);
    const x = (projected.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-projected.y * 0.5 + 0.5) * window.innerHeight;
    const margin = 12;
    labelEl.style.left = `${Math.min(Math.max(x, CALLOUT_LEFT_CLEARANCE), window.innerWidth - margin)}px`;
    labelEl.style.top = `${Math.min(Math.max(y, margin + 20), window.innerHeight - margin)}px`;
  });
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
    setStatusTitle();
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
    setStatusTitle();
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
  setStatusTitle(milestone?.title);
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

function setStatusTitle(title = "") {
  // The period turns the title into a sentence lead-in ("A Super-Aged
  // Planet.") now that it sits inline ahead of the status text rather than
  // standing alone as its own heading; the space after it is a CSS margin
  // on the span (see styles.css) rather than trailing whitespace here, to
  // avoid relying on whitespace-collapsing behavior at the span boundary.
  elements.statusTitle.textContent = title ? `${title}.` : "";
  elements.statusTitle.hidden = !title;
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
  // #statusTitle now lives inside #status as its lead-in span rather than
  // as a separate element next to it — replaceChildren() below would
  // otherwise throw it away along with whatever text was there before.
  const titlePrefix = el === elements.status ? [elements.statusTitle] : [];
  if (instant) {
    const textNode = document.createElement("div");
    textNode.textContent = text;
    el.replaceChildren(...titlePrefix, textNode);
    return;
  }

  const textNode = document.createTextNode("");
  const cursor = document.createElement("span");
  cursor.className = "status-cursor";
  el.replaceChildren(...titlePrefix, textNode, cursor);

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
  const meta = document.createElement("div");
  meta.className = "country-summary-meta";

  const caption = document.createElement("div");
  caption.className = "caption mono-uppercase";
  caption.textContent = summary.caption;
  meta.append(caption);

  if (summary.flagUrl) {
    elements.detailFlag.style.backgroundImage = `url(${summary.flagUrl})`;
    elements.detailFlag.hidden = false;
  } else {
    elements.detailFlag.hidden = true;
    elements.detailFlag.style.backgroundImage = "";
  }

  const copy = document.createElement("div");
  copy.className = "country-summary-copy";
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
  elements.detailSummary.replaceChildren(meta, copy);
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
  // overlay (setChartViewActive) does one full applyYear() call to catch
  // the 3D scene up to wherever this left it.
  if (chartViewActive) {
    updateYearLabels(year);
    renderTrendChart();
    renderChartTable();
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
  updateMetricsPanel(year);
  renderDetailPanel();
  if (selectedCountry) {
    updateCountryDetailForYear(year);
    updateStatusPanel(year, { instant });
  } else if (!selectedLegend) {
    updateStatusPanel(year, { instant });
  }
  updatePeakCallouts(year);
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
  const metricKeys = [
    "population",
    ...(chartMetricKey === "population" ? [] : [chartMetricKey]),
  ];
  return buildDetailColumns({
    currentYearIndex,
    metricFor,
    metricKeys,
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
    row.append(
      ...detailRow.cells.map((cell) =>
        createDetailCell(cell.text, cell.className),
      ),
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
  if (chartViewActive) {
    Object.assign(state, { view: "chart", metric: chartMetricKey, countries: selectedChartCountries });
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
    setChartViewActive(true);
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

function selectLegendItem(label, color) {
  if (selectedLegend?.mode === colorMode && selectedLegend?.label === label) {
    closeDetailPanel();
    return;
  }
  tourController.stop();
  selectedLegend = { mode: colorMode, label, color };
  renderLegend();
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
// A plain categorical color set assigned by selection order, not by the
// country's actual region — two countries in the same region are a
// near-certainty among any handful of selections, so coloring by region
// here would make their lines indistinguishable. Starts with the region
// palette (for visual consistency with the rest of the app) extended with
// a few more distinct hues, since the country grid invites selecting well
// past 7.
const CHART_LINE_COLORS = [
  ...Object.values(REGION_COLORS),
  "#4fc3f7",
  "#ba68c8",
  "#ff8f6b",
  "#8bc34a",
  "#ffca28",
];

// A dedicated tooltip (separate from #tooltip, which the 3D canvas's own
// hover system clears on a 100ms timer even while this panel is open) for
// hovering the main chart's marker dot or a sparkline's current-value dot.
function showChartTooltip(event, text) {
  if (!text) return;
  elements.chartTooltip.hidden = false;
  elements.chartTooltip.replaceChildren(document.createTextNode(text));
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
  if (chartViewActive) setChartViewActive(false);
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
  if (key === "population") return country.populations;
  return countryDemographicMetrics?.countries?.[country.iso3]?.[key] ?? [];
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
  elements.chartCountryChips.replaceChildren(
    ...chartCountryList().map((country) => {
      const color = chartColorFor(country.iso3);
      const chip = document.createElement("span");
      chip.className = "chip";
      if (color) chip.style.setProperty("--chart-line-color", color);

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
  if (key === chartMetricKey || !METRICS[key]) return;
  chartMetricKey = key;
  elements.chartMetricTabs.querySelectorAll("button").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.key === key);
  });
  renderTrendChart();
  renderChartTable();
  syncUrlFromState();
}

function renderChartMetricTabs() {
  elements.chartMetricTabs.replaceChildren(
    ...CHART_METRIC_KEYS.map((key) => {
      const btn = document.createElement("button");
      btn.type = "button";
      // btn.className = "mono-uppercase";
      btn.dataset.key = key;
      btn.textContent = METRICS[key].label;
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
  trendChartAnimationHandle?.cancel();
  trendChartAnimationHandle = null;
  const svg = elements.trendChart;
  const width = svg.clientWidth || 900;
  const height = svg.clientHeight || 360;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

  const countries = chartCountryList();
  const key = chartMetricKey;
  const definition = METRICS[key];
  const n = yearsData.length;
  const cutoffIndex = Math.max(0, yearsData.indexOf(historicalCutoffYear));
  // Left padding fits the Y axis's value labels (e.g. "10.29B", "80.0
  // yrs"); the compact right padding only needs to fit the ISO alpha-2
  // labels drawn directly off each line's end point.
  const pad = TREND_CHART_PADDING;
  const chartTop = 4;
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;

  const allValues = [];
  countries.forEach((country) => {
    chartSeriesFor(country, key).forEach((value) => {
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

  // elementsToAppend.push(
  //   svgEl("line", {
  //     class: "trend-chart-axis",
  //     x1: pad.left,
  //     x2: width - pad.right,
  //     y1: pad.top,
  //     y2: pad.top,
  //   }),
  // );

  for (let i = 0; i < Y_TICK_COUNT; i++) {
    const tickValue = min + (range / (Y_TICK_COUNT - 1)) * i;
    const y = yFor(tickValue).toFixed(1);
    // elementsToAppend.push(
    //   svgEl("line", {
    //     class: "trend-chart-tick-line",
    //     x1: pad.left,
    //     x2: width - pad.right,
    //     y1: y,
    //     y2: y,
    //   }),
    //   svgEl("line", {
    //     class: "trend-chart-tick",
    //     x1: pad.left - 4,
    //     x2: pad.left,
    //     y1: y,
    //     y2: y,
    //   }),
    // );
    const tickLabel = svgEl("text", {
      class: "trend-chart-axis-label",
      x: pad.left - 8,
      y: (Number(y) + 3).toFixed(1),
      "text-anchor": "end",
    });
    tickLabel.textContent = tickValue === 0 ? "0" : tickFormat(tickValue);
    elementsToAppend.push(tickLabel);
  }

  // Skipped when the reference value sits at the scale's own min/max — that
  // only happens when it was the thing that extended the range to begin
  // with (see min/max above), in which case a tick already labels it and
  // a separate baseline would just double-print the same line and value.
  if (referenceValue != null && referenceValue !== min && referenceValue !== max) {
    const baselineY = yFor(referenceValue).toFixed(1);
    elementsToAppend.push(
      svgEl("line", {
        class: "trend-chart-baseline",
        x1: pad.left,
        x2: width - pad.right,
        y1: baselineY,
        y2: baselineY,
      }),
    );
    const baselineLabel = svgEl("text", {
      class: "trend-chart-baseline-label",
      x: pad.left - 8,
      y: Math.max(yFor(referenceValue) - 4, 12).toFixed(1),
      "text-anchor": "end",
    });
    baselineLabel.textContent =
      referenceValue === 0 ? "0" : tickFormat(referenceValue);
    elementsToAppend.push(baselineLabel);
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

  // Labeled directly off each line's own end point rather than through a
  // separate legend — the chips above already double as one, so this is
  // just about tying a color back to a country without eyeballing it.
  const lineLabels = [];
  // Bottom of the plot area — every line starts flattened here and grows
  // up into its real shape below, when animate is on.
  const baselineY = pad.top + innerH;
  const growingLines = [];
  countries.forEach((country) => {
    const color = chartColorFor(country.iso3);
    const series = chartSeriesFor(country, key);
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
    elementsToAppend.push(historicalPath, projectedPath);
    if (animate) {
      growingLines.push(
        { el: historicalPath, series, from: 0, to: cutoffIndex },
        { el: projectedPath, series, from: cutoffIndex, to: n - 1 },
      );
    }

    let lastIndex = -1;
    for (let i = n - 1; i >= 0; i--) {
      if (series[i] != null) {
        lastIndex = i;
        break;
      }
    }
    if (lastIndex !== -1) {
      lineLabels.push({
        country,
        color,
        x: xFor(lastIndex) + 6,
        y: yFor(series[lastIndex]),
      });
    }
  });

  // Two lines ending at close values would otherwise print their labels
  // right on top of each other — nudge later ones (in ascending y order)
  // down just enough to keep each one legible.
  separateTrendLineLabels(lineLabels).forEach(({ country, color, x, y }) => {
    const label = svgEl("text", {
      class: "trend-line-label",
      x,
      y: (y + 3).toFixed(1),
      "text-anchor": "start",
      // fill: color,
    });
    label.style.setProperty("--color", color);
    label.textContent = convertAlpha3ToAlpha2(country.iso3) ?? country.iso3;
    elementsToAppend.push(label);
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
    const DRAG_HIT_HALF_WIDTH = 1;
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

function setChartTableSort(key) {
  const next = nextSortState(chartTableSort, key, chartTableColumns());
  if (!next) return;
  chartTableSort = next;
  renderChartTable();
}

function renderChartInsight() {
  const year = yearsData[currentYearIndex];
  elements.chartInsightCaption.textContent = `${year} snapshot`;

  const definition = METRICS[chartMetricKey];
  const ranked = chartCountryList()
    .map((country) => ({
      country,
      value: chartSeriesFor(country, chartMetricKey)[currentYearIndex],
    }))
    .filter(({ value }) => Number.isFinite(value))
    .sort((a, b) => b.value - a.value);

  if (!ranked.length) {
    elements.chartInsightText.textContent =
      "No comparable data is available for the selected countries.";
    return;
  }

  const format =
    chartMetricKey === "population"
      ? formatPeakPopulation
      : (definition.formatPanel ?? definition.format);
  const [highest, second] = ranked;
  if (!second) {
    elements.chartInsightText.textContent =
      `${highest.country.name} is at ${format(highest.value)}.`;
    return;
  }

  if (chartMetricKey === "population") {
    elements.chartInsightText.textContent =
      `${highest.country.name} leads at ${format(highest.value)}, followed by ` +
      `${second.country.name} at ${format(second.value)}.`;
    return;
  }

  const lowest = ranked.at(-1);
  const metricLabel = definition.label.toLowerCase();
  elements.chartInsightText.textContent =
    `${highest.country.name} has the highest ${metricLabel} at ` +
    `${format(highest.value)}, while ${lowest.country.name} has the lowest ` +
    `at ${format(lowest.value)}.`;
}

// The same sortable table component the group view uses, reduced here to
// country, population, and the active chart metric.
function renderChartTable() {
  if (!elements.chartTableRows) return;
  renderChartInsight();
  const columns = chartTableColumns();
  if (!columns.some((column) => column.key === chartTableSort.key)) {
    chartTableSort = { key: "population", direction: "desc" };
  }
  const metricColumnCount = columns.length - 1;
  const gridTemplateColumns =
    `minmax(150px, 1fr) repeat(${metricColumnCount}, minmax(120px, 0.8fr))`;
  renderSortableTable({
    headerEl: elements.chartTableHeader,
    rowsEl: elements.chartTableRows,
    columns,
    sort: chartTableSort,
    countries: chartCountryList(),
    onSort: setChartTableSort,
    onRowClick: openCountryDetail,
    gridTemplateColumns,
  });
}

// Chart is a full-screen overlay, not a real member of the Globe/Map
// toggle's selection state — opening it never touches which of those two
// is "active", so whichever was selected before is still the one shown
// (and still marked active) once the overlay closes.
function setChartViewActive(active) {
  if (active === chartViewActive) return;
  chartViewActive = active;
  elements.chartView.hidden = !active;
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
  } else if (currentYearIndex >= 0) {
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
      if (chartViewActive) {
        renderTrendChart();
        renderChartTable();
      }
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
    });
    elements.yearSlider.addEventListener("change", () => {
      applyYear(Number(elements.yearSlider.value));
    });
    // "pointerdown" (not "input"/"change") is the tour's cue to stop, since
    // goToYear() itself only dispatches "input"/"change" — using those to
    // cancel would make the tour immediately cancel its own steps.
    elements.yearSlider.addEventListener("pointerdown", tourController.stop);
    elements.yearSlider.addEventListener("pointermove", updateYearHoverLabel);
    elements.yearSlider.addEventListener("pointerleave", () => {
      elements.yearHoverValue.hidden = true;
    });

    elements.colorMode.hidden = false;
    elements.colorMode.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => setColorMode(btn.dataset.mode));
    });

    elements.viewMode.hidden = false;
    elements.viewMode.querySelectorAll("button").forEach((btn) =>
      btn.classList.toggle("active", btn.dataset.mode === viewMode),
    );
    elements.viewMode.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.dataset.mode === "chart") {
          setChartViewActive(true);
          return;
        }
        setChartViewActive(false);
        setViewMode(btn.dataset.mode);
      });
    });
    elements.chartViewClose.addEventListener("click", () =>
      setChartViewActive(false),
    );
    renderChartMetricTabs();
    renderChartCountryChips();
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
        hideChartCountrySuggestions();
      }
    });
    document.addEventListener("click", (event) => {
      if (!elements.chartCountryPicker.contains(event.target)) {
        hideChartCountrySuggestions();
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
  if (peakCallouts.some((callout) => callout.country === country)) {
    elements.tooltip.hidden = true;
    return;
  }

  const pop = country.populations[currentYearIndex] ?? country.population;
  const groupColor = colorFor(country);

  const swatch = document.createElement("span");
  swatch.className = "legend-swatch";
  swatch.style.background = `#${groupColor.getHexString()}`;

  const countryText = document.createElement("span");
  countryText.textContent = `${country.name} ${formatPeakPopulation(pop)}`;

  const line1 = document.createElement("div");
  line1.className = "tooltip-line mono-uppercase";
  line1.append(swatch, countryText);

  const lines = [line1];

  elements.tooltip.hidden = false;
  elements.tooltip.replaceChildren(...lines);
  elements.tooltip.style.setProperty(
    "--tooltip-color",
    `#${groupColor.getHexString()}`,
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
  updateCalloutLabels();
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
  if (chartViewActive) {
    clearTimeout(countryChartResizeTimer);
    countryChartResizeTimer = setTimeout(renderTrendChart, 120);
  }
});

init();
animate();
