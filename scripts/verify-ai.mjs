// Optional real Workers AI check. Seven bounded inference requests at most.
import { chromium, expect } from "@playwright/test";
import fs from "node:fs/promises";
const base = process.env.BASE_URL || "http://127.0.0.1:8798";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1100 },
});
const page = await context.newPage();
const outputs = [];
page.on("response", async (r) => {
  if (r.url().endsWith("/api/detect"))
    outputs.push({ status: r.status(), body: await r.json() });
});
try {
  await page.goto(base);
  await expect(
    page.getByRole("heading", { name: "A shopping session, observed" }),
  ).toBeVisible();
  await expect
    .poll(() => page.locator("video").evaluate((v) => v.readyState))
    .toBeGreaterThan(1);
  await page.locator("video").evaluate((v) => (v.currentTime = 2));
  await expect(page.locator(".time-display")).toContainText("00:02.00");
  await page.getByRole("button", { name: "This frame", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "This frame", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "This frame", exact: true }),
  ).toBeEnabled({ timeout: 60000 });
  await expect(
    page.getByRole("button", { name: "Accept candidates" }),
  ).toBeVisible();
  const candidates = (await page.locator(".aoi-item").count()) - 2;
  expect(candidates).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Accept candidates" }).click();
  await expect(
    page.getByRole("button", { name: "Accept candidates" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Track next 10s" }).click();
  await expect(
    page.getByRole("button", { name: "Track next 10s" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Track next 10s" }),
  ).toBeEnabled({ timeout: 60000 });
  await expect(
    page.getByRole("button", { name: "Accept candidates" }),
  ).toBeVisible();
  const tracked = (await page.locator(".aoi-item").count()) - 2 - candidates;
  expect(tracked).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Reject all candidates" }).click();
  await page
    .getByRole("button", { name: "Find recorded page regions" })
    .click();
  await expect(
    page.getByRole("button", { name: "Accept candidates" }),
  ).toBeVisible();
  const dom = await page
    .locator(".aoi-item")
    .filter({ hasText: "DOM ·" })
    .count();
  expect(dom).toBeGreaterThan(0);
  await page.locator(".aoi-item").filter({ hasText: "DOM ·" }).first().click();
  expect(
    await page.locator("video").evaluate((v) => v.currentTime),
  ).toBeGreaterThan(40);
  await fs.mkdir("artifacts/verification", { recursive: true });
  await page.screenshot({
    path: "artifacts/verification/automatic-aoi.png",
    fullPage: true,
  });
  await fs.writeFile(
    "artifacts/verification/ai-results.json",
    JSON.stringify(
      {
        base,
        time: new Date().toISOString(),
        singleFrameCandidates: candidates,
        trackedCandidates: tracked,
        domRegions: dom,
        inferenceRequests: outputs.length,
        outputs,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      singleFrameCandidates: candidates,
      trackedCandidates: tracked,
      domRegions: dom,
      inferenceRequests: outputs.length,
    }),
  );
} catch (e) {
  await page.screenshot({
    path: "artifacts/verification/ai-failure.png",
    fullPage: true,
  });
  console.error(e);
  console.error(await page.locator(".error-toast").allTextContents());
  process.exitCode = 1;
} finally {
  await browser.close();
}
