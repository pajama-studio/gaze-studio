import { chromium, expect } from "@playwright/test";
import fs from "node:fs/promises";
const base = process.env.BASE_URL || "http://127.0.0.1:8798";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const passed = [],
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const check = async (name, fn) => {
  await fn();
  passed.push(name);
  console.log("PASS", name);
};
try {
  await page.goto(base);
  await expect(
    page.getByRole("heading", { name: "Through both eyes", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".metric strong").first()).not.toHaveText("—");
  await expect
    .poll(() =>
      page
        .locator("video")
        .evaluateAll(
          (v) => v.length === 3 && v.every((x) => x.readyState >= 2),
        ),
    )
    .toBe(true);
  await check(
    "real-only catalog and default corrected left camera preserve source video",
    async () => {
      await expect(
        page.getByRole("button", { name: /The attention garden/ }),
      ).toHaveCount(0);
      const eye = page.locator('[data-role="left-eye"] video'),
        src = await eye.getAttribute("src");
      await expect(eye).toHaveCSS("transform", "matrix(-1, 0, 0, -1, 0, 0)");
      await page
        .getByRole("button", { name: "Show original left-eye orientation" })
        .click();
      await expect(eye).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
      await page
        .getByRole("button", { name: "Show corrected left-eye orientation" })
        .click();
      await expect(eye).toHaveCSS("transform", "matrix(-1, 0, 0, -1, 0, 0)");
      expect(await eye.getAttribute("src")).toBe(src);
    },
  );
  await check(
    "five populated data tracks share the media clock and gaze readouts",
    async () => {
      await expect(page.locator("[data-signal-track]")).toHaveCount(5);
      await expect
        .poll(() =>
          page
            .locator('[data-signal-track="saccades"] [data-signal-event]')
            .count(),
        )
        .toBeGreaterThan(0);
      const plot = page.getByRole("slider", { name: "Gaze position timeline" });
      await plot.scrollIntoViewIfNeeded();
      const box = await plot.boundingBox();
      await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.6);
      await expect
        .poll(() => page.locator(".stage video").evaluate((v) => v.currentTime))
        .toBeCloseTo(8, 1);
      await expect(page.getByLabel("Gaze position values")).toContainText("px");
      await plot.focus();
      await page.keyboard.press("ArrowRight");
      await expect
        .poll(() => page.locator(".stage video").evaluate((v) => v.currentTime))
        .toBeGreaterThan(8.05);
    },
  );
  await check(
    "event selection exposes measured evidence and seeks the synchronized videos",
    async () => {
      const event = page
        .locator('[data-signal-track="saccades"] [data-signal-event]')
        .first();
      await event.focus();
      await event.press("Enter");
      await expect(page.locator(".signal-event-detail")).toContainText(
        "amplitude",
      );
      await expect(page.locator(".signal-event-detail")).toContainText("peak");
      expect(await page.locator(".stage video").evaluate((v) => v.paused)).toBe(
        true,
      );
    },
  );
  await check("track visibility and zoom keep data lanes aligned", async () => {
    await page.getByRole("button", { name: "Choose data tracks" }).click();
    await page.getByRole("checkbox", { name: "Pupil diameter" }).uncheck();
    await expect(page.locator("[data-signal-track]")).toHaveCount(4);
    await page.getByRole("checkbox", { name: "Pupil diameter" }).check();
    await page.getByRole("button", { name: "Choose data tracks" }).click();
    await page.getByRole("button", { name: "Zoom timeline in" }).click();
    const gaze = await page
        .getByRole("slider", { name: "Gaze position timeline" })
        .boundingBox(),
      media = await page
        .getByRole("slider", { name: "Multi-track timeline" })
        .boundingBox();
    expect(Math.abs(gaze.x - media.x)).toBeLessThan(2);
    expect(Math.abs(gaze.width - media.width)).toBeLessThan(2);
    await page.getByRole("button", { name: "Zoom timeline out" }).click();
  });
  await check(
    "analysis lists and exports Rust saccade candidates and returns to video evidence",
    async () => {
      await page.getByRole("button", { name: "Analysis", exact: true }).click();
      await page.getByRole("tab", { name: /Saccade candidates/ }).click();
      await expect(page.locator(".eye-events tbody tr").first()).toBeVisible();
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.getByRole("button", { name: "Export events CSV" }).click(),
      ]);
      const text = await fs.readFile(await download.path(), "utf8");
      expect(text).toContain("amplitude_px,peak_velocity_px_s");
      expect(text.includes('saccade_candidate,"P01"')).toBe(true);
      await page
        .getByRole("button", {
          name: "Replay saccade candidate 1",
          exact: true,
        })
        .click();
      await expect(
        page.getByRole("slider", { name: "Gaze position timeline" }),
      ).toBeVisible();
    },
  );
  await check(
    "view rotation persists across refresh without reintroducing the removed fixture",
    async () => {
      await page.getByRole("button", { name: "Rotate left-eye view" }).click();
      await expect(page.locator('[data-role="left-eye"] video')).toHaveCSS(
        "transform",
        "matrix(0, -1, 1, 0, 0, 0)",
      );
      await expect(
        page.getByText("Saved in browser", { exact: true }),
      ).toBeVisible();
      await page.reload();
      await expect(
        page.getByRole("heading", { name: "Through both eyes", exact: true }),
      ).toBeVisible();
      await expect(page.locator('[data-role="left-eye"] video')).toHaveCSS(
        "transform",
        "matrix(0, -1, 1, 0, 0, 0)",
      );
      for (let i = 0; i < 3; i++)
        await page
          .getByRole("button", { name: "Rotate left-eye view" })
          .click();
    },
  );
  await page.locator("h1").click();
  await page.keyboard.press("Home");
  await expect(page.locator(".metric strong").first()).not.toHaveText("—");
  await page.evaluate(() => document.activeElement?.blur());
  await page.screenshot({
    path: "artifacts/verification/signal-tracks-desktop.png",
    fullPage: true,
  });
  await check(
    "mobile data tracks fit the viewport and retain all five channels",
    async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(page.locator("[data-signal-track]")).toHaveCount(5);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: "artifacts/verification/signal-tracks-mobile.png",
        fullPage: true,
      });
    },
  );
  await check(
    "saved recording survives unavailable examples and empty workspaces remain importable",
    async () => {
      const block = async (p) => {
        await p.route("**/api/datasets/emotion-p01-0a/recording", (r) =>
          r.abort(),
        );
        await p.route("**/datasets/gazemining.json", (r) => r.abort());
      };
      await block(page);
      await page.reload();
      await expect(
        page.getByRole("heading", { name: "Through both eyes", exact: true }),
      ).toBeVisible();
      const fresh = await browser.newPage();
      await block(fresh);
      await fresh.goto(base);
      await expect(
        fresh.getByRole("heading", { name: "Open a recording", exact: true }),
      ).toBeVisible();
      await fresh
        .getByRole("button", { name: "Import recording", exact: true })
        .click();
      await expect(fresh.getByRole("dialog")).toBeVisible();
      await fresh.close();
    },
  );
  expect(errors).toEqual([]);
  await fs.writeFile(
    "artifacts/verification/signal-tracks-results.json",
    JSON.stringify(
      { base, time: new Date().toISOString(), passed, errors },
      null,
      2,
    ) + "\n",
  );
} finally {
  await browser.close();
}
