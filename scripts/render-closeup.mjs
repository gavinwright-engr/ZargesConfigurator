// Focused renderer regression and reproducible documentation capture.
// Run against `npm start`: CHROMIUM_EXECUTABLE=/usr/bin/chromium node scripts/render-closeup.mjs
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const base = process.env.BASE_URL || "http://localhost:3000";
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_EXECUTABLE
    ? { executablePath: process.env.CHROMIUM_EXECUTABLE }
    : {}),
  args: ["--no-sandbox"],
});
const page = await browser.newPage({
  viewport: { width: 1600, height: 1400 },
  deviceScaleFactor: 1,
});
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));

try {
  await page.goto(base);
  await page.waitForSelector("#scene svg");
  const report = await page.evaluate(async () => {
    const { CATALOG, PRESET } = await import("./src/catalog.js");
    const { renderScene } = await import("./src/renderer.js");

    // Keep the real renderer and catalog, but remove app layout and event-driven
    // resizing from this fixture. The result is a crisp product-only close-up.
    document.head.innerHTML = `<meta charset="utf-8"><title>K 470 stack detail</title>
      <style>
        * { box-sizing: border-box; }
        html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; }
        body { background: #f5f7f9; }
        #fixture { width: 100vw; height: 100vh; }
        #fixture > svg { display: block; width: 100%; height: 100%; }
      </style>`;
    document.body.innerHTML =
      '<main id="fixture" aria-label="K 470 close-up"></main>';
    const fixture = document.querySelector("#fixture");
    const failures = [];

    function mount(boxes, view, crop = false) {
      fixture.innerHTML = renderScene(boxes, CATALOG, {
        view,
        humanScale: false,
        soccerScale: false,
        workspace: false,
        dimensions: false,
        labels: true,
      });
      if (crop) {
        const svg = fixture.querySelector("svg");
        const bounds = svg.querySelector(".scene-boxes").getBBox();
        const padding = 32;
        svg.setAttribute(
          "viewBox",
          [
            bounds.x - padding,
            bounds.y - padding,
            bounds.width + padding * 2,
            bounds.height + padding * 2,
          ].join(" "),
        );
      }
    }

    function cornersOfRect(rect) {
      const x = rect.x.baseVal.value;
      const y = rect.y.baseVal.value;
      const width = rect.width.baseVal.value;
      const height = rect.height.baseVal.value;
      return [
        [x, y],
        [x + width, y],
        [x + width, y + height],
        [x, y + height],
      ].map(([px, py]) =>
        new DOMPoint(px, py).matrixTransform(rect.getScreenCTM()),
      );
    }

    function intersects(a, b) {
      // Allow subpixel contact, but no positive rectangle overlap.
      return (
        Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.1 &&
        Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.1
      );
    }

    function insideConvexPolygon(point, vertices) {
      let sign = 0;
      for (let index = 0; index < vertices.length; index += 1) {
        const a = vertices[index];
        const b = vertices[(index + 1) % vertices.length];
        const cross =
          (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
        // One tenth of a CSS pixel accounts for SVG decimal serialization.
        if (Math.abs(cross) <= Math.hypot(b.x - a.x, b.y - a.y) * 0.1) continue;
        const nextSign = Math.sign(cross);
        if (sign && nextSign !== sign) return false;
        sign = nextSign;
      }
      return true;
    }

    function inspectCase(box, label) {
      const node = fixture.querySelector(`[data-box-id="${box.id}"]`);
      const capacity = node?.querySelector(".box-capacity rect");
      const brand = node?.querySelector(".box-badge rect");
      const front = node?.querySelector(".box-front");
      if (!capacity || !front) {
        failures.push(`${label}: missing capacity or front-face geometry`);
        return;
      }
      const capacityBounds = capacity.getBoundingClientRect();
      // Small faces may intentionally omit decorative branding to preserve a
      // readable capacity. Any badge that is drawn must remain unobstructed.
      if (brand && intersects(capacityBounds, brand.getBoundingClientRect())) {
        failures.push(`${label}: capacity label overlaps its ZARGES badge`);
      }
      const frontVertices = [...front.points].map((point) =>
        new DOMPoint(point.x, point.y).matrixTransform(front.getScreenCTM()),
      );
      if (
        !cornersOfRect(capacity).every((point) =>
          insideConvexPolygon(point, frontVertices),
        )
      ) {
        failures.push(
          `${label}: capacity label extends outside its front face`,
        );
      }
      const hit = document
        .elementFromPoint(
          capacityBounds.x + capacityBounds.width / 2,
          capacityBounds.y + capacityBounds.height / 2,
        )
        ?.closest("[data-box-id]");
      if (hit?.dataset.boxId !== box.id) {
        failures.push(
          `${label}: its capacity center is covered by ${hit?.dataset.boxId || "no case"}`,
        );
      }
    }

    let modelViews = 0;
    for (const model of CATALOG) {
      for (const view of ["iso", "front"]) {
        for (const rotated of [false, true]) {
          const box = {
            id: "test-case",
            modelId: model.id,
            x: 0,
            y: 0,
            z: 0,
            rotated,
          };
          mount([box], view);
          inspectCase(
            box,
            `${model.id} (${model.label}), ${view}, ${rotated ? "90°" : "0°"}`,
          );
          modelViews += 1;
        }
      }
    }

    // The specific five-case arrangement that exposed the original clash.
    const rightStack = PRESET.filter((box) => box.x >= 1550);
    mount(rightStack, "iso", true);
    for (const box of rightStack)
      inspectCase(box, `Reference right stack ${box.id}`);
    const capacities = [...fixture.querySelectorAll(".box-capacity rect")];
    const brands = [...fixture.querySelectorAll(".box-badge rect")];
    for (let index = 0; index < capacities.length; index += 1) {
      const rect = capacities[index].getBoundingClientRect();
      if (
        capacities
          .slice(index + 1)
          .some((other) => intersects(rect, other.getBoundingClientRect()))
      ) {
        failures.push("Reference right stack: two capacity labels overlap");
      }
      if (
        brands.some((other) => intersects(rect, other.getBoundingClientRect()))
      ) {
        failures.push(
          "Reference right stack: a capacity label overlaps a brand badge",
        );
      }
    }
    return {
      models: CATALOG.length,
      modelViews,
      rightStackCases: rightStack.length,
      failures,
    };
  });

  // Capture even if an assertion fails, so a regression has a visual artifact.
  await mkdir("docs/media", { recursive: true });
  await page.screenshot({
    path: "docs/media/stack-detail.png",
    animations: "disabled",
  });
  assert.equal(
    report.models,
    25,
    "The regression must cover the full standard catalog",
  );
  assert.equal(
    report.modelViews,
    100,
    "Check both views and both orientations for each model",
  );
  assert.equal(report.rightStackCases, 5);
  assert.deepEqual(report.failures, [], report.failures.join("\n"));
  assert.deepEqual(errors, []);
  console.log(
    "PASS: all 25 models in 3D/front and both rotations keep capacity labels on their front face, clear of brand badges; five-case right-stack close-up captured without label or hit-target clashes.",
  );
} finally {
  await browser.close();
}
