// Selection must remain visible above neighboring cases without intercepting
// input or changing the camera. Rasterize the actual browser SVG to check every
// outline segment, including the three visible internal cube edges in 3D.
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
    const canvas = document.querySelector("#canvas-wrap").getBoundingClientRect();
    const round = (number) => Number(number.toFixed(3));
    return {
      canvas: [canvas.x, canvas.y, canvas.width, canvas.height].map(round),
      matrix: [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f].map(round),
      boxes: [...svg.querySelectorAll("[data-box-id]")].map((box) => ({
        id: box.dataset.boxId,
        envelope: box.querySelector(".box-envelope").getAttribute("points"),
      })),
    };
  });
}

async function inspectSelection(id, view) {
  const result = await page.evaluate(async ({ id, view }) => {
    const svg = document.querySelector("#scene svg");
    const overlay = svg.querySelector(".scene-selection");
    const polygon = overlay?.querySelector(".box-selection");
    const envelope = svg.querySelector(`[data-box-id="${id}"] .box-envelope`);
    const boxIds = [...svg.querySelectorAll("[data-box-id]")].map((box) => box.dataset.boxId);
    const structure = {
      overlays: svg.querySelectorAll(".scene-selection").length,
      polygons: svg.querySelectorAll(".box-selection").length,
      last: svg.lastElementChild === overlay,
      pointerEvents: overlay && getComputedStyle(overlay).pointerEvents,
      ariaHidden: overlay?.getAttribute("aria-hidden"),
      selectedId: overlay?.dataset.selectedBoxId,
      sameEnvelope: polygon?.getAttribute("points") === envelope?.getAttribute("points"),
      boxCount: boxIds.length,
      uniqueBoxCount: new Set(boxIds).size,
      internalEdges: overlay?.querySelectorAll(".box-selection-edge").length,
    };
    if (!polygon) return { structure, samples: 0, missing: ["Missing selection polygon"] };

    const vertices = [...polygon.points].map((point) => ({ x: point.x, y: point.y }));
    const segments = vertices.map((from, index) => ({
      from, to: vertices[(index + 1) % vertices.length], name: `hull-${index}`,
    }));
    for (const [index, line] of [...overlay.querySelectorAll(".box-selection-edge")].entries()) {
      segments.push({
        from: { x: line.x1.baseVal.value, y: line.y1.baseVal.value },
        to: { x: line.x2.baseVal.value, y: line.y2.baseVal.value },
        name: `visible-edge-${index}`,
      });
    }

    // Render the exact scene markup, with all neighboring cases, labels,
    // dimensions and reference objects still present. Only raster resolution
    // changes; no elements are hidden or reordered for this assertion.
    const factor = 2;
    const box = svg.viewBox.baseVal;
    const clone = svg.cloneNode(true);
    clone.setAttribute("width", box.width * factor);
    clone.setAttribute("height", box.height * factor);
    const url = URL.createObjectURL(new Blob(
      [new XMLSerializer().serializeToString(clone)],
      { type: "image/svg+xml" },
    ));
    let picture;
    try {
      picture = await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("Could not rasterize selection SVG"));
        image.src = url;
      });
      const canvas = document.createElement("canvas");
      canvas.width = box.width * factor;
      canvas.height = box.height * factor;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(picture, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const missing = [];
      let samples = 0;
      for (const segment of segments) {
        const dx = segment.to.x - segment.from.x;
        const dy = segment.to.y - segment.from.y;
        const steps = Math.max(3, Math.ceil(Math.hypot(dx, dy) / 4));
        for (let index = 0; index < steps; index += 1) {
          const t = (index + 0.5) / steps;
          const x = Math.round((segment.from.x + dx * t - box.x) * factor);
          const y = Math.round((segment.from.y + dy * t - box.y) * factor);
          let cyan = false;
          // A small neighborhood allows subpixel antialiasing while demanding
          // a strong blue stroke, not just a faint selection shadow.
          for (let py = y - 2; py <= y + 2 && !cyan; py += 1) {
            for (let px = x - 2; px <= x + 2; px += 1) {
              if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) continue;
              const offset = (py * canvas.width + px) * 4;
              const [r, g, b, a] = pixels.slice(offset, offset + 4);
              if (r < 55 && g > 105 && g < 185 && b > 175 && b > g + 35 && a > 200) {
                cyan = true;
                break;
              }
            }
          }
          samples += 1;
          if (!cyan) missing.push(`${id}/${view}/${segment.name}@${t.toFixed(2)}`);
        }
      }
      return { structure, samples, missing };
    } finally {
      URL.revokeObjectURL(url);
    }
  }, { id, view });
  assert.deepEqual(result.structure, {
    overlays: 1, polygons: 1, last: true, pointerEvents: "none", ariaHidden: "true",
    selectedId: id, sameEnvelope: true, boxCount: 8, uniqueBoxCount: 8,
    internalEdges: view === "iso" ? 3 : 0,
  }, `${id}/${view}: selection must be a single final, non-interactive overlay`);
  assert.ok(result.samples > 30);
  assert.deepEqual(result.missing, [], `${id}/${view}: every outline segment must remain visibly cyan`);
  return result.samples;
}

