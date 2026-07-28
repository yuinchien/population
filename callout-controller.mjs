import * as THREE from "three";

const VIEWPORT_MARGIN = 12;
// Map labels' constant on-screen gap above their dot — see the comment on
// computeOutwardPoint's map branch for why this replaced a world-space push.
const MAP_CALLOUT_LIFT_PX = 18;

export function smoothCalloutPosition(current, target, elapsed, smoothingMs) {
  if (current == null) return target;
  const blend = 1 - Math.exp(-Math.min(50, Math.max(0, elapsed)) / smoothingMs);
  return current + (target - current) * blend;
}

// Keeps pointer and keyboard focus as independent interaction sources. A label
// can own both at once after it is clicked, and a focused label can remain
// active while the pointer briefly highlights another one.
export function createCalloutInteractionState({
  onActivate = () => {},
  onDeactivate = () => {},
} = {}) {
  const countries = new Map();
  let activeCountry = null;
  let sequence = 0;

  function sync() {
    let nextCountry = null;
    let latestSequence = -1;
    countries.forEach(({ sources, activatedAt }, country) => {
      if (sources.size && activatedAt > latestSequence) {
        nextCountry = country;
        latestSequence = activatedAt;
      }
    });
    if (nextCountry === activeCountry) return;
    if (activeCountry) onDeactivate(activeCountry);
    activeCountry = nextCountry;
    if (activeCountry) onActivate(activeCountry);
  }

  function activate(country, source) {
    const entry = countries.get(country) ?? {
      sources: new Set(),
      activatedAt: 0,
    };
    entry.sources.add(source);
    entry.activatedAt = ++sequence;
    countries.set(country, entry);
    sync();
  }

  function deactivate(country, source) {
    const entry = countries.get(country);
    if (!entry) return;
    entry.sources.delete(source);
    if (!entry.sources.size) countries.delete(country);
    sync();
  }

  function clear() {
    countries.clear();
    sync();
  }

  return { activate, deactivate, clear };
}

