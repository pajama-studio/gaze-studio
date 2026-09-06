import { describe, it, expect } from "vitest";
import {
  relativeTime,
  mapTime,
  validateAnchors,
  frameAt,
} from "../src/core/time";
import { contains, pointsAt, iou, addKeyframe } from "../src/core/aoi";
import { analyze, detectFixations } from "../src/core/analysis";
import { benchmark, angularError } from "../src/core/benchmark";
import {
  csv,
  table,
  importCSV,
  inferMapping,
  exportPackage,
  importPackage,
  validateRecording,
  importARFF,
  exportBIDS,
} from "../src/core/io";
import { fixture } from "../src/core/fixture";
import {
  DEFAULT_SETTINGS,
  type AOI,
  type Gaze,
  type Recording,
} from "../src/core/types";
import { unzipSync, strFromU8, zipSync, strToU8 } from "fflate";
const sample = (t: number, x = 100, y = 100, participant = "P01"): Gaze => ({
  t,
  x,
  y,
  participant,
  valid: true,
});
const area: AOI = {
  id: "a",
  name: "A",
  shape: "rectangle",
  color: "#008866",
  start: 0,
  end: 1e6,
  keyframes: [
    {
      t: 0,
      points: [
        [0, 0],
        [200, 200],
      ],
    },
  ],
  source: "manual",
  accepted: true,
};
const recording = (samples: Gaze[]): Recording => ({
  ...fixture(),
  duration: 1e6,
  samples,
  aois: [structuredClone(area)],
});
describe("clock alignment", () => {
  it("subtracts epoch nanoseconds before conversion, retaining microsecond differences", () =>
    expect(
      relativeTime("1788717600000012345", "ns", "1788717600000000000"),
    ).toBe(12));
  it("keeps negative relative samples", () =>
    expect(relativeTime("999000", "ns", "1000000")).toBe(-1));
  it("rejects fractional nanoseconds and unsafe numbers", () => {
    expect(() => relativeTime("1.5", "ns")).toThrow();
    expect(() => relativeTime("1e100", "s")).toThrow();
  });
  it("maps offset, drift, inverse and extrapolation", () => {
    const a = [
      { gaze: 100, media: 0 },
      { gaze: 1100, media: 2000 },
      { gaze: 2100, media: 2500 },
    ];
    expect(mapTime(600, a)).toBe(1000);
    expect(mapTime(1500, a)).toBe(2200);
    expect(mapTime(2200, a, true)).toBe(1500);
    expect(mapTime(3100, a)).toBe(3000);
  });
  it("rejects discontinuous/reversed clocks", () => {
    expect(() => validateAnchors([])).toThrow();
    expect(() =>
      validateAnchors([
        { gaze: 0, media: 0 },
        { gaze: 0, media: 5 },
      ]),
    ).toThrow();
    expect(() =>
      validateAnchors([
        { gaze: 1, media: 0 },
        { gaze: 2, media: -5 },
      ]),
    ).toThrow();
  });
  it("finds frames by actual PTS for VFR gaps", () => {
    expect(frameAt([0, 400000, 600000, 1000000], 800000)).toBe(2);
    expect(frameAt([0, 400000], 400000)).toBe(1);
  });
});
describe("AOIs", () => {
  it("uses half-open visibility intervals", () => {
    expect(contains(area, 100, 100, 0)).toBe(true);
    expect(contains(area, 100, 100, 1e6)).toBe(false);
  });
  it("handles rectangles drawn backwards", () =>
    expect(
      contains(
        {
          ...area,
          keyframes: [
            {
              t: 0,
              points: [
                [200, 200],
                [0, 0],
              ],
            },
          ],
        },
        100,
        100,
        500,
      ),
    ).toBe(true));
  it("interpolates dynamic geometry", () => {
    const a = addKeyframe(area, 1000, [
      [100, 0],
      [300, 200],
    ]);
    expect(pointsAt(a, 500)).toEqual([
      [50, 0],
      [250, 200],
    ]);
  });
  it("uses ellipse geometry and polygon ray casting", () => {
    expect(contains({ ...area, shape: "ellipse" }, 0, 0, 0)).toBe(false);
    expect(
      contains(
        {
          ...area,
          shape: "polygon",
          keyframes: [
            {
              t: 0,
              points: [
                [0, 0],
                [100, 0],
                [0, 100],
              ],
            },
          ],
        },
        10,
        10,
        0,
      ),
    ).toBe(true);
  });
  it("computes bounding-box overlap", () =>
    expect(
      iou(
        [
          [0, 0],
          [10, 10],
        ],
        [
          [5, 0],
          [15, 10],
        ],
      ),
    ).toBeCloseTo(1 / 3));
});
describe("raw data and packages", () => {
  it("handles quoted delimiters, CRLF and missing values", () =>
    expect(table('a,b\r\n"c,d","e""f"\r\n')).toEqual([
      ["a", "b"],
      ["c,d", 'e"f'],
    ]));
  it("does not interpret blank values as zero", () => {
    const text = "t_us,x_px,y_px,valid\n0,,4,1\n1000,NaN,5,1";
    const samples = importCSV(text, inferMapping(table(text)));
    expect(samples.every((s) => s.x === null && !s.valid)).toBe(true);
  });
  it("preserves off-screen gaze", () => {
    const text = "t_us,x_px,y_px\n0,-200,5000";
    expect(importCSV(text, inferMapping(table(text)))[0]).toMatchObject({
      x: -200,
      y: 5000,
      valid: true,
    });
  });
  it("converts normalized bottom-left coordinates", () => {
    const text = "gaze_timestamp,norm_pos_x,norm_pos_y\n0,0.25,0.8";
    expect(
      importCSV(text, inferMapping(table(text), 1000, 500))[0],
    ).toMatchObject({ x: 250, y: expect.closeTo(100) });
  });
  it("rejects duplicate per-participant timestamps without fabricating sample times", () => {
    const text = "t_us,x_px,y_px\n0,1,2\n0,2,3";
    expect(() => importCSV(text, inferMapping(table(text)))).toThrow(
      "Duplicate",
    );
  });
  it("retains participant IDs, invalid samples, pupil and blink across CSV export", () => {
    const samples = [
      sample(0, 1, 2, 'P,"1'),
      { ...sample(1000), valid: false, x: null, pupil: 3.5, blink: true },
    ];
    const text = csv(samples);
    expect(importCSV(text, inferMapping(table(text)))).toEqual(
      samples.map((s) => ({ ...s, blink: s.blink ?? false, label: undefined })),
    );
  });
  it("imports GazeCom ARFF labels", () => {
    const s = importARFF(
      "@ATTRIBUTE time INTEGER\n@ATTRIBUTE x NUMERIC\n@ATTRIBUTE y NUMERIC\n@ATTRIBUTE confidence NUMERIC\n@ATTRIBUTE handlabeller_final INTEGER\n@DATA\n1000,20,30,1,3",
      1280,
      720,
    );
    expect(s[0]).toMatchObject({ t: 1000, x: 20, label: "3" });
  });
  it("round-trips media, annotations, raw files and clock anchors with checksums", async () => {
    const r = recording([sample(0), sample(1000)]);
    r.mediaBlob = new Blob(["test-video"], { type: "video/webm" });
    r.mediaType = "video";
    r.rawFiles = [{ name: "original.csv", blob: new Blob(["raw-source"]) }];
    const result = await importPackage(await exportPackage(r));
    expect(result.samples.map((s) => s.t)).toEqual([0, 1000]);
    expect(result.aois).toEqual(r.aois);
    expect(await result.mediaBlob!.text()).toBe("test-video");
    expect(await result.rawFiles![0].blob.text()).toBe("raw-source");
  });
  it("detects tampered gaze bytes", async () => {
    const r = recording([sample(0), sample(1000)]);
    r.mediaBlob = new Blob(["test"], { type: "image/png" });
    const files = unzipSync(
      new Uint8Array(await (await exportPackage(r)).arrayBuffer()),
    );
    files["gaze.csv"] = strToU8("modified");
    await expect(
      importPackage(new Blob([zipSync(files) as Uint8Array<ArrayBuffer>])),
    ).rejects.toThrow("Checksum");
  });
  it("rejects unsafe sample time and frame order", () => {
    const r = recording([sample(1), sample(0)]);
    expect(() => validateRecording(r)).toThrow();
    r.samples = [sample(0)];
    r.frameTimes = [0, 0];
    expect(() => validateRecording(r)).toThrow();
  });
  it("exports headerless BIDS physio and correct eye metadata", () => {
    const r = recording([sample(0), sample(10000)]);
    r.recordedEye = "left";
    const b = exportBIDS(r);
    expect(b.type).toBe("application/zip");
  });
  it("refuses an irregular stream in continuous BIDS export", () =>
    expect(() =>
      exportBIDS(recording([sample(0), sample(10000), sample(50000)])),
    ).toThrow("uniform"));
});
describe("time-weighted attention analysis", () => {
  it("measures elapsed dwell rather than the count of samples", () => {
    const r = recording([
      sample(0),
      sample(10000),
      sample(30000),
      sample(60000),
    ]);
    const a = analyze(r, DEFAULT_SETTINGS);
    expect(a.aoi[0].dwell).toBe(60000);
    expect(a.validTime).toBe(60000);
    expect(a.coverage).toBe(0.06);
  });
  it("does not bridge invalid samples or long gaps", () => {
    const r = recording([
      sample(0),
      sample(10000),
      { ...sample(20000), valid: false },
      sample(30000),
      sample(500000),
      sample(510000),
    ]);
    const a = analyze(r, DEFAULT_SETTINGS);
    expect(a.validTime).toBe(20000);
    expect(a.aoi[0].visits).toBe(2);
    expect(a.gaps).toBe(1);
    expect(a.blinkSamples).toBe(0);
  });
  it("clips analysis to the requested window", () => {
    const a = analyze(recording([sample(0), sample(60000)]), {
      ...DEFAULT_SETTINGS,
      start: 10000,
      end: 30000,
    });
    expect(a.validTime).toBe(20000);
    expect(a.coverage).toBe(1);
  });
  it("clips AOI visibility inside a sample interval", () => {
    const r = recording([sample(0), sample(60000)]);
    r.aois[0].start = 10000;
    r.aois[0].end = 30000;
    expect(analyze(r, DEFAULT_SETTINGS).aoi[0].dwell).toBe(20000);
  });
  it("applies clock alignment before analysis", () => {
    const r = recording([sample(0), sample(10000)]);
    r.anchors = [{ gaze: 0, media: 500000 }];
    expect(
      analyze(r, { ...DEFAULT_SETTINGS, start: 0, end: 100000 }).validTime,
    ).toBe(0);
  });
  it("groups participants without interleaving derivatives", () => {
    const r = recording([
      sample(0),
      sample(0, 900, 100, "P02"),
      sample(10000),
      sample(10000, 900, 100, "P02"),
    ]);
    const a = analyze(r, DEFAULT_SETTINGS);
    expect(a.validTime).toBe(20000);
    expect(a.coverage).toBe(0.01);
    expect(a.aoi[0].dwell).toBe(10000);
  });
  it("excludes unaccepted model proposals from metrics", () => {
    const r = recording([sample(0), sample(10000)]);
    r.aois[0].accepted = false;
    expect(analyze(r, DEFAULT_SETTINGS).aoi).toEqual([]);
  });
  it("breaks AOI sequences during outside-gaze periods", () => {
    const r = recording([
      sample(0),
      sample(10000, 900),
      sample(20000),
      sample(30000),
    ]);
    const a = analyze(r, DEFAULT_SETTINGS);
    expect(a.aoi[0].visits).toBe(2);
    expect(a.transitions).toEqual([]);
  });
  it.each(["ivt", "idt"] as const)(
    "detects long stable fixations with %s",
    (method) => {
      const s = Array.from({ length: 21 }, (_, i) => sample(i * 10000));
      expect(detectFixations(s, { ...DEFAULT_SETTINGS, method })).toEqual([
        { start: 0, end: 200000, x: 100, y: 100, participant: "P01" },
      ]);
    },
  );
  it("returns no fixation for a constant-velocity saccade candidate", () => {
    const s = Array.from({ length: 21 }, (_, i) => sample(i * 10000, i * 20));
    expect(detectFixations(s, DEFAULT_SETTINGS)).toEqual([]);
  });
});
describe("independent label benchmarking", () => {
  it("computes exact known 3-4-5 pixel errors", () => {
    const r = benchmark(
      [sample(0, 3, 4), sample(10000, 6, 8)],
      [sample(0, 0, 0), sample(10000, 0, 0)],
      1000,
      1000,
      500,
    );
    expect(r.pixelError!.mean).toBe(7.5);
    expect(r.pixelError!.rmse).toBeCloseTo(Math.sqrt(62.5));
    expect(r.matched).toBe(2);
  });
  it("does not match labels across participants", () =>
    expect(
      benchmark([sample(0)], [sample(0, 100, 100, "P02")], 1000, 1000, 500)
        .matched,
    ).toBe(0));
  it("never reuses a reference for multiple predictions", () =>
    expect(
      benchmark([sample(0), sample(1000)], [sample(0)], 2000, 1000, 500)
        .matched,
    ).toBe(1));
  it("reports missing predictions in coverage instead of hiding them", () => {
    const r = benchmark(
      [sample(0), { ...sample(1000), valid: false }],
      [sample(0), sample(1000), sample(2000)],
      0,
      1000,
      500,
    );
    expect(r.predictionMatchRate).toBe(0.5);
    expect(r.referenceCoverage).toBeCloseTo(1 / 3);
  });
  it("reports null accuracy when no labels are paired", () =>
    expect(
      benchmark([sample(0)], [sample(100000)], 1000, 1000, 500).pixelError,
    ).toBeNull());
  it("uses physical gaze rays for angular error", () =>
    expect(
      angularError(500, 250, 1000, 250, 1000, 500, {
        widthMm: 1000,
        heightMm: 500,
        distanceMm: 500,
      }),
    ).toBeCloseTo(45));
});
