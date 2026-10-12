import test from "node:test";
import assert from "node:assert/strict";
import { PRESET } from "../src/catalog.js";
import {
  STORAGE_KEY,
  MAX_CASES,
  makePlan,
  parsePlan,
  encodePlan,
  decodePlan,
  boxListCsv,
} from "../src/plans.js";

const oneBox = () => [
  { id: "case-1", modelId: "40564", x: 0, y: 0, z: 0, rotated: false },
];
const document = (boxes = oneBox()) => ({ version: 1, units: "mm", boxes });

test("versioned plans and base64 share links round-trip the complete preset", () => {
  assert.equal(STORAGE_KEY, "zarges-stack-planner:v1");
  const plan = makePlan(PRESET);
  assert.equal(plan.version, 1);
  assert.equal(plan.units, "mm");
  assert.deepEqual(parsePlan(JSON.stringify(plan)), PRESET);
  assert.deepEqual(decodePlan(encodePlan(PRESET)), PRESET);
  assert.deepEqual(JSON.parse(atob(encodePlan(PRESET))), plan);
  assert.notEqual(plan.boxes, PRESET);
  assert.notEqual(plan.boxes[0], PRESET[0]);
});

test("imported display text, URLs, and placement metadata are stripped", () => {
  const boxes = oneBox();
  boxes[0].label = "<img src=x onerror=alert(1)>";
  boxes[0].url = "javascript:alert(1)";
  boxes[0].placement = { valid: true };
  const result = parsePlan(document(boxes));
  assert.deepEqual(result, oneBox());
  assert.equal(boxes[0].label, "<img src=x onerror=alert(1)>");
});

test("unknown model ids and unsafe or duplicate instance ids are rejected", () => {
  for (const modelId of ["unknown", 40564, "__proto__"]) {
    const boxes = oneBox();
    boxes[0].modelId = modelId;
    assert.throws(() => parsePlan(document(boxes)), /unsupported model/);
  }
  for (const id of ["", "<script>", "name with spaces", "a".repeat(65), null]) {
    const boxes = oneBox();
    boxes[0].id = id;
    assert.throws(() => parsePlan(document(boxes)), /safe id/);
  }
  const duplicate = [...oneBox(), { ...oneBox()[0], x: 600 }];
  assert.throws(() => parsePlan(document(duplicate)), /unique/);
});

test("coordinates must be finite numbers within the 50 metre limit", () => {
  for (const value of [NaN, Infinity, -Infinity, "0", null, 50_001, -50_001]) {
    const boxes = oneBox();
    boxes[0].x = value;
    assert.throws(() => parsePlan(document(boxes)), /finite number/);
  }
  const edge = oneBox();
  edge[0].x = -50_000;
  edge[0].y = 50_000;
  assert.deepEqual(parsePlan(document(edge)), edge);
});

test("rotated accepts only an explicit boolean", () => {
  for (const rotated of [0, 1, "false", null, undefined]) {
    const boxes = oneBox();
    boxes[0].rotated = rotated;
    assert.throws(() => parsePlan(document(boxes)), /boolean/);
  }
});

test("imports cannot bypass collision and full-footprint support checks", () => {
  const overlapping = [...oneBox(), { ...oneBox()[0], id: "case-2", x: 500 }];
  assert.throws(() => parsePlan(document(overlapping)), /overlaps/);
  const floating = oneBox();
  floating[0].z = 200;
  assert.throws(() => parsePlan(document(floating)), /floor|surface/);
  const overhang = [
    ...oneBox(),
    { ...oneBox()[0], id: "case-2", x: 1, z: 410 },
  ];
  assert.throws(() => parsePlan(document(overhang)), /full footprint/);
  const belowFloor = oneBox();
  belowFloor[0].z = -1;
  assert.throws(() => parsePlan(document(belowFloor)), /below the floor/);
});

test("enforces the case count limit before inspecting geometry", () => {
  assert.equal(MAX_CASES, 60);
  const boxes = Array.from({ length: MAX_CASES + 1 }, (_, index) => ({
    ...oneBox()[0],
    id: `case-${index}`,
    x: index * 600,
  }));
  assert.throws(() => parsePlan(document(boxes)), /at most 60/);
  assert.equal(
    parsePlan(document(boxes.slice(0, MAX_CASES))).length,
    MAX_CASES,
  );
});

test("malformed JSON, envelopes, versions, units, and share links are rejected", () => {
  assert.throws(() => parsePlan("{broken"), /valid JSON/);
  for (const value of [null, 4, [], { version: 2, units: "mm", boxes: [] }]) {
    assert.throws(() => parsePlan(value), /Invalid plan/);
  }
  assert.throws(
    () => parsePlan({ version: 1, units: "in", boxes: [] }),
    /units/,
  );
  assert.throws(
    () => parsePlan({ version: 1, units: "mm", boxes: {} }),
    /array/,
  );
  assert.throws(() => decodePlan("%%% not base64 %%%"), /base64/);
  assert.throws(() => decodePlan(btoa('{"version":2}')), /version/);
  assert.throws(() => parsePlan(" ".repeat(40_001)), /too large/);
  assert.throws(() => decodePlan("a".repeat(80_001)), /too large/);
});

test("export validates live input too, preserving only the supported data schema", () => {
  const invalid = oneBox();
  invalid[0].modelId = "unknown";
  assert.throws(() => makePlan(invalid), /unsupported model/);
  assert.throws(() => encodePlan(invalid), /unsupported model/);
  assert.throws(() => boxListCsv(invalid), /unsupported model/);
  assert.deepEqual(parsePlan(makePlan([])), []);
});

test("CSV groups the reference cases into six SKUs, including three 73 L cases", () => {
  const csv = boxListCsv(PRESET);
  const [header, ...rows] = csv
    .trim()
    .split("\r\n")
    .map((row) => row.split(","));
  const record = (row) =>
    Object.fromEntries(header.map((key, index) => [key, row[index]]));
  const records = rows.map(record);
  assert.equal(records.length, 6);
  const model73 = records.find((row) => row.SKU === "40564");
  assert.equal(model73.Quantity, "3");
  assert.equal(model73["Capacity (L)"], "73");
  assert.equal(model73["External length (mm)"], "600");
  assert.equal(model73["External width (mm)"], "400");
  assert.equal(model73["External height (mm)"], "410");
  assert.equal(model73["Total capacity (L)"], "219");
  assert.equal(model73["Total empty weight (kg)"], "15.9");
  assert.match(model73["Product URL"], /^https:\/\/www\.zarges\.com\//);
  assert.equal(
    records.reduce((total, row) => total + Number(row.Quantity), 0),
    8,
  );
  assert.equal(
    records.reduce(
      (total, row) => total + Number(row["Total capacity (L)"]),
      0,
    ),
    567,
  );
});

test("CSV ignores arbitrary imported labels instead of exporting spreadsheet formulas", () => {
  const boxes = oneBox();
  boxes[0].label = '=HYPERLINK("https://example.com")';
  assert.equal(boxListCsv(boxes).includes("HYPERLINK"), false);
  assert.equal(boxListCsv([]).trim().split("\r\n").length, 1);
});
