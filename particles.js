import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const DATA_URL = "./data/population-dots.json";
const PEOPLE_PER_DOT = 1_000_000;
const GLOBE_RADIUS = 200;
const DOT_SIZE = 2.2;
const PULSE_AMPLITUDE = 5;
const PULSE_FREQ_MIN = 0.5;
const PULSE_FREQ_RANGE = 2.0;

const REGION_COLORS = {
  "East Asia & Pacific": "#FF48B0",
  "Europe & Central Asia": "#4EA8FF",
  "Latin America & Caribbean": "#E3ED55",
  "Middle East, North Africa, Afghanistan & Pakistan": "#FF8E91",
  "North America": "#00A95C",
  "South Asia": "#B18CFF",
  "Sub-Saharan Africa": "#FFB454",
};
const DEFAULT_COLOR = "#5fe39a";

const elements = {
  status: document.querySelector("#status"),
  tooltip: document.querySelector("#tooltip"),
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

function buildDots(countries) {
  const positions = [];
  const colors = [];
  const dotCountry = [];
  const frequencies = [];
  const phases = [];

  countries.forEach((country) => {
    const color = regionColor(country.region);

    // Dot coordinates are precomputed (data/population-dots.json) by
    // randomly sampling points inside each country's real polygon
    // boundary, so population spreads across its actual landmass instead
    // of clustering around a single lat/lon anchor.
    country.dots.forEach(([lat, lon]) => {
      const point = latLonToVector3(lat, lon, GLOBE_RADIUS);
      positions.push(point.x, point.y, point.z);
      colors.push(color.r, color.g, color.b);
      dotCountry.push(country);
      frequencies.push(PULSE_FREQ_MIN + Math.random() * PULSE_FREQ_RANGE);
      phases.push(Math.random() * Math.PI * 2);
    });
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));

  const material = new THREE.PointsMaterial({
    size: DOT_SIZE,
    map: createDotTexture(),
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    sizeAttenuation: true,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geometry, material);
  scene.add(points);
  return {
    points,
    dotCountry,
    originalPositions: Float32Array.from(positions),
    frequencies: Float32Array.from(frequencies),
    phases: Float32Array.from(phases),
  };
}

function formatCount(value) {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}K`;
  return `${value}`;
}

let pointsMesh = null;
let dotCountry = [];
let originalPositions = null;
let frequencies = null;
let phases = null;
const clock = new THREE.Clock();

async function init() {
  try {
    const response = await fetch(DATA_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const built = buildDots(data.countries);
    pointsMesh = built.points;
    dotCountry = built.dotCountry;
    originalPositions = built.originalPositions;
    frequencies = built.frequencies;
    phases = built.phases;

    const totalPop = data.countries.reduce((sum, c) => sum + c.population, 0);
    elements.status.textContent = `${dotCountry.length.toLocaleString()} dots · 1 dot ≈ ${formatCount(PEOPLE_PER_DOT)} people · ${data.countries.length} countries · ${formatCount(totalPop)} total (${data.year})`;
  } catch (error) {
    elements.status.textContent = `Could not load data: ${error.message}`;
  }
}

function pulseDots(elapsedTime) {
  if (!pointsMesh) return;
  const positionAttribute = pointsMesh.geometry.getAttribute("position");
  const array = positionAttribute.array;
  for (let i = 0; i < frequencies.length; i++) {
    const i3 = i * 3;
    const ox = originalPositions[i3];
    const oy = originalPositions[i3 + 1];
    const oz = originalPositions[i3 + 2];
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
  if (!pointsMesh) return;
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
  elements.tooltip.hidden = false;
  elements.tooltip.textContent = `${country.name} — ${country.population.toLocaleString()}`;
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
