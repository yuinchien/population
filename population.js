import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  CSS2DRenderer,
  CSS2DObject,
} from "three/addons/renderers/CSS2DRenderer.js";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";

const DATA_URL = "/data/population-global.json";
const CURRENT_YEAR = new Date().getFullYear();
const MIN_YEAR = 1960;
const MAX_YEAR = 2050;

const SERIES_DEFS = [
  {
    id: "population",
    label: "Global Population",
    color: "#FF48B0",
    format: formatCount,
  },
  {
    id: "lifeExpectancy",
    label: "Life Expectancy at Birth",
    color: "#00A95C",
    format: (value) => `${value.toFixed(1)} yrs`,
  },
  {
    id: "fertility",
    label: "Fertility Rate",
    color: "#E3ED55",
    format: (value) => `${value.toFixed(2)} births/woman`,
  },
  {
    id: "oldAgeDependency",
    label: "Old-Age Dependency Ratio",
    color: "#FF8E91",
    format: (value) => `${value.toFixed(1)}%`,
  },
];

const elements = {
  startYear: document.querySelector("#startYear"),
  endYear: document.querySelector("#endYear"),
  startYearLabel: document.querySelector("#startYearLabel"),
  endYearLabel: document.querySelector("#endYearLabel"),
  yearRangeFill: document.querySelector("#yearRangeFill"),
  status: document.querySelector("#status"),
  chartSubtitle: document.querySelector("#chartSubtitle"),
  chart3d: document.querySelector("#chart3d"),
  chartWrap: document.querySelector(".chart-wrap"),
  chartLegend: document.querySelector("#chartLegend"),
  tooltip: document.querySelector("#tooltip"),
};

const state = {
  data: null,
};

const scene3d = {
  scene: null,
  camera: null,
  renderer: null,
  labelRenderer: null,
  controls: null,
  seriesGroup: null,
  labelGroup: null,
  raf: null,
  raycaster: null,
  pointer: null,
  framed: false,
};

function init() {
  elements.startYear.min = MIN_YEAR;
  elements.startYear.max = MAX_YEAR;
  elements.endYear.min = MIN_YEAR;
  elements.endYear.max = MAX_YEAR;
  elements.startYear.step = 1;
  elements.endYear.step = 1;
  elements.startYear.value = MIN_YEAR;
  elements.endYear.value = MAX_YEAR;

  restoreFromUrl();
  bindEvents();
  syncYearLabels();
  loadData();
}

function bindEvents() {
  elements.startYear.addEventListener("input", () => {
    if (Number(elements.startYear.value) > Number(elements.endYear.value)) {
      elements.endYear.value = elements.startYear.value;
    }
    syncYearLabels();
    render();
  });
  elements.endYear.addEventListener("input", () => {
    if (Number(elements.endYear.value) < Number(elements.startYear.value)) {
      elements.startYear.value = elements.endYear.value;
    }
    syncYearLabels();
    render();
  });
  elements.startYear.addEventListener("change", updateUrl);
  elements.endYear.addEventListener("change", updateUrl);

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

function restoreFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const start = params.get("start");
  const end = params.get("end");
  if (start) elements.startYear.value = start;
  if (end) elements.endYear.value = end;
}

function updateUrl() {
  const params = new URLSearchParams();
  params.set("start", elements.startYear.value);
  params.set("end", elements.endYear.value);
  history.replaceState(null, "", `${window.location.pathname}?${params}`);
}

