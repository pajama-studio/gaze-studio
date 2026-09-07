export interface Gaze {
  t: number;
  x: number | null;
  y: number | null;
  valid: boolean;
  participant: string;
  pupil?: number;
  blink?: boolean;
  referenceX?: number;
  referenceY?: number;
  label?: string;
}
export interface Anchor {
  gaze: number;
  media: number;
}
export type Point = [number, number];
export interface Keyframe {
  t: number;
  points: Point[];
}
export interface AOI {
  id: string;
  name: string;
  shape: "rectangle" | "ellipse" | "polygon";
  color: string;
  start: number;
  end: number;
  keyframes: Keyframe[];
  source: "manual" | "model" | "import";
  accepted: boolean;
  model?: string;
  score?: number;
}
export interface Geometry {
  widthMm: number;
  heightMm: number;
  distanceMm: number;
}
/** Auxiliary video. Anchor.gaze is the master stimulus clock, Anchor.media is this video's encoded PTS, both in microseconds. */
export interface VideoTrack {
  id: string;
  role: "left-eye" | "right-eye" | "context";
  name: string;
  url: string;
  width: number;
  height: number;
  duration: number;
  start: number;
  end: number;
  anchors: Anchor[];
  frameTimes?: number[];
  blob?: Blob;
  source?: string;
}
export interface EyeSignal {
  t: number;
  eye: "left" | "right";
  confidence: number;
  pupil: number | null;
  pupilUnit: "mm" | "px" | "arbitrary";
}
export interface Recording {
  id: string;
  title: string;
  description: string;
  width: number;
  height: number;
  duration: number;
  mediaUrl: string;
  mediaName: string;
  mediaType: "video" | "image";
  samples: Gaze[];
  aois: AOI[];
  anchors: Anchor[];
  geometry?: Geometry;
  recordedEye?: "left" | "right" | "cyclopean";
  source: {
    url?: string;
    license: string;
    citation?: string;
    synthetic: boolean;
    originalTimeOrigin?: string;
    format?: string;
    rawUrl?: string;
    transform?: string;
  };
  rawFiles?: { name: string; blob: Blob }[];
  frameTimes?: number[];
  mediaBlob?: Blob;
  cloudId?: string;
  analysisSettings?: Settings;
  videoTracks?: VideoTrack[];
  eyeSignals?: EyeSignal[];
}
export interface Settings {
  aoiScope?: "all" | "automatic";
  method: "ivt" | "idt";
  velocity: number;
  dispersion: number;
  minFixation: number;
  maxGap: number;
  participant: string;
  start: number;
  end: number;
}
export interface Fixation {
  start: number;
  end: number;
  x: number;
  y: number;
  participant: string;
}
export interface AOIMetric {
  id: string;
  name: string;
  dwell: number;
  visits: number;
  ttff: number | null;
  fixationCount: number;
  fixationDuration: number;
}
export interface EyeSummary {
  eye: string;
  unit: string;
  samples: number;
  validSamples: number;
  validTime: number;
  coverage: number;
  mean: number | null;
  median: number | null;
  sd: number | null;
  p05: number | null;
  p95: number | null;
}
export interface Analysis {
  eyeSignals?: EyeSummary[];
  samples: number;
  validSamples: number;
  duration: number;
  validTime: number;
  coverage: number;
  medianHz: number;
  gaps: number;
  fixations: Fixation[];
  aoi: AOIMetric[];
  transitions: { from: string; to: string; count: number }[];
  sequences: {
    start: number;
    end: number;
    aoi: string | null;
    participant: string;
  }[];
  pupil: { mean: number | null; count: number };
  blinkSamples: number;
  velocities: { t: number; v: number }[];
  parameters: Settings;
  version: string;
}
export const PALETTE = [
  "#0c9a87",
  "#f3a33b",
  "#a47cdf",
  "#e67172",
  "#5b9adb",
  "#c79573",
];
export const DEFAULT_SETTINGS: Settings = {
  method: "ivt",
  velocity: 800,
  dispersion: 65,
  minFixation: 100000,
  maxGap: 75000,
  participant: "all",
  start: 0,
  end: Infinity,
};
