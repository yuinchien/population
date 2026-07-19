import { forceCollide, forceSimulation, forceX, forceY } from "d3-force";
import { runChartAnimation } from "./chart-animation.mjs";
import { convertAlpha3ToAlpha2 } from "./data-loader.mjs";
import {
  classifyCountry,
  forceStrengthFor,
  populationDeclineContext,
  radiusForPopulation,
  refineArchetypeForPhase,
} from "./cluster-model.mjs";
import {
  CLUSTER_ARCHETYPES,
  clusterPhaseForYear,
} from "./cluster-config.mjs";
import {
  clusterBoundaryCorrection,
  clusterEntranceOrder,
  clusterEntranceScale,
  clusterNodeAtPoint,
  resolveClusterHover,
  seededClusterPosition,
} from "./cluster-layout.mjs";
import { foregroundForColor, resolveCssColor } from "./theme-colors.mjs";

const AXES = {
  fertility: "fertility",
  migration: "netMigrationRate",
  growth: "populationGrowth",
  age: "medianAge",
  population: "population",
  lifeExpectancy: "lifeExpectancy",
};
const RADIUS_OPTIONS = { minRadius: 5, maxRadius: 144 };
const LABEL_HEIGHT = 24;
const LABEL_PADDING_X = 4;
const LABEL_PARTICLE_GAP = 12;
const CLUSTER_BOUNDARY_GAP = 16;
// Resolve the dense, anchor-centered seed layout before exposing the canvas.
// Manual D3 ticks do not dispatch the tick listener, so this removes the
// initial burst of particles crossing title blocks without flashing the
// intermediate positions to the user.
const INITIAL_SETTLE_TICKS = 20;
const ENTRANCE_DURATION_MS = 900;
// Canvas fillText renders uppercase archetype titles (GROWTH, SILVER
// DECLINE, ...) with the letters butted right up against each other —
// noticeably tighter than the same font/weight would ever read as body
// text, since there's no CSS letter-spacing equivalent by default. Applied
// wherever this text is measured (updateLabelRects) or drawn (drawLabels)
// so the two stay in sync.
const TITLE_LETTER_SPACING = ".8px";

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
  showArchetypeTooltip,
  hideArchetypeTooltip,
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
  let annotationPhase = null;
  let forceXInstance = null;
  let forceYInstance = null;
  let collideForce = null;
  let labelAvoidanceForce = null;
  let territoryForce = null;
  let entranceAnimation = null;
  let entranceProgress = 1;
  let entrancePending = false;

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
      Object.entries(CLUSTER_ARCHETYPES).map(([key, archetype]) => [
        key,
        {
          x: width * archetype.anchor.x,
          y: height * archetype.anchor.y,
        },
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
        .getPropertyValue("--font-sans")
        .trim() || "sans-serif";
    titleFont = `600 14px ${family}`;
    return titleFont;
  }

  function updateLabelRects(activeKeys) {
    if (!context || !anchors) return;
    context.save();
    context.font = ensureTitleFont();
    context.letterSpacing = TITLE_LETTER_SPACING;
    labelRects = [...activeKeys].map((archetype) => {
      const anchor = anchors[archetype];
      const label = CLUSTER_ARCHETYPES[archetype].label;
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
    context.restore();
  }

  function updateAnnotationVisibility(year) {
    const phase = clusterPhaseForYear(year);
    if (phase === annotationPhase) return;
    annotationPhase = phase;
    updateLabelRects(phase.archetypes);
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

  function createTerritoryForce() {
    let forceNodes = [];
    function force(alpha) {
      forceNodes.forEach((node) => {
        if (!node.archetype) return;
        const ownAnchor = clusterAnchorFor(node);
        let correctionX = 0;
        let correctionY = 0;
        labelRects.forEach(({ archetype }) => {
          if (archetype === node.archetype) return;
          const correction = clusterBoundaryCorrection(
            node,
            ownAnchor,
            anchors[archetype],
            CLUSTER_BOUNDARY_GAP,
          );
          correctionX += correction.x;
          correctionY += correction.y;
        });
        if (!correctionX && !correctionY) return;
        const strength = 0.2 + alpha * 0.25;
        node.vx = node.vx * 0.72 + correctionX * strength;
        node.vy = node.vy * 0.72 + correctionY * strength;
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
    territoryForce?.initialize(nodes);
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
    updateLabelRects(clusterPhaseForYear(year).archetypes);
    if (simulation) {
      reinitializeForces();
      simulation.alpha(1).restart();
    }
  }

  function buildNodes() {
    if (nodesBuilt) return;
    nodes = getCountries().map((country) => {
      const position = seededClusterPosition(
        country.iso3,
        anchors.growth,
      );
      return {
        country,
        iso2: convertAlpha3ToAlpha2(country.iso3) ?? country.iso3,
        ...position,
        radius: 3,
        archetype: null,
        medianAge: null,
      };
    });
    const entranceOrder = clusterEntranceOrder(
      nodes.map((node) => node.country.iso3),
    );
    entranceOrder.forEach((sourceIndex, orderIndex) => {
      nodes[sourceIndex].entranceOrder = orderIndex;
    });
    nodesBuilt = true;
  }

  function entranceScaleFor(node) {
    return clusterEntranceScale(
      entranceProgress,
      node.entranceOrder ?? 0,
      nodes.length,
    );
  }

  function startEntranceAnimation() {
    entranceAnimation?.cancel();
    entrancePending = false;
    entranceAnimation = runChartAnimation({
      duration: ENTRANCE_DURATION_MS,
      onFrame: (_eased, progress) => {
        entranceProgress = progress;
        paintFrame();
      },
      onFinish: () => {
        entranceProgress = 1;
        entranceAnimation = null;
        paintFrame();
      },
    });
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
    territoryForce = createTerritoryForce();
    simulation = forceSimulation(nodes)
      .force("x", forceXInstance)
      .force("y", forceYInstance)
      .force("collide", collideForce)
      .force("label-avoidance", labelAvoidanceForce)
      .force("territory", territoryForce)
      .alphaTarget(0)
      .on("tick", paintFrame)
      .stop();
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
          ...populationDeclineContext(
            node.country.populations,
            getYears(),
            yearIndex,
            population,
          ),
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
    updateAnnotationVisibility(year);
    reinitializeForces();
  }

  function drawNode(node) {
    const scale = entranceScaleFor(node);
    if (scale <= 0) return;
    const visibleRadius = node.radius * scale;
    context.beginPath();
    context.arc(node.x, node.y, visibleRadius, 0, Math.PI * 2);
    const fill = colorFor(node.country, colorMode);
    context.fillStyle = fill;
    context.fill();
    if (node === hoveredNode) {
      context.lineWidth = 2;
      context.strokeStyle = resolveCssColor("var(--color-text)");
      context.stroke();
    }
    if (visibleRadius < 9) return;
    context.fillStyle = resolveCssColor(foregroundForColor(fill));
    context.font = ensureParticleFont();
    context.letterSpacing = TITLE_LETTER_SPACING;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.save();
    context.translate(node.x, node.y);
    context.scale(scale, scale);
    context.fillText(node.iso2, 0, 1);
    context.restore();
  }

  function drawLabels() {
    context.save();
    context.font = ensureTitleFont();
    context.letterSpacing = TITLE_LETTER_SPACING;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.lineWidth = 1;
    context.strokeStyle = "#fff";
    const background = resolveCssColor("var(--color-scrim-strong)");
    const textColor = resolveCssColor("var(--color-text)");
    labelRects.forEach((rect) => {
      // context.fillStyle = background;
      // context.fillRect(rect.x, rect.y, rect.width, rect.height);
      // context.strokeRect(rect.x, rect.y, rect.width, rect.height);
      context.fillStyle = textColor;
      context.fillText(
        rect.label,
        rect.x + rect.width / 2,
        rect.y + rect.height / 2,
      );
    });
    context.restore();
  }

  function paintFrame() {
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
      const visibleRadius = node.radius * entranceScaleFor(node);
      const dx = x - node.x;
      const dy = y - node.y;
      if (dx * dx + dy * dy <= visibleRadius * visibleRadius) return node;
    }
    return null;
  }

  // labelRects are already in the same canvas-relative CSS-pixel space as
  // nodeAtClientPoint's x/y (see updateLabelRects/computeAnchors — both
  // derive from canvas.clientWidth/clientHeight, not the dpr-scaled
  // backing-store size), so no separate coordinate conversion is needed.
  function labelRectAtClientPoint(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    return (
      labelRects.find(
        (label) =>
          x >= label.x &&
          x <= label.x + label.width &&
          y >= label.y &&
          y <= label.y + label.height,
      ) ?? null
    );
  }

  function setupInteraction() {
    if (interactionBound) return;
    canvas.addEventListener("pointermove", (event) => {
      const node = nodeAtClientPoint(event.clientX, event.clientY);
      const hoverChanged = node !== hoveredNode;
      hoveredNode = node;
      if (hoverChanged) paintFrame();
      if (node) {
        canvas.style.cursor = "pointer";
        hideArchetypeTooltip();
        showTooltip(event, node.country.name, colorFor(node.country, colorMode));
        return;
      }
      // Titles aren't click targets (see the click handler below, which
      // only ever looks up nodeAtClientPoint) — just a "help" cursor to
      // signal there's more context on hover, distinct from particles'
      // "pointer".
      const label = labelRectAtClientPoint(event.clientX, event.clientY);
      if (label) {
        canvas.style.cursor = "help";
        hideTooltip();
        showArchetypeTooltip(event, label.archetype);
        return;
      }
      canvas.style.cursor = "default";
      hideTooltip();
      hideArchetypeTooltip();
    });
    canvas.addEventListener("pointerleave", () => {
      const hover = resolveClusterHover(hoveredNode, null);
      hoveredNode = hover.node;
      if (hover.changed) paintFrame();
      hideTooltip();
      hideArchetypeTooltip();
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
    const isInitialLayout = !simulation;
    if (isInitialLayout) startSimulation();
    updateNodesForYear(currentYearIndex);
    if (isInitialLayout) {
      simulation.alpha(1).tick(INITIAL_SETTLE_TICKS);
      paintFrame();
      // Leave only a little energy for a restrained final settle. Year
      // changes still use the normal animated transition in setYear().
      simulation.alpha(0.12).restart();
    } else {
      simulation.alpha(1).restart();
    }
    if (entrancePending) startEntranceAnimation();
    return true;
  }

  function activate(yearIndex) {
    entranceAnimation?.cancel();
    entranceProgress = 0;
    entrancePending = true;
    active = true;
    renderLayout(yearIndex);
  }

  function deactivate() {
    active = false;
    hoveredNode = null;
    hideTooltip();
    hideArchetypeTooltip();
    entranceAnimation?.cancel();
    entranceAnimation = null;
    entranceProgress = 1;
    entrancePending = false;
    simulation?.stop();
    simulation = null;
    forceXInstance = null;
    forceYInstance = null;
    collideForce = null;
    labelAvoidanceForce = null;
    territoryForce = null;
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
    paintFrame();
  }

  return {
    activate,
    deactivate,
    isActive: () => active,
    getColorMode: () => colorMode,
    render: renderLayout,
    // Repaints the current frame with whatever colors resolveCssColor()
    // reads right now — no rebuild, no simulation restart. Distinct from
    // `render` (aliased to the heavier renderLayout, which also rebuilds
    // nodes and reheats the simulation): callers that only need the
    // baked-in canvas pixels to reflect a CSS custom-property change (e.g.
    // a light/dark theme toggle) should use this instead, since the
    // simulation may already be settled/stopped and nothing else would
    // otherwise trigger a redraw.
    redraw: paintFrame,
    resize,
    setColorMode,
    setYear,
  };
}
