import { forceCollide, forceSimulation, forceX, forceY } from "d3-force";
import { convertAlpha3ToAlpha2 } from "./data-loader.mjs";
import {
  classifyCountry,
  forceStrengthFor,
  PHASE_ONE_END_YEAR,
  PHASE_ONE_START_YEAR,
  radiusForPopulation,
  refineArchetypeForPhase,
} from "./cluster-model.mjs";
import { foregroundForColor, resolveCssColor } from "./theme-colors.mjs";

const AXES = {
  fertility: "fertility",
  migration: "netMigrationRate",
  growth: "populationGrowth",
  age: "medianAge",
  population: "population",
  lifeExpectancy: "lifeExpectancy",
};
const RADIUS_OPTIONS = { minRadius: 9, maxRadius: 128 };
const ARCHETYPE_LABELS = {
  goldenBoom: "Golden Boom",
  emergingSurge: "Emerging Surge",
  growth: "Growth",
  bufferedGrowth: "Migrant Buffers",
  silverDecline: "Silver Decline",
};
const ANCHOR_RATIOS = {
  emergingSurge: { x: 0.35, y: 0.4 },
  goldenBoom: { x: 0.8, y: 0.65 },
  growth: { x: 0.25, y: 0.38 },
  bufferedGrowth: { x: 0.5, y: 0.8 },
  silverDecline: { x: 0.78, y: 0.5 },
};
const LABEL_HEIGHT = 32;
const LABEL_PADDING_X = 14;
const LABEL_PARTICLE_GAP = 14;
const PHASE_ONE_KEYS = new Set(["goldenBoom", "emergingSurge"]);
const PHASE_TWO_KEYS = new Set([
  "growth",
  "bufferedGrowth",
  "silverDecline",
]);

function isPhaseOneYear(year) {
  return (
    year != null && year >= PHASE_ONE_START_YEAR && year <= PHASE_ONE_END_YEAR
  );
}

