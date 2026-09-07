import type { Analysis, Recording } from "@pajama-studio/gaze-core";
import { mapTime } from "@pajama-studio/gaze-core/time";
export const SIGNAL_TRACKS = [
  { id: "gaze", label: "Gaze position" },
  { id: "fixations", label: "Fixations" },
  { id: "saccades", label: "Saccade candidates" },
  { id: "pupil", label: "Pupil diameter" },
  { id: "quality", label: "Tracking quality" },
] as const;
export type SignalTrackId = (typeof SIGNAL_TRACKS)[number]["id"];
export interface SignalPoint {
  t: number;
  value: number | null;
}
export interface SignalSeries {
  label: string;
  color: string;
  unit: string;
  points: SignalPoint[];
  min: number;
  max: number;
}
export interface SignalEvent {
  id: string;
  start: number;
  end: number;
  label: string;
  detail: string;
  color: string;
}
export interface SignalRow {
  id: SignalTrackId;
  label: string;
  description: string;
  series: SignalSeries[];
  events: SignalEvent[];
  empty: string;
}
/** Retain extrema and endpoints per pixel bucket. Explicit invalid samples and
 * capture gaps always break paths, including inside a bucket. */
export function signalPath(
  points: SignalPoint[],
  duration: number,
  min: number,
  max: number,
  maxGap: number,
  bins = 1000,
) {
  const out: string[] = [];
  let group: SignalPoint[] = [];
  let bucket = -1;
  let previous = -Infinity;
  let connected = false;
  function flush() {
    if (!group.length) return;
    const low = group.reduce((a, b) => (a.value! <= b.value! ? a : b)),
      high = group.reduce((a, b) => (a.value! >= b.value! ? a : b));
    const keep = [
      ...new Set([group[0], low, high, group[group.length - 1]]),
    ].sort((a, b) => a.t - b.t);
    for (const p of keep) {
      const x = (p.t / duration) * 1000,
        y = 44 - ((p.value! - min) / Math.max(1e-9, max - min)) * 36;
      out.push(`${connected ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`);
      connected = true;
    }
    group = [];
  }
  for (const p of points) {
    if (p.value === null || !Number.isFinite(p.value)) {
      flush();
      connected = false;
      previous = -Infinity;
      bucket = -1;
      continue;
    }
    if (p.t - previous > maxGap) {
      flush();
      connected = false;
    }
    const next = Math.floor((p.t / duration) * bins);
    if (next !== bucket) {
      flush();
      bucket = next;
    }
    group.push(p);
    previous = p.t;
  }
  flush();
  return out.join(" ");
}
export function pointAt(
  points: SignalPoint[],
  time: number,
  maxGap: number,
): SignalPoint | null {
  let lo = 0,
    hi = points.length;
  while (lo < hi) {
    const m = (lo + hi) >>> 1;
    if (points[m].t <= time) lo = m + 1;
    else hi = m;
  }
  const p = points[lo - 1];
  return p && time - p.t <= maxGap ? p : null;
}
const series = (
  label: string,
  color: string,
  unit: string,
  points: SignalPoint[],
  limit = 1,
): SignalSeries => ({
  label,
  color,
  unit,
  points,
  min: points.reduce((m, p) => Math.min(m, p.value ?? m), 0),
  max: points.reduce((m, p) => Math.max(m, p.value ?? m), limit),
});
export function buildSignalRows(
  r: Recording,
  analysis: Analysis | null,
  participant: string,
): SignalRow[] {
  const samples = r.samples
    .filter((g) => g.participant === participant)
    .map((g) => ({ ...g, t: mapTime(g.t, r.anchors) }))
    .sort((a, b) => a.t - b.t);
  const usable = (g: (typeof samples)[number]) =>
    g.valid && !g.blink && g.x !== null && g.y !== null;
  const rows: SignalRow[] = SIGNAL_TRACKS.map((t) => ({
    ...t,
    description: "",
    series: [],
    events: [],
    empty: "No data in this recording",
  }));
  const [gaze, fixations, saccades, pupil, quality] = rows;
  gaze.description = `${r.width} × ${r.height} scene pixels · ${participant}`;
  gaze.series = [
    series(
      "X",
      "#6caaf0",
      "px",
      samples.map((g) => ({ t: g.t, value: usable(g) ? g.x : null })),
      r.width,
    ),
    series(
      "Y",
      "#e5ad62",
      "px",
      samples.map((g) => ({ t: g.t, value: usable(g) ? g.y : null })),
      r.height,
    ),
  ];
  fixations.description = `${analysis?.parameters.method.toUpperCase() ?? "I-VT"} · ${((analysis?.parameters.minFixation ?? 100000) / 1000).toFixed(0)} ms minimum`;
  fixations.empty = analysis
    ? "No fixations in the analysis window"
    : "Analyzing fixations…";
  fixations.events = (analysis?.fixations ?? [])
    .filter((f) => f.participant === participant)
    .map((f, i) => ({
      id: `fixation-${i}`,
      start: f.start,
      end: f.end,
      label: `Fixation ${i + 1}`,
      color: "#56baa7",
      detail: `${((f.end - f.start) / 1000).toFixed(1)} ms · center ${f.x.toFixed(1)}, ${f.y.toFixed(1)} px · ${f.participant}`,
    }));
  saccades.description = `Velocity > ${analysis?.parameters.velocity ?? 800} px/s · ≥10 ms`;
  saccades.empty = analysis
    ? "No above-threshold intervals in the analysis window"
    : "Analyzing saccade candidates…";
  saccades.events = (analysis?.saccades ?? [])
    .filter((s) => s.participant === participant)
    .map((s, i) => ({
      id: `saccade-${i}`,
      start: s.start,
      end: s.end,
      label: `Saccade candidate ${i + 1}`,
      color: "#eca869",
      detail: `${((s.end - s.start) / 1000).toFixed(1)} ms · amplitude ${s.amplitude.toFixed(1)} px · peak ${s.peakVelocity.toFixed(0)} px/s · ${s.participant}`,
    }));
  // EyeSignal currently describes one recording participant. Do not attach it
  // to another participant if an imported recording contains multiple people.
  const singleParticipant =
    new Set(r.samples.map((g) => g.participant)).size === 1;
  const eyeSignals = singleParticipant ? (r.eyeSignals ?? []) : [];
  for (const [eye, color] of [
    ["left", "#56c7ae"],
    ["right", "#b197ed"],
  ] as const) {
    const all = eyeSignals
      .filter((s) => s.eye === eye)
      .map((s) => ({ ...s, t: mapTime(s.t, r.anchors) }))
      .sort((a, b) => a.t - b.t);
    if (!all.length) continue;
    for (const unit of new Set(all.map((s) => s.pupilUnit)))
      pupil.series.push(
        series(
          eye === "left" ? "Left" : "Right",
          color,
          unit,
          all.map((s) => ({
            t: s.t,
            value:
              s.pupilUnit === unit &&
              s.confidence >= 0.6 &&
              s.pupil !== null &&
              s.pupil > 0
                ? s.pupil
                : null,
          })),
        ),
      );
    quality.series.push(
      series(
        eye === "left" ? "Left" : "Right",
        color,
        "%",
        all.map((s) => ({ t: s.t, value: s.confidence * 100 })),
        100,
      ),
    );
  }
  if (!pupil.series.length && samples.some((g) => g.pupil !== undefined))
    pupil.series.push(
      series(
        "Pupil",
        "#b197ed",
        "arbitrary",
        samples.map((g) => ({
          t: g.t,
          value:
            usable(g) && g.pupil !== undefined && g.pupil > 0 ? g.pupil : null,
        })),
      ),
    );
  pupil.description = pupil.series.length
    ? "Recorded pupil measurements · gaps preserved"
    : "Pupil measurements not supplied";
  quality.description = quality.series.length
    ? "Per-eye detection confidence · below 60% shaded"
    : "Sample validity · not confidence";
  if (!quality.series.length)
    quality.series.push(
      series(
        "Validity",
        "#70b3e2",
        "%",
        samples.map((g) => ({ t: g.t, value: usable(g) ? 100 : 0 })),
        100,
      ),
    );
  const maxGap = analysis?.parameters.maxGap ?? 75000;
  // Missing/invalid data are quality intervals, never silently classified as blinks.
  for (let i = 0; i < samples.length - 1; i++) {
    const a = samples[i],
      b = samples[i + 1];
    if (b.t <= a.t) continue;
    const kind =
      b.t - a.t > maxGap
        ? "Capture gap"
        : a.blink
          ? "Recorded blink"
          : !usable(a)
            ? "Invalid gaze"
            : null;
    if (!kind) continue;
    const end = Math.min(r.duration, b.t),
      start = Math.max(0, a.t);
    if (end <= start) continue;
    const last = quality.events.at(-1);
    if (last?.label === kind && last.end === start) last.end = end;
    else
      quality.events.push({
        id: `quality-${i}`,
        start,
        end,
        label: kind,
        detail:
          kind === "Recorded blink"
            ? "Blink flag supplied by source"
            : "Missing or unusable gaze; this is not a blink classification",
        color: kind === "Recorded blink" ? "#db91c0" : "#bf6c79",
      });
  }
  return rows;
}
