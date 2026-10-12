import test from "node:test";
import assert from "node:assert/strict";
import { CATALOG, PRESET } from "../src/catalog.js";
import { inspectLayout } from "../src/stacking.js";
import {
  WORKSPACE,
  validateWorkspace,
  findFloorPlacement,
  repairWorkspace,
} from "../src/workspace.js";

const box = (id, modelId = "40564", x = 0, y = 0, z = 0, rotated = false) => ({
  id,
  modelId,
  x,
  y,
  z,
  rotated,
});

test("the reference layout fits the physical stage and its two stacks stay connected", () => {
  assert.deepEqual(WORKSPACE, {
    x: 0,
    y: 0,
    length: 4500,
    width: 2400,
    maxHeight: 3000,
    maxGap: 600,
  });
  assert.equal(validateWorkspace(PRESET, CATALOG).valid, true);
  assert.deepEqual(validateWorkspace([], CATALOG), { valid: true, issues: [] });
});

test("bounds apply to complete rotated envelopes, including top height", () => {
  const exact = box("edge", "40876", 3700, 700, 2300, true);
  assert.equal(validateWorkspace([exact], CATALOG).valid, true);
  for (const change of [{ x: 3700.01 }, { y: 700.01 }, { z: 2300.01 }]) {
    const result = validateWorkspace([{ ...exact, ...change }], CATALOG);
    assert.equal(result.valid, false);
    assert.equal(result.issues[0].code, "workspace-bounds");
  }
  // An origin inside the stage is insufficient when the far edge protrudes.
  assert.equal(
    validateWorkspace([box("wide", "40876", 3000)], CATALOG).valid,
    false,
  );
  for (const axis of ["x", "y", "z"]) {
    assert.equal(
      validateWorkspace([{ ...box("negative"), [axis]: -1 }], CATALOG).valid,
      false,
    );
  }
});

test("a single bounded case is allowed away from the origin", () => {
  assert.equal(
    validateWorkspace([box("single", "40835", 4000, 2000)], CATALOG).valid,
    true,
  );
});

test("spacing permits 600 mm exactly, but rejects distant cases and diagonal shortcuts", () => {
  const first = box("first");
  assert.equal(
    validateWorkspace([first, box("near", "40564", 1200)], CATALOG).valid,
    true,
  );
  const separated = validateWorkspace(
    [first, box("far", "40564", 1200.01)],
    CATALOG,
  );
  assert.equal(separated.valid, false);
  assert.equal(separated.issues[0].code, "workspace-gap");
  // sqrt(360² + 480²) = 600, measured between the footprint edges.
  assert.equal(
    validateWorkspace([first, box("diagonal", "40564", 960, 880)], CATALOG)
      .valid,
    true,
  );
  assert.equal(
    validateWorkspace([first, box("too-far", "40564", 961, 880)], CATALOG)
      .valid,
    false,
  );
});

test("connectivity permits a nearby chain but rejects two isolated groups", () => {
  const chain = [box("a"), box("b", "40564", 1100), box("c", "40564", 2200)];
  assert.equal(validateWorkspace(chain, CATALOG).valid, true);
  const isolated = [
    box("a"),
    box("b", "40564", 600),
    box("c", "40564", 2600),
    box("d", "40564", 3200),
  ];
  const result = validateWorkspace(isolated, CATALOG);
  assert.equal(result.valid, false);
  assert.deepEqual(
    result.issues.map((issue) => issue.id),
    ["c", "d"],
  );
});

test("workspace validation reports malformed positions without throwing", () => {
  assert.equal(validateWorkspace(null, CATALOG).valid, false);
  for (const value of [NaN, Infinity, "0"]) {
    assert.equal(
      validateWorkspace([{ ...box("bad"), x: value }], CATALOG).valid,
      false,
    );
  }
  assert.equal(
    validateWorkspace([box("unknown", "missing")], CATALOG).valid,
    false,
  );
});

test("each catalog model can start on the bounded floor in either orientation", () => {
  for (const model of CATALOG) {
    for (const rotated of [false, true]) {
      const placed = findFloorPlacement(model.id, [], CATALOG, {
        id: "first",
        rotated,
      });
      assert.ok(placed, `${model.id} must fit as a first case`);
      assert.deepEqual([placed.x, placed.y, placed.z], [0, 0, 0]);
      assert.equal(placed.rotated, rotated);
      assert.equal(validateWorkspace([placed], CATALOG).valid, true);
      assert.equal(inspectLayout([placed], CATALOG).valid, true);
    }
  }
});

test("additions stay near the group with useful front-row clearance", () => {
  const second = findFloorPlacement("40564", [box("first")], CATALOG, {
    id: "second",
  });
  assert.deepEqual([second.x, second.y, second.z], [700, 0, 0]);
  const before = structuredClone(PRESET);
  const large = findFloorPlacement("40846", PRESET, CATALOG, { id: "new-259" });
  assert.deepEqual([large.x, large.y, large.z], [2450, 0, 0]);
  assert.equal(validateWorkspace([...PRESET, large], CATALOG).valid, true);
  assert.deepEqual(
    PRESET,
    before,
    "Searching must not mutate the existing layout",
  );
});

