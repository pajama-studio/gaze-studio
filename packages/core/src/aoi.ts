import type { AOI, Point } from "./types";

export function isAutomaticAOI(a: AOI) {
  return a.source === "model" || a.model?.startsWith("recorded-dom:") === true;
}

export function coveredDuration(aois: AOI[], start: number, end: number) {
  const spans = aois
    .map((a) => [Math.max(start, a.start), Math.min(end, a.end)])
    .filter(([lo, hi]) => hi > lo)
    .sort((a, b) => a[0] - b[0]);
  let total = 0,
    last = start;
  for (const [lo, hi] of spans) {
    total += Math.max(0, hi - Math.max(last, lo));
    last = Math.max(last, hi);
  }
  return total;
}
export function pointsAt(aoi: AOI, t: number): Point[] | null {
  if (t < aoi.start || t >= aoi.end || !aoi.keyframes.length) return null;
  let i = 0;
  while (i < aoi.keyframes.length - 1 && aoi.keyframes[i + 1].t <= t) i++;
  const a = aoi.keyframes[i],
    b = aoi.keyframes[i + 1];
  if (!b || t <= a.t || a.points.length !== b.points.length) return a.points;
  const p = (t - a.t) / (b.t - a.t);
  return a.points.map(([x, y], j) => [
    x + (b.points[j][0] - x) * p,
    y + (b.points[j][1] - y) * p,
  ]);
}
export function contains(aoi: AOI, x: number, y: number, t: number): boolean {
  const p = pointsAt(aoi, t);
  if (!p) return false;
  if (aoi.shape !== "polygon") {
    const [a, b] = p;
    const left = Math.min(a[0], b[0]),
      top = Math.min(a[1], b[1]),
      w = Math.abs(b[0] - a[0]),
      h = Math.abs(b[1] - a[1]);
    if (!w || !h) return false;
    return aoi.shape === "rectangle"
      ? x >= left && x <= left + w && y >= top && y <= top + h
      : ((x - left - w / 2) / (w / 2)) ** 2 +
          ((y - top - h / 2) / (h / 2)) ** 2 <=
          1;
  }
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i],
      [xj, yj] = p[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}
export function iou(a: Point[], b: Point[]) {
  const x = Math.max(
    0,
    Math.min(a[1][0], b[1][0]) - Math.max(a[0][0], b[0][0]),
  );
  const y = Math.max(
    0,
    Math.min(a[1][1], b[1][1]) - Math.max(a[0][1], b[0][1]),
  );
  const area = (p: Point[]) =>
    Math.max(0, p[1][0] - p[0][0]) * Math.max(0, p[1][1] - p[0][1]);
  return (x * y) / Math.max(1, area(a) + area(b) - x * y);
}
export function addKeyframe(aoi: AOI, t: number, points: Point[]): AOI {
  return {
    ...aoi,
    keyframes: [...aoi.keyframes.filter((k) => k.t !== t), { t, points }].sort(
      (a, b) => a.t - b.t,
    ),
  };
}