function percentile(sortedValues, fraction) {
  if (!sortedValues.length) return null;
  const index = (sortedValues.length - 1) * fraction;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sortedValues[lower];
  const weight = index - lower;
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

export function createClusterController({
  canvas,
  getCountries,
  getYears,
  chartSeriesFor,
  valueAtYear,
  colorFor,
  showTooltip,
  hideTooltip,
  onCountryClick,
}) {
  let active = false;
  let colorMode = "region";
  let currentYearIndex = -1;
  let context = null;
  let simulation = null;
  let nodes = [];
  let nodesBuilt = false;
  let interactionBound = false;
  let anchors = null;
  let labelRects = [];
  let medianAgeDomain = null;
  let populationMax = null;
  let hoveredNode = null;
  let sortedNodes = [];
  let particleFont = null;
  let titleFont = null;
  let annotationPhaseIsOne = null;
  let forceXInstance = null;
  let forceYInstance = null;
  let collideForce = null;
  let labelAvoidanceForce = null;

  function computeDomains() {
    const medianAges = [];
    let maxPopulation = 0;
    getCountries().forEach((country) => {
      chartSeriesFor(country, AXES.age).forEach((value) => {
        if (Number.isFinite(value)) medianAges.push(value);
      });
      chartSeriesFor(country, AXES.population).forEach((value) => {
        if (Number.isFinite(value) && value > maxPopulation) {
          maxPopulation = value;
        }
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

  function ensureDomains() {
    if (medianAgeDomain && populationMax) return true;
    const domains = computeDomains();
    if (!domains) return false;
    medianAgeDomain = domains.medianAgeDomain;
    populationMax = domains.populationMax;
    return true;
  }

  function computeAnchors(width, height) {
    return Object.fromEntries(
      Object.entries(ANCHOR_RATIOS).map(([key, ratio]) => [
        key,
        { x: width * ratio.x, y: height * ratio.y },
      ]),
    );
  }

  function ensureParticleFont() {
    if (particleFont) return particleFont;
    const family =
      getComputedStyle(document.documentElement)
        .getPropertyValue("--font-mono")
        .trim() || "monospace";
    particleFont = `600 11px ${family}`;
    return particleFont;
  }

  function ensureTitleFont() {
    if (titleFont) return titleFont;
    const family =
      getComputedStyle(document.documentElement)
        .getPropertyValue("--font-mono")
        .trim() || "monospace";
    titleFont = `600 14px ${family}`;
    return titleFont;
  }

  function updateLabelRects(activeKeys) {
    if (!context || !anchors) return;
    context.font = ensureTitleFont();
    labelRects = [...activeKeys].map((archetype) => {
      const anchor = anchors[archetype];
      const label = ARCHETYPE_LABELS[archetype];
      const width =
        context.measureText(label.toUpperCase()).width + LABEL_PADDING_X * 2;
      return {
        archetype,
        label,
        x: anchor.x - width / 2,
        y: anchor.y - LABEL_HEIGHT / 2,
        width,
        height: LABEL_HEIGHT,
      };
    });
  }

  function updateAnnotationVisibility(year) {
    const phaseIsOne = isPhaseOneYear(year);
    if (phaseIsOne === annotationPhaseIsOne) return;
    annotationPhaseIsOne = phaseIsOne;
    updateLabelRects(phaseIsOne ? PHASE_ONE_KEYS : PHASE_TWO_KEYS);
  }

  function clusterAnchorFor(node) {
    return anchors[node.archetype] ?? anchors.growth;
  }

  function createLabelAvoidanceForce() {
    let forceNodes = [];
    function force(alpha) {
      forceNodes.forEach((node) => {
        if (!node.archetype) return;
        labelRects.forEach((rect) => {
          const gap = node.radius + LABEL_PARTICLE_GAP;
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
          // Use damped repulsion instead of snapping positions directly to
          // the boundary. Snapping fights the anchor/collision forces on
          // alternating ticks and makes nearby particles visibly vibrate.
          // The larger exclusion gap above gives this softer force room to
          // settle before a circle reaches the visible rectangle.
          const strength = 0.18 + alpha * 0.22;
          if (nearest.axis === "x") {
            node.vx =
              node.vx * 0.65 + (nearest.target - node.x) * strength;
          } else {
            node.vy =
              node.vy * 0.65 + (nearest.target - node.y) * strength;
          }
        });
      });
    }
    force.initialize = (nextNodes) => {
      forceNodes = nextNodes;
    };
    return force;
  }

  function reinitializeForces() {
    forceXInstance?.initialize(nodes);
    forceYInstance?.initialize(nodes);
    collideForce?.initialize(nodes);
    labelAvoidanceForce?.initialize(nodes);
  }

  function resize() {
    if (!active) return;
    const displayWidth = canvas.clientWidth || window.innerWidth;
    const displayHeight = canvas.clientHeight || window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(displayWidth * dpr);
    canvas.height = Math.round(displayHeight * dpr);
    if (!context) context = canvas.getContext("2d");
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    anchors = computeAnchors(displayWidth, displayHeight);
    const year = getYears()[currentYearIndex] ?? null;
    updateLabelRects(isPhaseOneYear(year) ? PHASE_ONE_KEYS : PHASE_TWO_KEYS);
    if (simulation) {
      reinitializeForces();
      simulation.alpha(1).restart();
    }
  }

  function buildNodes() {
    if (nodesBuilt) return;
    nodes = getCountries().map((country) => ({
      country,
      iso2: convertAlpha3ToAlpha2(country.iso3) ?? country.iso3,
      x: anchors.growth.x + (Math.random() - 0.5) * 40,
      y: anchors.growth.y + (Math.random() - 0.5) * 40,
      radius: 3,
      archetype: null,
      medianAge: null,
    }));
    nodesBuilt = true;
  }

  function startSimulation() {
    forceXInstance = forceX((node) => clusterAnchorFor(node).x).strength(
      (node) =>
        forceStrengthFor(node.archetype, node.medianAge, medianAgeDomain),
    );
    forceYInstance = forceY((node) => clusterAnchorFor(node).y).strength(
      (node) =>
        forceStrengthFor(node.archetype, node.medianAge, medianAgeDomain),
    );
    collideForce = forceCollide((node) => node.radius + 2)
      .strength(1)
      .iterations(10);
    labelAvoidanceForce = createLabelAvoidanceForce();
    simulation = forceSimulation(nodes)
      .force("x", forceXInstance)
      .force("y", forceYInstance)
      .force("collide", collideForce)
      .force("label-avoidance", labelAvoidanceForce)
      .alphaTarget(0)
      .on("tick", render);
  }

  function declineContext(country, yearIndex, population) {
    const years = getYears();
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
    const upperIndex = Math.min(years.length - 1, Math.ceil(yearIndex));
    const fraction = yearIndex - lowerIndex;
    const currentYear =
      years[lowerIndex] + (years[upperIndex] - years[lowerIndex]) * fraction;
    return {
      populationLossFromPeak: Math.max(
        0,
        (peakPopulation - population) / peakPopulation,
      ),
      yearsSincePeak: currentYear - years[peakIndex],
    };
  }

  function updateNodesForYear(yearIndex) {
    if (yearIndex == null || yearIndex < 0) return;
    currentYearIndex = yearIndex;
    const year = getYears()[Math.round(yearIndex)] ?? null;
    nodes.forEach((node) => {
      const fertility = valueAtYear(node.country, AXES.fertility, yearIndex);
      const netMigrationRate = valueAtYear(
        node.country,
        AXES.migration,
        yearIndex,
      );
      const populationGrowth = valueAtYear(
        node.country,
        AXES.growth,
        yearIndex,
      );
      const medianAge = valueAtYear(node.country, AXES.age, yearIndex);
      const population = valueAtYear(
        node.country,
        AXES.population,
        yearIndex,
      );
      const lifeExpectancy = valueAtYear(
        node.country,
        AXES.lifeExpectancy,
        yearIndex,
      );
      node.archetype = refineArchetypeForPhase(
        classifyCountry({
          fertility,
          netMigrationRate,
          populationGrowth,
          incomeLabel: node.country._incomeLabel,
          ...declineContext(node.country, yearIndex, population),
        }),
        year,
        lifeExpectancy,
      );
      node.medianAge = medianAge;
      node.radius = radiusForPopulation(
        population,
        populationMax,
        RADIUS_OPTIONS,
      );
    });
    reinitializeForces();
    updateAnnotationVisibility(year);
  }

  function drawNode(node) {
    context.beginPath();
    context.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
    const fill = colorFor(node.country, colorMode);
    context.fillStyle = fill;
    context.fill();
    if (node === hoveredNode) {
      context.lineWidth = 2;
      context.strokeStyle = resolveCssColor("var(--color-text)");
      context.stroke();
    }
    if (node.radius < 9) return;
    context.fillStyle = resolveCssColor(foregroundForColor(fill));
    context.font = ensureParticleFont();
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(node.iso2, node.x, node.y + 1);
  }

  function drawLabels() {
    context.save();
    context.font = ensureTitleFont();
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.lineWidth = 1;
    context.strokeStyle = "#fff";
    const background = resolveCssColor("var(--color-scrim-strong)");
    const textColor = resolveCssColor("var(--color-text)");
    labelRects.forEach((rect) => {
      context.fillStyle = background;
      context.fillRect(rect.x, rect.y, rect.width, rect.height);
      context.strokeRect(rect.x, rect.y, rect.width, rect.height);
      context.fillStyle = textColor;
      context.fillText(
        rect.label.toUpperCase(),
        rect.x + rect.width / 2,
        rect.y + rect.height / 2,
      );
    });
    context.restore();
  }

  function render() {
    if (!context || !anchors) return;
    context.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    sortedNodes = nodes
      .filter((node) => node.archetype)
      .sort((a, b) => b.radius - a.radius);
    sortedNodes.forEach(drawNode);
    drawLabels();
  }

  function nodeAtClientPoint(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    for (let index = sortedNodes.length - 1; index >= 0; index--) {
      const node = sortedNodes[index];
      const dx = x - node.x;
      const dy = y - node.y;
      if (dx * dx + dy * dy <= node.radius * node.radius) return node;
    }
    return null;
  }

  function setupInteraction() {
    if (interactionBound) return;
    canvas.addEventListener("pointermove", (event) => {
      const node = nodeAtClientPoint(event.clientX, event.clientY);
      const hoverChanged = node !== hoveredNode;
      hoveredNode = node;
      if (hoverChanged) render();
      canvas.style.cursor = node ? "pointer" : "default";
      if (node) {
        showTooltip(event, node.country.name, colorFor(node.country, colorMode));
      } else {
        hideTooltip();
      }
    });
    canvas.addEventListener("pointerleave", () => {
      const hadHoveredNode = hoveredNode !== null;
      hoveredNode = null;
      if (hadHoveredNode) render();
      hideTooltip();
    });
    canvas.addEventListener("click", (event) => {
      const node = nodeAtClientPoint(event.clientX, event.clientY);
      if (node) onCountryClick(node.country);
    });
    interactionBound = true;
  }

  function renderLayout(yearIndex = currentYearIndex) {
    if (!active) return false;
    currentYearIndex = yearIndex;
    if (!ensureDomains()) {
      if (context) {
        context.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
      }
      return false;
    }
    resize();
    buildNodes();
    setupInteraction();
    if (!simulation) startSimulation();
    updateNodesForYear(currentYearIndex);
    simulation.alpha(1).restart();
    return true;
  }

  function activate(yearIndex) {
    active = true;
    renderLayout(yearIndex);
  }

  function deactivate() {
    active = false;
    hoveredNode = null;
    hideTooltip();
    simulation?.stop();
    simulation = null;
    forceXInstance = null;
    forceYInstance = null;
    collideForce = null;
    labelAvoidanceForce = null;
  }

  function setYear(year) {
    if (!active || !medianAgeDomain) return;
    const yearIndex = getYears().indexOf(year);
    if (yearIndex === -1) return;
    updateNodesForYear(yearIndex);
    simulation?.alpha(Math.max(simulation.alpha(), 0.4)).restart();
  }

  function setColorMode(mode) {
    if (mode === colorMode) return;
    colorMode = mode;
    render();
  }

  return {
    activate,
    deactivate,
    isActive: () => active,
    getColorMode: () => colorMode,
    render: renderLayout,
    resize,
    setColorMode,
    setYear,
  };
}
