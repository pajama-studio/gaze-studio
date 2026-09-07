import { chromium, expect } from "@playwright/test";
import fs from "node:fs/promises";
const base = process.env.BASE_URL || "http://127.0.0.1:5198";
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  acceptDownloads: true,
});
const results = [],
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const ids = [];
async function roundtrip(title) {
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Save to cloud", exact: true })
    .click();
  await expect(page.locator('.toast[role="status"]')).toContainText(
    "Saved to your private cloud workspace",
    { timeout: 60000 },
  );
  const list = await page.request
    .get(base + "/api/recordings")
    .then((r) => r.json());
  ids.push(...list.map((r) => r.id));
  await page
    .getByRole("button", { name: "Cloud workspace", exact: true })
    .click();
  await page.getByRole("button", { name: "Open", exact: true }).first().click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator("video")).toHaveCount(3);
  await expect
    .poll(
      () =>
        page
          .locator("video")
          .evaluateAll((v) => v.every((v) => v.readyState >= 2)),
      { timeout: 20000 },
    )
    .toBe(true);
  expect(
    await page
      .locator("video")
      .evaluateAll((v) =>
        v.every((v) => v.getAttribute("src").startsWith("/api/recordings/")),
      ),
  ).toBe(true);
  await page.locator(".stage video").evaluate((v) => (v.currentTime = 9));
  await expect
    .poll(() =>
      page
        .locator(".eye-video")
        .evaluateAll((fs) =>
          Math.max(
            ...fs.map((f) =>
              Math.abs(
                f.querySelector("video").currentTime * 1e6 -
                  Number(f.dataset.targetUs),
              ),
            ),
          ),
        ),
    )
    .toBeLessThan(45000);
  const metadata = await page.request
    .get(base + "/api/recordings/" + list[0].id)
    .then((r) => r.json());
  expect(metadata.videoTracks).toHaveLength(2);
  if (title === "Through both eyes") {
    expect(
      metadata.videoTracks.find((t) => t.role === "left-eye").viewRotation,
    ).toBe(180);
    await expect(page.locator('[data-role="left-eye"] video')).toHaveCSS(
      "transform",
      "matrix(-1, 0, 0, -1, 0, 0)",
    );
  }
  expect(metadata.eyeSignals.length).toBeGreaterThan(4000);
  results.push({
    title,
    tracks: metadata.videoTracks.map((t) => ({
      role: t.role,
      anchors: t.anchors.length,
      frames: t.frameTimes.length,
      viewRotation: t.viewRotation ?? 0,
    })),
    signals: metadata.eyeSignals.length,
  });
  await page.request.delete(base + "/api/recordings/" + list[0].id, {
    headers: { "X-Gaze-Studio": "1" },
  });
}
try {
  await page.goto(base);
  await roundtrip("Through both eyes");
  if (process.env.HARMONIC_PACKAGE) {
    await page.getByRole("button", { name: "Import", exact: true }).click();
    await page
      .locator('input[type=file][accept=".csv,.tsv,.gz,.arff,.zip"]')
      .setInputFiles(process.env.HARMONIC_PACKAGE);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await roundtrip("HARMONIC · through the glasses");
  }
  expect(errors).toEqual([]);
  await fs.writeFile(
    "artifacts/verification/raw-cloud-results.json",
    JSON.stringify(
      { base, time: new Date().toISOString(), results, errors },
      null,
      2,
    ),
  );
  console.log(JSON.stringify(results));
} finally {
  for (const id of new Set(ids))
    await page.request
      .delete(base + "/api/recordings/" + id, {
        headers: { "X-Gaze-Studio": "1" },
      })
      .catch(() => {});
  await browser.close();
}
