import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import init, {
  analyze_json,
  merge_json,
} from "../packages/analysis/wasm/gaze_core.js";
import { analyze } from "../src/core/analysis";
import { fixture } from "./fixtures/recording";
import {
  DEFAULT_SETTINGS,
  type Recording,
  type Settings,
} from "../src/core/types";
beforeAll(async () => {
  await init({
    module_or_path: readFileSync(
      new URL("../packages/analysis/wasm/gaze_core_bg.wasm", import.meta.url),
    ),
  });
});
function compare(a: any, b: any, path = "root") {
  if (path.endsWith(".version")) return;
  if (typeof b === "number") {
    expect(a, path).toBeCloseTo(b, 5);
    return;
  }
  if (Array.isArray(b)) {
    expect(a.length, path).toBe(b.length);
    b.forEach((v, i) => compare(a[i], v, `${path}[${i}]`));
    return;
  }
  if (b && typeof b === "object") {
    for (const k of Object.keys(b)) compare(a[k], b[k], path + "." + k);
    return;
  }
  expect(a, path).toEqual(b);
}
function run(r: Recording, s: Settings, partition = false) {
  const groups = partition
    ? [...new Set(r.samples.map((x) => x.participant))].map((p) =>
        r.samples.filter((x) => x.participant === p),
      )
    : [r.samples];
  const parts = groups.map((samples) =>
    JSON.parse(
      analyze_json(
        JSON.stringify({ recording: { ...r, samples }, settings: s }),
      ),
    ),
  );
  return JSON.parse(merge_json(JSON.stringify(parts)));
}
describe("compiled Rust WASM differential validation", () => {
  const real = JSON.parse(
    readFileSync(
      new URL("../public/datasets/gazemining.json", import.meta.url),
      "utf8",
    ),
  ) as Recording;
  for (const method of ["ivt", "idt"] as const)
    for (const scope of ["all", "automatic"] as const) {
      for (const [name, recording] of [
        ["three-participant fixture", fixture()],
        ["real GazeMining", real],
      ] as const) {
        it(`${method} ${scope}: ${name}, pooled and partitioned`, () => {
          const settings = {
            ...DEFAULT_SETTINGS,
            method,
            aoiScope: scope,
            start: 230000,
            end: Math.min(recording.duration, 17e6),
          };
          const ref = analyze(recording, settings);
          compare(run(recording, settings), ref);
          compare(run(recording, settings, true), ref);
        });
      }
    }
  it("invalid samples, blinks, irregular intervals, clock drift, polygon animation and participant filter", () => {
    const r = fixture();
    r.anchors = [
      { gaze: 0, media: 1234 },
      { gaze: r.duration, media: r.duration * 1.03 },
    ];
    r.samples = r.samples.map((s, i) => ({
      ...s,
      valid: s.valid && i % 11 !== 0,
      blink: i % 23 === 0,
      pupil: i % 9 === 0 ? undefined : 3 + (i % 4) / 10,
    }));
    for (const participant of ["all", "P01", "missing"]) {
      const settings = {
        ...DEFAULT_SETTINGS,
        participant,
        start: 500000,
        end: 8e6,
      };
      compare(run(r, settings, true), analyze(r, settings));
    }
  });
});

it("Rust saccade candidates preserve participant isolation, window and mapped media clocks", () => {
  const r = fixture();
  r.anchors = [{ gaze: 0, media: 10000 }];
  r.samples = [
    { t: 0, x: 0, y: 0, valid: true, participant: "A" },
    { t: 10000, x: 20, y: 0, valid: true, participant: "A" },
    { t: 20000, x: 50, y: 0, valid: true, participant: "A" },
    { t: 0, x: 100, y: 0, valid: true, participant: "B" },
    { t: 10000, x: 110, y: 0, valid: true, participant: "B" },
  ];
  const settings = { ...DEFAULT_SETTINGS, start: 0, end: r.duration };
  const result = run(r, settings, true);
  expect(result.saccades).toHaveLength(2);
  expect(result.saccades[0]).toMatchObject({
    start: 10000,
    end: 30000,
    amplitude: 50,
    peakVelocity: 3000,
    participant: "A",
  });
  expect(
    run(r, { ...settings, participant: "A", start: 20000 }, true).saccades,
  ).toEqual([
    expect.objectContaining({
      start: 20000,
      end: 30000,
      amplitude: 30,
      participant: "A",
    }),
  ]);
});