async function loadData() {
  setStatus("Loading population data...");
  try {
    const response = await fetch(DATA_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.data = await response.json();
    setStatus("Ready.");
    render();
  } catch (error) {
    setStatus(`Could not load data: ${error.message}`);
  }
}

function setStatus(message) {
  elements.status.textContent = message;
}

function render() {
  if (!state.data) return;
  renderTrend3D();
}

function renderTrend3D() {
  ensureThreeScene();
  clearSeriesGroup();
  clearTooltip();

  const start = Number(elements.startYear.value);
  const end = Number(elements.endYear.value);

  const seriesList = SERIES_DEFS.map((def) => {
    const rows = state.data[def.id] || [];
    const points = rows
      .filter((row) => row.year >= start && row.year <= end)
      .map((row) => ({ ...row, projected: row.year > CURRENT_YEAR }))
      .sort((a, b) => a.year - b.year);
    return { ...def, points };
  }).filter((series) => series.points.length > 1);

  renderTrendLegend(seriesList);

  const isProjected = seriesList.some((series) =>
    series.points.some((point) => point.projected),
  );
  elements.chartSubtitle.textContent = seriesList.length
    ? `World Bank population estimates and projections, ${start}–${end}${isProjected ? " (includes projection)" : ""}`
    : `No data available for ${start}–${end}`;

  if (!seriesList.length) {
    stopAnimation();
    return;
  }

  const n = seriesList.length;
  const rowDepth = 90;
  const spanX = 460;
  const maxH = 260;
  const depth = n * rowDepth;

  const mapX = (year) => scale(year, [start, end], [-spanX / 2, spanX / 2]);
  const mapZ = (index) => (index - (n - 1) / 2) * rowDepth;

  const containerRect = elements.chart3d.getBoundingClientRect();
  const resolution = new THREE.Vector2(
    Math.max(1, containerRect.width),
    Math.max(1, containerRect.height),
  );

  addBaseGrid({ spanX, depth });

  seriesList.forEach((series, index) => {
    const z = mapZ(index);
    const yDomain = paddedDomain(series.points.map((point) => point.value));
    const mapY = (value) => scale(value, yDomain, [0, maxH]);
    const plotted = series.points.map((point) => ({
      ...point,
      _plotX: mapX(point.year),
      seriesLabel: series.label,
      format: series.format,
    }));
    const toVec = (point) =>
      new THREE.Vector3(mapX(point.year), mapY(point.value), z);
    const actualPoints = plotted.filter((point) => !point.projected);
    const projectedPoints = plotted.filter((point) => point.projected);

    const toPositions = (points) =>
      points.flatMap((point) => {
        const v = toVec(point);
        return [v.x, v.y, v.z];
      });

    if (actualPoints.length > 1) {
      const geometry = new LineGeometry();
      geometry.setPositions(toPositions(actualPoints));
      const material = new LineMaterial({
        color: series.color,
        linewidth: 3,
        resolution,
      });
      const line = new Line2(geometry, material);
      line.computeLineDistances();
      line.userData = { series: plotted };
      scene3d.seriesGroup.add(line);
    }

    if (projectedPoints.length) {
      const bridge = actualPoints.length
        ? [actualPoints[actualPoints.length - 1], ...projectedPoints]
        : projectedPoints;
      const geometry = new LineGeometry();
      geometry.setPositions(toPositions(bridge));
      const material = new LineMaterial({
        color: series.color,
        linewidth: 3,
        resolution,
        dashed: true,
        dashSize: 6,
        gapSize: 6,
        dashScale: 1.5,
        transparent: true,
        opacity: 0.85,
      });
      const line = new Line2(geometry, material);
      line.computeLineDistances();
      line.userData = { series: plotted };
      scene3d.seriesGroup.add(line);
    }

    const first = plotted[0];
    const firstVec = toVec(first);
    const nameDiv = document.createElement("div");
    nameDiv.className = "label-3d label-country";
    nameDiv.textContent = series.label;
    const nameLabel = new CSS2DObject(nameDiv);
    nameLabel.center.set(1, 1);
    nameLabel.position.set(firstVec.x - 20, maxH + 14, z);
    scene3d.labelGroup.add(nameLabel);

    const rangeDiv = document.createElement("div");
    rangeDiv.className = "label-3d label-tick";
    rangeDiv.textContent = `${series.format(yDomain[0])} — ${series.format(yDomain[1])}`;
    const rangeLabel = new CSS2DObject(rangeDiv);
    rangeLabel.center.set(1, 1);
    rangeLabel.position.set(firstVec.x - 20, maxH - 14, z);
    scene3d.labelGroup.add(rangeLabel);
  });

  addYearAxisTicks({ start, end, spanX, depth });

  if (!scene3d.framed) {
    scene3d.camera.position.set(
      spanX * 0.35,
      maxH * 0.9 + 140,
      depth * 1.1 + maxH * 1.1 + 380,
    );
    scene3d.framed = true;
  }
  scene3d.controls.target.set(0, maxH * 0.35, 0);
  scene3d.controls.maxDistance = Math.max(spanX, depth, maxH) * 2.8;
  scene3d.controls.update();
  resizeThree();
  startAnimation();
}

function renderTrendLegend(seriesList) {
  elements.chartWrap.classList.toggle("has-legend", seriesList.length > 0);
  elements.chartLegend.hidden = seriesList.length === 0;
  elements.chartLegend.replaceChildren(
    ...seriesList.map((series) => {
      const item = document.createElement("div");
      item.className = "legend-item";

      const swatch = document.createElement("span");
      swatch.className = "legend-swatch";
      swatch.style.background = series.color;

      const name = document.createElement("span");
      name.className = "legend-name";
      name.textContent = series.label;

      item.append(swatch, name);
      return item;
    }),
  );
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
  camera.position.set(0, 500, 900);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(w, h);
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
  const ambient = new THREE.AmbientLight(0xffffff, 0.2);
  scene.add(ambient);
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(280, 480, 220);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x8aa6ff, 0.35);
  fill.position.set(-300, 220, -180);
  scene.add(fill);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 100, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 200;
  controls.maxDistance = 2400;
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

  const seriesGroup = new THREE.Group();
  scene.add(seriesGroup);
  const labelGroup = new THREE.Group();
  scene.add(labelGroup);

  scene3d.scene = scene;
  scene3d.camera = camera;
  scene3d.renderer = renderer;
  scene3d.labelRenderer = labelRenderer;
  scene3d.controls = controls;
  scene3d.seriesGroup = seriesGroup;
  scene3d.labelGroup = labelGroup;
  scene3d.raycaster = new THREE.Raycaster();
  scene3d.raycaster.params.Line2 = { threshold: 6 };
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

function disposeObject3D(object) {
  if (object.geometry) object.geometry.dispose();
  if (object.material) object.material.dispose();
  object.children.forEach(disposeObject3D);
}

function clearSeriesGroup() {
  if (!scene3d.seriesGroup) return;
  while (scene3d.seriesGroup.children.length) {
    const child = scene3d.seriesGroup.children[0];
    scene3d.seriesGroup.remove(child);
    disposeObject3D(child);
  }
  while (scene3d.labelGroup.children.length) {
    const child = scene3d.labelGroup.children[0];
    scene3d.labelGroup.remove(child);
    if (child.element && child.element.parentNode) {
      child.element.parentNode.removeChild(child.element);
    }
  }
}

function addBaseGrid({ spanX, depth }) {
  const width = spanX + 100;
  const depthSize = depth + 100;

  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(width, depthSize),
    new THREE.MeshStandardMaterial({
      color: 0x0d1712,
      roughness: 0.95,
      metalness: 0,
      transparent: true,
      opacity: 0.92,
    }),
  );
  plane.rotation.x = -Math.PI / 2;
  scene3d.seriesGroup.add(plane);

  const divisionsX = 12;
  const divisionsZ = 6;
  const points = [];
  for (let i = 0; i <= divisionsX; i++) {
    const x = -width / 2 + (i / divisionsX) * width;
    points.push(x, 0.02, -depthSize / 2, x, 0.02, depthSize / 2);
  }
  for (let i = 0; i <= divisionsZ; i++) {
    const z = -depthSize / 2 + (i / divisionsZ) * depthSize;
    points.push(-width / 2, 0.02, z, width / 2, 0.02, z);
  }
  const gridGeom = new THREE.BufferGeometry();
  gridGeom.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(points, 3),
  );
  scene3d.seriesGroup.add(
    new THREE.LineSegments(
      gridGeom,
      new THREE.LineBasicMaterial({
        color: 0x2a3a30,
        transparent: true,
        opacity: 0.6,
      }),
    ),
  );

  const edgesGeom = new THREE.EdgesGeometry(
    new THREE.BoxGeometry(width, 0.02, depthSize),
  );
  const border = new THREE.LineSegments(
    edgesGeom,
    new THREE.LineBasicMaterial({ color: 0x4a6355 }),
  );
  border.position.y = 0.03;
  scene3d.seriesGroup.add(border);
}

