/**
 * Practical limits for the interactive planning stage, in millimetres.
 *
 * These are application limits, not ZARGES specifications or load ratings.
 * Geometry remains separate: validateWorkspace constrains the work area and
 * spacing, while stacking.js checks collisions and rectangular support.
 */
import { getDimensions, inspectLayout, validatePlacement } from "./stacking.js";

export const WORKSPACE = Object.freeze({
  x: 0,
  y: 0,
  length: 4500,
  width: 2400,
  maxHeight: 3000,
  maxGap: 600,
});

const EPSILON = 1e-7;
const PREFERRED_GAP = 100;

function boundsOf(box, catalog) {
  const [length, width, height] = getDimensions(box, catalog);
  if (![box.x, box.y, box.z].every(Number.isFinite)) {
    throw new Error("Case positions must be finite numbers.");
  }
  return {
    x1: box.x,
    x2: box.x + length,
    y1: box.y,
    y2: box.y + width,
    z1: box.z,
    z2: box.z + height,
  };
}

function isInside(bounds) {
  return (
    bounds.x1 >= WORKSPACE.x - EPSILON &&
    bounds.y1 >= WORKSPACE.y - EPSILON &&
    bounds.z1 >= -EPSILON &&
    bounds.x2 <= WORKSPACE.x + WORKSPACE.length + EPSILON &&
    bounds.y2 <= WORKSPACE.y + WORKSPACE.width + EPSILON &&
    bounds.z2 <= WORKSPACE.maxHeight + EPSILON
  );
}

// Overlapping or touching footprints have zero horizontal gap. For diagonally
// separated footprints, Euclidean distance prevents a 600 mm gap on BOTH axes.
function footprintGap(a, b) {
  const x = Math.max(a.x1 - b.x2, b.x1 - a.x2, 0);
  const y = Math.max(a.y1 - b.y2, b.y1 - a.y2, 0);
  return Math.hypot(x, y);
}

/**
 * Return { valid, issues } for stage bounds and spacing, without mutating boxes.
 *
 * Every complete, rotated case envelope must stay inside WORKSPACE. Footprints
 * form a graph: edges join cases separated by at most maxGap. Requiring one
 * connected graph permits several nearby stacks while rejecting an isolated
 * distant group. Vertical cases participate through their floor projections.
 * A single case may occupy any bounded position; an empty layout is valid.
 * Use inspectLayout as well when validating an arbitrary imported arrangement.
 */
export function validateWorkspace(boxes, catalog) {
  if (!Array.isArray(boxes)) {
    return {
      valid: false,
      issues: [
        { code: "invalid", message: "The workspace needs a case array." },
      ],
    };
  }
  const issues = [];
  const bounds = [];
  for (const box of boxes) {
    try {
      const current = boundsOf(box, catalog);
      bounds.push(current);
      if (!isInside(current)) {
        issues.push({
          id: box.id,
          code: "workspace-bounds",
          message:
            "Keep the whole case inside the 4,500 × 2,400 mm work area and below 3,000 mm high.",
        });
      }
    } catch (error) {
      issues.push({ id: box?.id, code: "invalid", message: error.message });
    }
  }
  if (issues.length || boxes.length < 2) {
    return { valid: issues.length === 0, issues };
  }

  const connected = new Set([0]);
  const pending = [0];
  for (let cursor = 0; cursor < pending.length; cursor += 1) {
    const current = pending[cursor];
    for (let index = 0; index < bounds.length; index += 1) {
      if (
        !connected.has(index) &&
        footprintGap(bounds[current], bounds[index]) <=
          WORKSPACE.maxGap + EPSILON
      ) {
        connected.add(index);
        pending.push(index);
      }
    }
  }
  for (let index = 0; index < boxes.length; index += 1) {
    if (!connected.has(index)) {
      issues.push({
        id: boxes[index].id,
        code: "workspace-gap",
        message:
          "Keep every stack connected to the setup by gaps of 600 mm or less.",
      });
    }
  }
  return { valid: issues.length === 0, issues };
}

function axisPositions(bounds, axis, size, origin, extent) {
  const positions = new Set([origin, origin + extent - size]);
  for (const bound of bounds) {
    const start = bound[`${axis}1`];
    const end = bound[`${axis}2`];
    // Align either edge, then try 100 mm clearance and flush adjacency.
    for (const position of [
      start,
      end - size,
      end + PREFERRED_GAP,
      start - size - PREFERRED_GAP,
      end,
      start - size,
    ]) {
      if (position >= origin && position + size <= origin + extent) {
        positions.add(position);
      }
    }
  }
  return [...positions].filter(
    (position) => position >= origin && position + size <= origin + extent,
  );
}

/**
 * Find a supported, bounded floor position near the current group, or null.
 *
 * Supply { id, rotated }; `id` is required and identifies a new instance or the
 * existing case being moved. The returned instance contains only plan fields.
 * Search is deterministic: prefer the front row, then later rows, with a small
 * preference for 100 mm clearance. Flush placement remains available when the
 * stage is nearly full. We search rectangle edges rather than an arbitrary grid
 * so every catalog size can fit without changing its dimensions.
 */
