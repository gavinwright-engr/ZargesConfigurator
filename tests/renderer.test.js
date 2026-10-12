import assert from "node:assert/strict";
import test from "node:test";
import { CATALOG, PRESET } from "../src/catalog.js";
import { WORKSPACE } from "../src/workspace.js";
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

function polygonPoints(markup) {
  return markup
    .match(/points="([^"]+)"/)[1]
    .split(" ")
    .map((point) => point.split(",").map(Number));
}

function insidePolygon(point, vertices) {
  let sign = 0;
  for (let index = 0; index < vertices.length; index += 1) {
    const a = vertices[index];
    const b = vertices[(index + 1) % vertices.length];
    const cross =
      (b[0] - a[0]) * (point[1] - a[1]) - (b[1] - a[1]) * (point[0] - a[0]);
    if (Math.abs(cross) <= Math.hypot(b[0] - a[0], b[1] - a[1]) * 0.03)
      continue;
    if (sign && Math.sign(cross) !== sign) return false;
    sign = Math.sign(cross);
  }
  return true;
}

function labelCorners(markup, className) {
  const group = markup.match(
    new RegExp(
      `<g class="${className}" transform="matrix\\(([^)]+)\\)"[^>]*>\\s*<rect ([^>]+)`,
    ),
  );
  if (!group) return null;
  const [a, b, c, d, e, f] = group[1].split(" ").map(Number);
  const attribute = (name) =>
    Number(group[2].match(new RegExp(`(?:^| )${name}="([^"]+)"`))[1]);
  const x = attribute("x"),
    y = attribute("y");
  const width = attribute("width"),
    height = attribute("height");
  return [
    [x, y],
    [x + width, y],
    [x + width, y + height],
    [x, y + height],
  ].map(([px, py]) => [a * px + c * py + e, b * px + d * py + f]);
}

test("every catalogue orientation keeps physical artwork and labels inside its case", () => {
  for (const model of CATALOG) {
    for (const rotated of [false, true]) {
      for (const view of ["iso", "front"]) {
        for (const workspace of [false, true]) {
          const box = {
            id: "fit-test",
            modelId: model.id,
            x: 0,
            y: 0,
            z: 0,
            rotated,
          };
          const svg = renderScene([box], CATALOG, { view, workspace });
          const context = `${model.id}, ${view}, rotated=${rotated}, workspace=${workspace}`;
          const envelope = polygonPoints(
            svg.match(/<polygon[^>]+class="box-envelope"[^>]*>/)[0],
          );
          const front = polygonPoints(
            svg.match(/<polygon[^>]+class="box-front"[^>]*>/)[0],
          );
          const capacity = labelCorners(svg, "box-capacity");
          assert(
            capacity.every((point) => insidePolygon(point, front)),
            `${context}: capacity escapes face`,
          );
          const physical = svg.slice(
            svg.indexOf('<g class="box-art"'),
            svg.indexOf('<g class="box-capacity"'),
          );
          for (const polygon of physical.matchAll(/<polygon[^>]+>/g)) {
            assert(
              polygonPoints(polygon[0]).every((point) =>
                insidePolygon(point, envelope),
              ),
              `${context}: hardware escapes envelope`,
            );
          }
          const badge = labelCorners(svg, "box-badge");
          if (badge) {
            const capacityTop = Math.min(...capacity.map((point) => point[1]));
            const badgeBottom = Math.max(...badge.map((point) => point[1]));
            assert(
              badgeBottom <= capacityTop,
              `${context}: badge collides with capacity`,
            );
          }
        }
      }
    }
  }
});

