import { describe, expect, it } from "vitest";
import { importCogixAOIs, importPackage, exportPackage } from "../src/core/io";
import { gazeMiningLayers } from "../src/core/dom";
import { fixture } from "./fixtures/recording";
import { benchmark } from "../src/core/benchmark";
import type { Gaze } from "../src/core/types";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
describe("explicit interoperability", () => {
  it("converts Cogix normalized rectangle width/height into bounding corners", () => {
    const [a] = importCogixAOIs(
      {
        metadata: { coordinateSystem: "normalized" },
        aois: [{ type: "rectangle", coordinates: [0.1, 0.2, 0.3, 0.4] }],
      },
      1e6,
      1000,
      500,
    );
    expect(a.keyframes[0].points).toEqual([
      [100, 100],
      [400, 300],
    ]);
  });
  it("converts Cogix ellipse center/radii into bounding corners", () => {
    const [a] = importCogixAOIs(
      {
        metadata: { coordinateSystem: "pixels" },
        aois: [{ type: "ellipse", coordinates: [100, 200, 20, 30] }],
      },
      1e6,
      1000,
      500,
    );
    expect(a.keyframes[0].points).toEqual([
      [80, 170],
      [120, 230],
    ]);
  });
  it("refuses unknown Cogix coordinate conventions and frame-only intervals", () => {
    expect(() =>
      importCogixAOIs(
        [{ type: "rectangle", coordinates: [0.1, 0.2, 0.3, 0.4] }],
        1e6,
        1000,
        500,
      ),
    ).toThrow("coordinateSystem");
    expect(() =>
      importCogixAOIs(
        {
          metadata: { coordinateSystem: "pixels" },
          aois: [
            {
              type: "rectangle",
              coordinates: [1, 2, 3, 4],
              frameRange: { startFrame: 10 },
            },
          ],
        },
        1e6,
        1000,
        500,
      ),
    ).toThrow("Frame-only");
  });
  it("extracts visible fixed DOM regions as unaccepted proposals", () => {
    const aois = gazeMiningLayers(
      {
        Layers: [
          {
            type: "fixed",
            x: -20,
            y: 50,
            width: 100,
            height: 200,
            qtVideoTs_first: 100,
            qtVideoTs_last: 200,
            xpath: "html/body/div-product",
          },
          { type: "overflow", x: 10, y: 9000, width: 100, height: 100 },
        ],
      },
      fixture(),
    );
    expect(aois).toHaveLength(1);
    expect(aois[0]).toMatchObject({
      accepted: false,
      source: "import",
      start: 100000,
      end: 250000,
    });
    expect(aois[0].keyframes[0].points).toEqual([
      [0, 50],
      [80, 250],
    ]);
  });
  it("rejects a package that omits integrity entries", async () => {
    const r = fixture();
    r.mediaBlob = new Blob(["svg"], { type: "image/svg+xml" });
    const entries = unzipSync(
      new Uint8Array(await (await exportPackage(r)).arrayBuffer()),
    );
    const manifest = JSON.parse(strFromU8(entries["manifest.json"]));
    manifest.files = [];
    entries["manifest.json"] = strToU8(JSON.stringify(manifest));
    await expect(
      importPackage(new Blob([zipSync(entries) as Uint8Array<ArrayBuffer>])),
    ).rejects.toThrow("checksum");
  });
});
describe("accuracy versus precision", () => {
  const reference: Gaze[] = Array.from({ length: 11 }, (_, i) => ({
    t: i * 20000,
    x: 100,
    y: 100,
    valid: true,
    participant: "P01",
  }));
  it("separates a constant 10px bias from zero jitter", () => {
    const result = benchmark(
      reference.map((s) => ({ ...s, x: 110 })),
      reference,
      0,
      1000,
      500,
    );
    expect(result.pixelError!.mean).toBe(10);
    expect(result.staticTargetPrecision!.rmsSampleToSamplePx).toBe(0);
    expect(result.staticTargetPrecision!.pooledWithinTargetSDPx).toBe(0);
  });
  it("measures jitter on constant target labels", () => {
    const result = benchmark(
      reference.map((s, i) => ({ ...s, x: 100 + (i % 2) * 2 })),
      reference,
      0,
      1000,
      500,
    );
    expect(result.staticTargetPrecision!.rmsSampleToSamplePx).toBe(2);
  });
  it("does not call moving-target displacement precision", () => {
    const moving = reference.map((s, i) => ({ ...s, x: i * 10 }));
    expect(
      benchmark(moving, moving, 0, 1000, 500).staticTargetPrecision,
    ).toBeNull();
  });
  it("requires positive physical geometry", () =>
    expect(() =>
      benchmark(reference, reference, 0, 1000, 500, {
        widthMm: 500,
        heightMm: 300,
        distanceMm: 0,
      }),
    ).toThrow("positive"));
  it("excludes explicitly annotated blinks from prediction scoring", () =>
    expect(
      benchmark(
        reference.map((s) => ({ ...s, blink: true })),
        reference,
        0,
        1000,
        500,
      ).matched,
    ).toBe(0));
});
