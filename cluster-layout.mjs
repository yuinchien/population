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
