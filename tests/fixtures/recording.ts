import type { Recording } from "../../packages/core/src/types";
export function fixture(): Recording {
  const r: Recording = {
    id: "clock-fixture",
    recordedEye: "cyclopean",
    title: "The attention garden",
    description:
      "A deterministic synthetic fixture for testing clocks, AOIs and export. Not human gaze.",
    width: 1280,
    height: 720,
    duration: 12000000,
    mediaType: "image",
    mediaName: "garden.svg",
    mediaUrl:
      "data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E",
    samples: [],
    anchors: [{ gaze: 0, media: 0 }],
    source: {
      license: "CC0-1.0",
      synthetic: true,
      format: "Gaze Package fixture",
    },
    geometry: { widthMm: 530, heightMm: 298, distanceMm: 600 },
    aois: [
      {
        id: "fern",
        name: "Fern",
        shape: "rectangle",
        color: "#0c9a87",
        start: 0,
        end: 12000000,
        keyframes: [
          {
            t: 0,
            points: [
              [110, 170],
              [440, 595],
            ],
          },
        ],
        source: "manual",
        accepted: true,
      },
      {
        id: "cactus",
        name: "Cactus",
        shape: "rectangle",
        color: "#e5a23d",
        start: 0,
        end: 12000000,
        keyframes: [
          {
            t: 0,
            points: [
              [470, 170],
              [800, 595],
            ],
          },
        ],
        source: "manual",
        accepted: true,
      },
      {
        id: "monstera",
        name: "Monstera",
        shape: "rectangle",
        color: "#ab81d7",
        start: 0,
        end: 12000000,
        keyframes: [
          {
            t: 0,
            points: [
              [830, 170],
              [1160, 595],
            ],
          },
        ],
        source: "manual",
        accepted: true,
      },
    ],
  };
  for (let p = 0; p < 3; p++)
    for (let i = 0; i <= 720; i++) {
      const t = Math.round((i * 1e6) / 60),
        target = (Math.floor(t / 1.5e6) + p) % 3;
      const valid =
        !(t > 4.1e6 && t < 4.3e6) && !(p === 1 && t > 8e6 && t < 8.3e6);
      r.samples.push({
        t,
        x: valid ? 275 + target * 360 + Math.sin(i * 0.6 + p) * 5 : null,
        y: valid ? 345 + Math.cos(i * 0.4 + p) * 6 : null,
        valid,
        participant: `P0${p + 1}`,
        pupil: 3 + 0.15 * Math.sin(i * 0.04),
        blink: t > 4.1e6 && t < 4.3e6,
      });
    }
  r.samples.sort((a, b) => a.t - b.t);
  return r;
}
