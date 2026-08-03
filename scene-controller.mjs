import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createCalloutController } from "./callout-controller.mjs";
import { foregroundForColor, resolveCssColor } from "./theme-colors.mjs";
import { createCountryBorderHitTester } from "./country-border-hit-test.mjs";
import { createTooltipLine } from "./tooltip-controller.mjs";
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

// "Peak population year" callouts: a leader line drawn along the surface
// normal at a country's location, from a country whose modeled population
// peaks in the currently selected year.
// Keep callout labels clear of the fixed sidebar (#overlay is 240px wide).
const CALLOUT_LEFT_CLEARANCE = 260;

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

// Nudges the fill just outside the globe surface/dot pulse range (up to
// ±DOT_CONFIG.pulseAmplitude) so it reads as sitting on the country rather
// than a pulsing dot occasionally poking through it, and just toward the
// camera on the flat map for the same reason.
const HOVER_FILL_GLOBE_RADIUS = GLOBE_RADIUS + DOT_CONFIG.pulseAmplitude + 4;
const HOVER_FILL_MAP_Z = 2;
const HOVER_FILL_CACHE_LIMIT = 12;

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

// Raycasting activeTotal dots (up to ~33K) on every single animation frame
// is the most expensive per-frame cost in the app, and pointermove fires
// far more often than a tooltip needs to visibly update — so re-run the
// hit test on a timer instead of every frame.
const TOOLTIP_UPDATE_INTERVAL_MS = 100;

// Distinguishes an actual click from the end of an orbit-drag (OrbitControls
// doesn't suppress the native "click" event itself) by checking how far the
// pointer moved between down and up, rather than relying on "click" alone.
const CANVAS_CLICK_MAX_DRAG_PX = 6;

export function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
// Arrives at the scramble point already moving (no decel-to-a-stop), so
// it can flow straight into easeOutCubic's departure without a stall.
export function easeInCubic(t) {
  return t * t * t;
}
// Leaves the scramble point at full speed and decelerates into rest.
export function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

