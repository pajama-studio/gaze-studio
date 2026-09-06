import type { Gaze, Geometry } from "./types";
import { lowerBound } from "./time";
import { quantile } from "./analysis";
export function angularError(
  x: number,
  y: number,
  rx: number,
  ry: number,
  width: number,
  height: number,
  g: Geometry,
) {
  const a = [
    (x / width - 0.5) * g.widthMm,
    (y / height - 0.5) * g.heightMm,
    g.distanceMm,
  ];
  const b = [
    (rx / width - 0.5) * g.widthMm,
    (ry / height - 0.5) * g.heightMm,
    g.distanceMm,
  ];
  return (
    (Math.acos(
      Math.max(
        -1,
        Math.min(
          1,
          a.reduce((sum, v, i) => sum + v * b[i], 0) /
            Math.hypot(...a) /
            Math.hypot(...b),
        ),
      ),
    ) *
      180) /
    Math.PI
  );
}
export function benchmark(
  predictions: Gaze[],
  references: Gaze[],
  tolerance: number,
  width: number,
  height: number,
  geometry?: Geometry,
) {
  if (!Number.isFinite(tolerance) || tolerance < 0)
    throw new Error("Matching tolerance must be non-negative.");
  if (
    ![width, height].every((v) => Number.isFinite(v) && v > 0) ||
    (geometry &&
      !Object.values(geometry).every((v) => Number.isFinite(v) && v > 0))
  )
    throw new Error(
      "Screen dimensions and geometry must be finite and positive.",
    );
  const errors: number[] = [],
    degrees: number[] = [],
    timing: number[] = [],
    byParticipant: Record<string, number[]> = {},
    used = new Set<Gaze>();
  const matchedPairs: { prediction: Gaze; reference: Gaze }[] = [];
  const groups = new Map<string, Gaze[]>();
  for (const r of references)
    if (r.valid && !r.blink && r.x !== null && r.y !== null) {
      const a = groups.get(r.participant) ?? [];
      a.push(r);
      groups.set(r.participant, a);
    }
  for (const g of groups.values()) g.sort((a, b) => a.t - b.t);
  for (const p of [...predictions].sort((a, b) => a.t - b.t)) {
    if (!p.valid || p.blink || p.x === null || p.y === null) continue;
    const g = groups.get(p.participant) ?? [],
      index = lowerBound(g, p.t, (s) => s.t);
    const reference = [g[index - 1], g[index]]
      .filter((v): v is Gaze => !!v && !used.has(v))
      .sort((a, b) => Math.abs(a.t - p.t) - Math.abs(b.t - p.t))[0];
    if (!reference || Math.abs(reference.t - p.t) > tolerance) continue;
    used.add(reference);
    const error = Math.hypot(p.x - reference.x!, p.y - reference.y!);
    errors.push(error);
    timing.push(Math.abs(reference.t - p.t));
    (byParticipant[p.participant] ??= []).push(error);
    matchedPairs.push({ prediction: p, reference });
    if (geometry)
      degrees.push(
        angularError(
          p.x,
          p.y,
          reference.x!,
          reference.y!,
          width,
          height,
          geometry,
        ),
      );
  }
  const stats = (v: number[]) =>
    v.length
      ? {
          mean: v.reduce((a, b) => a + b, 0) / v.length,
          median: quantile(v, 0.5),
          p90: quantile(v, 0.9),
          rmse: Math.sqrt(v.reduce((a, b) => a + b * b, 0) / v.length),
        }
      : null;
  const perParticipant = Object.fromEntries(
    Object.entries(byParticipant).map(([p, e]) => [p, stats(e)]),
  );
  let precisionSquared = 0,
    precisionPairs = 0,
    precisionGroups = 0,
    withinSS = 0,
    degreesOfFreedom = 0;
  for (const participant of Object.keys(byParticipant)) {
    const pairs = matchedPairs.filter(
      (p) => p.prediction.participant === participant,
    );
    let run: typeof pairs = [];
    const emit = () => {
      if (
        run.length < 5 ||
        run.at(-1)!.prediction.t - run[0].prediction.t < 100000
      )
        return;
      precisionGroups++;
      const mx = run.reduce((s, p) => s + p.prediction.x!, 0) / run.length,
        my = run.reduce((s, p) => s + p.prediction.y!, 0) / run.length;
      for (let i = 0; i < run.length; i++) {
        const p = run[i].prediction;
        withinSS += (p.x! - mx) ** 2 + (p.y! - my) ** 2;
        if (i > 0) {
          const prev = run[i - 1].prediction;
          precisionSquared += (p.x! - prev.x!) ** 2 + (p.y! - prev.y!) ** 2;
          precisionPairs++;
        }
      }
      degreesOfFreedom += run.length - 1;
    };
    for (const pair of pairs) {
      const prev = run.at(-1);
      if (
        prev &&
        (pair.reference.x !== prev.reference.x ||
          pair.reference.y !== prev.reference.y ||
          pair.prediction.t - prev.prediction.t > 75000)
      ) {
        emit();
        run = [];
      }
      run.push(pair);
    }
    emit();
  }
  const staticTargetPrecision = precisionPairs
    ? {
        rmsSampleToSamplePx: Math.sqrt(precisionSquared / precisionPairs),
        pooledWithinTargetSDPx: Math.sqrt(withinSS / degreesOfFreedom),
        pairCount: precisionPairs,
        groups: precisionGroups,
        rule: "Exact constant-reference runs, at least 5 matched samples and 100 ms, no gap over 75 ms. Includes settling and drift; define a fixation-only protocol for controlled precision.",
      }
    : null;
  return {
    version: "gaze-studio-benchmark/0.1.0",
    predictions: predictions.length,
    references: references.length,
    matched: errors.length,
    predictionMatchRate: errors.length / (predictions.length || 1),
    referenceCoverage: used.size / (references.length || 1),
    pixelError: stats(errors),
    angularError: stats(degrees),
    matchingErrorUs: stats(timing),
    staticTargetPrecision,
    perParticipant,
    macroMeanPx: Object.values(perParticipant).length
      ? Object.values(perParticipant).reduce((s, v) => s + v!.mean, 0) /
        Object.values(perParticipant).length
      : null,
    toleranceUs: tolerance,
    geometry: geometry ?? null,
    interpretation:
      "Offline error against supplied reference labels. This does not establish real-world webcam accuracy; hold out participants and calibration targets.",
  };
}
