import type { Anchor, Gaze } from "./types";
export function validateAnchors(anchors: Anchor[]) {
  if (!anchors.length)
    throw new Error("At least one synchronization anchor is required.");
  anchors.forEach((a, i) => {
    if (
      ![a.gaze, a.media].every(Number.isSafeInteger) ||
      (i > 0 &&
        (a.gaze <= anchors[i - 1].gaze || a.media <= anchors[i - 1].media))
    )
      throw new Error(
        "Clock anchors must increase strictly in both clocks (integer microseconds).",
      );
  });
}
// Explicit linear extrapolation at both ends; one anchor is a fixed offset.
export function mapTime(t: number, anchors: Anchor[], inverse = false): number {
  const input = inverse ? "media" : "gaze",
    output = inverse ? "gaze" : "media";
  if (anchors.length === 1) return t - anchors[0][input] + anchors[0][output];
  const i = Math.max(
    0,
    Math.min(anchors.length - 2, lowerBound(anchors, t, (a) => a[input]) - 1),
  );
  const a = anchors[i],
    b = anchors[i + 1];
  return (
    a[output] +
    ((t - a[input]) * (b[output] - a[output])) / (b[input] - a[input])
  );
}
export function lowerBound<T>(
  items: T[],
  t: number,
  value: (item: T) => number,
): number {
  let lo = 0,
    hi = items.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (value(items[mid]) < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
export function frameAt(times: number[], t: number) {
  const i = lowerBound(times, t, (x) => x);
  return i < times.length && times[i] === t ? i : Math.max(0, i - 1);
}
export function sampleWindow(samples: Gaze[], t: number, trail = 500000) {
  return samples.slice(
    lowerBound(samples, t - trail, (s) => s.t),
    lowerBound(samples, t + 1, (s) => s.t),
  );
}
export function relativeTime(
  value: string,
  unit: "s" | "ms" | "us" | "ns",
  origin = "0",
): number {
  if (unit === "ns") {
    if (!/^-?\d+$/.test(value) || !/^-?\d+$/.test(origin))
      throw new Error("Nanosecond timestamps must be integers.");
    const delta = BigInt(value) - BigInt(origin);
    const result = Number(delta / 1000n);
    if (!Number.isSafeInteger(result))
      throw new Error("Timestamp range exceeds safe integer microseconds.");
    return result;
  }
  const result = Math.round(
    (Number(value) - Number(origin)) * { s: 1e6, ms: 1e3, us: 1 }[unit],
  );
  if (!Number.isSafeInteger(result))
    throw new Error("Invalid timestamp or unsafe timestamp range.");
  return result;
}
