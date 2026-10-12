/**
 * Framework-free rectangular stacking geometry. All coordinates are millimetres.
 *
 * x/y are a box's minimum horizontal corner; z is its base elevation. A quarter
 * turn swaps length and width. Published external dimensions are envelopes, not
 * measured lid/corner geometry: a valid result establishes footprint support only.
 * It does not certify interlocking, load capacity, or transport safety.
 */

// Only a floating-point allowance, not a real-world gap/overhang allowance.
const EPSILON = 1e-7;

function getModel(modelId, catalog) {
  const models = catalog.models ?? catalog;
  const model = Array.isArray(models)
    ? models.find((entry) => String(entry.id) === String(modelId))
    : models[modelId];
  if (!model) throw new Error(`Unknown box model: ${modelId}`);
  return model;
}

/** Return [length, width, height], including the instance's 90° rotation. */
export function getDimensions(box, catalog) {
  const model = getModel(box.modelId, catalog);
  const dimensions = model.external ?? model.dimensions;
  if (
    !Array.isArray(dimensions) ||
    dimensions.length !== 3 ||
    !dimensions.every((value) => Number.isFinite(value) && value > 0)
  ) {
    throw new Error(`Invalid external dimensions for model: ${box.modelId}`);
  }
  const [length, width, height] = dimensions;
  return box.rotated ? [width, length, height] : [length, width, height];
}

