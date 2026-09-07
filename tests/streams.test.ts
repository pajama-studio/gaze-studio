import { describe, it, expect } from "vitest";
import { fixture } from "../src/core/fixture";
import {
  validateRecording,
  exportPackage,
  importPackage,
} from "../src/core/io";
import { mapTime } from "../src/core/time";
import type { VideoTrack } from "../src/core/types";
const track = (): VideoTrack => ({
  id: "left",
  role: "left-eye",
  name: "eye.mp4",
  url: "blob:eye",
  width: 400,
  height: 400,
  duration: 10e6,
  start: 1e6,
  end: 11e6,
  anchors: [
    { gaze: 1e6, media: 0 },
    { gaze: 11e6, media: 10e6 },
  ],
  frameTimes: [0, 8333, 16667],
  blob: new Blob([new Uint8Array([1, 2, 3])], { type: "video/mp4" }),
});
describe("binocular stream protocol", () => {
  it("preserves video bytes, per-camera frame clocks and eye measurements in a portable package", async () => {
    const r = fixture();
    r.mediaBlob = new Blob(['<svg xmlns="http://www.w3.org/2000/svg"/>'], {
      type: "image/svg+xml",
    });
    r.videoTracks = [track()];
    r.eyeSignals = [
      { t: 5000, eye: "left", pupil: 4.1, pupilUnit: "mm", confidence: 0.8 },
    ];
    const restored = await importPackage(await exportPackage(r));
    expect(restored.videoTracks![0].anchors).toEqual(r.videoTracks[0].anchors);
    expect(restored.videoTracks![0].frameTimes).toEqual([0, 8333, 16667]);
    expect(
      new Uint8Array(await restored.videoTracks![0].blob!.arrayBuffer()),
    ).toEqual(new Uint8Array([1, 2, 3]));
    expect(restored.eyeSignals).toEqual(r.eyeSignals);
  });
  it("maps scene time to an independent eye clock with offset and drift", () => {
    const t = track();
    t.anchors[1].media = 9e6;
    expect(mapTime(6e6, t.anchors)).toBe(4.5e6);
  });
  it("rejects inverted clocks, duplicate tracks, invalid intervals and out-of-order eye samples", () => {
    const r = fixture();
    r.videoTracks = [track(), track()];
    expect(() => validateRecording(r)).toThrow(/uniquely/);
    r.videoTracks = [track()];
    r.videoTracks[0].anchors.reverse();
    expect(() => validateRecording(r)).toThrow();
    r.videoTracks = [{ ...track(), end: 13e6 }];
    expect(() => validateRecording(r)).toThrow(/track/);
    r.videoTracks = [];
    r.eyeSignals = [
      { t: 5000, eye: "left", pupil: 4, pupilUnit: "mm", confidence: 1 },
      { t: 4000, eye: "left", pupil: 4, pupilUnit: "mm", confidence: 1 },
    ];
    expect(() => validateRecording(r)).toThrow(/signal/);
  });
});
