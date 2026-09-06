import type { AOI, Point, Recording } from "./types";
import { PALETTE } from "./types";
import { iou } from "./aoi";
import { api, connectCloud } from "./storage";
export async function detectAOIs(
  recording: Recording,
  times: number[],
  progress: (text: string) => void,
  signal?: AbortSignal,
): Promise<AOI[]> {
  await connectCloud();
  const media = document.createElement(
    recording.mediaType === "video" ? "video" : "img",
  ) as HTMLVideoElement | HTMLImageElement;
  media.crossOrigin = "anonymous";
  if (media instanceof HTMLVideoElement) {
    media.muted = true;
    media.preload = "auto";
  }
  const ready = new Promise<void>((resolve, reject) => {
    media.addEventListener(
      recording.mediaType === "video" ? "loadeddata" : "load",
      () => resolve(),
      { once: true },
    );
    media.addEventListener(
      "error",
      () => reject(new Error("Could not decode media for detection.")),
      { once: true },
    );
  });
  media.src = recording.mediaUrl;
  await ready;
  const canvas = document.createElement("canvas"),
    ratio = Math.min(1, 960 / recording.width);
  canvas.width = Math.round(recording.width * ratio);
  canvas.height = Math.round(recording.height * ratio);
  const context = canvas.getContext("2d")!;
  const proposals: AOI[] = [];
  let previousHistogram: number[] | null = null;
  let lastFrame = -Infinity;
  try {
    for (let i = 0; i < times.length; i++) {
      signal?.throwIfAborted();
      const t = times[i];
      progress(`Detecting objects · frame ${i + 1} of ${times.length}`);
      if (
        media instanceof HTMLVideoElement &&
        Math.abs(media.currentTime - t / 1e6) > 0.001
      )
        await new Promise<void>((resolve) => {
          media.addEventListener("seeked", () => resolve(), { once: true });
          media.currentTime = t / 1e6;
        });
      context.drawImage(media, 0, 0, canvas.width, canvas.height);
      const pixels = context.getImageData(
          0,
          0,
          canvas.width,
          canvas.height,
        ).data,
        hist = Array(24).fill(0);
      let count = 0;
      for (let p = 0; p < pixels.length; p += 64) {
        for (let c = 0; c < 3; c++) hist[c * 8 + (pixels[p + c] >>> 5)]++;
        count++;
      }
      const h = hist.map((v) => v / count);
      const cut =
        previousHistogram &&
        h.reduce((s, v, j) => s + Math.abs(v - previousHistogram![j]), 0) > 1.1;
      previousHistogram = h;
      const blob = await new Promise<Blob>((resolve) =>
        canvas.toBlob((b) => resolve(b!), "image/jpeg", 0.85),
      );
      const response = await api("/detect", {
        method: "POST",
        headers: { "Content-Type": "image/jpeg" },
        body: blob,
        signal,
      }).then((r) => r.json());
      if (!Array.isArray(response.detections))
        throw new Error("Unexpected detector response.");
      const matched = new Set<string>();
      for (const d of response.detections) {
        if (d.score < 0.65 || !d.box) continue;
        const b = d.box;
        const points: Point[] = [
          [b.xmin / ratio, b.ymin / ratio],
          [b.xmax / ratio, b.ymax / ratio],
        ];
        if (points.some((p) => p.some((v) => !Number.isFinite(v)))) continue;
        const candidates = !cut
          ? proposals
              .filter(
                (a) =>
                  !matched.has(a.id) &&
                  a.name === d.label &&
                  a.keyframes.at(-1)!.t === lastFrame,
              )
              .map((a) => ({
                a,
                score: iou(a.keyframes.at(-1)!.points, points),
              }))
              .sort((a, b) => b.score - a.score)
          : [];
        const existing = candidates[0]?.score > 0.25 ? candidates[0].a : null;
        const end = Math.min(
          recording.duration,
          t +
            (times[i + 1]
              ? times[i + 1] - t
              : times.length > 1
                ? times[i] - times[i - 1]
                : 1e6),
        );
        if (existing) {
          existing.keyframes.push({ t, points });
          existing.end = end;
          existing.score = Math.min(existing.score!, d.score);
          matched.add(existing.id);
        } else {
          const a: AOI = {
            id: crypto.randomUUID(),
            name: String(d.label),
            shape: "rectangle",
            color: PALETTE[proposals.length % PALETTE.length],
            start: t,
            end,
            keyframes: [{ t, points }],
            source: "model",
            model: response.model,
            score: d.score,
            accepted: false,
          };
          proposals.push(a);
          matched.add(a.id);
        }
      }
      lastFrame = t;
    }
  } finally {
    media.removeAttribute("src");
    if (media instanceof HTMLVideoElement) media.load();
  }
  return proposals;
}