export function createCalloutController({
  camera,
  layer,
  globeRadius,
  viewConfig,
  leftClearance,
  getCountries,
  getViewMode,
  isTransitioning,
  getColor,
  getPeakYear = (country) => country.peakYear,
  getPopulation,
  formatPopulation,
  getTextColor,
  onOpenCountry,
  onHoverCountry = () => {},
  onLeaveCountry = () => {},
  getViewport = () => ({ width: window.innerWidth, height: window.innerHeight }),
}) {
  const group = new THREE.Group();
  const callouts = [];
  const cameraDirection = new THREE.Vector3();
  const facingDirection = new THREE.Vector3();
  const projectedPoint = new THREE.Vector3();
  const interactions = createCalloutInteractionState({
    onActivate: onHoverCountry,
    onDeactivate: onLeaveCountry,
  });

  function computeAnchor(country, viewMode) {
    const source = viewMode === "map" ? country._xyzMap : country._xyzGlobe;
    const count = source.length / 3;
    const anchor = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      anchor.x += source[i * 3];
      anchor.y += source[i * 3 + 1];
      anchor.z += source[i * 3 + 2];
    }
    anchor.divideScalar(count);
    if (viewMode !== "map") anchor.normalize().multiplyScalar(globeRadius);
    return anchor;
  }

  function computeOutwardPoint(anchor, viewMode) {
    if (viewMode === "map") {
      // No push here — pushing a point toward the camera along world Z (like
      // the globe branch below does, to lift a label off the sphere's
      // curved surface) relies on the camera looking straight down that
      // same axis. That was true for the map too back when its camera was
      // always centered on the map's own origin, but panning breaks it: the
      // parallax this push creates is proportional to how far the point
      // sits from the camera's OWN optical axis (controls.target's x/y),
      // which used to always be (0,0) and now moves with every pan. A flat
      // map has no curvature to lift off of anyway — the label just needs a
      // constant on-screen gap above its dot, applied in screen space after
      // projection instead (see MAP_CALLOUT_LIFT_PX in update()).
      return anchor.clone();
    }
    return anchor
      .clone()
      .normalize()
      .multiplyScalar(viewConfig.globe.calloutExtend);
  }

  function resetPosition(callout) {
    callout.screenX = null;
    callout.screenY = null;
  }

  function clear() {
    interactions.clear();
    callouts.forEach(({ labelEl }) => {
      labelEl.remove();
    });
    callouts.length = 0;
  }

  function rebuild(year) {
    clear();
    const countries = getCountries();
    if (!countries.length) return;
    const viewMode = getViewMode();
    countries
      .filter((country) => getPeakYear(country) === year)
      .forEach((country) => {
        const anchor = computeAnchor(country, viewMode);
        const outward = computeOutwardPoint(anchor, viewMode);
        const color = getColor(country);

        const labelEl = document.createElement("button");
        labelEl.type = "button";
        labelEl.className = "peak-callout-label glass";
        labelEl.setAttribute("aria-label", `Open ${country.name} details`);
        labelEl.textContent = `${country.name} ${formatPopulation(
          getPopulation(country),
        )}`;
        labelEl.style.setProperty("--color-callout", `#${color.getHexString()}`);
        labelEl.style.setProperty("--color-callout-text", getTextColor(color));
        labelEl.addEventListener("click", () => onOpenCountry(country));
        labelEl.addEventListener("pointerenter", () =>
          interactions.activate(country, "pointer"),
        );
        labelEl.addEventListener("pointerleave", () =>
          interactions.deactivate(country, "pointer"),
        );
        labelEl.addEventListener("focus", () =>
          interactions.activate(country, "focus"),
        );
        labelEl.addEventListener("blur", () =>
          interactions.deactivate(country, "focus"),
        );
        layer.append(labelEl);

        callouts.push({
          country,
          anchor,
          outward,
          labelEl,
          screenX: null,
          screenY: null,
        });
      });
  }

  function update() {
    if (!callouts.length) return;
    cameraDirection.copy(camera.position).normalize();
    const viewMode = getViewMode();
    const transitioning = isTransitioning();
    const { width, height } = getViewport();
    callouts.forEach((callout) => {
      const { anchor, outward, labelEl } = callout;
      if (transitioning) {
        labelEl.hidden = true;
        resetPosition(callout);
        return;
      }
      if (viewMode !== "map") {
        const facing = facingDirection
          .copy(anchor)
          .normalize()
          .dot(cameraDirection);
        if (facing < 0.1) {
          labelEl.hidden = true;
          resetPosition(callout);
          return;
        }
      }
      labelEl.hidden = false;
      const projected = projectedPoint.copy(outward).project(camera);
      const targetX = Math.min(
        Math.max((projected.x * 0.5 + 0.5) * width, leftClearance),
        width - VIEWPORT_MARGIN,
      );
      const rawY =
        (-projected.y * 0.5 + 0.5) * height -
        (viewMode === "map" ? MAP_CALLOUT_LIFT_PX : 0);
      const targetY = Math.min(
        Math.max(rawY, VIEWPORT_MARGIN + 20),
        height - VIEWPORT_MARGIN,
      );
      // Tracks its dot 1:1 every frame rather than easing toward it — a
      // rebuild (year/mode change) already starts screenX/screenY at null,
      // which snaps immediately regardless, so smoothing here only ever
      // applied to a *moving* target: continuous camera motion (pan, zoom,
      // globe auto-rotate). That's exactly when a lag behind the actual dot
      // is most visible and least wanted, so there's no case left where
      // easing helps.
      callout.screenX = targetX;
      callout.screenY = targetY;
      labelEl.style.setProperty("--callout-x", `${callout.screenX}px`);
      labelEl.style.setProperty("--callout-y", `${callout.screenY}px`);
    });
  }

  return {
    group,
    clear,
    rebuild,
    update,
    hasCountry: (country) => callouts.some((callout) => callout.country === country),
  };
}
