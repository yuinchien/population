import test from "node:test";
import assert from "node:assert/strict";
import {
  clusterBoundaryCorrection,
  clusterEntranceOrder,
  clusterEntranceScale,
  clusterNodeAtPoint,
  resolveClusterHover,
  seededClusterPosition,
} from "../cluster-layout.mjs";
import {
  CLUSTER_ARCHETYPES,
  CLUSTER_PHASES,
  CLUSTER_STATUS_PERIODS,
  clusterPhaseForYear,
  clusterStatusForYear,
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

test("cluster entrance order is deterministic and includes every particle", () => {
  const codes = ["USA", "CHN", "IND", "NGA"];
  const first = clusterEntranceOrder(codes);
  assert.deepEqual(first, clusterEntranceOrder(codes));
  assert.deepEqual([...first].sort((a, b) => a - b), [0, 1, 2, 3]);
});

test("cluster entrance scale cascades and settles after an overshoot", () => {
  assert.equal(clusterEntranceScale(0, 0, 4), 0);
  assert.ok(clusterEntranceScale(0.2, 0, 4) > 0);
  assert.equal(clusterEntranceScale(0.2, 3, 4), 0);
  assert.ok(clusterEntranceScale(0.3, 0, 4) > 1);
  assert.equal(clusterEntranceScale(1, 3, 4), 1);
});

test("clusterBoundaryCorrection keeps a particle inside its cluster territory", () => {
  const own = { x: 0, y: 0 };
  const competitor = { x: 100, y: 0 };
  assert.deepEqual(
    clusterBoundaryCorrection({ x: 30, y: 20, radius: 10 }, own, competitor),
    { x: 0, y: 0 },
  );
  assert.deepEqual(
    clusterBoundaryCorrection({ x: 48, y: 20, radius: 10 }, own, competitor),
    { x: -14, y: 0 },
  );
});

test("cluster splits into two phases at the 1990 boundary", () => {
  assert.equal(clusterPhaseForYear(1989), CLUSTER_PHASES.historical);
  assert.equal(clusterPhaseForYear(1990), CLUSTER_PHASES.divergence);
  assert.equal(clusterPhaseForYear(2000), CLUSTER_PHASES.divergence);
  assert.equal(clusterPhaseForYear(2100), CLUSTER_PHASES.divergence);
  assert.deepEqual(CLUSTER_PHASES.historical.archetypes, [
    "goldenBoom",
    "emergingSurge",
  ]);
  assert.deepEqual(CLUSTER_PHASES.divergence.archetypes, [
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

test("CLUSTER_STATUS_PERIODS covers 1950-2100 with no gaps or overlaps", () => {
  assert.equal(CLUSTER_STATUS_PERIODS[0].years[0], 1950);
  assert.equal(
    CLUSTER_STATUS_PERIODS.at(-1).years[1],
    2100,
  );
  for (let i = 1; i < CLUSTER_STATUS_PERIODS.length; i++) {
    assert.equal(
      CLUSTER_STATUS_PERIODS[i].years[0],
      CLUSTER_STATUS_PERIODS[i - 1].years[1] + 1,
    );
  }
});

test("every cluster status period has a title and non-empty text", () => {
  CLUSTER_STATUS_PERIODS.forEach((period) => {
    assert.ok(period.title?.length);
    assert.ok(period.text?.length);
  });
});

test("clusterStatusForYear picks the period containing the year, clamping outside 1950-2100", () => {
  assert.equal(clusterStatusForYear(1950), CLUSTER_STATUS_PERIODS[0]);
  assert.equal(clusterStatusForYear(1989), CLUSTER_STATUS_PERIODS[0]);
  assert.equal(clusterStatusForYear(1990), CLUSTER_STATUS_PERIODS[1]);
  assert.equal(clusterStatusForYear(2023), CLUSTER_STATUS_PERIODS[1]);
  assert.equal(clusterStatusForYear(2024), CLUSTER_STATUS_PERIODS[2]);
  assert.equal(clusterStatusForYear(2060), CLUSTER_STATUS_PERIODS[2]);
  assert.equal(clusterStatusForYear(2061), CLUSTER_STATUS_PERIODS[3]);
  assert.equal(clusterStatusForYear(2100), CLUSTER_STATUS_PERIODS[3]);
  assert.equal(clusterStatusForYear(NaN), CLUSTER_STATUS_PERIODS[0]);
});
