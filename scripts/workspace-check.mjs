// Exercise real pointer moves and the saved-plan migration against npm start.
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { CATALOG, PRESET } from "../src/catalog.js";
import { inspectLayout } from "../src/stacking.js";
import { validateWorkspace } from "../src/workspace.js";

const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_EXECUTABLE
    ? { executablePath: process.env.CHROMIUM_EXECUTABLE }
    : {}),
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1500, height: 1125 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const state = () =>
  page.evaluate(
    () => JSON.parse(localStorage.getItem("zarges-stack-planner:v1")).boxes,
  );
async function point(x, y, z = 0) {
  return page.evaluate(
    async ({ x, y, z }) => {
      const { CATALOG } = await import("./src/catalog.js");
      const { getSceneTransform } = await import("./src/renderer.js");
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
      const q = new DOMPoint(p.x, p.y).matrixTransform(
        document.querySelector("#scene svg").getScreenCTM(),
      );
      return { x: q.x, y: q.y };
    },
    { x, y, z },
  );
}
async function drag(from, to) {
  const a = await point(...from),
    b = await point(...to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 20 });
  await page.mouse.up();
}
async function catalogDrop(modelId, x, y, z = 0) {
  const card = page.locator(`[data-model="${modelId}"]`);
  await card.scrollIntoViewIfNeeded();
  const bounds = await card.boundingBox();
  const target = await point(x, y, z);
  await page.mouse.move(bounds.x + 25, bounds.y + 25);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 40, bounds.y + 30, { steps: 5 });
  await page.mouse.move(target.x, target.y, { steps: 20 });
  await page.mouse.up();
  await page.waitForFunction(
    () => document.querySelector("#total-boxes").textContent === "9",
    null,
    { timeout: 5000 },
  );
}
try {
  await page.goto(process.env.BASE_URL || "http://localhost:3000");
  await page.waitForSelector("#scene svg");
  await page.locator('button[data-view="top"]').click();
  const initial = await state();
  for (const destination of [
    [1750, 2050, 0],
    // The dragged case is 600 mm deep: this center puts its front at -950 mm.
    [1750, -650, 0],
    [-600, 300, 0],
    [4700, 300, 0],
  ]) {
    await drag([1750, 300, 1000], destination);
    assert.deepEqual(
      await state(),
      initial,
      "A distant or out-of-bounds pointer drop must leave the plan intact",
    );
    assert.match(await page.locator("#toast").textContent(), /work area/);
  }
  // A move to adjacent clear floor is still usable and undoable.
  await drag([1750, 300, 1000], [1750, 950, 0]);
  let moved = (await state()).find((box) => box.id === "case-7");
  assert.equal(moved.z, 0);
  assert.ok(moved.y >= 600 && moved.y <= 700);
  assert.equal(validateWorkspace(await state(), CATALOG).valid, true);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  assert.deepEqual(await state(), initial);

  // The same case can now occupy the clear floor in front of the reference
  // stacks. Negative y is useful workspace, not an automatic bounds failure.
  await drag([1750, 300, 1000], [1750, -400, 0]);
  moved = (await state()).find((box) => box.id === "case-7");
  assert.equal(moved.z, 0);
  assert.ok(
    Math.abs(moved.y + 700) < 1,
    "Front move should place the case near y=-700 mm",
  );
  assert.equal(validateWorkspace(await state(), CATALOG).valid, true);
  assert.equal(inspectLayout(await state(), CATALOG).valid, true);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  assert.deepEqual(await state(), initial);

  // Use an actual HTML drag from the catalog, rather than synthesizing a drop
  // event, to verify that browser hit testing reaches the newly usable floor.
  await catalogDrop("40810", 300, -300);
  const withFrontCase = await state();
  const frontCase = withFrontCase.find(
    (box) => !initial.some((original) => original.id === box.id),
  );
  assert.equal(frontCase.modelId, "40810");
  assert.equal(frontCase.z, 0);
  assert.ok(
    frontCase.y < 0,
    "The new catalog case must occupy front floor space",
  );
  assert.equal(validateWorkspace(withFrontCase, CATALOG).valid, true);
  assert.equal(inspectLayout(withFrontCase, CATALOG).valid, true);
  assert.deepEqual(
    withFrontCase.filter((box) => box.id !== frontCase.id),
    initial,
  );
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  assert.deepEqual(await state(), initial);

  // Repeat the real drop in the default 3D view, where projection and hit
  // testing differ, then confirm reloading preserves the negative-y case.
  await page.locator('button[data-view="iso"]').click();
  await catalogDrop("40810", 300, -450);
  const isoFrontPlan = await state();
  const isoFrontCase = isoFrontPlan.find(
    (box) => !initial.some((original) => original.id === box.id),
  );
  assert.equal(isoFrontCase.modelId, "40810");
  assert.equal(isoFrontCase.z, 0);
  assert.ok(isoFrontCase.y < 0, "A 3D catalog drop must reach the front floor");
  assert.equal(validateWorkspace(isoFrontPlan, CATALOG).valid, true);
  assert.equal(inspectLayout(isoFrontPlan, CATALOG).valid, true);
  await page.reload();
  await page.waitForSelector("#scene svg");
  assert.deepEqual(
    await state(),
    isoFrontPlan,
    "Reload must retain a valid front-floor position",
  );
  await page.locator("#human-scale").uncheck();
  await page.locator("#soccer-scale").uncheck();
  await page.locator('button[data-view="iso"]').click();
  await page.keyboard.press("Escape");
  await page.waitForFunction(
    () => !document.querySelector("#toast").classList.contains("visible"),
  );
  await page.evaluate(() => {
    document.activeElement?.blur();
    document.querySelector("#catalog-list").scrollTop = 0;
    window.scrollTo(0, 0);
  });
  await mkdir("docs/media", { recursive: true });
  await page.screenshot({
    path: "docs/media/front-placement.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.locator('[data-action="reset"]').first().click();
  assert.deepEqual(await state(), initial);

  const far = [
    ...PRESET,
    { id: "distant", modelId: "40568", x: 4000, y: 0, z: 0, rotated: true },
  ];
  await page
    .locator("#import-file")
    .setInputFiles({
      name: "distant.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({ version: 1, units: "mm", boxes: far }),
      ),
    });
  await page.waitForFunction(() =>
    document.querySelector("#toast").textContent.includes("600 mm"),
  );
  assert.deepEqual(
    await state(),
    initial,
    "Import must not bypass workspace limits",
  );

  // Old sessions keep every model and a backup of the original arrangement.
  await page.evaluate(
    (boxes) =>
      localStorage.setItem(
        "zarges-stack-planner:v1",
        JSON.stringify({ version: 1, units: "mm", boxes }),
      ),
    far,
  );
  await page.reload();
  await page.waitForSelector("#scene svg");
  const repaired = await state();
  assert.equal(repaired.length, far.length);
  assert.equal(repaired.find((box) => box.id === "distant").rotated, true);
  assert.equal(inspectLayout(repaired, CATALOG).valid, true);
  assert.equal(validateWorkspace(repaired, CATALOG).valid, true);
  assert.deepEqual(
    await page.evaluate(
      () =>
        JSON.parse(
          localStorage.getItem(
            "zarges-stack-planner:v1:before-workspace-limits",
          ),
        ).boxes,
    ),
    far,
  );
  assert.deepEqual(
    repaired.filter((box) => box.id !== "distant"),
    PRESET,
  );

  // Add enough cases to wrap to a new row, rather than extending the floor.
  await page.locator('[data-action="reset"]').first().click();
  for (let i = 0; i < 8; i++)
    await page
      .getByRole("button", { name: "Add 73 L case", exact: true })
      .click();
  const expanded = await state();
  assert.equal(expanded.length, 16);
  assert.equal(validateWorkspace(expanded, CATALOG).valid, true);
  assert.equal(inspectLayout(expanded, CATALOG).valid, true);
  assert.ok(expanded.some((box) => box.y !== 0));

  // A full/blocked browser store must not strand the unbounded plan on screen
  // or overwrite the original when a migration backup cannot be written.
  await page.evaluate(
    (boxes) =>
      localStorage.setItem(
        "zarges-stack-planner:v1",
        JSON.stringify({ version: 1, units: "mm", boxes }),
      ),
    far,
  );
  await page.addInitScript(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.endsWith(":before-workspace-limits"))
        throw new DOMException("Full", "QuotaExceededError");
      return setItem.call(this, key, value);
    };
  });
  await page.reload();
  await page.waitForSelector("#scene svg");
  assert.deepEqual(
    await state(),
    far,
    "Failed backup preserves the original stored plan",
  );
  assert.match(
    await page.locator("#toast").textContent(),
    /Storage is unavailable/,
  );
  const download = page.waitForEvent("download");
  await page.locator('[data-action="save"]').click();
  const visiblePlan = JSON.parse(
    await readFile(await (await download).path(), "utf8"),
  );
  assert.equal(visiblePlan.boxes.length, far.length);
  assert.equal(
    validateWorkspace(visiblePlan.boxes, CATALOG).valid,
    true,
    "Visible and exportable plan is repaired even if automatic saving is blocked",
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: distant/outside pointer drops blocked; front/back moves and undo; real Top/3D catalog drags onto front floor; negative-y reload persistence; bounded imports; old-plan repair with original backup; new cases wrap to nearby rows.",
  );
} finally {
  await browser.close();
}
