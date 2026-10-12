// Selection follows visible case edges, without revealing geometry behind other
// cases. An independent 3D ray test supplies expected visibility; browser SVG
// rasters verify the highlights, pointer behavior, and unchanged camera.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_EXECUTABLE
    ? { executablePath: process.env.CHROMIUM_EXECUTABLE }
    : {}),
  args: ["--no-sandbox"],
});
const page = await browser.newPage({
  viewport: { width: 1500, height: 1125 },
  deviceScaleFactor: 2,
});
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));

async function selectCase(id) {
  const node = page.locator(`#scene [data-box-id="${id}"]`);
  await node.focus();
  await page.keyboard.press("Enter");
  assert.equal(await node.getAttribute("aria-pressed"), "true");
}

async function cameraGeometry() {
  return page.evaluate(() => {
    const svg = document.querySelector("#scene svg");
    const matrix = svg.getScreenCTM();
    const canvas = document
      .querySelector("#canvas-wrap")
      .getBoundingClientRect();
    const round = (number) => Number(number.toFixed(3));
    return {
      canvas: [canvas.x, canvas.y, canvas.width, canvas.height].map(round),
      matrix: [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f].map(
        round,
      ),
      boxes: [...svg.querySelectorAll("[data-box-id]")].map((box) => ({
        id: box.dataset.boxId,
        envelope: box.querySelector(".box-envelope").getAttribute("points"),
      })),
    };
  });
}