// Owns the Globe/Map 3D dot scene: Three.js scene/camera/renderer/controls,
// the dot point-cloud buffer, the globe<->map morph transition, hover/click
// hit-testing, and the peak-population callout labels (via
// callout-controller.mjs, constructed internally since it needs a live
// camera/scene reference). App-level UI state pauses the render loop whenever
// an overlay (Chart/Cluster/Search/Lifetime/detail/settings/menu) covers the
// scene and resumes it when Globe or Map becomes interactive again.
export function createSceneController({
  elements,
  getCountries,
  getYears,
  getCurrentYearIndex,
  getColorMode,
  getViewMode,
  setViewModeState,
  getPopulationAt,
  getPeakYear,
  formatPopulation,
  onOpenCountry,
  renderLegend,
  syncUrl,
}) {
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
    getCountries,
    getViewMode,
    isTransitioning: () => !!transition,
    getColor: colorFor,
    getPeakYear,
    getPopulation: (country) => getPopulationAt(country),
    formatPopulation,
    getTextColor: (color) => foregroundForColor(`#${color.getHexString()}`),
    onOpenCountry,
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
  // geometry that hasn't changed. Cache built meshes per iso3+viewMode (the
  // two projections aren't interchangeable) and only dispose on eviction,
  // not on every hover-out.
  const hoverFillCache = new Map(); // `${iso3}:${viewMode}` -> THREE.Mesh[]

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
  const hoverGlobe = new THREE.Sphere(new THREE.Vector3(0, 0, 0), GLOBE_RADIUS);
  const hoverMapPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const hoverSurfacePoint = new THREE.Vector3();
  // Latest pointermove event, consumed by animate()'s throttled tooltip
  // hit-test rather than raycasting on every single mousemove.
  let lastPointerEvent = null;

  const timer = new THREE.Timer();
  timer.connect(document);

  let pointsMesh = null;
  let basePositions = null; // pre-pulse baseline, rebuilt whenever the year changes
  let frequencies = null;
  let phases = null;
  let currentDotSize = VIEW_CONFIG.globe.dotSize; // logical size (unscaled by pixelRatio)
  let dotCountry = [];
  let activeTotal = 0;
  // Set once in setup() rather than rescanned on every hasUnclassifiedIncome()
  // call — the set of income labels present is fixed once countries load.
  let hasUnclassifiedIncome = false;
  let dotLocalIndex = null;
  let transition = null;
  let isScrambledPhase = false;
  let isHoldPhase = false;

  // Simplified country outline rings ({ [iso3]: [[lon,lat], ...][] }), lazily
  // loaded — see showHoverCountryFill(). null until it resolves; hovering
  // before then just doesn't draw a fill for that hover, same tradeoff as the
  // fill-geometry module below.
  let countryBorders = null;
  let countryBorderHitTester = null;
  let createCountryFillGeometries = null;
  let countryFillGeometryModulePromise = null;
  let loadCountryBorders = async () => null;

  let canvasPointerDownPos = null;
  let lastTooltipUpdate = 0;
  let yearChangePulseStart = -Infinity;

  // Map pan/zoom affordance: a hint pill shown once ever (localStorage), and
  // a reset-view button shown whenever the map camera has drifted from its
  // default centered/zoomed state. Both are map-mode-only, driven off the
  // same controls "change" listener clampMapPanTarget already uses.
  const MAP_PAN_HINT_STORAGE_KEY = "mapPanHintSeen";
  const MAP_PAN_HINT_DURATION_MS = 3500;
  const MAP_RESET_TWEEN_MS = 500;
  const MAP_VIEW_DEFAULT_EPSILON = 0.5;
  let mapPanHintSeen = localStorage.getItem(MAP_PAN_HINT_STORAGE_KEY) === "1";
  let mapPanHintTimer = null;
  let resetTween = null; // { fromPos, fromTarget, start } while animating back to center

  // Milestone-tour camera assist: when the tour (or manual Prev/Next
  // milestone stepping) lands on a year with peak-population callouts, the
  // Globe camera rotates to face the biggest one rather than leaving it
  // wherever it happened to be — a callout on the sphere's far side is
  // otherwise invisible with no indication anything is there. See
  // focusPeakCountry() below.
  // Duration scales with how far the camera actually has to turn (see
  // focusPeakCountry()) — a neighboring-country nudge and a rotate to the
  // sphere's far side both used to take the same fixed 700ms, which made
  // the big turns feel like a hard snap rather than a smooth pan.
  const FOCUS_TWEEN_MIN_MS = 500;
  const FOCUS_TWEEN_MAX_MS = 1800;
  const FOCUS_HOLD_MS = 1500;
  let focusTween = null; // { fromDir, toDir, distance, durationMs, start }
  let focusResumeTimer = null;

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

  function colorFor(country, mode = getColorMode()) {
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
  function setup(countries, incomeGroups) {
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
    return getViewMode() === "map" ? country._xyzMap : country._xyzGlobe;
  }

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

  // Fills a country's outline (one shape per ring — most countries are a
  // single polygon, but archipelagos/exclaves are several) on whichever
  // surface is currently showing, in a darkened version of its own dot color
  // (an outline this same color, even drawn at several px wide, read as too
  // close to the dot cloud underneath to make out — a filled, darker shape
  // doesn't have that problem). Border data is lazy-loaded (see
  // setLoadCountryBorders()); hovering before it's arrived just skips
  // drawing one, same as any other deferred data here.
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

    const viewMode = getViewMode();
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

  // Scene portion of applyYear(): rebuilds the active dot buffer for the
  // given year. Callers (script.js's own applyYear orchestrator) handle
  // everything non-scene (detail panel, status text, URL sync) around this.
  function applyYear(year, yearIndex, { isFirstCall = false } = {}) {
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

    getCountries().forEach((country) => {
      const pop = getPopulationAt(country, yearIndex);
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
  }

  function rebuildCallouts(year) {
    calloutController.rebuild(year);
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

  // Theme-toggle portion of applyTheme(): rebuilds every country's baked
  // region/income colors and clears the (theme-tinted) hover-fill cache.
  // Caller still runs recolor()/rebuildCallouts()/colorFor() separately.
  function recomputeThemeColors() {
    getCountries().forEach((country) => {
      country._regionColor = regionColor(country.region);
      country._incomeColor = incomeColor(country._incomeLabel);
    });
    clearHoverCountryFill();
    clearHoverFillCache();
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
    if (getViewMode() === "globe") {
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
    renderer.domElement.classList.toggle("pannable", getViewMode() === "map");
  }

  // Keeps map pan from wandering the camera off into empty space with no way
  // back short of switching views and back — clamps controls.target (what the
  // map-mode camera, at a fixed offset with rotation disabled, is effectively
  // centered on) to the map's own bounds plus one screen-ish of slack, moving
  // the camera by the same delta so the offset — and therefore zoom — doesn't
  // change underneath the clamp.
  function clampMapPanTarget() {
    if (getViewMode() !== "map" || transition) return;
    const maxX = VIEW_CONFIG.map.width * 0.75;
    const maxY = VIEW_CONFIG.map.height * 0.75;
    const clampedX = THREE.MathUtils.clamp(controls.target.x, -maxX, maxX);
    const clampedY = THREE.MathUtils.clamp(controls.target.y, -maxY, maxY);
    const dx = clampedX - controls.target.x;
    const dy = clampedY - controls.target.y;
    if (dx !== 0 || dy !== 0) {
      controls.target.x = clampedX;
      controls.target.y = clampedY;
      camera.position.x += dx;
      camera.position.y += dy;
    }
    updateMapResetViewVisibility();
  }

  function clearMapPanHintTimer() {
    if (mapPanHintTimer === null) return;
    clearTimeout(mapPanHintTimer);
    mapPanHintTimer = null;
  }

  // Shown briefly, once per browser, when Map becomes the visible base view.
  // Interaction dismisses it immediately; covered views hide it without
  // consuming the one-time hint.
  function showMapPanHintIfNeeded() {
    if (mapPanHintSeen || getViewMode() !== "map") return;
    clearMapPanHintTimer();
    elements.mapPanHint.classList.add("visible");
    mapPanHintTimer = setTimeout(dismissMapPanHint, MAP_PAN_HINT_DURATION_MS);
  }

  function dismissMapPanHint() {
    clearMapPanHintTimer();
    if (!mapPanHintSeen) {
      mapPanHintSeen = true;
      localStorage.setItem(MAP_PAN_HINT_STORAGE_KEY, "1");
    }
    elements.mapPanHint.classList.remove("visible");
  }

  function hideMapPanHint() {
    clearMapPanHintTimer();
    elements.mapPanHint.classList.remove("visible");
  }

  function setTransientUiVisible(visible) {
    if (visible && getViewMode() === "map") showMapPanHintIfNeeded();
    else hideMapPanHint();
  }

  function isMapViewAtDefault() {
    const distance = camera.position.distanceTo(controls.target);
    return (
      Math.abs(controls.target.x) < MAP_VIEW_DEFAULT_EPSILON &&
      Math.abs(controls.target.y) < MAP_VIEW_DEFAULT_EPSILON &&
      Math.abs(distance - VIEW_CONFIG.map.cameraDistance) <
        MAP_VIEW_DEFAULT_EPSILON
    );
  }

  function updateMapResetViewVisibility() {
    elements.mapResetView.classList.toggle(
      "visible",
      getViewMode() === "map" && !isMapViewAtDefault(),
    );
  }

  // Animates the map camera/target back to their default centered, zoomed-out
  // position — same easeInOutCubic used by the globe/map morph transition,
  // just applied to camera position + controls.target directly rather than
  // the dot buffer.
  function resetMapView() {
    if (getViewMode() !== "map" || transition || resetTween) return;
    resetTween = {
      fromPos: camera.position.clone(),
      fromTarget: controls.target.clone(),
      start: performance.now(),
    };
    dismissMapPanHint();
  }

  function updateResetTween() {
    if (!resetTween) return;
    const elapsed = performance.now() - resetTween.start;
    const t = easeInOutCubic(Math.min(1, elapsed / MAP_RESET_TWEEN_MS));
    camera.position.lerpVectors(
      resetTween.fromPos,
      new THREE.Vector3(0, 0, VIEW_CONFIG.map.cameraDistance),
      t,
    );
    controls.target.lerpVectors(
      resetTween.fromTarget,
      new THREE.Vector3(0, 0, 0),
      t,
    );
    if (elapsed >= MAP_RESET_TWEEN_MS) {
      resetTween = null;
      updateMapResetViewVisibility();
    }
  }

  function clearFocusResumeTimer() {
    if (focusResumeTimer != null) {
      clearTimeout(focusResumeTimer);
      focusResumeTimer = null;
    }
  }

  // Same lat/lon-averaged anchor callout-controller.mjs computes for its own
  // labels, recomputed here rather than exposed by that module since this is
  // the only other place that needs a country's on-globe direction.
  function countryGlobeAnchor(country) {
    const source = country._xyzGlobe;
    const count = source.length / 3;
    const anchor = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      anchor.x += source[i * 3];
      anchor.y += source[i * 3 + 1];
      anchor.z += source[i * 3 + 2];
    }
    anchor.divideScalar(count);
    return anchor.normalize();
  }

  function biggestPeakCountry(year) {
    const candidates = getCountries().filter(
      (country) => getPeakYear(country) === year,
    );
    if (!candidates.length) return null;
    return candidates.reduce((best, country) => {
      const pop = getPopulationAt(country) ?? 0;
      const bestPop = best ? getPopulationAt(best) ?? 0 : -Infinity;
      return pop > bestPop ? country : best;
    }, null);
  }

  // Called whenever the milestone tour (auto-play or manual Prev/Next) lands
  // on a milestone year. Global milestones (Peak Humanity, Super-Aged
  // Planet, etc.) aren't about any one country, but any peak-population
  // callouts that happen to fall on this same year can otherwise be sitting
  // on the Globe's far side, invisible, with no indication anything is
  // there — so this just aims the camera at the biggest one, if any. Map
  // view already shows the whole world at once; the only thing that can
  // hide a callout there is the user having panned/zoomed away, so this
  // just snaps back to the default framing instead of computing a facing
  // direction.
  function focusPeakCountry(year) {
    if (getViewMode() === "map") {
      if (!isMapViewAtDefault()) resetMapView();
      return;
    }
    if (getViewMode() !== "globe") return;
    const target = biggestPeakCountry(year);
    if (!target) return;
    clearFocusResumeTimer();
    controls.autoRotate = false;
    const fromDir = camera.position.clone().normalize();
    const toDir = countryGlobeAnchor(target);
    // 0 (already facing it) to π (exact opposite side) — scaled linearly
    // into the duration range so a short hop and a full half-globe turn
    // each read as smooth pans at their own natural pace, instead of both
    // racing to fit the same fixed window.
    const angle = fromDir.angleTo(toDir);
    focusTween = {
      fromDir,
      toDir,
      distance: camera.position.length(),
      durationMs:
        FOCUS_TWEEN_MIN_MS +
        (FOCUS_TWEEN_MAX_MS - FOCUS_TWEEN_MIN_MS) * (angle / Math.PI),
      start: performance.now(),
    };
  }

  function updateFocusTween() {
    if (!focusTween) return;
    const elapsed = performance.now() - focusTween.start;
    const t = easeOutCubic(Math.min(1, elapsed / focusTween.durationMs));
    const dir = focusTween.fromDir.clone().lerp(focusTween.toDir, t).normalize();
    camera.position.copy(dir.multiplyScalar(focusTween.distance));
    if (elapsed >= focusTween.durationMs) {
      focusTween = null;
      clearFocusResumeTimer();
      focusResumeTimer = setTimeout(() => {
        focusResumeTimer = null;
        if (getViewMode() === "globe") controls.autoRotate = true;
      }, FOCUS_HOLD_MS);
    }
  }

  // URL-selected map mode is initial state, not a user-triggered transition.
  // Configure the camera, controls, material, and dot sizing before the first
  // population layout is written so the globe never flashes or scrambles in.
  function initializeViewMode(mode) {
    if (mode !== "map") return;
    setViewModeState("map");
    camera.position.set(0, 0, VIEW_CONFIG.map.cameraDistance);
    controls.target.set(0, 0, 0);
    setDotSize(VIEW_CONFIG.map.dotSize);
    pointsMesh.material.uniforms.uIsMap.value = 1;
    applySettledViewControls();
    controls.update();
    showMapPanHintIfNeeded();
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
    const viewMode = getViewMode();
    if (mode === viewMode || !activeTotal) return;

    const fromPositions = basePositions.slice(0, activeTotal * 3);
    const scramblePositions = computeScramblePositions(activeTotal);
    const toPositions = computeTargetPositions(mode);
    setViewModeState(mode);
    resetTween = null;
    focusTween = null;
    clearFocusResumeTimer();
    if (mode === "map") {
      showMapPanHintIfNeeded();
    } else {
      hideMapPanHint();
      elements.mapResetView.classList.remove("visible");
    }
    // Anchors are computed from the globe/map basis, so a mode toggle needs
    // its own rebuild even though the selected year hasn't changed.
    rebuildCallouts(getYears()[getCurrentYearIndex()]);

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
    syncUrl();
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

  function triggerYearChangePulse() {
    yearChangePulseStart = performance.now();
  }

  function updateDotUniforms(elapsedTime) {
    if (!pointsMesh) return;
    const u = pointsMesh.material.uniforms;
    u.uTime.value = elapsedTime;
    u.uIsMap.value = getViewMode() === "map" && !isScrambledPhase ? 1 : 0;

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

  function geographicPointAtPointer() {
    if (getViewMode() === "map") {
      const point = raycaster.ray.intersectPlane(hoverMapPlane, hoverSurfacePoint);
      if (!point) return null;
      const lon = (point.x / (VIEW_CONFIG.map.width / 2)) * 180;
      const lat = (point.y / (VIEW_CONFIG.map.height / 2)) * 90;
      if (Math.abs(lon) > 180 || Math.abs(lat) > 90) return null;
      return { lon, lat };
    }

    const point = raycaster.ray.intersectSphere(hoverGlobe, hoverSurfacePoint);
    if (!point) return null;
    const lat = THREE.MathUtils.radToDeg(Math.asin(point.y / GLOBE_RADIUS));
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
        ? getCountries().find((country) => country.iso3 === iso3) ?? null
        : null;
    }
    const hits = raycaster.intersectObject(pointsMesh);
    return hits.length ? dotCountry[hits[0].index] : null;
  }

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
    // Same reasoning as the pointerup guard installed by init(): raycasting
    // mid-transition would test against pre-transition positions, since the
    // morph itself runs on the GPU rather than updating the CPU-side
    // position attribute.
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

    const pop = getPopulationAt(country) ?? country.population;
    const groupColor = colorFor(country);

    const tooltipColor = `#${groupColor.getHexString()}`;
    const line1 = createTooltipLine(
      `${country.name} ${formatPopulation(pop)}`,
      tooltipColor,
    );

    const lines = [line1];

    elements.tooltip.hidden = false;
    elements.tooltip.replaceChildren(...lines);
    elements.tooltip.style.setProperty("--tooltip-color", tooltipColor);
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

  function resize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    if (pointsMesh) {
      pointsMesh.material.uniforms.uScale.value = renderer.domElement.height * 0.5;
    }
  }

  let eventController = null;

  function init() {
    if (eventController) return false;
    eventController = new AbortController();
    const { signal } = eventController;
    controls.addEventListener("change", clampMapPanTarget);

    elements.mapPanHint.hidden = false;
    elements.mapResetView.hidden = false;
    elements.mapPanHint.addEventListener("click", dismissMapPanHint, { signal });
    elements.mapResetView.addEventListener("click", resetMapView, { signal });

    renderer.domElement.addEventListener("pointermove", (event) => {
      pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
      pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
      lastPointerEvent = event;
      if (!countryBorderHitTester) ensureCountryBorders();
    }, { signal });
    renderer.domElement.addEventListener("pointerleave", () => {
      pointer.set(Infinity, Infinity);
      lastPointerEvent = null;
      clearCanvasHover();
    }, { signal });
    renderer.domElement.addEventListener("pointerdown", (event) => {
      canvasPointerDownPos = { x: event.clientX, y: event.clientY };
      dismissMapPanHint();
      // A manual grab takes over the camera outright — cancel any in-flight
      // facing tween/hold rather than fight the user's own drag, restoring
      // autoRotate immediately (exactly the state it'd be in without this
      // feature at all).
      if (focusTween || focusResumeTimer != null) {
        focusTween = null;
        clearFocusResumeTimer();
        if (getViewMode() === "globe") controls.autoRotate = true;
      }
    }, { signal });
    // Dismissing on the "change" event fired by controls.update() would also
    // fire for purely programmatic camera moves (initializeViewMode, the
    // reset-view tween, view-mode morphs) — genuine pointerdown/wheel input
    // is the actual signal that the user tried panning or zooming.
    renderer.domElement.addEventListener("wheel", dismissMapPanHint, {
      passive: true,
      signal,
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
      if (country) onOpenCountry(country);
    }, { signal });
    return true;
  }

  let animFrameId = null;

  function animate(timestamp) {
    animFrameId = requestAnimationFrame(animate);
    timer.update(timestamp);
    updateTransition();
    updateResetTween();
    updateFocusTween();
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

  function start() {
    if (animFrameId !== null) return false;
    animFrameId = requestAnimationFrame(animate);
    return true;
  }

  function stop() {
    if (animFrameId === null) return false;
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
    return true;
  }

  function dispose() {
    stop();
    hideMapPanHint();
    eventController?.abort();
    eventController = null;
    controls.removeEventListener("change", clampMapPanTarget);
    clearFocusResumeTimer();
    calloutController.clear();
    if (pointsMesh) {
      scene.remove(pointsMesh);
      pointsMesh.geometry?.dispose();
      pointsMesh.material?.dispose();
      pointsMesh = null;
    }
    if (borderLinesGroup) {
      scene.remove(borderLinesGroup);
      borderLinesGroup.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) obj.material.dispose();
      });
    }
    if (hoverFillGroup) {
      scene.remove(hoverFillGroup);
      hoverFillGroup.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) obj.material.dispose();
      });
    }
    hoverFillCache.forEach((item) => {
      item.mesh?.geometry?.dispose();
      item.mesh?.material?.dispose();
    });
    hoverFillCache.clear();
    controls.dispose();
    renderer.dispose();
  }

  function setLoadCountryBorders(fn) {
    loadCountryBorders = fn;
  }

  // True once setup() has built the dot buffer — mirrors the old bare
  // `if (!pointsMesh) return;` guard callers used before the scene owned
  // pointsMesh itself.
  function isReady() {
    return pointsMesh !== null;
  }

  return {
    init,
    setup,
    initializeViewMode,
    applyYear,
    rebuildCallouts,
    recolor,
    recomputeThemeColors,
    setViewMode,
    setTransientUiVisible,
    colorFor,
    hasUnclassifiedIncome: () => hasUnclassifiedIncome,
    resize,
    start,
    stop,
    dispose,
    setLoadCountryBorders,
    isReady,
    focusPeakCountry,
  };
}
