// Record genuine browser interactions. `npm start` must be running.
// Playwright's Chromium + ffmpeg: npx playwright install chromium
import { chromium } from "playwright";
import { mkdir, rename } from "node:fs/promises";
import assert from "node:assert/strict";
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_EXECUTABLE
    ? { executablePath: process.env.CHROMIUM_EXECUTABLE }
    : {}),
  args: ["--no-sandbox"],
});
await mkdir("test-results/video", { recursive: true });
const context = await browser.newContext({
  viewport: { width: 1500, height: 1125 },
  permissions: ["clipboard-read", "clipboard-write"],
  recordVideo: {
    dir: "test-results/video",
    size: { width: 1500, height: 1125 },
  },
});
const page = await context.newPage();
const video = page.video();
await page.goto(process.env.BASE_URL || "http://localhost:3000");
await page.waitForSelector("#scene svg");
// Start with the product filling the workspace. Scale references are a later,
// optional part of the tour; these are real UI controls, not altered app data.
await page.locator("#human-scale").uncheck();
await page.locator("#soccer-scale").uncheck();
assert.equal(await page.locator("#human-scale").isChecked(), false);
assert.equal(await page.locator("#soccer-scale").isChecked(), false);
await page.mouse.move(20, 20);
await page.evaluate(() => document.activeElement?.blur());
await mkdir("docs/media", { recursive: true });
await page.screenshot({
  path: "docs/media/demo-poster.png",
  animations: "disabled",
});
await page.evaluate(() => {
  const caption = document.createElement("div");
  caption.id = "demo-caption";
  caption.style.cssText =
    "position:fixed;bottom:22px;left:50%;transform:translateX(-50%);background:#004d88;color:white;padding:15px 28px;font:500 18px Arial,sans-serif;z-index:100;box-shadow:0 8px 40px #1234;white-space:nowrap;pointer-events:none";
  document.body.append(caption);
  const pointer = document.createElement("div");
  pointer.style.cssText =
    "position:fixed;width:18px;height:18px;border:2px solid #005b9f;border-radius:50%;background:#83caf766;z-index:101;pointer-events:none;transform:translate(-50%,-50%)";
  document.body.append(pointer);
  document.addEventListener("mousemove", (e) => {
    pointer.style.left = e.clientX + "px";
    pointer.style.top = e.clientY + "px";
  });
});
async function caption(text, pause = 1700) {
  await page
    .locator("#demo-caption")
    .evaluate((node, text) => (node.textContent = text), text);
  await page.waitForTimeout(pause);
}
async function click(selector) {
  await page.locator(selector).first().click();
  await page.waitForTimeout(550);
}
try {
  await caption("K 470 Stack Planner · Your complete eight-case setup", 4000);
  await click('#scene [data-box-id="case-6"]');
  await caption("Select a case to highlight its visible edges", 2300);
  await page.locator("#search").fill("829");
  await caption("All 25 standard K 470 sizes — from 13 to 829 liters", 1800);
  await click('[data-add="40876"]');
  await caption(
    "Add any catalog model, even outside the reference setup",
    2200,
  );
  await click('[data-action="reset"]');
  await page.locator("#search").fill("");
  await click('#scene [data-box-id="case-8"]');
  await caption("Inspect real dimensions, capacity, and position", 2300);
  await click('[data-action="copy"]');
  await click('[data-action="paste"]');
  await caption(
    "Copy and paste a case — its model and rotation stay the same",
    2200,
  );
  await click('[data-action="undo"]');
  await caption(
    "Equal floor space in front and behind your reference setup",
    2000,
  );
  await click("#dimensions");
  await click('button[data-view="front"]');
  await caption("Compare your setup from the front…", 1800);
  await click('button[data-view="top"]');
  await caption("…or check the footprint from above", 1800);
  await click('[data-action="clear"]');
  await click('[data-add="40564"]');
  await click('[data-add="40810"]');
  await page.locator("#dimensions").uncheck();
  await caption("Drag a 29 L case onto the 73 L base", 1500);
  const coords = await page.evaluate(async () => {
    const { getSceneTransform } = await import("./src/renderer.js");
    const { CATALOG } = await import("./src/catalog.js");
    const boxes = JSON.parse(
      localStorage.getItem("zarges-stack-planner:v1"),
    ).boxes;
    const t = getSceneTransform(boxes, CATALOG, "top", {
        humanScale: document.querySelector("#human-scale").checked,
        soccerScale: document.querySelector("#soccer-scale").checked,
      }),
      m = document.querySelector("#scene svg").getScreenCTM();
    return [
      [1000, 200, 0],
      [300, 200, 0],
    ].map((args) => {
      const p = t.project(...args),
        q = new DOMPoint(p.x, p.y).matrixTransform(m);
      return { x: q.x, y: q.y };
    });
  });
  await page.mouse.move(coords[0].x, coords[0].y);
  await page.mouse.down();
  await page.mouse.move(coords[1].x, coords[1].y, { steps: 70 });
  await page.waitForTimeout(700);
  await page.mouse.up();
  // Verify the recording actually stacked the case with the current camera.
  await page.waitForFunction(() =>
    JSON.parse(localStorage.getItem("zarges-stack-planner:v1")).boxes.some(
      (box) => box.modelId === "40810" && box.z === 410,
    ),
  );
  await page.waitForTimeout(1200);
  await click('button[data-view="iso"]');
  await caption(
    "Automatic snapping. Full support. No overlapping cases.",
    2400,
  );
  await click('[data-action="reset"]');
  await caption("Return to the two-stack reference arrangement", 2300);
  await page.locator("#human-scale").check();
  await caption("Optional scale reference: a 6-foot person", 2000);
  await page.locator("#soccer-scale").check();
  await caption("Or compare with a 22 cm soccer ball", 2000);
  await page.locator("#human-scale").uncheck();
  await page.locator("#soccer-scale").uncheck();
  await click('[data-action="export"]');
  await caption(
    "Export a model-by-model box list, ready to discuss with ZARGES",
    2800,
  );
  await click('[data-action="fit-details"]');
  await caption(
    "Clear fit information: dimensions versus corner engagement",
    2200,
  );
  await page.keyboard.press("Escape");
  await caption("8 cases · 567 liters · Endless ways to organize", 2600);
} finally {
  await context.close();
  const path = await video.path();
  await rename(path, "test-results/demo.webm");
  await browser.close();
  console.log(
    "Recorded test-results/demo.webm. Use the ffmpeg commands in docs/media/README.md to encode it.",
  );
}
