import { chromium, expect } from "@playwright/test";
import fs from "node:fs/promises";
const base = process.env.BASE_URL || "http://127.0.0.1:5198";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const results = [],
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const check = async (name, fn) => {
  await fn();
  results.push(name);
  console.log("PASS", name);
};
try {
  await page.goto(base);
  await expect(
    page.getByRole("heading", { name: "Through both eyes", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator("video")
        .evaluateAll((v) => v.every((v) => v.readyState >= 2)),
    )
    .toBe(true);
  await check(
    "left and right cameras appear side by side in anatomical label order",
    async () => {
      const left = await page.locator('[data-role="left-eye"]').boundingBox(),
        right = await page.locator('[data-role="right-eye"]').boundingBox();
      expect(Math.abs(left.y - right.y)).toBeLessThan(2);
      expect(left.x).toBeLessThan(right.x);
    },
  );
  await check(
    "timeline supports pointer scrubbing and zoom without changing scene coordinates",
    async () => {
      const track = page.getByRole("slider", { name: "Multi-track timeline" }),
        box = await track.boundingBox();
      await page.mouse.move(box.x + box.width * 0.2, box.y + 8);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.6, box.y + 10, { steps: 12 });
      await page.mouse.up();
      await expect
        .poll(() => page.locator(".stage video").evaluate((v) => v.currentTime))
        .toBeGreaterThan(11.8);
      await page.getByRole("button", { name: "Zoom timeline in" }).click();
      expect(
        await page.locator(".timeline-content").evaluate((e) => e.style.width),
      ).toBe("200%");
      await page.getByRole("button", { name: "Zoom timeline out" }).click();
    },
  );
  await check(
    "keyboard playback, frame stepping and editing shortcuts preserve input focus",
    async () => {
      await page.locator("h1").click();
      await page.keyboard.press("Home");
      await page.keyboard.press("Space");
      await expect(
        page.getByRole("button", { name: "Pause", exact: true }),
      ).toBeVisible();
      await page.waitForTimeout(350);
      await page.keyboard.press("Space");
      const t = await page
        .locator(".stage video")
        .evaluate((v) => v.currentTime);
      await page.keyboard.press("ArrowRight");
      await expect
        .poll(() => page.locator(".stage video").evaluate((v) => v.currentTime))
        .toBeGreaterThan(t);
      await page.keyboard.press("r");
      await expect(
        page.getByRole("button", { name: "Draw rectangle" }),
      ).toHaveClass(/active/);
      await page.keyboard.press("Escape");
      await expect(
        page.getByRole("button", { name: "Select AOI" }),
      ).toHaveClass(/active/);
    },
  );
  await check(
    "eye view rotation and collapse are display controls",
    async () => {
      const eye = page.locator('[data-role="left-eye"] video');
      const src = await eye.getAttribute("src");
      await page.getByRole("button", { name: "Rotate left-eye view" }).click();
      await expect(eye).toHaveCSS("transform", "matrix(0, -1, 1, 0, 0, 0)");
      expect(await eye.getAttribute("src")).toBe(src);
      await page.getByRole("button", { name: /EYE CAMERAS/ }).click();
      await expect(page.locator("video")).toHaveCount(1);
      await page.getByRole("button", { name: /EYE CAMERAS/ }).click();
      await expect(page.locator("video")).toHaveCount(3);
    },
  );
  await check(
    "workspace contains real examples and no attention garden fixture",
    async () => {
      await expect(
        page.getByRole("button", { name: /The attention garden/ }),
      ).toHaveCount(0);
      await expect(page.getByText(/Rust \/ WASM · 1 worker/)).toBeVisible();
    },
  );
  await page.screenshot({
    path: "artifacts/verification/editor-desktop.png",
    fullPage: true,
  });
  await check(
    "per-eye Rust descriptive statistics are available in analysis",
    async () => {
      await page.getByRole("button", { name: "Analysis", exact: true }).click();
      await expect(
        page.getByRole("heading", { name: "Pupil measurements" }),
      ).toBeVisible();
      await expect(page.locator(".eye-statistics tbody tr")).toHaveCount(2);
      await page.screenshot({
        path: "artifacts/verification/editor-analysis.png",
        fullPage: true,
      });
      await page.getByRole("button", { name: "Replay", exact: true }).click();
    },
  );
  await check(
    "mobile editor keeps cameras side by side and all controls within the viewport",
    async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      const left = await page.locator('[data-role="left-eye"]').boundingBox(),
        right = await page.locator('[data-role="right-eye"]').boundingBox();
      expect(Math.abs(left.y - right.y)).toBeLessThan(2);
      await page.screenshot({
        path: "artifacts/verification/editor-mobile.png",
        fullPage: true,
      });
    },
  );
  expect(errors).toEqual([]);
  await fs.writeFile(
    "artifacts/verification/editor-results.json",
    JSON.stringify(
      { base, time: new Date().toISOString(), results, errors },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