test("the camera closely frames the cases independently of the bounded floor", () => {
  for (const view of ["iso", "front", "top"]) {
    const transform = getSceneTransform(PRESET, CATALOG, view, {
      humanScale: false,
    });
    const points = PRESET.flatMap((box) => {
      const model = CATALOG.find((model) => model.id === box.modelId);
      const [length, width, height] = box.rotated
        ? [model.external[1], model.external[0], model.external[2]]
        : model.external;
      return [box.x, box.x + length].flatMap((x) =>
        [box.y, box.y + width].flatMap((y) =>
          [box.z, box.z + height].map((z) => transform.project(x, y, z)),
        ),
      );
    });
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const left = Math.min(...xs),
      right = Math.max(...xs);
    const top = Math.min(...ys),
      bottom = Math.max(...ys);
    assert(
      (right - left) / transform.width >= 0.8,
      `${view}: cases must fill the view when scale references are hidden`,
    );
    assert(Math.abs((left + right) / 2 - transform.width / 2) < 1);
    assert(Math.abs((top + bottom) / 2 - transform.height / 2) < 20);
    assert(left > 20 && right < transform.width - 20);
    assert(top > 20 && bottom < transform.height - 20);
    for (const humanScale of [false, true]) {
      for (const soccerScale of [false, true]) {
        const options = { humanScale, soccerScale };
        const bounded = getSceneTransform(PRESET, CATALOG, view, options);
        const unbounded = getSceneTransform(PRESET, CATALOG, view, {
          ...options,
          workspace: false,
        });
        assert.equal(
          bounded.scale,
          unbounded.scale,
          "Drawing empty floor must not shrink the objects",
        );
        assert.deepEqual(bounded.project(0, 0, 0), unbounded.project(0, 0, 0));
      }
    }
    if (view === "front") continue;
    assert.match(
      renderScene(PRESET, CATALOG, { view }),
      new RegExp(
        `data-workspace-length-mm="${WORKSPACE.length}" data-workspace-width-mm="${WORKSPACE.width}"`,
      ),
    );
  }
  assert.doesNotMatch(
    renderScene(PRESET, CATALOG, { workspace: false }),
    /class="workspace-boundary"/,
  );
  assert.doesNotMatch(
    renderBoxThumbnail(CATALOG[0]),
    /class="workspace-boundary"/,
  );
});

test("the rendered floor leaves equal placeable depth in front of and behind the reference boxes", () => {
  const near = Math.min(...PRESET.map((box) => box.y));
  const far = Math.max(
    ...PRESET.map((box) => {
      const model = CATALOG.find((model) => model.id === box.modelId);
      return box.y + model.external[box.rotated ? 0 : 1];
    }),
  );
  for (const view of ["iso", "top"]) {
    const svg = renderScene(PRESET, CATALOG, { view });
    const transform = getSceneTransform(PRESET, CATALOG, view);
    const boundary = svg.match(
      /<polygon points="([^"]+)"[^>]*class="workspace-boundary"/,
    );
    assert(
      boundary,
      "The visible floor must use the actual placeable boundary",
    );
    const world = boundary[1].split(" ").map((point) => {
      const [x, y] = point.split(",").map(Number);
      return transform.unproject(x, y, 0);
    });
    const frontSpace = near - Math.min(...world.map((point) => point.y));
    const backSpace = Math.max(...world.map((point) => point.y)) - far;
    assert(
      Math.abs(frontSpace - backSpace) < 0.15,
      `${view}: free depth should be split equally`,
    );
    assert(
      Math.abs(frontSpace - 900) < 0.15,
      "There must be room for a new row in front",
    );
  }
});

test("the optional soccer ball is 220 mm in every view and camera configuration", () => {
  assert.doesNotMatch(renderScene(PRESET, CATALOG), /data-soccer-diameter-mm/);
  assert.doesNotMatch(
    renderBoxThumbnail(CATALOG[0]),
    /data-soccer-diameter-mm/,
  );
  for (const view of ["iso", "front", "top"]) {
    for (const workspace of [false, true]) {
      for (const humanScale of [false, true]) {
        const options = { view, workspace, humanScale, soccerScale: true };
        const svg = renderScene(PRESET, CATALOG, options);
        const transform = getSceneTransform(PRESET, CATALOG, view, options);
        assert.match(svg, /data-soccer-diameter-mm="220"/);
        const radius = Number(
          svg.match(/class="soccer-outline" r="([^"]+)"/)[1],
        );
        const sphereScale = Number(
          svg.match(
            /class="soccer-figure" transform="translate\([^)]+\) scale\(([^)]+)\)"/,
          )[1],
        );
        assert(
          Math.abs(radius * 2 * sphereScale - 220 * transform.scale) < 1e-10,
        );
        const selected = renderScene(PRESET, CATALOG, {
          ...options,
          selectedId: "case-7",
        });
        assert.equal(
          firstPolygon(svg, "case-7"),
          firstPolygon(selected, "case-7"),
        );
      }
    }
  }
});
