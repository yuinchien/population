import * as THREE from "three";

const DEFAULT_SMOOTHING_MS = 90;
const VIEWPORT_MARGIN = 12;

export function smoothCalloutPosition(current, target, elapsed, smoothingMs) {
  if (current == null) return target;
  const blend = 1 - Math.exp(-Math.min(50, Math.max(0, elapsed)) / smoothingMs);
  return current + (target - current) * blend;
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
  getPopulation,
  formatPopulation,
  getTextColor,
  onOpenCountry,
  getViewport = () => ({ width: window.innerWidth, height: window.innerHeight }),
  smoothingMs = DEFAULT_SMOOTHING_MS,
}) {
  const group = new THREE.Group();
  const callouts = [];
  const cameraDirection = new THREE.Vector3();
  const facingDirection = new THREE.Vector3();
  const projectedPoint = new THREE.Vector3();

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
      return anchor.clone().add(new THREE.Vector3(0, 0, viewConfig.map.calloutExtend));
    }
    return anchor
      .clone()
      .normalize()
      .multiplyScalar(viewConfig.globe.calloutExtend);
  }

  function resetPosition(callout) {
    callout.screenX = null;
    callout.screenY = null;
    callout.lastFrameTime = null;
  }

  function clear() {
    callouts.forEach(({ line, labelEl }) => {
      group.remove(line);
      line.geometry.dispose();
      line.material.dispose();
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
      .filter((country) => country.peakYear === year)
      .forEach((country) => {
        const anchor = computeAnchor(country, viewMode);
        const outward = computeOutwardPoint(anchor, viewMode);
        const color = getColor(country);
        const geometry = new THREE.BufferGeometry().setFromPoints([anchor, outward]);
        const material = new THREE.LineBasicMaterial({
          color,
          transparent: true,
          opacity: 0.9,
        });
        const line = new THREE.Line(geometry, material);
        group.add(line);

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
        layer.append(labelEl);

        callouts.push({
          country,
          anchor,
          outward,
          line,
          labelEl,
          screenX: null,
          screenY: null,
          lastFrameTime: null,
        });
      });
  }

  function update(timestamp) {
    if (!callouts.length) return;
    cameraDirection.copy(camera.position).normalize();
    const viewMode = getViewMode();
    const transitioning = isTransitioning();
    const { width, height } = getViewport();
    callouts.forEach((callout) => {
      const { anchor, outward, line, labelEl } = callout;
      if (transitioning) {
        line.visible = false;
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
          line.visible = false;
          labelEl.hidden = true;
          resetPosition(callout);
          return;
        }
      }
      line.visible = true;
      labelEl.hidden = false;
      const projected = projectedPoint.copy(outward).project(camera);
      const targetX = Math.min(
        Math.max((projected.x * 0.5 + 0.5) * width, leftClearance),
        width - VIEWPORT_MARGIN,
      );
      const targetY = Math.min(
        Math.max((-projected.y * 0.5 + 0.5) * height, VIEWPORT_MARGIN + 20),
        height - VIEWPORT_MARGIN,
      );
      const elapsed = callout.lastFrameTime == null
        ? 0
        : timestamp - callout.lastFrameTime;
      callout.screenX = smoothCalloutPosition(
        callout.screenX,
        targetX,
        elapsed,
        smoothingMs,
      );
      callout.screenY = smoothCalloutPosition(
        callout.screenY,
        targetY,
        elapsed,
        smoothingMs,
      );
      callout.lastFrameTime = timestamp;
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
