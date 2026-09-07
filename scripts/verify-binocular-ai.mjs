import { chromium, expect } from "@playwright/test";
import fs from "node:fs/promises";
const base = process.env.BASE_URL || "https://gaze.pajama.studio";
const out = "artifacts/library/emotion-p01-0a/annotation";
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 1100 },
  acceptDownloads: true,
});
const responses = [],
  writes = [];
let count = 0;
page.on("request", (r) => {
  if (new URL(r.url()).pathname === "/api/detect" && r.method() === "POST")
    count++;
});
await page.addInitScript(() => {
  const original = window.fetch;
  window.__aoiFrames = [];
  window.fetch = async function (input, options) {
    if (String(input) === "/api/detect" && options?.body instanceof Blob)
      window.__aoiFrames.push(
        Array.from(new Uint8Array(await options.body.arrayBuffer())),
      );
    return original.call(this, input, options);
  };
});
page.on("response", (r) => {
  if (new URL(r.url()).pathname === "/api/detect") {
    writes.push(
      r.json().then(async (data) => {
        responses.push(data);
        await fs.writeFile(
          `${out}/response-${responses.length}.json`,
          JSON.stringify(data, null, 2),
        );
      }),
    );
  }
});
try {
  await page.goto(base);
  await expect(
    page.getByRole("heading", { name: "Through both eyes", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Auto annotate", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Accept & analyze" }),
  ).toBeVisible({ timeout: 90000 });
  await page.getByRole("button", { name: "Accept & analyze" }).click();
  await expect(page.locator("tbody tr").first()).toBeVisible();
  const event = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export analysis", exact: true })
    .click();
  await (await event).saveAs(out + "/analysis.json");
  await Promise.all(writes);
  const frames = await page.evaluate(() => window.__aoiFrames);
  for (let i = 0; i < frames.length; i++)
    await fs.writeFile(`${out}/frame-${i + 1}.jpg`, Buffer.from(frames[i]));
  expect(count).toBe(6);
  expect(responses).toHaveLength(6);
  expect(
    responses.every((r) => r.model === "@cf/facebook/detr-resnet-50"),
  ).toBe(true);
  const report = JSON.parse(await fs.readFile(out + "/analysis.json", "utf8"));
  expect(report.aois.length).toBeGreaterThan(0);
  expect(report.result.aoi.some((a) => a.dwell > 0)).toBe(true);
  expect(report.result.version).toContain("rust");
  await page.screenshot({ path: out + "/analysis.png", fullPage: true });
  const recording = JSON.parse(
    await fs.readFile(
      "artifacts/library/emotion-p01-0a/v1/recording.json",
      "utf8",
    ),
  );
  recording.aois = report.aois.map((a) => ({ ...a, accepted: false }));
  await fs.writeFile(
    "artifacts/library/emotion-p01-0a/v1/recording.json",
    JSON.stringify(recording),
  );
  const summary = {
    base,
    time: new Date().toISOString(),
    requests: count,
    model: responses[0].model,
    areas: report.aois.length,
    dwellUs: report.result.aoi.map((a) => ({ name: a.name, dwell: a.dwell })),
    version: report.result.version,
  };
  await fs.writeFile(
    out + "/verification.json",
    JSON.stringify(summary, null, 2),
  );
  console.log(JSON.stringify(summary, null, 2));
} finally {
  await browser.close();
}