async function inspectSelection(
  id,
  view,
  expectedCount = 8,
  fullyCovered = false,
) {
  const result = await page.evaluate(
    async ({ id, view, fullyCovered }) => {
      const { CATALOG } = await import("./src/catalog.js");
      const boxes = JSON.parse(
        localStorage.getItem("zarges-stack-planner:v1"),
      ).boxes.map((box) => {
        const dimensions = CATALOG.find(
          (model) => model.id === box.modelId,
        ).external;
        const [length, width, height] = box.rotated
          ? [dimensions[1], dimensions[0], dimensions[2]]
          : dimensions;
        return { ...box, length, width, height };
      });
      const selected = boxes.find((box) => box.id === id);
      const svg = document.querySelector("#scene svg");
      const overlay = svg.querySelector(".scene-selection");
      const polygon = overlay?.querySelector(".box-selection");
      const envelope = svg.querySelector(`[data-box-id="${id}"] .box-envelope`);
      const boxIds = [...svg.querySelectorAll("[data-box-id]")].map(
        (box) => box.dataset.boxId,
      );
      const structure = {
        overlays: svg.querySelectorAll(".scene-selection").length,
        polygons: svg.querySelectorAll(".box-selection").length,
        last: svg.lastElementChild === overlay,
        pointerEvents: overlay && getComputedStyle(overlay).pointerEvents,
        ariaHidden: overlay?.getAttribute("aria-hidden"),
        selectedId: overlay?.dataset.selectedBoxId,
        sameEnvelope:
          polygon?.getAttribute("points") === envelope?.getAttribute("points"),
        masked: Boolean(overlay?.getAttribute("mask")),
        boxCount: boxIds.length,
        uniqueBoxCount: new Set(boxIds).size,
        internalEdges: overlay?.querySelectorAll(".box-selection-edge").length,
      };
      if (!polygon)
        return {
          structure,
          visible: 0,
          hidden: 0,
          failures: ["Missing selection polygon"],
        };

      // These are the physical corners of the selected case, not polygons from
      // the renderer's mask or its painter ordering. Camera-facing rays intersect
      // every other 3D box to decide whether an edge point can really be seen.
      const { x, y, z, length: w, width: d, height: h } = selected;
      const corners =
        view === "top"
          ? [
              [x, y, z + h],
              [x + w, y, z + h],
              [x + w, y + d, z + h],
              [x, y + d, z + h],
            ]
          : view === "front"
            ? [
                [x, y, z],
                [x + w, y, z],
                [x + w, y, z + h],
                [x, y, z + h],
              ]
            : [
                [x, y + d, z + h],
                [x + w, y + d, z + h],
                [x + w, y, z + h],
                [x + w, y, z],
                [x, y, z],
                [x, y + d, z],
              ];
      // Null directions of the documented orthographic projection, toward the
      // camera: minimum x/y faces in 3D, minimum y in Front, maximum z in Top.
      const direction =
        view === "top"
          ? [0, 0, 1]
          : view === "front"
            ? [0, -1, 0]
            : [-0.44 / 0.98, -1, 0.25 + (0.055 * 0.44) / 0.98];
      function rayHits(origin, box) {
        const min = [box.x, box.y, box.z];
        const max = [box.x + box.length, box.y + box.width, box.z + box.height];
        let enter = 0,
          leave = Infinity;
        for (let axis = 0; axis < 3; axis += 1) {
          if (Math.abs(direction[axis]) < 1e-9) {
            if (
              origin[axis] < min[axis] - 1e-7 ||
              origin[axis] > max[axis] + 1e-7
            )
              return false;
          } else {
            const a = (min[axis] - origin[axis]) / direction[axis];
            const b = (max[axis] - origin[axis]) / direction[axis];
            enter = Math.max(enter, Math.min(a, b));
            leave = Math.min(leave, Math.max(a, b));
          }
        }
        return leave > enter + 1e-6;
      }
      const occluded = (origin) =>
        boxes.some((box) => box.id !== id && rayHits(origin, box));
      const vertices = [...polygon.points].map((point) => ({
        x: point.x,
        y: point.y,
      }));
      const segments = vertices.map((from, index) => ({
        from,
        to: vertices[(index + 1) % vertices.length],
        name: `hull-${index}`,
        worldFrom: corners[index],
        worldTo: corners[(index + 1) % corners.length],
      }));
      const internalEnds = [
        [x + w, y, z + h],
        [x, y + d, z + h],
        [x, y, z],
      ];
      for (const [index, line] of [
        ...overlay.querySelectorAll(".box-selection-edge"),
      ].entries()) {
        segments.push({
          from: { x: line.x1.baseVal.value, y: line.y1.baseVal.value },
          to: { x: line.x2.baseVal.value, y: line.y2.baseVal.value },
          worldFrom: [x, y, z + h],
          worldTo: internalEnds[index],
          name: `visible-edge-${index}`,
        });
      }

      const factor = 2;
      const viewport = svg.viewBox.baseVal;
      async function raster(hideSelection = false) {
        const clone = svg.cloneNode(true);
        if (hideSelection) clone.querySelector(".scene-selection").remove();
        clone.setAttribute("width", viewport.width * factor);
        clone.setAttribute("height", viewport.height * factor);
        const url = URL.createObjectURL(
          new Blob([new XMLSerializer().serializeToString(clone)], {
            type: "image/svg+xml",
          }),
        );
        try {
          const picture = await new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = () =>
              reject(new Error("Could not rasterize selection SVG"));
            image.src = url;
          });
          const canvas = document.createElement("canvas");
          canvas.width = viewport.width * factor;
          canvas.height = viewport.height * factor;
          const context = canvas.getContext("2d", { willReadFrequently: true });
          context.drawImage(picture, 0, 0);
          return context.getImageData(0, 0, canvas.width, canvas.height).data;
        } finally {
          URL.revokeObjectURL(url);
        }
      }
      const pixels = await raster();
      const failures = [];
      let visible = 0,
        hidden = 0,
        skipped = 0;
      for (const segment of segments) {
        const dx = segment.to.x - segment.from.x,
          dy = segment.to.y - segment.from.y;
        const screenLength = Math.hypot(dx, dy);
        const steps = Math.max(3, Math.ceil(screenLength / 4));
        const at = (t) =>
          segment.worldFrom.map(
            (value, axis) => value + (segment.worldTo[axis] - value) * t,
          );
        for (let index = 0; index < steps; index += 1) {
          const t = (index + 0.5) / steps;
          const hiddenPoint = occluded(at(t));
          // Ignore tiny transition neighborhoods; a shared edge can legitimately
          // retain half its stroke. Test hidden segment interiors away from joins.
          const margin = Math.min(0.08, 3 / screenLength);
          if (
            t < margin ||
            t > 1 - margin ||
            occluded(at(t - margin)) !== hiddenPoint ||
            occluded(at(t + margin)) !== hiddenPoint
          ) {
            skipped += 1;
            continue;
          }
          const px = Math.round(
            (segment.from.x + dx * t - viewport.x) * factor,
          );
          const py = Math.round(
            (segment.from.y + dy * t - viewport.y) * factor,
          );
          let cyan = false;
          for (let sy = py - 2; sy <= py + 2 && !cyan; sy += 1) {
            for (let sx = px - 2; sx <= px + 2; sx += 1) {
              if (
                sx < 0 ||
                sy < 0 ||
                sx >= viewport.width * factor ||
                sy >= viewport.height * factor
              )
                continue;
              const offset = (sy * viewport.width * factor + sx) * 4;
              const [r, g, b, a] = pixels.slice(offset, offset + 4);
              if (
                r < 55 &&
                g > 105 &&
                g < 185 &&
                b > 175 &&
                b > g + 35 &&
                a > 200
              ) {
                cyan = true;
                break;
              }
            }
          }
          if (hiddenPoint) hidden += 1;
          else visible += 1;
          if (cyan === hiddenPoint)
            failures.push(
              `${id}/${view}/${segment.name}@${t.toFixed(2)}: ${hiddenPoint ? "hidden edge shows cyan" : "visible edge missing cyan"}`,
            );
        }
      }
      let changedPixels = null;
      if (fullyCovered) {
        const baseline = await raster(true);
        changedPixels = 0;
        for (let offset = 0; offset < pixels.length; offset += 4) {
          if (
            [0, 1, 2, 3].some(
              (channel) =>
                pixels[offset + channel] !== baseline[offset + channel],
            )
          )
            changedPixels += 1;
        }
      }
      return { structure, visible, hidden, skipped, failures, changedPixels };
    },
    { id, view, fullyCovered },
  );
  assert.deepEqual(
    result.structure,
    {
      overlays: 1,
      polygons: 1,
      last: true,
      pointerEvents: "none",
      ariaHidden: "true",
      selectedId: id,
      sameEnvelope: true,
      masked: true,
      boxCount: expectedCount,
      uniqueBoxCount: expectedCount,
      internalEdges: view === "iso" ? 3 : 0,
    },
    `${id}/${view}: selection must be a single final, masked, non-interactive overlay`,
  );
  assert.ok(result.visible + result.hidden > 30);
  assert.deepEqual(
    result.failures,
    [],
    `${id}/${view}: highlights must follow independent 3D visibility`,
  );
  if (fullyCovered)
    assert.equal(
      result.changedPixels,
      0,
      `${id}/${view}: a fully hidden case must cause no highlight or antialias fringe`,
    );
  return result;
}

