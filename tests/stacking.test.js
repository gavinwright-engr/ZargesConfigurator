import test from "node:test";
import assert from "node:assert/strict";
import {
  getDimensions,
  validatePlacement,
  resolveDrop,
  inspectLayout,
} from "../src/stacking.js";
import { CATALOG as catalog, PRESET } from "../src/catalog.js";

// Test the actual manufacturer catalog and the reference arrangement shipped
// with the app, so data/preset changes are checked alongside geometry changes.
const box = (id, modelId, x = 0, y = 0, z = 0, rotated = false) => ({
  id,
  modelId,
  x,
  y,
  z,
  rotated,
});
const picturedLayout = () => structuredClone(PRESET);

test("rotation swaps footprint axes without changing height or catalog data", () => {
  assert.deepEqual(
    getDimensions(box("a", "40564", 0, 0, 0, true), catalog),
    [400, 600, 410],
  );
  assert.deepEqual(catalog[3].external, [600, 400, 410]);
});

test("all eight pictured boxes fit geometrically, including the bridge and split base", () => {
  const layout = picturedLayout();
  const report = inspectLayout(layout, catalog);
  assert.equal(report.valid, true);
  assert.equal(report.stats.count, 8);
  assert.equal(report.stats.volumeLiters, 567);
  assert.equal(report.stats.emptyWeightKg, 47.4);
  assert.deepEqual(report.stats.dimensions, [2350, 600, 1000]);
  assert.deepEqual(report.placements[2].supportedBy, ["case-1", "case-2"]);
  assert.deepEqual(report.placements[4].supportedBy, ["case-4"]);
  assert.deepEqual(report.placements[5].supportedBy, ["case-4"]);
});

test("side-to-side and top-to-bottom touching is allowed, volume overlap is blocked", () => {
  const base = box("base", "40564");
  assert.equal(
    validatePlacement(box("beside", "40564", 600), [base], catalog).valid,
    true,
  );
  assert.equal(
    validatePlacement(box("above", "40564", 0, 0, 410), [base], catalog).valid,
    true,
  );
  assert.equal(
    validatePlacement(box("inside", "40564", 599), [base], catalog).code,
    "collision",
  );
});

test("rejects unsupported overhangs, even when 99.9% of the footprint is supported", () => {
  const base = box("base", "40564");
  const result = validatePlacement(
    box("overhang", "40810", 0.1, 0, 410),
    [base],
    catalog,
  );
  assert.equal(result.valid, false);
  assert.equal(result.code, "unsupported");
  assert.ok(result.supportRatio > 0.999);
  assert.ok(result.supportRatio < 1);
});

test("a long lid can span two coplanar boxes but not a gap or different-height pair", () => {
  const left = box("left", "40564");
  const right = box("right", "40564", 600);
  const bridge = box("bridge", "40847", 0, 0, 410);
  assert.equal(validatePlacement(bridge, [left, right], catalog).valid, true);
  assert.equal(
    validatePlacement(bridge, [left, { ...right, x: 601 }], catalog).valid,
    false,
  );
  assert.equal(
    validatePlacement(bridge, [left, { ...right, modelId: "40678" }], catalog)
      .valid,
    false,
  );
});

test("overlapping support areas cannot disguise an uncovered half", () => {
  const left = box("left", "40564");
  const duplicateSupport = box("overlapping-left", "40564");
  const result = validatePlacement(
    box("bridge", "40847", 0, 0, 410),
    [left, duplicateSupport],
    catalog,
  );
  assert.equal(result.valid, false);
  assert.equal(result.supportRatio, 0.5);
});

test("removing a supporting box invalidates the full layout", () => {
  const layout = picturedLayout().filter((entry) => entry.id !== "case-2");
  const report = inspectLayout(layout, catalog);
  assert.equal(report.valid, false);
  assert.ok(
    report.issues.some(
      (issue) => issue.id === "case-3" && issue.code === "unsupported",
    ),
  );
});

test("drop snaps a rotated box to a larger base and finds its top elevation", () => {
  const base = box("base", "40565", 1550);
  const dropped = resolveDrop("40564", 1562, 8, [base], catalog, {
    id: "new",
    rotated: true,
  });
  assert.ok(dropped);
  assert.deepEqual([dropped.x, dropped.y, dropped.z], [1550, 0, 410]);
  assert.equal(dropped.placement.valid, true);
});

test("drop places the second rotated box next to the first, then stacks a matching top", () => {
  const base = box("base", "40565", 1550);
  const first = box("first", "40564", 1550, 0, 410, true);
  const second = resolveDrop("40678", 1955, 2, [base, first], catalog, {
    id: "second",
    rotated: true,
  });
  assert.deepEqual([second.x, second.y, second.z], [1950, 0, 410]);
  const top = resolveDrop("40568", 1950, 0, [base, first, second], catalog, {
    id: "top",
    rotated: true,
  });
  assert.deepEqual([top.x, top.y, top.z], [1950, 0, 750]);
});

test("drop finds two supports for the 1200 mm long box", () => {
  const supports = [box("left", "40564"), box("right", "40564", 600)];
  const dropped = resolveDrop("40847", 9, 5, supports, catalog, {
    id: "bridge",
  });
  assert.deepEqual([dropped.x, dropped.y, dropped.z], [0, 0, 410]);
  assert.equal(dropped.placement.supportedBy.length, 2);
});

test("moving a box excludes its previous position by id without mutating the input", () => {
  const original = box("moving", "40564");
  const dropped = resolveDrop("40564", 0, 0, [original], catalog, {
    id: "moving",
  });
  assert.equal(dropped.z, 0);
  assert.equal(original.z, 0);
});

test("locked-height drops cannot silently jump to another level", () => {
  const base = box("base", "40564");
  assert.equal(
    resolveDrop("40564", 0, 0, [base], catalog, {
      z: 0,
      maxDistance: 0,
      snapDistance: 0,
    }),
    null,
  );
  assert.equal(resolveDrop("40564", 0, 0, [base], catalog, { z: 410 }).z, 410);
});

test("invalid models, non-finite positions, floating boxes, and below-floor boxes are rejected", () => {
  assert.equal(
    validatePlacement(box("a", "missing"), [], catalog).code,
    "invalid",
  );
  assert.equal(
    validatePlacement(box("a", "40564", NaN), [], catalog).code,
    "invalid",
  );
  assert.equal(
    validatePlacement(box("a", "40564", 0, 0, 100), [], catalog).code,
    "unsupported",
  );
  assert.equal(
    validatePlacement(box("a", "40564", 0, 0, -1), [], catalog).code,
    "below-ground",
  );
  assert.equal(resolveDrop("missing", 0, 0, [], catalog), null);
});

test("empty layouts have zero statistics and duplicate ids are reported", () => {
  assert.deepEqual(inspectLayout([], catalog).stats.dimensions, [0, 0, 0]);
  const report = inspectLayout(
    [box("same", "40564"), box("same", "40564", 600)],
    catalog,
  );
  assert.equal(report.valid, false);
  assert.ok(report.issues.some((issue) => issue.code === "duplicate-id"));
});