function addYearAxisTicks({ start, end, spanX, depth }) {
  const backZ = -(depth / 2 + 20);
  makeYearTicks(start, end).forEach((year) => {
    const div = document.createElement("div");
    div.className = "label-3d label-tick";
    div.textContent = year;
    const obj = new CSS2DObject(div);
    obj.position.set(
      scale(year, [start, end], [-spanX / 2, spanX / 2]),
      0,
      backZ,
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
      scene3d.seriesGroup.children,
      true,
    );
    if (!hits.length) {
      clearTooltip();
      return;
    }
    const hit = hits[0];
    if (hit.object.userData.point) {
      showTrendTooltip(event, hit.object.userData.point);
    } else if (hit.object.userData.series) {
      const nearest = nearestSeriesPoint(
        hit.object.userData.series,
        hit.point.x,
      );
      if (nearest) {
        showTrendTooltip(event, nearest);
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

function showTrendTooltip(event, point) {
  const rect = elements.chartWrap.getBoundingClientRect();
  elements.tooltip.hidden = false;
  elements.tooltip.innerHTML = `
    <strong>${point.seriesLabel}</strong><br>
    ${point.year}: ${point.format(point.value)}${point.projected ? " (projected)" : ""}
  `;
  elements.tooltip.style.left = `${Math.min(rect.width - 220, event.clientX - rect.left + 12)}px`;
  elements.tooltip.style.top = `${Math.max(8, event.clientY - rect.top - 46)}px`;
}

function clearTooltip() {
  elements.tooltip.hidden = true;
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
  const step = span > 60 ? 10 : span > 30 ? 5 : span > 12 ? 2 : 1;
  const ticks = [];
  for (let year = start; year <= end; year += step) {
    ticks.push(year);
  }
  if (!ticks.includes(end)) ticks.push(end);
  return ticks;
}

function formatCount(value) {
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000_000)
    return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (absolute >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (absolute >= 10_000) return Math.round(value).toLocaleString();
  return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

init();
