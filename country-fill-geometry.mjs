import * as THREE from "three";
import { TessellateModifier } from "three/addons/modifiers/TessellateModifier.js";

const globeFillTessellator = new TessellateModifier(5, 8);

function pointSegmentDistanceSquared(point, start, end) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  if (dx === 0 && dy === 0) {
    return (point[0] - start[0]) ** 2 + (point[1] - start[1]) ** 2;
  }
  const amount = Math.max(
    0,
    Math.min(
      1,
      ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) /
        (dx * dx + dy * dy),
    ),
  );
  const x = start[0] + amount * dx;
  const y = start[1] + amount * dy;
  return (point[0] - x) ** 2 + (point[1] - y) ** 2;
}

export function simplifyRing(ring, tolerance = 0.18) {
  if (ring.length < 12) return ring;
  const points =
    ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1]
      ? ring.slice(0, -1)
      : ring.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  const toleranceSquared = tolerance * tolerance;
  while (stack.length) {
    const [startIndex, endIndex] = stack.pop();
    let furthestIndex = -1;
    let furthestDistance = toleranceSquared;
    for (let i = startIndex + 1; i < endIndex; i++) {
      const distance = pointSegmentDistanceSquared(
        points[i],
        points[startIndex],
        points[endIndex],
      );
      if (distance > furthestDistance) {
        furthestDistance = distance;
        furthestIndex = i;
      }
    }
    if (furthestIndex !== -1) {
      keep[furthestIndex] = 1;
      stack.push([startIndex, furthestIndex], [furthestIndex, endIndex]);
    }
  }
  return points.filter((_, index) => keep[index]);
}

export function ringNeedsGlobeTessellation(ring) {
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  ring.forEach(([lon, lat]) => {
    minLon = Math.min(minLon, lon);
    maxLon = Math.max(maxLon, lon);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  });
  return ring.length > 80 || maxLon - minLon > 20 || maxLat - minLat > 20;
}

function wrappedPointDistanceSquared(a, b) {
  const lonDistance = Math.abs(a[0] - b[0]);
  const wrappedLonDistance = Math.min(lonDistance, 360 - lonDistance);
  return wrappedLonDistance ** 2 + (a[1] - b[1]) ** 2;
}

export function unwrapLongitudes(ring) {
  if (!ring.length) return ring;
  const unwrapped = [[...ring[0]]];
  for (let i = 1; i < ring.length; i++) {
    let [lon, lat] = ring[i];
    const previousLon = unwrapped.at(-1)[0];
    while (lon - previousLon > 180) lon -= 360;
    while (lon - previousLon < -180) lon += 360;
    unwrapped.push([lon, lat]);
  }
  return unwrapped;
}

export function stitchOpenRings(rings) {
  const closed = [];
  const open = [];
  rings.forEach((ring) => {
    if (
      ring[0][0] === ring.at(-1)[0] &&
      ring[0][1] === ring.at(-1)[1]
    ) {
      closed.push(ring);
    } else {
      open.push(ring);
    }
  });
  while (open.length) {
    const stitched = open.shift().slice();
    while (open.length) {
      const end = stitched.at(-1);
      let matchIndex = -1;
      let reverseMatch = false;
      let nearest = 1;
      open.forEach((candidate, index) => {
        const startDistance = wrappedPointDistanceSquared(end, candidate[0]);
        const endDistance = wrappedPointDistanceSquared(end, candidate.at(-1));
        if (startDistance < nearest) {
          nearest = startDistance;
          matchIndex = index;
          reverseMatch = false;
        }
        if (endDistance < nearest) {
          nearest = endDistance;
          matchIndex = index;
          reverseMatch = true;
        }
      });
      if (matchIndex === -1) break;
      const fragment = open.splice(matchIndex, 1)[0];
      stitched.push(...(reverseMatch ? fragment.slice().reverse() : fragment));
      if (wrappedPointDistanceSquared(stitched[0], stitched.at(-1)) < 1) break;
    }
    closed.push(unwrapLongitudes(stitched));
  }
  return closed;
}

export function createCountryFillGeometries({ rings, viewMode, projectPoint }) {
  const geometries = [];
  stitchOpenRings(rings).forEach((ring) => {
    if (ring.length < 3) return;
    const simplifiedRing = simplifyRing(ring);
    const shape = new THREE.Shape(
      simplifiedRing.map(([lon, lat]) => new THREE.Vector2(lon, lat)),
    );
    let geometry = new THREE.ShapeGeometry(shape);
    if (viewMode === "globe" && ringNeedsGlobeTessellation(simplifiedRing)) {
      const flatGeometry = geometry;
      geometry = globeFillTessellator.modify(flatGeometry);
      flatGeometry.dispose();
    }
    const positions = geometry.getAttribute("position");
    for (let i = 0; i < positions.count; i++) {
      const projected = projectPoint(positions.getX(i), positions.getY(i));
      positions.setXYZ(i, projected.x, projected.y, projected.z);
    }
    positions.needsUpdate = true;
    geometry.computeVertexNormals();
    geometries.push(geometry);
  });
  return geometries;
}