async function clickNeighbor(selectedId) {
  const target = await page.evaluate((id) => {
    const polygon = document.querySelector("#scene .box-selection");
    const vertices = [...polygon.points];
    for (let index = 0; index < vertices.length; index += 1) {
      const from = vertices[index],
        to = vertices[(index + 1) % vertices.length];
      for (const t of [0.2, 0.5, 0.8]) {
        const point = new DOMPoint(
          from.x + (to.x - from.x) * t,
          from.y + (to.y - from.y) * t,
        ).matrixTransform(polygon.getScreenCTM());
        // Browser input rounds subpixel pointer positions. Hit-test the same
        // integer pixel that the real click will use at a shared case edge.
        const x = Math.round(point.x),
          y = Math.round(point.y);
        const hit = document.elementFromPoint(x, y)?.closest("[data-box-id]");
        if (hit && hit.dataset.boxId !== id)
          return { id: hit.dataset.boxId, x, y, edge: true };
      }
    }
    for (const box of document.querySelectorAll("#scene [data-box-id]")) {
      if (box.dataset.boxId === id) continue;
      const badge = box.querySelector(".box-capacity").getBoundingClientRect();
      const x = Math.round(badge.x + badge.width / 2),
        y = Math.round(badge.y + badge.height / 2);
      const hit = document.elementFromPoint(x, y)?.closest("[data-box-id]");
      if (hit?.dataset.boxId === box.dataset.boxId)
        return { id: box.dataset.boxId, x, y, edge: false };
    }
    return null;
  }, selectedId);
  assert.ok(
    target,
    "A neighboring case must remain available for pointer selection",
  );
  await page.mouse.click(target.x, target.y);
  assert.equal(
    await page
      .locator(`#scene [data-box-id="${target.id}"]`)
      .getAttribute("aria-pressed"),
    "true",
    `Click ${target.x},${target.y} through ${selectedId}'s outline must select ${target.id}`,
  );
  return target.edge;
}