function boundsOf(box, catalog) {
  const [length, width, height] = getDimensions(box, catalog);
  if (![box.x, box.y, box.z].every(Number.isFinite)) {
    throw new Error("Box coordinates must be finite numbers.");
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

function otherBoxes(box, boxes) {
  return boxes.filter(
    (other) => other !== box && (box.id == null || other.id !== box.id),
  );
}

function overlap(a1, a2, b1, b2) {
  return Math.min(a2, b2) - Math.max(a1, b1);
}

/**
 * Compute a rectangle union with an x-axis sweep. Summing support areas would
 * double-count overlapping supports and could falsely approve a gap elsewhere.
 */
function rectangleUnionArea(rectangles) {
  if (!rectangles.length) return 0;
  const edges = [...new Set(rectangles.flatMap((r) => [r.x1, r.x2]))].sort(
    (a, b) => a - b,
  );
  let area = 0;
  for (let index = 1; index < edges.length; index += 1) {
    const left = edges[index - 1];
    const right = edges[index];
    const intervals = rectangles
      .filter((r) => r.x1 < right && r.x2 > left)
      .map((r) => [r.y1, r.y2])
      .sort((a, b) => a[0] - b[0]);
    let covered = 0;
    let start = null;
    let end = null;
    for (const [nextStart, nextEnd] of intervals) {
      if (start === null) {
        [start, end] = [nextStart, nextEnd];
      } else if (nextStart <= end) {
        end = Math.max(end, nextEnd);
      } else {
        covered += end - start;
        [start, end] = [nextStart, nextEnd];
      }
    }
    if (start !== null) covered += end - start;
    area += (right - left) * covered;
  }
  return area;
}

/**
 * Validate one candidate against the other instances. The ground is an unlimited
 * plane. Above it, the entire footprint needs coplanar support; touching side
 * faces are allowed, penetrating volumes and unsupported overhangs are not.
 * A moving instance can remain in `others`: its matching id is excluded.
 */
export function validatePlacement(box, others, catalog) {
  let bounds;
  let neighbors;
  try {
    bounds = boundsOf(box, catalog);
    neighbors = otherBoxes(box, others).map((other) => ({
      box: other,
      bounds: boundsOf(other, catalog),
    }));
  } catch (error) {
    return {
      valid: false,
      code: "invalid",
      reason: error.message,
      supportRatio: 0,
      supportedBy: [],
      issues: [{ code: "invalid", message: error.message }],
    };
  }

  const issues = [];
  if (bounds.z1 < -EPSILON) {
    issues.push({
      code: "below-ground",
      message: "The box extends below the floor.",
    });
  }
  const collisions = neighbors.filter(
    ({ bounds: other }) =>
      overlap(bounds.x1, bounds.x2, other.x1, other.x2) > EPSILON &&
      overlap(bounds.y1, bounds.y2, other.y1, other.y2) > EPSILON &&
      overlap(bounds.z1, bounds.z2, other.z1, other.z2) > EPSILON,
  );
  if (collisions.length) {
    issues.push({
      code: "collision",
      message: "This position overlaps another box.",
      boxIds: collisions.map(({ box: other }) => other.id),
    });
  }

  const onGround = Math.abs(bounds.z1) <= EPSILON;
  const supports = neighbors.filter(
    ({ bounds: other }) =>
      Math.abs(other.z2 - bounds.z1) <= EPSILON &&
      overlap(bounds.x1, bounds.x2, other.x1, other.x2) > EPSILON &&
      overlap(bounds.y1, bounds.y2, other.y1, other.y2) > EPSILON,
  );
  const footprintArea = (bounds.x2 - bounds.x1) * (bounds.y2 - bounds.y1);
  const coveredArea = onGround
    ? footprintArea
    : rectangleUnionArea(
        supports.map(({ bounds: other }) => ({
          x1: Math.max(bounds.x1, other.x1),
          x2: Math.min(bounds.x2, other.x2),
          y1: Math.max(bounds.y1, other.y1),
          y2: Math.min(bounds.y2, other.y2),
        })),
      );
  const supportRatio = Math.min(1, coveredArea / footprintArea);
  if (!onGround && footprintArea - coveredArea > EPSILON) {
    issues.push({
      code: "unsupported",
      message:
        coveredArea > 0
          ? "The full footprint needs support at one height. Align the edges or add an equal-height box."
          : "Place the box on the floor or directly on a supported top surface.",
    });
  }
  return {
    valid: issues.length === 0,
    code: issues[0]?.code ?? "supported",
    reason:
      issues[0]?.message ??
      (onGround ? "Supported by the floor." : "Full footprint support."),
    supportRatio,
    supportedBy: onGround ? [] : supports.map(({ box: other }) => other.id),
    issues,
  };
}

function axisCandidates(position, dimension, bounds, axis, radius) {
  const values = new Set([position]);
  for (const boxBounds of bounds) {
    const min = boxBounds[`${axis}1`];
    const max = boxBounds[`${axis}2`];
    // Same edge, opposing edge, and immediately adjacent on either side.
    for (const value of [min, max - dimension, max, min - dimension]) {
      if (Math.abs(value - position) <= radius + EPSILON) values.add(value);
    }
  }
  return [...values];
}

/**
 * Resolve a pointer drop to the nearest supported floor/top position.
 *
 * Returns {id, modelId, x, y, z, rotated, placement} or null when no nearby valid
 * placement exists. `placement` is the validatePlacement result. Optional `z`
 * locks elevation (useful for precise controls). Without it, collisions rule out
 * lower surfaces and the nearest horizontal fit wins. Existing instances with
 * the supplied `id` are ignored, making the same API work for additions and moves.
 */
export function resolveDrop(modelId, x, y, others, catalog, options = {}) {
  if (![x, y].every(Number.isFinite)) return null;
  const candidate = {
    id: options.id,
    modelId,
    x,
    y,
    z: 0,
    rotated: Boolean(options.rotated),
  };
  let dimensions;
  let neighbors;
  try {
    dimensions = getDimensions(candidate, catalog);
    neighbors = otherBoxes(candidate, others).map((box) =>
      boundsOf(box, catalog),
    );
  } catch {
    return null;
  }
  if (options.z != null && !Number.isFinite(options.z)) return null;
  const snapDistance = Math.max(0, options.snapDistance ?? 35);
  const maxDistance = Math.max(snapDistance, options.maxDistance ?? 180);
  const elevations =
    options.z != null
      ? [options.z]
      : [...new Set([0, ...neighbors.map((bounds) => bounds.z2)])];

  // Keep normal drags local. A wider recovery search runs only if nothing works
  // within the normal snap distance, so a pointer never teleports unnecessarily.
  for (const radius of [...new Set([snapDistance, maxDistance])]) {
    const xs = axisCandidates(x, dimensions[0], neighbors, "x", radius);
    const ys = axisCandidates(y, dimensions[1], neighbors, "y", radius);
    let best = null;
    for (const px of xs) {
      for (const py of ys) {
        const dx = Math.abs(px - x);
        const dy = Math.abs(py - y);
        // Near an edge, give snapping priority over an unaligned position. Use
        // Manhattan distance so equally useful x/y snaps behave consistently.
        const alignedX = neighbors.some((b) =>
          [b.x1, b.x2 - dimensions[0], b.x2, b.x1 - dimensions[0]].includes(px),
        );
        const alignedY = neighbors.some((b) =>
          [b.y1, b.y2 - dimensions[1], b.y2, b.y1 - dimensions[1]].includes(py),
        );
        const score =
          dx +
          dy +
          (!alignedX ? snapDistance + EPSILON : 0) +
          (!alignedY ? snapDistance + EPSILON : 0);
        for (const z of elevations) {
          const box = { ...candidate, x: px, y: py, z };
          const placement = validatePlacement(box, others, catalog);
          if (!placement.valid) continue;
          if (
            !best ||
            score < best.score - EPSILON ||
            (Math.abs(score - best.score) <= EPSILON && z > best.box.z)
          ) {
            best = { box: { ...box, placement }, score };
          }
        }
      }
    }
    if (best) return best.box;
  }
  return null;
}

/** Inspect a whole layout, including boxes orphaned by a move or removal. */
export function inspectLayout(boxes, catalog) {
  const placements = boxes.map((box) => ({
    id: box.id,
    ...validatePlacement(box, boxes, catalog),
  }));
  const issues = placements.flatMap((placement) =>
    placement.issues.map((issue) => ({
      ...issue,
      id: placement.id,
    })),
  );
  const ids = new Set();
  for (const box of boxes) {
    if (box.id != null && ids.has(box.id)) {
      issues.push({
        id: box.id,
        code: "duplicate-id",
        message: "Each box needs a unique instance id.",
      });
    }
    ids.add(box.id);
  }

  let bounds = null;
  let volumeLiters = 0;
  let emptyWeightKg = 0;
  for (const box of boxes) {
    try {
      const current = boundsOf(box, catalog);
      const model = getModel(box.modelId, catalog);
      volumeLiters += Number(
        model.volume ??
          model.liters ??
          model.volumeLiters ??
          model.capacity ??
          0,
      );
      emptyWeightKg += Number(
        model.weight ?? model.weightKg ?? model.emptyWeightKg ?? 0,
      );
      bounds = bounds
        ? {
            x1: Math.min(bounds.x1, current.x1),
            x2: Math.max(bounds.x2, current.x2),
            y1: Math.min(bounds.y1, current.y1),
            y2: Math.max(bounds.y2, current.y2),
            z1: Math.min(bounds.z1, current.z1),
            z2: Math.max(bounds.z2, current.z2),
          }
        : current;
    } catch {
      // Invalid instances already have actionable placement errors above.
    }
  }
  return {
    valid: issues.length === 0,
    issues,
    placements,
    bounds,
    stats: {
      count: boxes.length,
      volumeLiters,
      emptyWeightKg: Math.round(emptyWeightKg * 1000) / 1000,
      dimensions: bounds
        ? [bounds.x2 - bounds.x1, bounds.y2 - bounds.y1, bounds.z2 - bounds.z1]
        : [0, 0, 0],
      height: bounds?.z2 ?? 0,
    },
  };
}
