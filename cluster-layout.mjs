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