export function findFloorPlacement(modelId, boxes, catalog, options = {}) {
  if (
    !Array.isArray(boxes) ||
    boxes.some((box) => !box || typeof box !== "object") ||
    typeof options?.id !== "string" ||
    !options.id
  ) {
    return null;
  }
  const others = boxes.filter((box) => box.id !== options.id);
  const candidate = {
    id: options.id,
    modelId,
    x: WORKSPACE.x,
    y: WORKSPACE.y,
    z: 0,
    rotated: Boolean(options.rotated),
  };
  let dimensions;
  let bounds;
  try {
    dimensions = getDimensions(candidate, catalog);
    bounds = others.map((box) => boundsOf(box, catalog));
  } catch {
    return null;
  }
  const [length, width, height] = dimensions;
  if (
    length > WORKSPACE.length ||
    width > WORKSPACE.width ||
    height > WORKSPACE.maxHeight
  ) {
    return null;
  }

  const xs = axisPositions(bounds, "x", length, WORKSPACE.x, WORKSPACE.length);
  const ys = axisPositions(bounds, "y", width, WORKSPACE.y, WORKSPACE.width);
  const positions = [];
  for (const y of ys) {
    for (const x of xs) {
      const placed = { ...candidate, x, y };
      const rectangle = boundsOf(placed, catalog);
      const gap = bounds.length
        ? Math.min(...bounds.map((other) => footprintGap(rectangle, other)))
        : PREFERRED_GAP;
      if (gap <= WORKSPACE.maxGap + EPSILON) {
        const clearancePenalty = Math.abs(gap - PREFERRED_GAP);
        positions.push({
          placed,
          clearancePenalty,
          score: y + clearancePenalty,
        });
      }
    }
  }
  positions.sort(
    (a, b) =>
      a.score - b.score ||
      a.clearancePenalty - b.clearancePenalty ||
      a.placed.y - b.placed.y ||
      a.placed.x - b.placed.x,
  );
  for (const { placed } of positions) {
    if (!validatePlacement(placed, others, catalog).valid) continue;
    const proposed = [...others, placed];
    if (
      validateWorkspace(proposed, catalog).valid &&
      inspectLayout(proposed, catalog).valid
    ) {
      return placed;
    }
  }
  return null;
}

/**
 * Move workspace outliers onto nearby floor space without dropping any cases.
 *
 * Intended for migration of previously saved, geometrically valid layouts. Keep
 * the largest supported, in-bounds connected group unchanged; relocate every
 * other case using findFloorPlacement. Preserve instance order, IDs, model IDs,
 * and rotations. Return a new layout, or null if every case cannot be retained.
 * This does not repair corrupt model data, collisions, or unsupported stacks.
 * The caller should retain the original saved document before applying it.
 */
export function repairWorkspace(boxes, catalog) {
  if (
    !Array.isArray(boxes) ||
    !boxes.every(
      (box) =>
        box &&
        typeof box === "object" &&
        !Array.isArray(box) &&
        typeof box.id === "string" &&
        box.id.length > 0 &&
        typeof box.modelId === "string" &&
        typeof box.rotated === "boolean",
    ) ||
    !inspectLayout(boxes, catalog).valid
  )
    return null;
  const clean = boxes.map(({ id, modelId, x, y, z, rotated }) => ({
    id,
    modelId,
    x,
    y,
    z,
    rotated,
  }));
  if (validateWorkspace(clean, catalog).valid) return clean;

  // Process bottom-up: an in-bounds upper case can remain only when all of its
  // supporting geometry also remains. This avoids preserving an orphaned lid
  // after a larger supporting case crosses the stage boundary.
  const supported = [];
  const inBounds = clean
    .filter((box) => isInside(boundsOf(box, catalog)))
    .sort((a, b) => a.z - b.z);
  for (const box of inBounds) {
    if (validatePlacement(box, supported, catalog).valid) supported.push(box);
  }
  const bounds = supported.map((box) => boundsOf(box, catalog));
  const visited = new Set();
  let largest = [];
  for (let start = 0; start < supported.length; start += 1) {
    if (visited.has(start)) continue;
    const group = [start];
    visited.add(start);
    for (let cursor = 0; cursor < group.length; cursor += 1) {
      for (let index = 0; index < supported.length; index += 1) {
        if (
          !visited.has(index) &&
          footprintGap(bounds[group[cursor]], bounds[index]) <=
            WORKSPACE.maxGap + EPSILON
        ) {
          visited.add(index);
          group.push(index);
        }
      }
    }
    if (group.length > largest.length) largest = group;
  }

  const repaired = largest.map((index) => supported[index]);
  const preservedIds = new Set(repaired.map((box) => box.id));
  for (const box of clean) {
    if (preservedIds.has(box.id)) continue;
    const placed = findFloorPlacement(box.modelId, repaired, catalog, {
      id: box.id,
      rotated: box.rotated,
    });
    if (!placed) return null;
    repaired.push(placed);
  }
  const byId = new Map(repaired.map((box) => [box.id, box]));
  const result = clean.map((box) => byId.get(box.id));
  return validateWorkspace(result, catalog).valid &&
    inspectLayout(result, catalog).valid
    ? result
    : null;
}
