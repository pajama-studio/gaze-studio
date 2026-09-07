import { chromium, expect } from "@playwright/test";
import fs from "node:fs/promises";
const base = process.env.BASE_URL || "http://127.0.0.1:5198";
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 1100 },
  acceptDownloads: true,
});
const errors = [],
  results = [];
page.on("pageerror", (e) => errors.push(e.message));
await fs.mkdir("artifacts/verification", { recursive: true });
const check = async (name, fn) => {
  await fn();
  results.push(name);
  console.log("PASS", name);
};
async function sync() {
  await expect
    .poll(() =>
      page
        .locator(".eye-video")
        .evaluateAll((figures) =>
          Math.max(
            ...figures.map((f) =>
              Math.abs(
                f.querySelector("video").currentTime * 1e6 -
                  Number(f.getAttribute("data-target-us")),
              ),
            ),
          ),
        ),
    )
    .toBeLessThan(45000);
}
try {
  await page.goto(base);
  await expect(
    page.getByRole("heading", { name: "Through both eyes", exact: true }),
  ).toBeVisible();
  await check(
    "real left eye, right eye and scene decode from owned Cloudflare assets",
    async () => {
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
      const sources = await page
        .locator("video")
        .evaluateAll((v) =>
          v.map((x) => ({
            width: x.videoWidth,
            height: x.videoHeight,
            url: x.currentSrc,
          })),
        );
      expect(sources.map((s) => s.width)).toEqual([640, 400, 400]);
      expect(
        sources.every((s) => s.url.startsWith(base + "/api/datasets/")),
      ).toBe(true);
      await expect(page.getByLabel("Per-eye pupil timeline")).toBeVisible();
      await expect(page.getByText(/Rust \/ WASM · 1 worker/)).toBeVisible();
    },
  );
  await check(
    "seeking, true frame stepping and two playback speeds keep eye videos synchronized",
    async () => {
      await page
        .locator(".stage video")
        .evaluate((v) => (v.currentTime = 9.123));
      await sync();
      await page
        .getByRole("button", { name: "Next frame or 100 milliseconds" })
        .click();
      await sync();
      for (const speed of ["0.5", "2"]) {
        await page.getByLabel("Playback speed").selectOption(speed);
        await page.getByRole("button", { name: "Play", exact: true }).click();
        await page.waitForTimeout(1200);
        await sync();
        await page.getByRole("button", { name: "Pause", exact: true }).click();
        await sync();
      }
    },
  );
  await check("pupil trace seeks all three camera streams", async () => {
    const plot = page.getByRole("slider", { name: "left pupil timeline" });
    await plot.click({ position: { x: 200, y: 20 } });
    await sync();
    expect(
      await page.locator(".stage video").evaluate((v) => v.currentTime),
    ).toBeGreaterThan(1);
  });
  await check(
    "portable package preserves both actual eye movies, frame clocks and derived signals offline",
    async () => {
      await page.getByRole("button", { name: "Export", exact: true }).click();
      const event = page.waitForEvent("download");
      await page.getByRole("button", { name: "Portable Gaze Package" }).click();
      await (await event).saveAs("artifacts/verification/binocular.gaze.zip");
      await page.getByRole("button", { name: "Import", exact: true }).click();
      await page
        .locator('input[type=file][accept=".csv,.tsv,.gz,.arff,.zip"]')
        .setInputFiles("artifacts/verification/binocular.gaze.zip");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      const result = await page.evaluate(
        () =>
          new Promise((resolve, reject) => {
            const open = indexedDB.open("gaze-studio", 1);
            open.onsuccess = () => {
              const db = open.result;
              const get = db
                .transaction("recordings")
                .objectStore("recordings")
                .get("emotion-p01-0a");
              get.onsuccess = () => {
                const r = get.result;
                db.close();
                resolve({
                  tracks: r.videoTracks.map((t) => ({
                    role: t.role,
                    bytes: t.blob.size,
                    frames: t.frameTimes.length,
                    url: t.url,
                  })),
                  signals: r.eyeSignals.length,
                  samples: r.samples.length,
                });
              };
              get.onerror = () => reject(get.error);
            };
            open.onerror = () => reject(open.error);
          }),
      );
      expect(result.tracks).toHaveLength(2);
      expect(
        result.tracks.every(
          (t) => t.bytes > 1e6 && t.frames > 2300 && t.url.startsWith("blob:"),
        ),
      ).toBe(true);
      expect(result.signals).toBe(4757);
      expect(result.samples).toBe(4757);
    },
  );
  await check(
    "R2/D1 catalog exposes checksums and rejects private raw asset reads",
    async () => {
      const catalog = await page.request
        .get(base + "/api/datasets/emotion-p01-0a")
        .then((r) => r.json());
      expect(
        catalog.assets.some(
          (a) => a.role === "raw" && a.public === 0 && a.sha256.length === 64,
        ),
      ).toBe(true);
      const denied = await page.request.get(
        base + "/api/datasets/emotion-p01-0a/assets/raw/eye0.mp4",
      );
      expect(denied.status()).toBe(404);
      const range = await page.request.get(
        base + "/api/datasets/emotion-p01-0a/assets/eye0.mp4",
        { headers: { Range: "bytes=100-199" } },
      );
      expect(range.status()).toBe(206);
      expect((await range.body()).length).toBe(100);
    },
  );
  await check(
    "standalone reusable replay works independently of Studio",
    async () => {
      const embed = await browser.newPage();
      await embed.goto(base + "/embed/?sample=binocular");
      await expect(embed.locator("video")).toHaveCount(3);
      await expect(embed.getByRole("status")).toContainText("Rust / WASM");
      await embed.close();
    },
  );
  await page.screenshot({
    path: "artifacts/verification/binocular-desktop.png",
    fullPage: true,
  });
  await check("binocular replay fits a mobile viewport", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expect(page.locator("video")).toHaveCount(3);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "artifacts/verification/binocular-mobile.png",
      fullPage: true,
    });
  });
  expect(errors).toEqual([]);
  await fs.writeFile(
    "artifacts/verification/binocular-results.json",
    JSON.stringify(
      { base, time: new Date().toISOString(), results, errors },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
