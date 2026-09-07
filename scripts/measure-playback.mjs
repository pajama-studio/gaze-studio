import { chromium, expect } from "@playwright/test";
import fs from "node:fs/promises";
const urls = process.argv.slice(2);
if (!urls.length) urls.push("http://127.0.0.1:8798");
const browser = await chromium.launch();
const results = [];
try {
  for (const url of urls) {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Performance.enable");
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await page.goto(url);
    await expect(
      page.getByRole("heading", { name: "Through both eyes", exact: true }),
    ).toBeVisible();
    await expect
      .poll(
        () =>
          page
            .locator("video")
            .evaluateAll((v) => v.every((e) => e.readyState >= 3)),
        { timeout: 20000 },
      )
      .toBe(true);
    await expect(
      page.locator(".metric").first().locator("strong"),
    ).not.toHaveText("—");
    await page.locator(".stage video").evaluate((v) => (v.currentTime = 2));
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      window.__perf = {
        longTasks: [],
        frames: [],
        last: performance.now(),
        stop: false,
      };
      new PerformanceObserver((list) =>
        window.__perf.longTasks.push(
          ...list.getEntries().map((e) => e.duration),
        ),
      ).observe({ type: "longtask" });
      const raf = () => {
        const p = window.__perf,
          n = performance.now();
        p.frames.push(n - p.last);
        p.last = n;
        if (!p.stop) requestAnimationFrame(raf);
      };
      requestAnimationFrame(raf);
    });
    const metric = async () =>
      Object.fromEntries(
        (await cdp.send("Performance.getMetrics")).metrics.map((m) => [
          m.name,
          m.value,
        ]),
      );
    const before = await metric();
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await page.waitForTimeout(5000);
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    const after = await metric();
    const capture = await page.evaluate(() => {
      window.__perf.stop = true;
      return {
        ...window.__perf,
        videos: [...document.querySelectorAll("video")].map((v) => {
          const q = v.getVideoPlaybackQuality();
          return { decoded: q.totalVideoFrames, dropped: q.droppedVideoFrames };
        }),
      };
    });
    const sorted = capture.frames.slice(2).sort((a, b) => a - b);
    const stats = {
      url,
      cpuThrottle: 4,
      seconds: 5,
      scriptMs: (after.ScriptDuration - before.ScriptDuration) * 1000,
      taskMs: (after.TaskDuration - before.TaskDuration) * 1000,
      layoutMs: (after.LayoutDuration - before.LayoutDuration) * 1000,
      rafP95Ms: sorted[Math.floor(sorted.length * 0.95)],
      longTasks: capture.longTasks,
      videos: capture.videos,
    };
    results.push(stats);
    console.log(JSON.stringify(stats));
    await page.close();
  }
} finally {
  await browser.close();
}
await fs.writeFile(
  process.env.PERFORMANCE_REPORT ||
    "artifacts/verification/playback-performance.json",
  JSON.stringify(
    {
      time: new Date().toISOString(),
      results,
      note: "Same host, Chromium, 4x CPU throttle, 5 s playback after media ready. No universal FPS or device-speed claim.",
    },
    null,
    2,
  ),
);
