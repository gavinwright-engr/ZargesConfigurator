/**
 * Portable plan I/O shared by files, share links, and browser storage.
 *
 * Treat every imported plan as untrusted. Only these six catalog model ids and
 * a small set of scalar instance fields cross the boundary. Labels, URLs, HTML,
 * and computed placement metadata always come from our own catalog/geometry.
 */
import { CATALOG } from "./catalog.js";
import { inspectLayout } from "./stacking.js";

export const STORAGE_KEY = "zarges-stack-planner:v1";
export const MAX_CASES = 60;

const MAX_COORDINATE = 50_000;
const MAX_PLAN_LENGTH = 40_000;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const MODEL_IDS = new Set(CATALOG.map((model) => model.id));

function invalid(message) {
  throw new Error(`Invalid plan: ${message}`);
}

function sanitizeBoxes(boxes) {
  if (!Array.isArray(boxes)) invalid("boxes must be an array.");
  if (boxes.length > MAX_CASES) invalid(`use at most ${MAX_CASES} cases.`);
  const usedIds = new Set();
  const clean = boxes.map((box, index) => {
    const label = `Case ${index + 1}`;
    if (!box || typeof box !== "object" || Array.isArray(box)) {
      invalid(`${label} must be an object.`);
    }
    if (typeof box.id !== "string" || !SAFE_ID.test(box.id)) {
      invalid(
        `${label} needs a safe id (1–64 letters, numbers, hyphens or underscores).`,
      );
    }
    if (usedIds.has(box.id)) invalid("case ids must be unique.");
    usedIds.add(box.id);
    if (typeof box.modelId !== "string" || !MODEL_IDS.has(box.modelId)) {
      invalid(`${label} uses an unsupported model.`);
    }
    for (const axis of ["x", "y", "z"]) {
      if (!Number.isFinite(box[axis]) || Math.abs(box[axis]) > MAX_COORDINATE) {
        invalid(
          `${label} ${axis} must be a finite number within ±${MAX_COORDINATE} mm.`,
        );
      }
    }
    if (typeof box.rotated !== "boolean")
      invalid(`${label} rotated must be a boolean.`);

    // Build a new object explicitly; never spread arbitrary imported properties.
    return {
      id: box.id,
      modelId: box.modelId,
      x: box.x,
      y: box.y,
      z: box.z,
      rotated: box.rotated,
    };
  });
  const report = inspectLayout(clean, CATALOG);
  if (!report.valid) invalid(report.issues[0].message);
  return clean;
}

/** Create a clean, validated versioned document without mutating live state. */
export function makePlan(boxes) {
  return { version: 1, units: "mm", boxes: sanitizeBoxes(boxes) };
}

/** Read JSON or an already-parsed plan. Returns clean instances or throws. */
export function parsePlan(value) {
  let document = value;
  if (typeof value === "string") {
    if (value.length > MAX_PLAN_LENGTH) invalid("the document is too large.");
    try {
      document = JSON.parse(value);
    } catch {
      invalid("the document is not valid JSON.");
    }
  }
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    invalid("the document must be an object.");
  }
  if (document.version !== 1)
    invalid("unsupported version; expected version 1.");
  if (document.units !== "mm") invalid("units must be mm.");
  return sanitizeBoxes(document.boxes);
}

/**
 * Standard base64 is sufficient because all accepted plan fields are ASCII.
 * When using URLSearchParams, call .set('plan', encoded) so '+' is escaped.
 */
export function encodePlan(boxes) {
  return btoa(JSON.stringify(makePlan(boxes)));
}

/** Decode a share-link value through the same validation as imported files. */
export function decodePlan(encoded) {
  if (typeof encoded !== "string" || encoded.length > MAX_PLAN_LENGTH * 2) {
    invalid("the encoded document is invalid or too large.");
  }
  let json;
  try {
    json = atob(encoded);
  } catch {
    invalid("the share link is not valid base64.");
  }
  return parsePlan(json);
}

function csvCell(value) {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * An order-research list, grouped by catalog SKU. All text comes from CATALOG,
 * never imported labels, so spreadsheet formulas cannot be injected by a plan.
 */
export function boxListCsv(boxes) {
  const clean = sanitizeBoxes(boxes);
  const quantities = new Map();
  for (const box of clean)
    quantities.set(box.modelId, (quantities.get(box.modelId) ?? 0) + 1);
  const rows = [
    [
      "SKU",
      "Model",
      "Capacity (L)",
      "Quantity",
      "External length (mm)",
      "External width (mm)",
      "External height (mm)",
      "Empty weight each (kg)",
      "Total capacity (L)",
      "Total empty weight (kg)",
      "Product URL",
    ],
  ];
  for (const model of CATALOG) {
    const quantity = quantities.get(model.id);
    if (!quantity) continue;
    rows.push([
      model.id,
      model.name,
      model.volume,
      quantity,
      ...model.external,
      model.weight,
      model.volume * quantity,
      Math.round(model.weight * quantity * 1000) / 1000,
      model.url,
    ]);
  }
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