test("a full front row uses the next row instead of extending beyond the stage", () => {
  const catalog = [...CATALOG, { id: "row", external: [4500, 400, 200] }];
  const placed = findFloorPlacement("40564", [box("front", "row")], catalog, {
    id: "next",
  });
  assert.ok(placed);
  assert.deepEqual([placed.x, placed.y, placed.z], [0, 500, 0]);
});

test("a full floor returns null rather than placing a case outside the work area", () => {
  const catalog = [...CATALOG, { id: "floor", external: [4500, 2400, 200] }];
  assert.equal(
    findFloorPlacement("40835", [box("occupied", "floor")], catalog, {
      id: "extra",
    }),
    null,
  );
});

test("moving an elevated case to the floor preserves whole-layout support", () => {
  const layout = [
    box("base", "40565"),
    box("middle", "40564", 0, 0, 410),
    box("top", "40810", 0, 0, 820),
  ];
  assert.equal(
    findFloorPlacement("40564", layout, CATALOG, { id: "middle" }),
    null,
  );
  const top = findFloorPlacement("40810", layout, CATALOG, { id: "top" });
  assert.ok(top);
  assert.equal(top.z, 0);
  assert.equal(
    inspectLayout(
      [...layout.filter((entry) => entry.id !== top.id), top],
      CATALOG,
    ).valid,
    true,
  );
});

test("floor search handles unknown and oversized models without creating a bad instance", () => {
  assert.equal(findFloorPlacement("missing", [], CATALOG, { id: "new" }), null);
  assert.equal(findFloorPlacement("40810", [], CATALOG), null);
  assert.equal(
    findFloorPlacement("40810", [null], CATALOG, { id: "new" }),
    null,
  );
  assert.equal(findFloorPlacement("40810", [], CATALOG, null), null);
  const catalog = [{ id: "oversized", external: [4501, 400, 200] }];
  assert.equal(
    findFloorPlacement("oversized", [], catalog, { id: "new" }),
    null,
  );
});

test("repair brings a saved distant 259 L case back beside the unchanged reference stack", () => {
  for (const rotated of [false, true]) {
    const saved = [
      ...structuredClone(PRESET),
      box("far-259", "40846", 30000, 10000, 0, rotated),
    ];
    const before = structuredClone(saved);
    const repaired = repairWorkspace(saved, CATALOG);
    assert.ok(repaired);
    assert.equal(repaired.length, 9);
    assert.deepEqual(repaired.slice(0, 8), PRESET);
    assert.deepEqual(
      [repaired[8].x, repaired[8].y, repaired[8].z],
      [2450, 0, 0],
    );
    assert.equal(repaired[8].rotated, rotated);
    assert.deepEqual(
      repaired.map(({ id, modelId }) => ({ id, modelId })),
      saved.map(({ id, modelId }) => ({ id, modelId })),
    );
    assert.equal(validateWorkspace(repaired, CATALOG).valid, true);
    assert.equal(inspectLayout(repaired, CATALOG).valid, true);
    assert.deepEqual(saved, before);
  }
});

test("repair preserves the largest group even when an isolated in-bounds case appears first", () => {
  const saved = [
    box("isolated", "40835", 4000, 2000),
    ...structuredClone(PRESET),
  ];
  const repaired = repairWorkspace(saved, CATALOG);
  assert.ok(repaired);
  assert.deepEqual(repaired.slice(1), PRESET);
  assert.equal(repaired[0].id, "isolated");
  assert.equal(validateWorkspace(repaired, CATALOG).valid, true);
});

test("repair reconstructs an entirely out-of-bounds layout and copies an already valid one", () => {
  const moved = repairWorkspace(
    [box("a", "40564", 9000), box("b", "40564", 10300)],
    CATALOG,
  );
  assert.ok(moved);
  assert.deepEqual(
    moved.map(({ x, y, z }) => [x, y, z]),
    [
      [0, 0, 0],
      [700, 0, 0],
    ],
  );
  const copied = repairWorkspace(PRESET, CATALOG);
  assert.deepEqual(copied, PRESET);
  assert.notEqual(copied, PRESET);
  assert.notEqual(copied[0], PRESET[0]);
});

test("repair never drops a case when the retained group leaves no floor space", () => {
  const catalog = [...CATALOG, { id: "floor", external: [4500, 2400, 200] }];
  const saved = [box("occupied", "floor"), box("outlier", "40835", 10000)];
  const before = structuredClone(saved);
  assert.equal(repairWorkspace(saved, catalog), null);
  assert.deepEqual(saved, before);
});

test("repair refuses invalid geometry instead of legitimizing corrupt saved data", () => {
  assert.equal(
    repairWorkspace([box("a"), box("b", "40564", 100)], CATALOG),
    null,
  );
  assert.equal(
    repairWorkspace([box("floating", "40564", 0, 0, 100)], CATALOG),
    null,
  );
  assert.equal(repairWorkspace([box("unknown", "missing")], CATALOG), null);
  assert.equal(repairWorkspace(null, CATALOG), null);
  assert.equal(repairWorkspace([null], CATALOG), null);
  assert.equal(
    repairWorkspace([{ ...box("a"), rotated: "false" }], CATALOG),
    null,
  );
  assert.equal(repairWorkspace([{ ...box("a"), id: "" }], CATALOG), null);
});
