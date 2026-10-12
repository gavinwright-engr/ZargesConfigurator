import assert from "node:assert/strict";
import test from "node:test";
import { CATALOG, PRESET } from "../src/catalog.js";
import {
  getSceneTransform,
  renderBoxThumbnail,
  renderScene,
} from "../src/renderer.js";

const drawOrder = (svg) =>
  [...svg.matchAll(/data-box-id="([^"]+)"/g)].map((match) => match[1]);
const firstPolygon = (svg, id) =>
  svg.match(
    new RegExp(`data-box-id="${id}"[\\s\\S]*?<polygon points="([^"]+)"`),
  )[1];

test("a higher rear case cannot paint across the neighboring foreground case", () => {
  const order = drawOrder(renderScene(PRESET, CATALOG));
  // The right 42 L case begins at 750 mm, overlapping the left 73 L case's
  // 410–820 mm range. Base-elevation sorting previously drew its side on top
  // of the 73 L front; the 42 L case must instead be drawn first.
  assert(order.indexOf("case-8") < order.indexOf("case-5"));
  assert(order.indexOf("case-6") < order.indexOf("case-8"));
  assert(order.indexOf("case-5") < order.indexOf("case-7"));
  assert(order.indexOf("case-4") < order.indexOf("case-5"));
  assert.deepEqual(
    order,
    drawOrder(renderScene([...PRESET].reverse(), CATALOG)),
  );
});

test("depth separation also keeps raised rear cases behind foreground cases", () => {
  const boxes = [
    { id: "front", modelId: "40564", x: 0, y: 0, z: 0 },
    { id: "rear", modelId: "40564", x: 0, y: 400, z: 200 },
  ];
  for (const view of ["iso", "front"]) {
    assert.deepEqual(drawOrder(renderScene(boxes, CATALOG, { view })), [
      "rear",
      "front",
    ]);
  }
});

test("top view puts upper cases above their supports", () => {
  const order = drawOrder(renderScene(PRESET, CATALOG, { view: "top" }));
  for (const [lower, upper] of [
    ["case-1", "case-3"],
    ["case-2", "case-3"],
    ["case-4", "case-5"],
    ["case-5", "case-7"],
    ["case-6", "case-8"],
  ]) {
    assert(order.indexOf(lower) < order.indexOf(upper));
  }
});

test("the scale figure is exactly six feet tall at the same scale as case heights", () => {
  for (const view of ["iso", "front"]) {
    const transform = getSceneTransform(PRESET, CATALOG, view);
    const svg = renderScene(PRESET, CATALOG, { view });
    assert.match(svg, /data-person-height-mm="1828\.8"/);
    const figure = svg.match(
      /class="human-figure" transform="translate\([^)]+\) scale\(([^)]+)\)"/,
    );
    assert(figure);
    const renderedPersonHeight = Number(figure[1]) * 1000;
    const floor = transform.project(1550, 0, 0);
    const lid = transform.project(1550, 0, 410);
    assert(
      Math.abs(renderedPersonHeight / (floor.y - lid.y) - 1828.8 / 410) < 1e-9,
    );
  }
  assert.doesNotMatch(
    renderScene(PRESET, CATALOG, { humanScale: false }),
    /data-person-height-mm/,
  );
  assert.doesNotMatch(renderBoxThumbnail(CATALOG[0]), /data-person-height-mm/);
  assert.match(
    renderScene(PRESET, CATALOG, { view: "top" }),
    /data-person-height-mm/,
  );
  assert.doesNotMatch(
    renderScene(PRESET, CATALOG, { view: "top" }),
    /class="human-figure"/,
  );
});

test("selection and dimensions never change projected case positions", () => {
  const before = structuredClone(PRESET);
  for (const view of ["iso", "front", "top"]) {
    for (const humanScale of [false, true]) {
      const base = renderScene(PRESET, CATALOG, { view, humanScale });
      for (const selectedId of PRESET.map((box) => box.id)) {
        const selected = renderScene(PRESET, CATALOG, {
          view,
          humanScale,
          selectedId,
          dimensions: true,
        });
        for (const box of PRESET)
          assert.equal(
            firstPolygon(base, box.id),
            firstPolygon(selected, box.id),
          );
      }
    }
  }
  assert.deepEqual(PRESET, before);
});

test("pointer inversion matches both human-scale camera settings", () => {
  for (const view of ["iso", "top"]) {
    for (const humanScale of [false, true]) {
      const transform = getSceneTransform(PRESET, CATALOG, view, {
        humanScale,
      });
      const projected = transform.project(1713, 217, 410);
      const world = transform.unproject(projected.x, projected.y, 410);
      assert(Math.abs(world.x - 1713) < 1e-8);
      assert(Math.abs(world.y - 217) < 1e-8);
    }
  }
});
