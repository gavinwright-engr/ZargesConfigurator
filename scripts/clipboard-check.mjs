// Clipboard regression checks use real OS keyboard events in a running browser.
// Run with npm start in another terminal, then node scripts/clipboard-check.mjs.
import assert from "node:assert/strict";
import { chromium } from "playwright";

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
const key = process.platform === "darwin" ? "Meta" : "Control";
const state = () =>
  page.evaluate(
    () => JSON.parse(localStorage.getItem("zarges-stack-planner:v1")).boxes,
  );
async function count(expected) {
  await page.waitForFunction(
    (n) => document.querySelector("#total-boxes").textContent === String(n),
    expected,
    { timeout: 5000 },
  );
  assert.equal((await state()).length, expected);
}
async function select(id) {
  const item = page.locator(`#scene [data-box-id="${id}"]`);
  await item.focus();
  await page.keyboard.press("Enter");
}

try {
  await page.goto(process.env.BASE_URL || "http://localhost:3000");
  await page.waitForSelector("#scene svg");
  await page.evaluate(() => {
    localStorage.setItem(
      "zarges-stack-planner:v1",
      JSON.stringify({
        version: 1,
        units: "mm",
        boxes: [
          {
            id: "clipboard-source",
            modelId: "40564",
            rotated: true,
            x: 0,
            y: 0,
            z: 0,
          },
        ],
      }),
    );
  });
  await page.reload();
  await count(1);
  await select("clipboard-source");
  await page.keyboard.press(`${key}+C`);
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  assert.deepEqual(JSON.parse(copied), {
    type: "zarges-case",
    version: 1,
    modelId: "40564",
    rotated: true,
  });
  await page.keyboard.press(`${key}+V`);
  await count(2);
  await page.keyboard.press(`${key}+V`);
  await count(3);
  const pasted = await state();
  assert.equal(
    new Set(pasted.map((box) => box.id)).size,
    3,
    "Every paste must create a fresh instance ID",
  );
  assert.ok(
    pasted.every((box) => box.modelId === "40564" && box.rotated),
    "Model and rotation survive repeated paste",
  );
  assert.equal(
    new Set(pasted.map((box) => `${box.x},${box.y},${box.z}`)).size,
    3,
    "Copies occupy separate valid positions",
  );
  await page.keyboard.press(`${key}+Z`);
  await count(2);
  await page.keyboard.press("Escape");
  await page.keyboard.press(`${key}+V`);
  await count(3);
  await page.locator('[data-action="copy"]').click();
  await page.locator('[data-action="paste"]').click();
  await count(4);

  // An ordinary text copy supersedes the previously copied bin.
  const search = page.locator("#search");
  await search.fill("ordinary text");
  await search.press(`${key}+A`);
  await search.press(`${key}+C`);
  assert.equal(
    await page.evaluate(() => navigator.clipboard.readText()),
    "ordinary text",
  );
  await page.locator('[data-action="paste"]').click();
  await page.waitForFunction(() =>
    document.querySelector("#toast").textContent.includes("Copy a ZARGES case"),
  );
  await count(4);
  assert.match(
    await page.locator("#toast").textContent(),
    /Copy a ZARGES case/,
  );

  // Native text-field paste must not create a bin, even with a case payload.
  await page.evaluate((text) => navigator.clipboard.writeText(text), copied);
  await search.fill("");
  await search.focus();
  await search.press(`${key}+V`);
  assert.equal(await search.inputValue(), copied);
  await count(4);
  await search.fill("");

  // Selecting page text keeps native copy semantics as well.
  await page.evaluate(() => {
    document.activeElement.blur();
    const range = document.createRange();
    range.selectNodeContents(document.querySelector("#configuration-label"));
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await page.keyboard.press(`${key}+C`);
  assert.equal(
    await page.evaluate(() => navigator.clipboard.readText()),
    await page.locator("#configuration-label").textContent(),
  );
  await page.evaluate(() => window.getSelection().removeAllRanges());

  // Buttons retain in-tab functionality if browser clipboard access is denied.
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {
          throw new DOMException("Denied", "NotAllowedError");
        },
        readText: async () => {
          throw new DOMException("Denied", "NotAllowedError");
        },
      },
    });
  });
  await select("clipboard-source");
  await page.locator('[data-action="copy"]').click();
  await page.locator('[data-action="paste"]').click();
  await count(5);
  assert.equal((await state()).at(-1).rotated, true);
  assert.deepEqual(errors, []);
  console.log(
    "Clipboard checks passed: native copy/paste, rotation, unique instances, undo, buttons, text focus, and denied-permission fallback.",
  );
} finally {
  await browser.close();
}
