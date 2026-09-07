import type { Analysis, Fixation, Gaze, Recording, Settings } from "./types";
import { contains, isAutomaticAOI } from "./aoi";
import { mapTime } from "./time";
export function quantile(values: number[], q: number) {
  if (!values.length) return 0;
  const a = [...values].sort((x, y) => x - y),
    p = (a.length - 1) * q,
    i = Math.floor(p);
  return a[i] + (a[Math.min(i + 1, a.length - 1)] - a[i]) * (p - i);
}
const usable = (s: Gaze) =>
  s.valid &&
  s.x !== null &&
  s.y !== null &&
  Number.isFinite(s.x) &&
  Number.isFinite(s.y) &&
  !s.blink;
export function detectFixations(
  samples: Gaze[],
  settings: Settings,
): Fixation[] {
  const result: Fixation[] = [];
  const segments: Gaze[][] = [];
  let current: Gaze[] = [];
  for (const s of samples) {
    if (
      !usable(s) ||
      (current.length && s.t - current.at(-1)!.t > settings.maxGap)
    ) {
      if (current.length) segments.push(current);
      current = [];
    }
    if (usable(s)) current.push(s);
  }
  if (current.length) segments.push(current);
  const emit = (a: Gaze[]) => {
    if (a.length < 2 || a.at(-1)!.t - a[0].t < settings.minFixation) return;
    result.push({
      start: a[0].t,
      end: a.at(-1)!.t,
      x: a.reduce((n, s) => n + s.x!, 0) / a.length,
      y: a.reduce((n, s) => n + s.y!, 0) / a.length,
      participant: a[0].participant,
    });
  };
  for (const segment of segments) {
    if (settings.method === "ivt") {
      let run = [segment[0]];
      for (let i = 1; i < segment.length; i++) {
        const a = segment[i - 1],
          b = segment[i],
          dt = b.t - a.t,
          velocity =
            dt > 0
              ? Math.hypot(b.x! - a.x!, b.y! - a.y!) / (dt / 1e6)
              : Infinity;
        if (velocity > settings.velocity) {
          emit(run);
          run = [];
        }
        run.push(b);
      }
      emit(run);
    } else {
      let start = 0;
      while (start < segment.length - 1) {
        let end = start,
          minX = Infinity,
          maxX = -Infinity,
          minY = Infinity,
          maxY = -Infinity;
        while (end < segment.length) {
          const s = segment[end];
          const nx = Math.min(minX, s.x!),
            xx = Math.max(maxX, s.x!),
            ny = Math.min(minY, s.y!),
            xy = Math.max(maxY, s.y!);
          if (xx - nx + xy - ny > settings.dispersion) break;
          minX = nx;
          maxX = xx;
          minY = ny;
          maxY = xy;
          end++;
        }
        if (
          end > start &&
          segment[end - 1].t - segment[start].t >= settings.minFixation
        ) {
          emit(segment.slice(start, end));
          start = end;
        } else start++;
      }
    }
  }
  return result;
}
export function analyze(recording: Recording, settings: Settings): Analysis {
  const start = Math.max(0, settings.start),
    end = Math.min(recording.duration, settings.end);
  const selected = recording.samples
    .filter(
      (s) =>
        settings.participant === "all" ||
        s.participant === settings.participant,
    )
    .map((s) => ({ ...s, t: mapTime(s.t, recording.anchors) }));
  const groups = new Map<string, Gaze[]>();
  for (const s of selected) {
    const group = groups.get(s.participant) ?? [];
    group.push(s);
    groups.set(s.participant, group);
  }
  const aois = recording.aois.filter(
    (a) =>
      a.accepted && (settings.aoiScope !== "automatic" || isAutomaticAOI(a)),
  );
  const metrics = aois.map((a) => ({
    id: a.id,
    name: a.name,
    dwell: 0,
    visits: 0,
    ttff: null as number | null,
    fixationCount: 0,
    fixationDuration: 0,
  }));
  const result: Analysis = {
    samples: 0,
    validSamples: 0,
    duration: Math.max(0, end - start) * groups.size,
    validTime: 0,
    coverage: 0,
    medianHz: 0,
    gaps: 0,
    fixations: [],
    aoi: metrics,
    transitions: [],
    sequences: [],
    pupil: { mean: null, count: 0 },
    blinkSamples: 0,
    velocities: [],
    parameters: { ...settings, start, end },
    version: "gaze-studio-analysis/0.1.0",
  };
  const intervals: number[] = [],
    pupils: number[] = [],
    transitions = new Map<string, number>();
  for (const [participant, data] of groups) {
    data.sort((a, b) => a.t - b.t);
    const range = data.filter((s) => s.t >= start && s.t <= end);
    const fixes = detectFixations(range, settings);
    result.fixations.push(...fixes);
    result.samples += range.length;
    result.validSamples += range.filter(usable).length;
    result.blinkSamples += range.filter((s) => s.blink).length;
    for (const s of range)
      if (usable(s) && Number.isFinite(s.pupil) && s.pupil! > 0)
        pupils.push(s.pupil!);
    let previousHits = new Set<string>();
    let previousPrimary: string | null = null;
    for (let i = 0; i < data.length - 1; i++) {
      const a = data[i],
        b = data[i + 1];
      if (b.t <= start || a.t >= end) continue;
      const dt = b.t - a.t,
        lo = Math.max(start, a.t),
        hi = Math.min(end, b.t);
      if (dt > 0) intervals.push(dt);
      if (dt > settings.maxGap) result.gaps++;
      const valid = dt > 0 && dt <= settings.maxGap && usable(a) && usable(b);
      if (valid) {
        result.validTime += hi - lo;
        result.velocities.push({
          t: a.t,
          v: Math.hypot(b.x! - a.x!, b.y! - a.y!) / (dt / 1e6),
        });
      }
      const boundaries = [
        ...new Set([
          lo,
          hi,
          ...aois
            .flatMap((o) => [o.start, o.end])
            .filter((t) => t > lo && t < hi),
        ]),
      ].sort((a, b) => a - b);
      for (let k = 0; k < boundaries.length - 1; k++) {
        const segmentStart = boundaries[k],
          segmentEnd = boundaries[k + 1];
        const hits = new Set(
          valid
            ? aois
                .filter((o) => contains(o, a.x!, a.y!, segmentStart))
                .map((o) => o.id)
            : [],
        );
        for (const metric of metrics)
          if (hits.has(metric.id)) {
            metric.dwell += segmentEnd - segmentStart;
            if (!previousHits.has(metric.id)) metric.visits++;
          }
        const primary = hits.values().next().value ?? null;
        if (previousPrimary && primary && primary !== previousPrimary) {
          const key = JSON.stringify([previousPrimary, primary]);
          transitions.set(key, (transitions.get(key) ?? 0) + 1);
        }
        const last = result.sequences.at(-1);
        if (
          last &&
          last.participant === participant &&
          last.aoi === primary &&
          last.end === segmentStart
        )
          last.end = segmentEnd;
        else
          result.sequences.push({
            start: segmentStart,
            end: segmentEnd,
            aoi: primary,
            participant,
          });
        previousHits = hits;
        previousPrimary = primary;
      }
    }
    for (const fix of fixes)
      for (let i = 0; i < aois.length; i++)
        if (contains(aois[i], fix.x, fix.y, fix.start)) {
          const m = metrics[i];
          m.fixationCount++;
          m.fixationDuration += fix.end - fix.start;
          const ttff = fix.start - Math.max(start, aois[i].start);
          m.ttff = Math.min(m.ttff ?? Infinity, Math.max(0, ttff));
        }
  }
  result.coverage = result.duration ? result.validTime / result.duration : 0;
  result.medianHz = intervals.length ? 1e6 / quantile(intervals, 0.5) : 0;
  result.pupil = {
    mean: pupils.length
      ? pupils.reduce((a, b) => a + b, 0) / pupils.length
      : null,
    count: pupils.length,
  };
  result.transitions = [...transitions].map(([key, count]) => {
    const [from, to] = JSON.parse(key);
    return { from, to, count };
  });
  return result;
}
