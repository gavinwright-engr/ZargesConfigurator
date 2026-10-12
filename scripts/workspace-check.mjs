// Exercise real pointer moves and the saved-plan migration against npm start.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
      const p = getSceneTransform(boxes, CATALOG, view).project(x, y, z);
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
try {
  await page.goto(process.env.BASE_URL || "http://localhost:3000");
  await page.waitForSelector("#scene svg");
  await page.locator('button[data-view="top"]').click();
  const initial = await state();
  for (const destination of [
    [1750, 2050, 0],
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

  const far = [
    ...PRESET,
    { id: "distant", modelId: "40568", x: 1600, y: 1700, z: 0, rotated: true },
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
  assert.ok(expanded.some((box) => box.y > 0));

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
    "PASS: distant/outside pointer drops blocked; nearby move and undo; bounded imports; old-plan repair with original backup; new cases wrap to nearby rows.",
  );
} finally {
  await browser.close();
}
