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
// Keep the visible cursor and the real browser pointer at the same coordinates.
let cursor = { x: 745, y: 405 };
await page.mouse.move(cursor.x, cursor.y);
await page.evaluate(({ x, y }) => {
  const caption = document.createElement("div");
  caption.id = "demo-caption";
  caption.style.cssText =
    "position:fixed;bottom:22px;left:50%;transform:translateX(-50%);background:#004d88;color:white;padding:15px 28px;font:500 18px Arial,sans-serif;z-index:100;box-shadow:0 8px 40px #1234;white-space:nowrap;pointer-events:none";
  document.body.append(caption);
  const style = document.createElement("style");
  style.textContent = `
    #demo-pointer { position:fixed; inset:0 auto auto 0; width:0; height:0;
      margin:0; padding:0; border:0; overflow:visible; background:transparent;
      pointer-events:none; }
    #demo-pointer .halo { position:absolute; left:-28px; top:-28px;
      width:56px; height:56px; box-sizing:border-box; border-radius:50%;
      border:2px solid #fff; background:#008ed22b;
      box-shadow:0 0 0 2px #0067a8,0 2px 9px #1236;
      transition:background 120ms,transform 120ms; }
    #demo-pointer svg { position:absolute; left:-6px; top:-6px;
      width:58px; height:72px; overflow:visible;
      filter:drop-shadow(1px 3px 3px #1239); }
    #demo-pointer.pressed .halo { background:#008ed26b; transform:scale(.88); }
  `;
  document.head.append(style);
  const pointer = document.createElement("div");
  pointer.id = "demo-pointer";
  pointer.setAttribute("popover", "manual");
  pointer.setAttribute("aria-hidden", "true");
  pointer.style.transform = `translate(${x}px, ${y}px)`;
  pointer.innerHTML = `<span class="halo"></span>
    <svg viewBox="-6 -6 58 72" aria-hidden="true">
      <path d="M0 0 L0 43 L11 34 L21 53 L32 47 L22 28 L40 28 Z"
        fill="#005b9f" stroke="#fff" stroke-width="4" stroke-linejoin="round"/>
    </svg>`;
  document.body.append(pointer);
  // The top layer keeps the cursor visible above the fit-details dialog too.
  pointer.showPopover();
  document.addEventListener("pointermove", (e) => {
    pointer.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
  });
  document.addEventListener(
    "pointerdown",
    () => pointer.classList.add("pressed"),
    true,
  );
  document.addEventListener(
    "pointerup",
    () => pointer.classList.remove("pressed"),
    true,
  );
}, cursor);
async function caption(text, pause = 900) {
  await page
    .locator("#demo-caption")
    .evaluate((node, text) => (node.textContent = text), text);
  await page.waitForTimeout(pause);
}
async function moveCursor(x, y, duration) {
  const from = { ...cursor };
  const distance = Math.hypot(x - from.x, y - from.y);
  const milliseconds = duration ?? Math.min(650, Math.max(280, distance * 0.6));
  const steps = Math.ceil(milliseconds / (1000 / 30));
  const started = performance.now();
  for (let step = 1; step <= steps; step += 1) {
    const t = step / steps;
    const eased = t * t * (3 - 2 * t); // Gentle acceleration and deceleration.
    await page.mouse.move(
      from.x + (x - from.x) * eased,
      from.y + (y - from.y) * eased,
    );
    // Mouse steps alone run as fast as possible. Pace them so the recording
    // captures the complete journey, including while a case is being dragged.
    const remaining = started + milliseconds * t - performance.now();
    if (remaining > 0) await page.waitForTimeout(remaining);
  }
  cursor = { x, y };
}

async function click(selector, pause = 150) {
  let target = page.locator(selector).first();
  // A case's SVG bounding box includes occluded faces; use its visible badge.
  if (await target.locator(".box-capacity").count())
    target = target.locator(".box-capacity");
  await target.scrollIntoViewIfNeeded();
  const bounds = await target.boundingBox();
  assert.ok(bounds, `Demo target must be visible: ${selector}`);
  await moveCursor(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.waitForTimeout(80);
  await page.mouse.down();
  await page.waitForTimeout(100); // Make the pressed halo easy to see.
  await page.mouse.up();
  await page.evaluate(() => {
    const pointer = document.querySelector("#demo-pointer");
    pointer.hidePopover();
    pointer.showPopover();
  });
  await page.waitForTimeout(pause);
}

async function setChecked(selector, checked) {
  if ((await page.locator(selector).isChecked()) !== checked)
    await click(selector);
  assert.equal(await page.locator(selector).isChecked(), checked);
}

async function search(text) {
  await click("#search");
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("Backspace");
  await page.keyboard.type(text, { delay: 65 });
}
try {
  await caption("K 470 Stack Planner · Your eight-case setup", 3200);
  await click('#scene [data-box-id="case-6"]');
  await caption("Select a case. See its visible edges.");
  assert.equal(
    await page
      .locator('#scene [data-box-id="case-6"]')
      .getAttribute("aria-pressed"),
    "true",
  );
  await page.screenshot({ path: "test-results/demo-cursor.png" });
  await search("829");
  await caption("25 sizes · 13–829 liters");
  await click('[data-add="40876"]');
  await caption("Add any model");
  await click('[data-action="reset"]');
  await search("");
  await click('#scene [data-box-id="case-8"]');
  await caption("Dimensions, capacity, and position", 800);
  await click('[data-action="copy"]');
  await click('[data-action="paste"]');
  await caption("Copy. Paste. Build.", 1100);
  await click('[data-action="undo"]');
  await click("#dimensions");
  await click('button[data-view="front"]');
  await caption("Compare heights", 700);
  await click('button[data-view="top"]');
  await caption("Check the footprint", 700);
  await click('[data-action="clear"]');
  await click('[data-add="40564"]');
  await click('[data-add="40810"]');
  await setChecked("#dimensions", false);
  await caption("Drag to stack", 700);
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
  await moveCursor(coords[0].x, coords[0].y);
  await page.waitForTimeout(80);
  await page.mouse.down();
  await page.waitForTimeout(100);
  await moveCursor(coords[1].x, coords[1].y, 1000);
  await page.waitForTimeout(200);
  await page.mouse.up();
  // Verify the recording actually stacked the case with the current camera.
  await page.waitForFunction(() =>
    JSON.parse(localStorage.getItem("zarges-stack-planner:v1")).boxes.some(
      (box) => box.modelId === "40810" && box.z === 410,
    ),
  );
  await page.waitForTimeout(450);
  await click('button[data-view="iso"]');
  await caption("Snap into place. Full support.", 1100);
  await click('[data-action="reset"]');
  await setChecked("#human-scale", true);
  await caption("Optional scale: a 6-foot person");
  await setChecked("#soccer-scale", true);
  await caption("Or a 22 cm soccer ball", 800);
  await setChecked("#human-scale", false);
  await setChecked("#soccer-scale", false);
  await click('[data-action="export"]');
  await caption("Export your box list", 1200);
  await click('[data-action="fit-details"]');
  await caption("Check fit and stacking notes", 800);
  await page.keyboard.press("Escape");
  await caption("8 cases · 567 liters · Plan your setup", 1500);
} finally {
  await context.close();
  const path = await video.path();
  await rename(path, "test-results/demo.webm");
  await browser.close();
  console.log(
    "Recorded test-results/demo.webm. Use the ffmpeg commands in docs/media/README.md to encode it.",
  );
}
