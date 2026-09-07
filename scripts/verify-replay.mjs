import { chromium, expect } from "@playwright/test";
import fs from "node:fs/promises";
const base = process.env.BASE_URL || "http://127.0.0.1:5198";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1100 },
  acceptDownloads: true,
});
await context.addInitScript(() => {
  if (!localStorage.getItem("gaze-studio-active"))
    localStorage.setItem("gaze-studio-active", "gazemining-p1-amazon");
});
const page = await context.newPage();
const results = [],
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const check = async (name, fn) => {
  await fn();
  results.push(name);
  console.log("PASS", name);
};
await fs.mkdir("artifacts/verification", { recursive: true });
const report = async (name) => {
  const event = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export analysis", exact: true })
    .click();
  const path = `artifacts/verification/${name}.json`;
  await (await event).saveAs(path);
  return JSON.parse(await fs.readFile(path, "utf8"));
};
let original;
try {
  await page.goto(base);
  await expect(
    page.getByRole("heading", { name: "A shopping session, observed" }),
  ).toBeVisible();
  await check(
    "real source automatic annotations remain reviewable",
    async () => {
      await page
        .getByRole("button", { name: "Auto annotate", exact: true })
        .click();
      await expect(page.getByText("14 candidates to review")).toBeVisible();
      await expect(page.locator(".aoi-item")).toHaveCount(16);
      await page
        .getByRole("button", { name: "Review first candidate" })
        .click();
      await expect
        .poll(() => page.locator("video").evaluate((v) => v.currentTime))
        .toBeGreaterThan(40);
    },
  );
  await check("accepted automatic AOIs drive scoped analysis", async () => {
    await page.getByRole("button", { name: "Accept & analyze" }).click();
    await expect(page.getByLabel("AOI set")).toHaveValue("automatic");
    await expect(
      page.getByRole("table", { name: "AOI metrics" }).locator("tbody tr"),
    ).toHaveCount(14);
    original = await report("replay-analysis");
    expect(original.result.aoi.some((a) => a.name.includes("viewport"))).toBe(
      false,
    );
    expect(original.result.aoi.some((a) => a.dwell > 0)).toBe(true);
    expect(original.result.parameters.aoiScope).toBe("automatic");
    expect(original.aois).toHaveLength(16);
    await page.screenshot({
      path: "artifacts/verification/replay-analysis.png",
      fullPage: true,
    });
  });
  await check(
    "analysis evidence opens the aligned video at the first fixation",
    async () => {
      const metric = [...original.result.aoi].sort(
        (a, b) => b.dwell - a.dwell,
      )[0];
      const area = original.aois.find((a) => a.id === metric.id);
      const expected =
        metric.ttff !== null
          ? Math.max(original.result.parameters.start, area.start) + metric.ttff
          : (original.result.sequences.find((s) => s.aoi === metric.id)
              ?.start ?? area.start);
      await page
        .getByRole("button", {
          name: `Replay top area ${metric.name}`,
          exact: true,
        })
        .first()
        .click();
      await expect
        .poll(() => page.locator("video").evaluate((v) => v.readyState))
        .toBeGreaterThan(1);
      await expect
        .poll(() => page.locator("video").evaluate((v) => v.currentTime))
        .toBeCloseTo(expected / 1e6, 2);
      await expect(page.getByLabel("Area name")).toHaveValue(metric.name);
      await page.screenshot({
        path: "artifacts/verification/replay-workflow.png",
        fullPage: true,
      });
    },
  );
  await check(
    "portable replay restores the protocol and identical AOI results",
    async () => {
      const event = page.waitForEvent("download");
      await page.getByRole("button", { name: "Export", exact: true }).click();
      await page.getByRole("button", { name: "Portable Gaze Package" }).click();
      await (await event).saveAs("artifacts/verification/replay.gaze.zip");
      await page.getByRole("button", { name: "Import", exact: true }).click();
      await page
        .locator('input[type=file][accept=".csv,.tsv,.gz,.arff,.zip"]')
        .setInputFiles("artifacts/verification/replay.gaze.zip");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await page.getByRole("button", { name: "Analysis", exact: true }).click();
      await expect(
        page.getByRole("table", { name: "AOI metrics" }).locator("tbody tr"),
      ).toHaveCount(14);
      const restored = await report("replay-restored-analysis");
      expect(restored.result).toEqual(original.result);
      await page.getByRole("button", { name: "Replay", exact: true }).click();
      await page.route("**/datasets/gazemining-amazon-raw.json.gz", (route) =>
        route.abort(),
      );
      await page
        .getByRole("button", { name: "Auto annotate", exact: true })
        .click();
      await expect(page.getByText("14 candidates to review")).toBeVisible();
      await page.unroute("**/datasets/gazemining-amazon-raw.json.gz");
    },
  );
  await check(
    "public dataset opens a fresh replay with automatic region proposals",
    async () => {
      await page.getByRole("button", { name: /Public datasets/ }).click();
      await page
        .locator(".dataset-card")
        .filter({
          has: page.getByRole("heading", { name: "GazeMining", exact: true }),
        })
        .getByRole("button", { name: "Open replay + auto AOIs" })
        .click();
      await expect(
        page.getByRole("heading", { name: "GazeMining · Amazon replay" }),
      ).toBeVisible();
      await expect(page.locator(".aoi-item")).toHaveCount(14);
      await page.getByRole("button", { name: "Accept & analyze" }).click();
      await expect(
        page.getByRole("table", { name: "AOI metrics" }).locator("tbody tr"),
      ).toHaveCount(14);
      await page.getByLabel("Event detector").selectOption("idt");
      await expect(page.locator(".metric").nth(1)).toContainText("IDT");
      await page.reload();
      await expect(
        page.getByRole("heading", { name: "GazeMining · Amazon replay" }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Analysis", exact: true }).click();
      await expect(page.getByLabel("Event detector")).toHaveValue("idt");
      await expect(page.getByLabel("AOI set")).toHaveValue("automatic");
    },
  );
  let detections = 0;
  await check(
    "uploaded video and gaze use sampled AI proposals before analysis",
    async () => {
      await fs.writeFile(
        "artifacts/verification/uploaded-gaze.csv",
        "t_us,x_px,y_px,valid,participant_id\n" +
          Array.from(
            { length: 201 },
            (_, i) => `${i * 50000},300,300,1,P01`,
          ).join("\n"),
      );
      await page.getByRole("button", { name: "Import", exact: true }).click();
      await page
        .locator('input[type=file][accept^="video/mp4"]')
        .setInputFiles("public/datasets/gazemining-amazon.webm");
      await page
        .locator('input[type=file][accept=".csv,.tsv,.gz,.arff,.zip"]')
        .setInputFiles("artifacts/verification/uploaded-gaze.csv");
      await page
        .getByLabel("Recording name")
        .fill("Uploaded replay verification");
      await page.getByLabel("Source coordinate width").fill("1024");
      await page.getByLabel("Source coordinate height").fill("768");
      await page.getByLabel("Timestamp unit").selectOption("us");
      await page
        .getByRole("button", { name: "Open recording", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "Uploaded replay verification" }),
      ).toBeVisible();
      await page.route("**/api/detect", (route) => {
        expect(route.request().postDataBuffer().length).toBeGreaterThan(1000);
        detections++;
        return route.fulfill({
          json: {
            model: "verification-fixed-box",
            detections: [
              {
                label: "Verification object",
                score: 0.99,
                box: { xmin: 100, ymin: 100, xmax: 500, ymax: 500 },
              },
            ],
          },
        });
      });
      await page
        .getByRole("button", { name: "Auto annotate", exact: true })
        .click();
      await expect(page.getByText(/\d+ candidates to review/)).toBeVisible({
        timeout: 20000,
      });
      expect(detections).toBe(6);
      await page.getByRole("button", { name: "Accept & analyze" }).click();
      await expect(
        page
          .getByRole("table", { name: "AOI metrics" })
          .locator("tbody tr")
          .first(),
      ).toBeVisible();
      const uploaded = await report("uploaded-ai-workflow");
      expect(uploaded.aois.length).toBeGreaterThanOrEqual(1);
      expect(uploaded.aois.reduce((n, a) => n + a.keyframes.length, 0)).toBe(6);
      expect(Math.max(...uploaded.aois.map((a) => a.end))).toBe(10000000);
      expect(uploaded.result.aoi.reduce((n, a) => n + a.dwell, 0)).toBe(
        10000000,
      );
    },
  );
  await check("mobile replay workflow stays within the viewport", async () => {
    const mobile = await browser.newPage({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    await mobile.addInitScript(() =>
      localStorage.setItem("gaze-studio-active", "gazemining-p1-amazon"),
    );
    await mobile.goto(base);
    await expect(
      mobile.getByRole("button", { name: "Auto annotate", exact: true }),
    ).toBeVisible();
    expect(
      await mobile.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await mobile
      .getByRole("button", { name: "Auto annotate", exact: true })
      .click();
    await expect(
      mobile.getByRole("button", { name: "Accept & analyze" }),
    ).toBeVisible();
    await mobile.getByRole("button", { name: "Accept & analyze" }).click();
    await expect(
      mobile.getByRole("table", { name: "AOI metrics" }).locator("tbody tr"),
    ).toHaveCount(14);
    expect(
      await mobile.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await mobile.screenshot({
      path: "artifacts/verification/replay-mobile.png",
      fullPage: true,
    });
    await mobile.close();
  });
  expect(errors).toEqual([]);
  await fs.writeFile(
    "artifacts/verification/replay-results.json",
    JSON.stringify(
      {
        base,
        checkedAt: new Date().toISOString(),
        passed: results,
        errors,
        realDatasetRegions: 14,
        uploadedVideoDetector:
          "Mocked fixed-box responses test workflow and frame extraction, not model quality",
        uploadedVideoFrameRequests: detections,
      },
      null,
      2,
    ) + "\n",
  );
} catch (e) {
  console.error(e);
  console.error(await page.locator(".error-toast").allTextContents());
  await page.screenshot({
    path: "artifacts/verification/replay-failure.png",
    fullPage: true,
  });
  process.exitCode = 1;
} finally {
  await browser.close();
}
