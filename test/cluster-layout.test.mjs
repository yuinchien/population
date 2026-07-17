import test from "node:test";
import assert from "node:assert/strict";
import {
  clusterNodeAtPoint,
  resolveClusterHover,
  seededClusterPosition,
} from "../cluster-layout.mjs";
import {
  CLUSTER_ARCHETYPES,
  CLUSTER_PHASES,
  clusterPhaseForYear,
} from "../cluster-config.mjs";

test("clusterNodeAtPoint selects the topmost overlapping particle", () => {
  const large = { id: "large", x: 20, y: 20, radius: 15 };
  const small = { id: "small", x: 20, y: 20, radius: 5 };
  assert.equal(clusterNodeAtPoint([large, small], 20, 20), small);
});

test("clusterNodeAtPoint returns null outside every particle", () => {
  const node = { x: 20, y: 20, radius: 5 };
  assert.equal(clusterNodeAtPoint([node], 30, 30), null);
});

test("resolveClusterHover distinguishes enter, stable, change, and exit", () => {
  const india = { id: "IND" };
  const china = { id: "CHN" };
  assert.deepEqual(resolveClusterHover(null, india), {
    node: india,
    changed: true,
  });
  assert.deepEqual(resolveClusterHover(india, india), {
    node: india,
    changed: false,
  });
  assert.deepEqual(resolveClusterHover(india, china), {
    node: china,
    changed: true,
  });
  assert.deepEqual(resolveClusterHover(china, null), {
    node: null,
    changed: true,
  });
});

test("seededClusterPosition is reproducible and bounded", () => {
  const anchor = { x: 500, y: 300 };
  const first = seededClusterPosition("IND", anchor, 40);
  const second = seededClusterPosition("IND", anchor, 40);
  const other = seededClusterPosition("CHN", anchor, 40);
  assert.deepEqual(first, second);
  assert.notDeepEqual(first, other);
  assert.ok(first.x >= 480 && first.x <= 520);
  assert.ok(first.y >= 280 && first.y <= 320);
});

test("cluster phases own the expected archetypes at the 2000 boundary", () => {
  assert.equal(clusterPhaseForYear(1999), CLUSTER_PHASES.historical);
  assert.equal(clusterPhaseForYear(2000), CLUSTER_PHASES.projection);
  assert.deepEqual(CLUSTER_PHASES.historical.archetypes, [
    "goldenBoom",
    "emergingSurge",
  ]);
  assert.deepEqual(CLUSTER_PHASES.projection.archetypes, [
    "growth",
    "bufferedGrowth",
    "silverDecline",
  ]);
});

test("every configured phase archetype has display metadata", () => {
  Object.values(CLUSTER_PHASES).forEach((phase) => {
    phase.archetypes.forEach((key) => {
      const archetype = CLUSTER_ARCHETYPES[key];
      assert.ok(archetype?.label);
      assert.ok(Number.isFinite(archetype?.anchor?.x));
      assert.ok(Number.isFinite(archetype?.anchor?.y));
      assert.ok(archetype?.summary?.length);
    });
  });
});

test("Silver Decline summary names its defining demographic forces", () => {
  assert.match(
    CLUSTER_ARCHETYPES.silverDecline.summary,
    /high old age dependency/i,
  );
  assert.match(CLUSTER_ARCHETYPES.silverDecline.summary, /low migration/i);
});
