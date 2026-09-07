import { describe, it, expect } from "vitest";
import {
  buildSignalRows,
  pointAt,
  signalPath,
} from "../packages/react/src/signal-data";
import type { Recording } from "../packages/core/src/types";
const recording = (): Recording => ({
  id: "signals-test",
  title: "Test only",
  description: "",
  width: 100,
  height: 80,
  duration: 1e6,
  mediaUrl: "",
  mediaName: "",
  mediaType: "image",
  aois: [],
  anchors: [
    { gaze: 0, media: 1000 },
    { gaze: 1e6, media: 1.001e6 },
  ],
  source: { license: "MIT", synthetic: true },
  samples: [
    { t: 0, x: 0, y: 40, valid: true, participant: "A" },
    { t: 10000, x: 20, y: 30, valid: false, participant: "A" },
    { t: 20000, x: 100, y: 80, valid: true, participant: "A" },
  ],
});
describe("synchronized signal tracks", () => {
  it("preserves extrema, invalid breaks and capture gaps during decimation", () => {
    const d = signalPath(
      [
        { t: 0, value: 1 },
        { t: 10, value: 8 },
        { t: 20, value: 2 },
        { t: 25, value: null },
        { t: 30, value: 3 },
        { t: 200000, value: 5 },
      ],
      1e6,
      0,
      10,
      75000,
      1,
    );
    expect((d.match(/M/g) ?? []).length).toBe(3);
    expect(d).toContain("15.20");
    expect(d).toContain("L");
  });
  it("maps raw gaze to scene time, retains screen edges and leaves invalid gaze blank", () => {
    const rows = buildSignalRows(recording(), null, "A");
    expect(rows).toHaveLength(5);
    expect(rows[0].series[0].points).toEqual([
      { t: 1000, value: 0 },
      { t: 11000, value: null },
      { t: 21000, value: 100 },
    ]);
    expect(rows[4].series[0].label).toBe("Validity");
    expect(rows[4].events[0].label).toBe("Invalid gaze");
  });
  it("rejects stale readouts and isolates participants without fabricating binocular gaze", () => {
    const r = recording();
    r.samples.push({ t: 0, x: 999, y: 0, valid: true, participant: "B" });
    r.eyeSignals = [
      { t: 0, eye: "left", pupil: 4, pupilUnit: "mm", confidence: 1 },
    ];
    const rows = buildSignalRows(r, null, "A");
    expect(rows[0].series).toHaveLength(2);
    expect(rows[0].series[0].points.some((p) => p.value === 999)).toBe(false);
    expect(rows[3].series).toHaveLength(0);
    expect(pointAt(rows[0].series[0].points, 200000, 75000)).toBeNull();
    expect(pointAt(rows[0].series[0].points, 500, 75000)).toBeNull();
  });
  it("separates pupil units and hides low-confidence measurements while retaining confidence", () => {
    const r = recording();
    r.eyeSignals = [
      { t: 0, eye: "left", pupil: 4, pupilUnit: "mm", confidence: 1 },
      { t: 10000, eye: "left", pupil: 40, pupilUnit: "px", confidence: 0.2 },
    ];
    const rows = buildSignalRows(r, null, "A");
    expect(rows[3].series.map((s) => s.unit)).toEqual(["mm", "px"]);
    expect(rows[3].series[0].points[1].value).toBeNull();
    expect(rows[3].series[1].points[1].value).toBeNull();
    expect(rows[4].series[0].points[1].value).toBe(20);
  });
});