async function clickNeighbor(selectedId) {
  const target = await page.evaluate((id) => {
    const polygon = document.querySelector("#scene .box-selection");
    const vertices = [...polygon.points];
    for (let index = 0; index < vertices.length; index += 1) {
      const from = vertices[index], to = vertices[(index + 1) % vertices.length];
      for (const t of [0.2, 0.5, 0.8]) {
        const point = new DOMPoint(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t)
          .matrixTransform(polygon.getScreenCTM());
        // Browser input rounds subpixel pointer positions. Hit-test the same
        // integer pixel that the real click will use at a shared case edge.
        const x = Math.round(point.x), y = Math.round(point.y);
        const hit = document.elementFromPoint(x, y)?.closest("[data-box-id]");
        if (hit && hit.dataset.boxId !== id) return { id: hit.dataset.boxId, x, y, edge: true };
      }
    }
    for (const box of document.querySelectorAll("#scene [data-box-id]")) {
      if (box.dataset.boxId === id) continue;
      const badge = box.querySelector(".box-capacity").getBoundingClientRect();
      const x = Math.round(badge.x + badge.width / 2), y = Math.round(badge.y + badge.height / 2);
      const hit = document.elementFromPoint(x, y)?.closest("[data-box-id]");
      if (hit?.dataset.boxId === box.dataset.boxId) return { id: box.dataset.boxId, x, y, edge: false };
    }
    return null;
  }, selectedId);
  assert.ok(target, "A neighboring case must remain available for pointer selection");
  await page.mouse.click(target.x, target.y);
  assert.equal(
    await page.locator(`#scene [data-box-id="${target.id}"]`).getAttribute("aria-pressed"),
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
  let samples = 0;
  let edgeClicks = 0;
  for (const view of ["iso", "front", "top"]) {
    await page.locator(`button[data-view="${view}"]`).click();
    await page.keyboard.press("Escape");
    const initial = await cameraGeometry();
    for (const id of ["case-6", "case-5", "case-4"]) {
      await selectCase(id);
      samples += await inspectSelection(id, view);
      assert.deepEqual(await cameraGeometry(), initial, `${id}/${view}: selecting must preserve the camera and every case`);
      if (await clickNeighbor(id)) edgeClicks += 1;
      assert.deepEqual(await cameraGeometry(), initial, `${id}/${view}: clicking a neighbor must preserve the camera`);
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("#scene .scene-selection").count(), 0);
    }
  }
  assert.ok(edgeClicks > 0, "At least one neighbor must be selected through a visible outline edge");

  await page.locator('button[data-view="iso"]').click();
  await page.locator("#human-scale").uncheck();
  await page.locator("#soccer-scale").uncheck();
  await page.locator("#dimensions").uncheck();
  await selectCase("case-6");
  await page.evaluate(() => document.activeElement?.blur());
  const clip = await page.evaluate(() => {
    const bounds = ["case-4", "case-5", "case-6", "case-7", "case-8"].map((id) => (
      document.querySelector(`#scene [data-box-id="${id}"]`).getBoundingClientRect()
    ));
    const x = Math.floor(Math.min(...bounds.map((box) => box.left)) - 22);
    const y = Math.floor(Math.min(...bounds.map((box) => box.top)) - 22);
    return {
      x, y,
      width: Math.ceil(Math.max(...bounds.map((box) => box.right)) + 22 - x),
      height: Math.ceil(Math.max(...bounds.map((box) => box.bottom)) + 22 - y),
    };
  });
  await mkdir("docs/media", { recursive: true });
  await page.screenshot({ path: "docs/media/selection-detail.png", clip, animations: "disabled" });
  assert.deepEqual(errors, []);
  console.log(`PASS: ${samples} cyan outline samples across three selected cases and three views; all outer/visible cube edges remain above scene artwork; ${edgeClicks} clicks pass through outline edges; camera and case identities stay unchanged.`);
} finally {
  await browser.close();
}
