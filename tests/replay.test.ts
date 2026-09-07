import { describe, expect, it, vi } from "vitest";
import { analyze } from "../src/core/analysis";
import { coveredDuration } from "../src/core/aoi";
import { recordedAOIs, replaySettings } from "../src/core/replay";
import {
  exportPackage,
  importPackage,
  validateRecording,
} from "../src/core/io";
import { fixture } from "../src/core/fixture";
import { DEFAULT_SETTINGS } from "../src/core/types";
import type { AOI, Recording } from "../src/core/types";
import { gzipSync, strToU8 } from "fflate";
const area = (id: string, x1: number, x2: number, automatic = true): AOI => ({
  id,
  name: id,
  start: 0,
  end: 200000,
  shape: "rectangle",
  color: "#119781",
  accepted: true,
  source: automatic ? "model" : "manual",
  keyframes: [
    {
      t: 0,
      points: [
        [x1, 0],
        [x2, 100],
      ],
    },
  ],
});
function sampleRecording(): Recording {
  return {
    ...fixture(),
    width: 100,
    height: 100,
    duration: 200000,
    frameTimes: undefined,
    samples: [10, 10, 60, 60].map((x, i) => ({
      t: i * 50000,
      x,
      y: 25,
      participant: "P01",
      valid: true,
    })),
    aois: [
      area("whole screen", 0, 100, false),
      area("left object", 0, 49),
      area("right object", 50, 100),
      { ...area("unreviewed", 0, 100), accepted: false },
    ],
  };
}
describe("replay and automatic AOI analysis", () => {
  it("separates automatic areas from an overlapping manual screen region", () => {
    const r = sampleRecording();
    const result = analyze(r, { ...DEFAULT_SETTINGS, aoiScope: "automatic" });
    expect(result.aoi.map((a) => a.id)).toEqual([
      "left object",
      "right object",
    ]);
    expect(result.aoi.map((a) => a.dwell)).toEqual([100000, 50000]);
    expect(result.transitions).toEqual([
      { from: "left object", to: "right object", count: 1 },
    ]);
    expect(analyze(r, DEFAULT_SETTINGS).transitions).toEqual([]);
  });
  it("counts visibility as a clipped union, not overlapping area-seconds", () => {
    const aois = [
      area("a", 0, 20),
      { ...area("b", 0, 20), start: 100000, end: 300000 },
    ];
    expect(coveredDuration(aois, 50000, 250000)).toBe(200000);
    expect(coveredDuration([], 0, 250000)).toBe(0);
  });
  it("restores the saved protocol and reproduces results from a portable package", async () => {
    const r = sampleRecording();
    r.mediaBlob = new Blob(["svg"], { type: "image/svg+xml" });
    r.analysisSettings = {
      ...DEFAULT_SETTINGS,
      end: r.duration,
      start: 50000,
      aoiScope: "automatic",
      method: "idt",
      minFixation: 50000,
    };
    const restored = await importPackage(await exportPackage(r));
    expect(restored.analysisSettings).toEqual(r.analysisSettings);
    expect(analyze(restored, replaySettings(restored))).toEqual(
      analyze(r, r.analysisSettings),
    );
    URL.revokeObjectURL(restored.mediaUrl);
  });
  it("rejects malformed stored analysis protocols", () => {
    const r = sampleRecording();
    r.analysisSettings = { ...DEFAULT_SETTINGS, end: Infinity };
    expect(() => validateRecording(r)).toThrow("analysis settings");
    r.analysisSettings = {
      ...DEFAULT_SETTINGS,
      end: 100000,
      aoiScope: "invented" as "all",
    };
    expect(() => validateRecording(r)).toThrow("analysis settings");
  });
  it("recovers recorded AOIs from preserved raw data without the original server", async () => {
    const r = sampleRecording();
    r.source = {
      ...r.source,
      format: "GazeMining · left eye",
      rawUrl: "https://unavailable.example/raw.json.gz",
    };
    r.rawFiles = [
      {
        name: "original.json.gz",
        blob: new Blob([
          gzipSync(
            strToU8(
              JSON.stringify({
                Layers: [
                  {
                    type: "fixed",
                    x: 10,
                    y: 10,
                    width: 50,
                    height: 50,
                    qtVideoTs_first: 0,
                    qtVideoTs_last: 150,
                    xpath: "html/body/div-product",
                  },
                ],
              }),
            ),
          ) as Uint8Array<ArrayBuffer>,
        ]),
      },
    ];
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("No network"));
    try {
      const candidates = await recordedAOIs(r);
      expect(candidates).toHaveLength(1);
      expect(candidates[0]).toMatchObject({
        accepted: false,
        model: "recorded-dom:html/body/div-product",
      });
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      fetch.mockRestore();
    }
  });
  it("keeps interactive and saved windows finite and nonempty", () => {
    const r = sampleRecording();
    expect(replaySettings(r).end).toBe(r.duration);
    expect(
      replaySettings(r, { ...DEFAULT_SETTINGS, start: r.duration, end: 0 }),
    ).toMatchObject({ start: r.duration - 1, end: r.duration });
  });
});
