// End-to-end checks against a running `npm start` server. This exercises the UI,
// real pointer events, downloads, shared links, imports, and mobile overflow.
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const base = process.env.BASE_URL || "http://localhost:3000";
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_EXECUTABLE
    ? { executablePath: process.env.CHROMIUM_EXECUTABLE }
    : {}),
  args: ["--no-sandbox"],
});
const context = await browser.newContext({
  viewport: { width: 1500, height: 1125 },
  permissions: ["clipboard-read", "clipboard-write"],
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const state = () =>
  page.evaluate(
    () => JSON.parse(localStorage.getItem("zarges-stack-planner:v1")).boxes,
  );
async function count(n) {
  // Imports read File.text() asynchronously; wait for the committed UI state.
  await page.waitForFunction(
    (expected) =>
      document.querySelector("#total-boxes")?.textContent === String(expected),
    n,
    { timeout: 5000 },
  );
  assert.equal(await page.locator("#total-boxes").textContent(), String(n));
}
async function worldPoint(x, y, z = 0) {
  return page.evaluate(
    async ({ x, y, z }) => {
      const { getSceneTransform } = await import("./src/renderer.js");
      const { CATALOG } = await import("./src/catalog.js");
      const boxes = JSON.parse(
        localStorage.getItem("zarges-stack-planner:v1"),
      ).boxes;
      const view = document.querySelector("button[data-view].active").dataset
        .view;
      const humanScale = document.querySelector("#human-scale").checked;
      const soccerScale = document.querySelector("#soccer-scale").checked;
      const p = getSceneTransform(boxes, CATALOG, view, {
        humanScale,
        soccerScale,
      }).project(x, y, z);
      const client = new DOMPoint(p.x, p.y).matrixTransform(
        document.querySelector("#scene svg").getScreenCTM(),
      );
      return { x: client.x, y: client.y };
    },
    { x, y, z },
  );
}
async function dragWorld(from, to) {
  const a = await worldPoint(...from),
    b = await worldPoint(...to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 20 });
  await page.mouse.up();
}
async function captureScreenshot(name) {
  // Documentation should show the settled UI, without transient toast/focus UI.
  await page.waitForFunction(
    () => !document.querySelector("#toast")?.classList.contains("visible"),
    null,
    { timeout: 6000 },
  );
  await page.evaluate(() => {
    document.activeElement?.blur();
    document.querySelector("#catalog-list").scrollTop = 0;
  });
  await page.screenshot({
    path: `docs/media/${name}.png`,
    fullPage: true,
    animations: "disabled",
  });
}

// Inspect actual polygon vertices in browser pixels. A selected outline has a
// larger bounding box by design, so comparing whole case bounding boxes would
// mistake its highlight for a camera change.
async function sceneGeometry() {
  return page.evaluate(() => {
    const round = (value) => Number(value.toFixed(3));
    const canvas = document
      .querySelector("#canvas-wrap")
      .getBoundingClientRect();
    const svg = document.querySelector("#scene svg");
    const matrix = svg.getScreenCTM();
    const boxes = {};
    for (const box of svg.querySelectorAll("[data-box-id]")) {
      const polygon = box.querySelector("polygon");
      boxes[box.dataset.boxId] = [...polygon.points].map((point) => {
        const screen = new DOMPoint(point.x, point.y).matrixTransform(
          polygon.getScreenCTM(),
        );
        return [round(screen.x), round(screen.y)];
      });
    }
    return {
      canvas: [canvas.x, canvas.y, canvas.width, canvas.height].map(round),
      matrix: [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f].map(
        round,
      ),
      boxes,
    };
  });
}

async function assertStableSelection(width) {
  await page.setViewportSize({ width, height: 1125 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.keyboard.press("Escape");
  const initial = await sceneGeometry();
  const originalPlan = await state();
  for (const id of Object.keys(initial.boxes)) {
    // Use the visible capacity badge's center for a genuine physical click.
    // This also catches wrong SVG painter order that hides a case behind its
    // neighbor: the clicked case must be the one that becomes selected.
    const badge = await page
      .locator(`#scene [data-box-id="${id}"] .box-capacity`)
      .boundingBox();
    assert.ok(badge, `Case ${id} must have a visible badge at ${width}px`);
    await page.mouse.click(
      badge.x + badge.width / 2,
      badge.y + badge.height / 2,
    );
    assert.equal(
      await page
        .locator(`#scene [data-box-id="${id}"]`)
        .getAttribute("aria-pressed"),
      "true",
      `Clicking case ${id} must select that case at ${width}px`,
    );
    const selected = await sceneGeometry();
    assert.deepEqual(
      selected.canvas,
      initial.canvas,
      `Inspector content must not resize the canvas at ${width}px`,
    );
    assert.deepEqual(
      selected.matrix,
      initial.matrix,
      `Selecting ${id} must not change SVG fitting at ${width}px`,
    );
    for (const otherId of Object.keys(initial.boxes).filter(
      (other) => other !== id,
    )) {
      assert.deepEqual(
        selected.boxes[otherId],
        initial.boxes[otherId],
        `Selecting ${id} must not move case ${otherId} at ${width}px`,
      );
    }
    await page.keyboard.press("Escape");
    assert.deepEqual(
      await sceneGeometry(),
      initial,
      `Deselecting ${id} must preserve the camera at ${width}px`,
    );
  }
  assert.deepEqual(
    await state(),
    originalPlan,
    "Selecting cases must not alter their saved coordinates",
  );
}

async function assertHumanScale() {
  const person = page.locator('#scene [data-person-height-mm="1828.8"]');
  assert.equal(await page.locator("#human-scale").isChecked(), true);
  assert.equal(
    await person.count(),
    1,
    "The default scene must include one true six-foot reference",
  );
  assert.ok(await person.isVisible());
  const heightError = await page.evaluate(async () => {
    const { getSceneTransform } = await import("./src/renderer.js");
    const { CATALOG } = await import("./src/catalog.js");
    const boxes = JSON.parse(
      localStorage.getItem("zarges-stack-planner:v1"),
    ).boxes;
    const view = document.querySelector("button[data-view].active").dataset
      .view;
    const transform = getSceneTransform(boxes, CATALOG, view, {
      humanScale: true,
    });
    const figure = document.querySelector("#scene .human-figure");
    const actualPixels = figure.getBoundingClientRect().height;
    const expectedPixels =
      1828.8 *
      transform.scale *
      document.querySelector("#scene svg").getScreenCTM().d;
    return Math.abs(actualPixels - expectedPixels);
  });
  assert.ok(
    heightError < 0.1,
    "Person artwork must be 1828.8 mm tall in the same projection as the cases",
  );
  const withPerson = await sceneGeometry();
  await page.locator("#human-scale").uncheck();
  assert.equal(await page.locator("#scene [data-person-height-mm]").count(), 0);
  await page.locator("#human-scale").check();
  assert.equal(await person.count(), 1);
  assert.deepEqual(
    await sceneGeometry(),
    withPerson,
    "Re-enabling the scale figure must restore the same camera",
  );
}

async function assertSoccerScale() {
  const before = await state();
  const initialCamera = await sceneGeometry();
  assert.equal(
    await page.locator("#scene [data-soccer-diameter-mm]").count(),
    0,
  );
  await page.locator("#soccer-scale").check();
  assert.equal(
    await page.locator('#scene [data-soccer-diameter-mm="220"]').count(),
    1,
  );
  for (const view of ["iso", "front", "top"]) {
    await page.locator(`button[data-view="${view}"]`).click();
    const diameterErrors = await page.evaluate(async () => {
      const { getSceneTransform } = await import("./src/renderer.js");
      const { CATALOG } = await import("./src/catalog.js");
      const boxes = JSON.parse(
        localStorage.getItem("zarges-stack-planner:v1"),
      ).boxes;
      const view = document.querySelector("button[data-view].active").dataset
        .view;
      const humanScale = document.querySelector("#human-scale").checked;
      const t = getSceneTransform(boxes, CATALOG, view, {
        humanScale,
        soccerScale: true,
      });
      const bounds = document
        .querySelector("#scene .soccer-outline")
        .getBoundingClientRect();
      const expected =
        220 * t.scale * document.querySelector("#scene svg").getScreenCTM().a;
      return [
        Math.abs(bounds.width - expected),
        Math.abs(bounds.height - expected),
      ];
    });
    assert.ok(
      diameterErrors.every((error) => error < 0.1),
      "Soccer ball must have a 220 mm diameter in every view",
    );
  }
  await page.locator('button[data-view="iso"]').click();
  await page.locator("#human-scale").uncheck();
  assert.equal(
    await page.locator('#scene [data-soccer-diameter-mm="220"]').count(),
    1,
    "Ball and person toggle independently",
  );
  await page.locator("#human-scale").check();
  await page.locator("#soccer-scale").uncheck();
  assert.deepEqual(await sceneGeometry(), initialCamera);
  assert.deepEqual(
    await state(),
    before,
    "Scale objects never enter the order or saved plan",
  );
}
try {
  await page.goto(base);
  await page.waitForSelector("#scene svg");
  await count(8);
  assert.match(await page.locator("#total-volume").textContent(), /567/);
  assert.equal(await page.locator("#total-weight").textContent(), "47.4 kg");
  assert.equal(await page.locator("#catalog-count").textContent(), "25");
  assert.equal(await page.locator(".case-card").count(), 25);
  await page.locator('[data-catalog="reference"]').click();
  assert.equal(await page.locator(".case-card").count(), 6);
  await page.locator('[data-catalog="all"]').click();
  assert.equal(await page.locator(".case-card").count(), 25);
  await page.locator("#search").fill("40847");
  assert.equal(await page.locator(".case-card").count(), 1);
  await page.locator("#search").fill("");
  await page.locator('[data-unit="in"]').click();
  assert.match(
    await page.locator('[data-model="40810"] .case-info p').textContent(),
    /23.62 × 15.75 × 7.09 in/,
  );
  await page.locator('[data-unit="mm"]').click();
  await assertHumanScale();
  await assertSoccerScale();
  for (const width of [1200, 1500, 1900]) await assertStableSelection(width);
  await page.setViewportSize({ width: 1500, height: 1125 });

  // The full range must work beyond the six reference models, including the
  // largest standard case. Exercise the same save/import path used by users.
  await page.locator("#search").fill("829");
  assert.equal(await page.locator(".case-card").count(), 1);
  assert.equal(
    await page.locator(".case-card").getAttribute("data-model"),
    "40876",
  );
  await page
    .getByRole("button", { name: "Add 829 L case", exact: true })
    .click();
  await count(9);
  assert.equal(
    (await state()).filter((box) => box.modelId === "40876").length,
    1,
  );
  const expandedSave = page.waitForEvent("download");
  await page.locator('[data-action="save"]').click();
  const expandedJson = await readFile(
    await (await expandedSave).path(),
    "utf8",
  );
  await page.locator('[data-action="clear"]').click();
  await count(0);
  await page.locator("#import-file").setInputFiles({
    name: "full-catalog-plan.json",
    mimeType: "application/json",
    buffer: Buffer.from(expandedJson),
  });
  await count(9);
  assert.equal(
    (await state()).find((box) => box.modelId === "40876").rotated,
    false,
  );
  await page.reload();
  await page.waitForSelector("#scene svg");
  await count(9);
  assert.equal(
    (await state()).filter((box) => box.modelId === "40876").length,
    1,
  );
  await page.locator('[data-action="reset"]').first().click();
  await count(8);
  await page.locator("#search").fill("");
  await page.locator("#dimensions").check();
  await page.locator('button[data-view="front"]').click();
  await page.locator('button[data-view="iso"]').click();
  await page.locator("#dimensions").uncheck();
  await mkdir("docs/media", { recursive: true });
  await page.locator("#soccer-scale").check();
  await captureScreenshot("desktop");
  await page.locator("#soccer-scale").uncheck();

  // Removing a load-bearing base must be blocked, not silently orphan children.
  await page.locator('#scene [data-box-id="case-4"]').click();
  await page.getByRole("button", { name: "Remove selected case" }).click();
  await count(8);
  assert.match(await page.locator("#toast").textContent(), /unsupported/);
  await page.locator('#scene [data-box-id="case-8"]').click();
  await page.getByRole("button", { name: "Remove selected case" }).click();
  await count(7);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await count(8);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await count(7);
  await page.locator('[data-action="reset"]').first().click();
  await count(8);

  // Actual pointer drag: move a separately-added 29 L onto the 73 L base.
  await page.locator('[data-action="clear"]').click();
  await count(0);
  await page
    .getByRole("button", { name: "Add 73 L case", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Add 29 L case", exact: true })
    .click();
  await page.locator('button[data-view="top"]').click();
  await dragWorld([1000, 200, 0], [300, 200, 0]);
  const stacked = (await state()).find((box) => box.modelId === "40810");
  assert.deepEqual([stacked.x, stacked.y, stacked.z], [0, 0, 410]);
  await page.reload();
  await page.waitForSelector("#scene svg");
  await count(2);

  // Start on the front capacity badge, then release on another case's lid.
  // This crosses elevation planes and exercises the 3D surface-hit fallback.
  await page.locator('[data-action="clear"]').click();
  await page
    .getByRole("button", { name: "Add 73 L case", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Add 73 L case", exact: true })
    .click();
  const [isoBase, isoMoving] = await state();
  await dragWorld([1000, -8, 143.5], [300, 200, 410]);
  let moved = (await state()).find((box) => box.id === isoMoving.id);
  assert.deepEqual(
    [moved.x, moved.y, moved.z],
    [0, 0, 410],
    "Dragging a front badge onto a lid must change the support plane",
  );

  // Operate selection and explicit placement entirely from keyboard focus.
  // A native select plus a real button provide stacking without pointer drags.
  const movingNode = page.locator(`#scene [data-box-id="${isoMoving.id}"]`);
  await movingNode.focus();
  await page.keyboard.press("Enter");
  assert.equal(await movingNode.getAttribute("aria-pressed"), "true");
  await page.locator("#surface-target").focus();
  await page.keyboard.press("Home");
  await page.getByRole("button", { name: "Place on", exact: true }).focus();
  await page.keyboard.press("Enter");
  moved = (await state()).find((box) => box.id === isoMoving.id);
  assert.equal(
    moved.z,
    0,
    "Keyboard placement can return an upper case to the floor",
  );
  await page.locator("#surface-target").focus();
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowDown");
  assert.equal(await page.locator("#surface-target").inputValue(), isoBase.id);
  await page.getByRole("button", { name: "Place on", exact: true }).focus();
  await page.keyboard.press("Enter");
  moved = (await state()).find((box) => box.id === isoMoving.id);
  assert.deepEqual(
    [moved.x, moved.y, moved.z],
    [0, 0, 410],
    "Keyboard placement must build a supported stack",
  );

  // Build the large base plus two rotated small cases via native catalog drops.
  await page.locator('[data-action="clear"]').click();
  await page
    .getByRole("button", { name: "Add 157 L case", exact: true })
    .click();
  await page.locator('button[data-view="top"]').click();
  async function catalogDrop(modelId, x, y, z) {
    const card = page.locator(`[data-model="${modelId}"]`);
    await card.scrollIntoViewIfNeeded();
    const p = await worldPoint(x, y, z);
    const bounds = await card.boundingBox();
    await page.mouse.move(bounds.x + 25, bounds.y + 25);
    await page.mouse.down();
    await page.mouse.move(bounds.x + 40, bounds.y + 30, { steps: 5 });
    await page.mouse.move(p.x, p.y, { steps: 20 });
    await page.mouse.up();
  }
  await catalogDrop("40564", 200, 300, 410);
  await count(2);
  await catalogDrop("40678", 600, 300, 410);
  await count(3);
  const mixed = await state();
  assert.deepEqual(
    mixed
      .filter((box) => box.modelId !== "40565")
      .map((box) => [box.x, box.y, box.z, box.rotated]),
    [
      [0, 0, 410, true],
      [400, 0, 410, true],
    ],
  );

  // CSV + JSON downloads and validated import use the exact same current plan.
  const csvPromise = page.waitForEvent("download");
  await page.locator('[data-action="export"]').click();
  const csv = await readFile(await (await csvPromise).path(), "utf8");
  assert.match(csv, /40565/);
  assert.match(csv, /40564/);
  const jsonPromise = page.waitForEvent("download");
  await page.locator('[data-action="save"]').click();
  const json = await readFile(await (await jsonPromise).path(), "utf8");
  assert.equal(JSON.parse(json).boxes.length, 3);
  await page.locator('[data-action="clear"]').click();
  await page.locator("#import-file").setInputFiles({
    name: "saved.json",
    mimeType: "application/json",
    buffer: Buffer.from(json),
  });
  await count(3);
  await page.locator("#import-file").setInputFiles({
    name: "bad.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"version":7}'),
  });
  await count(3);
  assert.match(
    await page.locator("#toast").textContent(),
    /Could not open plan/,
  );
  await page.locator('[data-action="share"]').click();
  const sharedUrl = await page.evaluate(() => navigator.clipboard.readText());
  assert.ok(sharedUrl.includes("#plan="));
  const sharedPage = await context.newPage();
  await sharedPage.goto(sharedUrl);
  await sharedPage.waitForSelector("#scene svg");
  assert.equal(await sharedPage.locator("#total-boxes").textContent(), "3");
  await sharedPage.close();

  await page.locator('[data-action="reset"]').first().click();
  await page.locator('button[data-view="top"]').click();
  await page.locator("#dimensions").check();
  assert.ok(
    await page.evaluate(() => {
      const canvas = document
        .querySelector("#canvas-wrap")
        .getBoundingClientRect();
      return [
        ...document.querySelectorAll("#scene .scene-dimensions text"),
      ].every((node) => {
        const text = node.getBoundingClientRect();
        return text.left >= canvas.left && text.right <= canvas.right;
      });
    }),
    "Top-view dimension labels must stay inside the canvas",
  );
  await captureScreenshot("top-view");
  await page.locator('button[data-view="iso"]').click();
  await page.locator("#dimensions").uncheck();
  await page.locator('[data-action="fit-details"]').click();
  assert.equal(
    await page.locator("dialog").evaluate((node) => node.open),
    true,
  );
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "Mobile must not overflow horizontally",
  );
  await assertHumanScale();
  await page.locator("#human-scale").uncheck();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "Mobile must not overflow with the scale figure hidden",
  );
  await page.locator("#human-scale").check();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "Mobile must not overflow with the six-foot reference visible",
  );
  await page.locator("#soccer-scale").check();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "Mobile must not overflow with both scale references visible",
  );
  await captureScreenshot("mobile");
  await page
    .getByRole("button", { name: "Add 29 L case", exact: true })
    .click();
  await count(9);
  await page.locator('[data-action="reset"]').first().click();
  await count(8);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: initial preset, full 25-model catalog/filter/search, extra-model save/import/persistence, six-foot person and 220 mm soccer-ball toggles, stable selection cameras at 1200/1500/1900px, units/views, support blocking, undo/redo, pointer stacking, isometric badge-to-lid dragging, keyboard surface placement, mixed-footprint catalog drops, CSV/JSON, import rejection, sharing, mobile scale/layout/actions, no browser errors.",
  );
} finally {
  await browser.close();
}