try {
  await page.goto(process.env.BASE_URL || "http://localhost:3000");
  await page.waitForSelector("#scene svg");
  await page.locator("#soccer-scale").check();
  await page.locator("#dimensions").check();
  let visibleSamples = 0;
  let hiddenSamples = 0;
  let edgeClicks = 0;
  for (const view of ["iso", "front", "top"]) {
    await page.locator(`button[data-view="${view}"]`).click();
    await page.keyboard.press("Escape");
    const initial = await cameraGeometry();
    for (const id of ["case-6", "case-5", "case-4"]) {
      await selectCase(id);
      const result = await inspectSelection(id, view, 8, view === "top");
      visibleSamples += result.visible;
      hiddenSamples += result.hidden;
      assert.deepEqual(
        await cameraGeometry(),
        initial,
        `${id}/${view}: selecting must preserve the camera and every case`,
      );
      if (await clickNeighbor(id)) edgeClicks += 1;
      assert.deepEqual(
        await cameraGeometry(),
        initial,
        `${id}/${view}: clicking a neighbor must preserve the camera`,
      );
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("#scene .scene-selection").count(), 0);
    }
  }
  assert.ok(
    edgeClicks > 0,
    "Neighbors must remain selectable through masked outline geometry",
  );
  assert.ok(visibleSamples > 100 && hiddenSamples > 100);

  await page.locator('button[data-view="iso"]').click();
  await page.locator("#human-scale").uncheck();
  await page.locator("#soccer-scale").uncheck();
  await page.locator("#dimensions").uncheck();
  await selectCase("case-6");
  await page.evaluate(() => document.activeElement?.blur());
  const clip = await page.evaluate(() => {
    const bounds = ["case-4", "case-5", "case-6", "case-7", "case-8"].map(
      (id) =>
        document
          .querySelector(`#scene [data-box-id="${id}"]`)
          .getBoundingClientRect(),
    );
    const x = Math.floor(Math.min(...bounds.map((box) => box.left)) - 22);
    const y = Math.floor(Math.min(...bounds.map((box) => box.top)) - 22);
    return {
      x,
      y,
      width: Math.ceil(Math.max(...bounds.map((box) => box.right)) + 22 - x),
      height: Math.ceil(Math.max(...bounds.map((box) => box.bottom)) + 22 - y),
    };
  });
  await mkdir("docs/media", { recursive: true });
  await page.screenshot({
    path: "docs/media/selection-detail.png",
    clip,
    animations: "disabled",
  });
  assert.deepEqual(errors, []);
  // A rear case can also be completely covered by an equal-size case in Front
  // view. Compare the entire raster with/without selection to catch AA fringes.
  const hiddenFront = {
    version: 1,
    units: "mm",
    boxes: [
      { id: "front-case", modelId: "40564", x: 0, y: 0, z: 0, rotated: false },
      { id: "rear-case", modelId: "40564", x: 0, y: 600, z: 0, rotated: false },
    ],
  };
  await page.locator("#import-file").setInputFiles({
    name: "hidden-front.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(hiddenFront)),
  });
  await page.waitForFunction(
    () => document.querySelector("#total-boxes").textContent === "2",
  );
  await page.locator('button[data-view="front"]').click();
  await selectCase("rear-case");
  await inspectSelection("rear-case", "front", 2, true);
  assert.deepEqual(errors, []);
  console.log(
    `PASS: ${visibleSamples} visible samples highlighted and ${hiddenSamples} hidden samples clear by independent 3D ray tests; fully covered Top/Front cases add zero pixels; ${edgeClicks} neighbor clicks pass through; camera and identities stay unchanged.`,
  );
} finally {
  await browser.close();
}
