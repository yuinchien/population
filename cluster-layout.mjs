function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function unitFromHash(value) {
  return hashString(value) / 0xffffffff;
}

export function clusterEntranceOrder(countryCodes) {
  return [...countryCodes]
    .map((code, sourceIndex) => ({
      sourceIndex,
      seed: hashString(`${code}:entrance`),
    }))
    .sort((a, b) => a.seed - b.seed || a.sourceIndex - b.sourceIndex)
    .map(({ sourceIndex }) => sourceIndex);
}

export function clusterEntranceScale(progress, orderIndex, count) {
  if (progress >= 1 || count <= 1) return 1;
  if (progress <= 0) return 0;
  const cascade = 0.58;
  const delay = (orderIndex / (count - 1)) * cascade;
  const localProgress = Math.min(
    1,
    Math.max(0, (progress - delay) / (1 - cascade)),
  );
  if (localProgress <= 0) return 0;
  if (localProgress >= 1) return 1;
  const overshoot = 1.70158;
  const shifted = localProgress - 1;
  return 1 + (overshoot + 1) * shifted ** 3 + overshoot * shifted ** 2;
}

export function seededClusterPosition(countryCode, anchor, spread = 40) {
  const code = String(countryCode ?? "");
  return {
    x: anchor.x + (unitFromHash(`${code}:x`) - 0.5) * spread,
    y: anchor.y + (unitFromHash(`${code}:y`) - 0.5) * spread,
  };
}

// Returns the shortest correction that keeps an entire particle on its own
// side of the midpoint between two cluster anchors. Applying this against
// every active competing anchor creates a small, readable lane between
// neighboring clusters without assigning countries to rigid boxes.
export function clusterBoundaryCorrection(
  node,
  ownAnchor,
  competingAnchor,
  gap = 12,
) {
  const dx = competingAnchor.x - ownAnchor.x;
  const dy = competingAnchor.y - ownAnchor.y;
  const distance = Math.hypot(dx, dy);
  if (!distance) return { x: 0, y: 0 };
  const ux = dx / distance;
  const uy = dy / distance;
  const midpointX = (ownAnchor.x + competingAnchor.x) / 2;
  const midpointY = (ownAnchor.y + competingAnchor.y) / 2;
  const projection =
    (node.x - midpointX) * ux + (node.y - midpointY) * uy;
  const limit = -(Math.max(0, node.radius ?? 0) + gap / 2);
  if (projection <= limit) return { x: 0, y: 0 };
  const overlap = projection - limit;
  return {
    x: ux === 0 ? 0 : -ux * overlap,
    y: uy === 0 ? 0 : -uy * overlap,
  };
}

// Returns the shortest translation that moves a particle outside a pill-shaped
// title boundary. Treating the label as a horizontal capsule (rather than an
// axis-aligned box) lets bubbles follow its rounded corners naturally while
// keeping their full radius and the requested visual gap clear of the text.
export function labelCollisionCorrection(node, rect, gap = 0) {
  const clearance = Math.max(0, node.radius ?? 0) + Math.max(0, gap);
  const labelRadius = Math.min(rect.width, rect.height) / 2;
  const collisionRadius = labelRadius + clearance;
  const centerY = rect.y + rect.height / 2;
  const segmentStart = rect.x + labelRadius;
  const segmentEnd = rect.x + rect.width - labelRadius;
  const closestX = Math.max(segmentStart, Math.min(segmentEnd, node.x));
  const dx = node.x - closestX;
  const dy = node.y - centerY;
  const distance = Math.hypot(dx, dy);
  if (distance >= collisionRadius) {
    return { x: 0, y: 0 };
  }
  // A point exactly on the capsule's center line has no radial direction;
  // move it upward deterministically so it cannot remain trapped in-place.
  if (distance === 0) return { x: 0, y: -collisionRadius };
  const overlap = collisionRadius - distance;
  return {
    x: (dx / distance) * overlap,
    y: (dy / distance) * overlap,
  };
}

// Nodes are supplied in canvas draw order (bottommost first). Iterating in
// reverse makes the visually topmost particle win when circles overlap.
export function clusterNodeAtPoint(nodesInDrawOrder, x, y) {
  for (let index = nodesInDrawOrder.length - 1; index >= 0; index--) {
    const node = nodesInDrawOrder[index];
    const dx = x - node.x;
    const dy = y - node.y;
    if (dx * dx + dy * dy <= node.radius * node.radius) return node;
  }
  return null;
}

export function resolveClusterHover(previousNode, nextNode) {
  return {
    node: nextNode,
    changed: previousNode !== nextNode,
  };
}
