import test from "node:test";
import assert from "node:assert/strict";
import { CATALOG } from "../src/catalog.js";
import { encodeCaseClipboard, parseCaseClipboard } from "../src/clipboard.js";

test("every catalog case copies its model and orientation without position or identity", () => {
  for (const model of CATALOG) {
    for (const rotated of [false, true]) {
      const text = encodeCaseClipboard({
        id: "source",
        modelId: model.id,
        rotated,
        x: 1000,
        y: 500,
        z: 410,
      });
      assert.deepEqual(parseCaseClipboard(text, CATALOG), {
        modelId: model.id,
        rotated,
      });
      assert.equal("id" in JSON.parse(text), false);
      assert.equal("x" in JSON.parse(text), false);
    }
  }
});

test("clipboard input rejects unrelated text, malformed cases, and unsupported models", () => {
  const valid = JSON.parse(
    encodeCaseClipboard({ modelId: "40564", rotated: true }),
  );
  const invalid = [
    "ordinary copied text",
    "{",
    "null",
    "[]",
    "x".repeat(2001),
    undefined,
    JSON.stringify({ ...valid, type: "another-application" }),
    JSON.stringify({ ...valid, version: 2 }),
    JSON.stringify({ ...valid, modelId: "unknown" }),
    JSON.stringify({ ...valid, modelId: 40564 }),
    JSON.stringify({ ...valid, rotated: "false" }),
    JSON.stringify({ ...valid, rotated: undefined }),
  ];
  for (const text of invalid)
    assert.equal(parseCaseClipboard(text, CATALOG), null);
});

test("clipboard data cannot smuggle instance IDs or coordinates into a pasted case", () => {
  const data = JSON.parse(
    encodeCaseClipboard({ modelId: "40564", rotated: false }),
  );
  assert.deepEqual(
    parseCaseClipboard(
      JSON.stringify({ ...data, id: "existing", x: 99999, y: -8000, z: 4000 }),
      CATALOG,
    ),
    { modelId: "40564", rotated: false },
  );
});
