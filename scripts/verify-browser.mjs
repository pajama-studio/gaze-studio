import { chromium, expect } from "@playwright/test";
import fs from "node:fs/promises";
const base = process.env.BASE_URL || "http://127.0.0.1:5198";
await fs.mkdir("artifacts/verification", { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  acceptDownloads: true,
});
await context.addInitScript(() => {
  if (!localStorage.getItem("gaze-studio-active"))
    localStorage.setItem("gaze-studio-active", "gazemining-p1-amazon");
});
const page = await context.newPage(),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const results = [];
const check = async (name, work) => {
  await work();
  results.push(name);
  console.log("PASS", name);
};
try {
  await page.goto(base);
  await expect(
    page.getByRole("heading", { name: "A shopping session, observed" }),
  ).toBeVisible();
  await expect(page.getByText("382 indexed frames")).toBeVisible();
  await check("real dataset and analysis worker", async () => {
    await expect(
      page.locator(".metric").first().locator("strong"),
    ).not.toHaveText("—");
    await expect
      .poll(() => page.locator("video").evaluate((v) => v.videoWidth), {
        timeout: 15000,
      })
      .toBe(1024);
  });
  await check("native video playback and seek", async () => {
    await expect
      .poll(() => page.locator("video").evaluate((v) => v.readyState), {
        timeout: 15000,
      })
      .toBeGreaterThan(1);
    await page.locator("video").evaluate((v) => (v.currentTime = 2));
    await expect(page.locator(".time-display")).toContainText("00:02.00");
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await page.waitForTimeout(1100);
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    expect(
      await page.locator("video").evaluate((v) => v.currentTime),
    ).toBeGreaterThan(0.5);
    await page.locator("video").evaluate((v) => (v.currentTime = 2));
    await expect(page.locator(".time-display")).toContainText("00:02.00");
  });
  await check("manual rectangle annotation", async () => {
    await page
      .getByRole("button", { name: "Draw rectangle", exact: true })
      .click();
    const bounds = await page.locator("svg.overlay").boundingBox();
    await page.mouse.move(
      bounds.x + bounds.width * 0.25,
      bounds.y + bounds.height * 0.25,
    );
    await page.mouse.down();
    await page.mouse.move(
      bounds.x + bounds.width * 0.5,
      bounds.y + bounds.height * 0.5,
      { steps: 15 },
    );
    await page.mouse.up();
    await expect(page.locator(".aoi-item")).toHaveCount(3);
    await page.getByLabel("Area name").fill("Test product");
  });
  await check("dynamic AOI keyframe and undo", async () => {
    await page.locator("video").evaluate((v) => (v.currentTime = 4));
    await expect(page.locator(".time-display")).toContainText("00:04.00");
    const handle = await page
      .locator("svg.overlay .handle")
      .last()
      .boundingBox();
    await page.mouse.move(
      handle.x + handle.width / 2,
      handle.y + handle.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(handle.x + 80, handle.y + 45, { steps: 12 });
    await page.mouse.up();
    await expect(page.locator(".aoi-item").last()).toContainText("2 keyframes");
    await page.getByRole("button", { name: "Undo AOI edit" }).click();
    await expect(page.locator(".aoi-item").last()).toContainText("Static area");
  });
  await check("polygon annotation", async () => {
    await page.getByRole("button", { name: "Draw polygon" }).click();
    await page.locator("svg.overlay").scrollIntoViewIfNeeded();
    const polygonBounds = await page.locator("svg.overlay").boundingBox();
    for (const [x, y] of [
      [0.55, 0.55],
      [0.85, 0.6],
      [0.8, 0.85],
    ])
      await page.mouse.click(
        polygonBounds.x + polygonBounds.width * x,
        polygonBounds.y + polygonBounds.height * y,
      );
    await page.getByRole("button", { name: "Finish polygon" }).click();
    await expect(page.locator(".aoi-item")).toHaveCount(4);
  });
  await check("independent analysis and exports", async () => {
    await page.getByRole("button", { name: "Analysis", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "From samples to attention." }),
    ).toBeVisible();
    await page.getByLabel("Event detector").selectOption("idt");
    await expect(page.locator(".metric").nth(1)).toContainText("IDT");
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export analysis" }).click();
    await (await download).saveAs("artifacts/verification/analysis.json");
    const report = JSON.parse(
      await fs.readFile("artifacts/verification/analysis.json", "utf8"),
    );
    expect(report.result.parameters.method).toBe("idt");
    expect(report.result.aoi.length).toBe(4);
  });
  await check(
    "portable package round trip with original raw data",
    async () => {
      await page.getByRole("button", { name: "Replay", exact: true }).click();
      const event = page.waitForEvent("download");
      await page.getByRole("button", { name: "Export", exact: true }).click();
      await page.getByRole("button", { name: "Portable Gaze Package" }).click();
      await (await event).saveAs("artifacts/verification/recording.gaze.zip");
      await page.getByRole("button", { name: "Import", exact: true }).click();
      await page
        .locator('input[type=file][accept=".csv,.tsv,.gz,.arff,.zip"]')
        .setInputFiles("artifacts/verification/recording.gaze.zip");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.locator(".aoi-item")).toHaveCount(4);
      expect(await page.locator("video").evaluate((v) => v.videoWidth)).toBe(
        1024,
      );
    },
  );
  await check("Cloudflare R2 upload and cloud catalog", async () => {
    await page.getByRole("button", { name: "Save to cloud" }).click();
    await expect(page.locator('.toast[role="status"]')).toContainText(
      "Saved to your private cloud workspace",
      { timeout: 60000 },
    );
    await page
      .getByRole("button", { name: "Cloud workspace", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Cloud workspace" }),
    ).toBeVisible();
    await expect(page.locator(".cloud-row")).toHaveCount(1);
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator("video")).toHaveAttribute(
      "src",
      /^\/api\/recordings\//,
    );
    await expect
      .poll(() => page.locator("video").evaluate((v) => v.readyState))
      .toBeGreaterThan(1);
    await page.locator("video").evaluate((v) => (v.currentTime = 20));
    await expect(page.locator(".time-display")).toContainText("00:20.00");
  });
  await page.screenshot({
    path: "artifacts/verification/desktop.png",
    fullPage: true,
  });
  await check("cloud data cleanup", async () => {
    await page
      .getByRole("button", { name: "Cloud workspace", exact: true })
      .click();
    await page.getByRole("button", { name: /Delete cloud recording/ }).click();
    await expect(page.locator(".cloud-row")).toHaveCount(0);
    await page.getByRole("button", { name: "Close cloud workspace" }).click();
  });
  await check("dataset discovery filter", async () => {
    await page.getByRole("button", { name: /Public datasets/ }).click();
    await page.getByRole("textbox", { name: "Search datasets" }).fill("webcam");
    await expect(page.locator(".dataset-card")).toHaveCount(1);
    await expect(page.locator(".dataset-card h2")).toHaveText("EVE");
  });
  await check("mobile layout and import", async () => {
    const mobile = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    await mobile.addInitScript(() =>
      localStorage.setItem("gaze-studio-active", "gazemining-p1-amazon"),
    );
    const p = await mobile.newPage();
    await p.goto(base);
    await expect(
      p.getByRole("heading", { name: "A shopping session, observed" }),
    ).toBeVisible();
    expect(
      await p.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await p
      .getByRole("button", { name: "Import recording", exact: true })
      .click();
    await expect(p.getByRole("dialog")).toBeVisible();
    await p.getByRole("button", { name: "Close import" }).click();
    await p.screenshot({
      path: "artifacts/verification/mobile.png",
      fullPage: true,
    });
    await mobile.close();
  });
  expect(errors).toEqual([]);
  await fs.writeFile(
    "artifacts/verification/browser-results.json",
    JSON.stringify(
      { base, checkedAt: new Date().toISOString(), passed: results, errors },
      null,
      2,
    ),
  );
} catch (e) {
  await page.screenshot({
    path: "artifacts/verification/failure.png",
    fullPage: true,
  });
  console.error(e);
  console.error(
    "Visible error:",
    await page.locator(".error-toast").allTextContents(),
  );
  process.exitCode = 1;
} finally {
  await browser.close();
}
