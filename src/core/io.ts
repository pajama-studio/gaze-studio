import {
  zipSync,
  unzipSync,
  strToU8,
  strFromU8,
  gunzipSync,
  gzipSync,
} from "fflate";
import type { AOI, Gaze, Recording } from "./types";
import { relativeTime, validateAnchors } from "./time";
export interface Mapping {
  time: string;
  x: string;
  y: string;
  participant: string;
  valid: string;
  pupil: string;
  unit: "s" | "ms" | "us" | "ns";
  origin: string;
  coordinates: "pixels" | "normalized" | "normalized-bottom-left";
  width: number;
  height: number;
}
export function table(text: string): string[][] {
  const delimiter = text.split(/\r?\n/)[0].includes("\t") ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  for (let i = 0; i <= text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (!quoted && (c === delimiter || c === "\n" || c === undefined)) {
      row.push(cell.trim());
      cell = "";
      if (c !== delimiter) {
        if (row.some(Boolean)) rows.push(row);
        row = [];
      }
    } else if (c !== "\r" || quoted) cell += c;
  }
  if (quoted) throw new Error("Unclosed CSV quote.");
  if (rows.length > 500001)
    throw new Error(
      "Interactive import is limited to 500,000 samples; split larger recordings into trials.",
    );
  return rows;
}
export function inferMapping(
  rows: string[][],
  width = 1280,
  height = 720,
): Mapping {
  const h = rows[0] ?? [];
  const pick = (...names: string[]) => names.find((n) => h.includes(n)) ?? "";
  const time = pick(
    "t_us",
    "timestamp [ns]",
    "timestamp",
    "time",
    "timestamp_us",
    "gaze_timestamp",
  );
  return {
    time,
    x: pick("x_px", "gaze x [px]", "gaze_x", "x", "norm_pos_x", "x_coordinate"),
    y: pick("y_px", "gaze y [px]", "gaze_y", "y", "norm_pos_y", "y_coordinate"),
    participant: pick("participant_id", "participant", "wearer id"),
    valid: pick("valid", "worn", "confidence"),
    pupil: pick("pupil_size", "pupil", "pupil_diameter"),
    unit:
      time === "timestamp [ns]"
        ? "ns"
        : time.includes("_us")
          ? "us"
          : time === "timestamp"
            ? "ms"
            : "s",
    origin: ["timestamp [ns]", "timestamp"].includes(time)
      ? (rows[1]?.[h.indexOf(time)] ?? "0")
      : "0",
    coordinates: h.includes("norm_pos_x") ? "normalized-bottom-left" : "pixels",
    width,
    height,
  };
}
const numberOrNull = (v: string | undefined) =>
  v === undefined ||
  v === "" ||
  ["nan", "n/a", "null", "?"].includes(v.toLowerCase()) ||
  !Number.isFinite(Number(v))
    ? null
    : Number(v);
export function importCSV(text: string, mapping: Mapping): Gaze[] {
  const rows = table(text),
    header = rows.shift()!;
  const index = (name: string) => header.indexOf(name);
  const [ti, xi, yi] = [mapping.time, mapping.x, mapping.y].map(index);
  if ([ti, xi, yi].some((i) => i < 0))
    throw new Error("Select timestamp, gaze X, and gaze Y columns.");
  const samples = rows.map((r, i): Gaze => {
    let x = numberOrNull(r[xi]),
      y = numberOrNull(r[yi]);
    if (x !== null && mapping.coordinates !== "pixels") x *= mapping.width;
    if (y !== null && mapping.coordinates !== "pixels")
      y =
        (mapping.coordinates === "normalized-bottom-left" ? 1 - y : y) *
        mapping.height;
    const v = r[index(mapping.valid)],
      pupil = numberOrNull(r[index(mapping.pupil)]);
    let t: number;
    try {
      t = relativeTime(r[ti], mapping.unit, mapping.origin);
    } catch {
      throw new Error(`Invalid timestamp on data row ${i + 1}.`);
    }
    return {
      t,
      x,
      y,
      valid:
        x !== null &&
        y !== null &&
        (mapping.valid
          ? v !== undefined && v !== "" && v !== "false" && Number(v) > 0
          : true),
      participant: r[index(mapping.participant)] || "P01",
      ...(pupil === null ? {} : { pupil }),
      blink: Boolean(r[index("blink id")]) || r[index("blink")] === "1",
      label: r[index("label")] || undefined,
    };
  });
  if (!samples.length) throw new Error("The recording has no gaze samples.");
  samples.sort((a, b) => a.t - b.t);
  const previous = new Map<string, number>();
  for (const s of samples) {
    if (previous.get(s.participant) === s.t)
      throw new Error(
        `Duplicate timestamp for ${s.participant}: ${s.t} µs. Split left/right eye streams before import.`,
      );
    previous.set(s.participant, s.t);
  }
  return samples;
}
export function csv(samples: Gaze[]) {
  const escape = (s: unknown) => `"${String(s ?? "").replaceAll('"', '""')}"`;
  return [
    "t_us,x_px,y_px,valid,participant_id,pupil,blink,label",
    ...samples.map((s) =>
      [
        s.t,
        s.x,
        s.y,
        +s.valid,
        s.participant,
        s.pupil,
        +(s.blink ?? false),
        s.label,
      ]
        .map(escape)
        .join(","),
    ),
  ].join("\n");
}
export function validateRecording(r: Recording) {
  if (
    !r ||
    typeof r.title !== "string" ||
    !Array.isArray(r.samples) ||
    r.samples.length > 500000 ||
    !Array.isArray(r.aois) ||
    !r.source ||
    !["video", "image"].includes(r.mediaType)
  )
    throw new Error("Invalid recording structure.");
  if (
    ![r.width, r.height, r.duration].every(
      (n) => Number.isFinite(n) && n > 0,
    ) ||
    r.width > 16384 ||
    r.height > 16384 ||
    !Number.isSafeInteger(r.duration)
  )
    throw new Error("Invalid media dimensions or duration.");
  validateAnchors(r.anchors);
  if (r.videoTracks) {
    if (
      !Array.isArray(r.videoTracks) ||
      r.videoTracks.length > 6 ||
      new Set(r.videoTracks.map((t) => t.id)).size !== r.videoTracks.length
    )
      throw new Error("Expected at most six uniquely named video tracks.");
    for (const t of r.videoTracks) {
      if (
        t.viewRotation !== undefined &&
        ![0, 90, 180, 270].includes(t.viewRotation)
      )
        throw new Error(
          "Camera view rotation must be 0, 90, 180 or 270 degrees.",
        );
      if (
        !t.id ||
        !["left-eye", "right-eye", "context"].includes(t.role) ||
        typeof t.url !== "string" ||
        typeof t.name !== "string" ||
        ![t.width, t.height, t.duration].every(
          (v) => Number.isFinite(v) && v > 0,
        ) ||
        ![t.start, t.end].every(Number.isSafeInteger) ||
        t.end <= t.start ||
        t.start < 0 ||
        t.end > r.duration
      )
        throw new Error("Invalid auxiliary video track.");
      validateAnchors(t.anchors);
      if (
        t.frameTimes?.some(
          (v, i, a) =>
            !Number.isSafeInteger(v) || v < 0 || (i > 0 && v <= a[i - 1]),
        )
      )
        throw new Error("Video frame timestamps must strictly increase.");
    }
  }
  if (r.eyeSignals) {
    if (!Array.isArray(r.eyeSignals) || r.eyeSignals.length > 1000000)
      throw new Error("Too many eye signal samples.");
    const last = new Map<string, number>();
    for (const s of r.eyeSignals) {
      if (
        !Number.isSafeInteger(s.t) ||
        !["left", "right"].includes(s.eye) ||
        !Number.isFinite(s.confidence) ||
        s.confidence < 0 ||
        s.confidence > 1 ||
        (s.pupil !== null && (!Number.isFinite(s.pupil) || s.pupil < 0)) ||
        !["mm", "px", "arbitrary"].includes(s.pupilUnit) ||
        s.t <= (last.get(s.eye) ?? -Infinity)
      )
        throw new Error("Invalid per-eye signal stream.");
      last.set(s.eye, s.t);
    }
  }
  if (r.analysisSettings) {
    const s = r.analysisSettings;
    if (
      !["ivt", "idt"].includes(s.method) ||
      ![s.velocity, s.dispersion, s.minFixation, s.maxGap].every(
        (n) => Number.isFinite(n) && n > 0,
      ) ||
      !Number.isSafeInteger(s.start) ||
      !Number.isSafeInteger(s.end) ||
      s.start < 0 ||
      s.end <= s.start ||
      s.end > r.duration ||
      typeof s.participant !== "string" ||
      (s.aoiScope !== undefined && !["all", "automatic"].includes(s.aoiScope))
    )
      throw new Error("Invalid saved analysis settings.");
  }
  const prev = new Map<string, number>();
  for (const s of r.samples) {
    if (
      !Number.isSafeInteger(s.t) ||
      typeof s.participant !== "string" ||
      typeof s.valid !== "boolean" ||
      [s.x, s.y].some((n) => n !== null && !Number.isFinite(n)) ||
      s.t <= (prev.get(s.participant) ?? -Infinity)
    )
      throw new Error(
        "Gaze samples must have finite coordinates and strictly increasing per-participant timestamps.",
      );
    prev.set(s.participant, s.t);
  }
  if (
    r.frameTimes &&
    r.frameTimes.some(
      (t, i, a) =>
        !Number.isSafeInteger(t) || t < 0 || (i > 0 && t <= a[i - 1]),
    )
  )
    throw new Error("Frame presentation timestamps must strictly increase.");
  for (const a of r.aois) {
    if (
      !["rectangle", "ellipse", "polygon"].includes(a.shape) ||
      !Array.isArray(a.keyframes) ||
      !a.keyframes.length ||
      !Number.isSafeInteger(a.start) ||
      !Number.isSafeInteger(a.end) ||
      a.start >= a.end
    )
      throw new Error("Invalid AOI geometry or visibility interval.");
    for (let i = 0; i < a.keyframes.length; i++) {
      const k = a.keyframes[i];
      if (
        !Number.isSafeInteger(k.t) ||
        (i > 0 && k.t <= a.keyframes[i - 1].t) ||
        k.points.length < (a.shape === "polygon" ? 3 : 2) ||
        k.points.some(
          (p) => p.length !== 2 || p.some((n) => !Number.isFinite(n)),
        )
      )
        throw new Error("Invalid AOI keyframes.");
    }
  }
}
async function sha256(bytes: Uint8Array) {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    bytes as Uint8Array<ArrayBuffer>,
  );
  return [...new Uint8Array(hash)]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
}
export async function exportPackage(r: Recording): Promise<Blob> {
  validateRecording(r);
  const media =
    r.mediaBlob ??
    (await fetch(r.mediaUrl).then((v) => {
      if (!v.ok) throw new Error("Cannot export media.");
      return v.blob();
    }));
  if (!media) throw new Error("Media is unavailable.");
  if (media.size > 100 * 1024 * 1024)
    throw new Error(
      "Portable browser exports currently support media up to 100 MiB.",
    );
  const ext =
    r.mediaType === "image"
      ? media.type === "image/png"
        ? "png"
        : media.type.includes("svg")
          ? "svg"
          : "jpg"
      : media.type.includes("webm")
        ? "webm"
        : "mp4";
  const files: Record<string, Uint8Array> = {
    "gaze.csv": strToU8(csv(r.samples)),
    "aois.json": strToU8(JSON.stringify(r.aois)),
    [`media/stimulus.${ext}`]: new Uint8Array(await media.arrayBuffer()),
  };
  if (r.frameTimes)
    files["frames.json"] = strToU8(JSON.stringify(r.frameTimes));
  const videoTracks = [];
  for (let i = 0; i < (r.videoTracks?.length ?? 0); i++) {
    const { blob, url, ...metadata } = r.videoTracks![i];
    const response = blob ? null : await fetch(url);
    if (response && !response.ok)
      throw new Error(`Cannot export ${metadata.name}.`);
    const media = blob ?? (await response!.blob());
    const path = `media/track-${i}.${media.type.includes("webm") ? "webm" : "mp4"}`;
    files[path] = new Uint8Array(await media.arrayBuffer());
    videoTracks.push({ ...metadata, url: path });
  }
  const raw = [...(r.rawFiles ?? [])];
  if (!raw.length && r.source.rawUrl) {
    const response = await fetch(r.source.rawUrl);
    if (!response.ok) throw new Error("Cannot include original raw data.");
    raw.push({ name: "original.json.gz", blob: await response.blob() });
  }
  const rawEntries = [];
  for (let i = 0; i < raw.length; i++) {
    if (raw[i].blob.size > 15e6)
      throw new Error(
        "Raw source files must be at most 15 MB for portable export.",
      );
    const path = `raw/source-${i}`;
    files[path] = new Uint8Array(await raw[i].blob.arrayBuffer());
    rawEntries.push({ name: raw[i].name, path, type: raw[i].blob.type });
  }
  const {
    samples: _,
    aois: __,
    mediaBlob: ___,
    mediaUrl: ____,
    cloudId: _____,
    rawFiles: ______,
    ...metadata
  } = r;
  const manifest = {
    format: "gaze-package",
    version: "0.2.0",
    coordinateSystem: "stimulus-pixels-top-left",
    timeUnit: "microseconds",
    clockExtrapolation: "linear",
    recording: { ...metadata, videoTracks, mediaUrl: `media/stimulus.${ext}` },
    rawSources: rawEntries,
    files: await Promise.all(
      Object.entries(files).map(async ([path, bytes]) => ({
        path,
        sha256: await sha256(bytes),
        bytes: bytes.length,
      })),
    ),
  };
  if (
    Object.values(files).reduce((sum, b) => sum + b.length, 0) >
    128 * 1024 * 1024
  )
    throw new Error(
      "Combined media and raw files exceed the 128 MiB portable limit. Export a shorter trial.",
    );
  files["manifest.json"] = strToU8(JSON.stringify(manifest, null, 2));
  return new Blob([zipSync(files, { level: 0 }) as Uint8Array<ArrayBuffer>], {
    type: "application/zip",
  });
}
export async function importPackage(blob: Blob): Promise<Recording> {
  if (blob.size > 130 * 1024 * 1024)
    throw new Error("Package exceeds the 130 MiB interactive limit.");
  let expanded = 0;
  const files = unzipSync(new Uint8Array(await blob.arrayBuffer()), {
    filter: (f) => {
      expanded += f.originalSize;
      if (
        expanded > 150 * 1024 * 1024 ||
        f.name.includes("..") ||
        f.name.startsWith("/")
      )
        throw new Error("Invalid package path or expansion limit exceeded.");
      return true;
    },
  });
  if (!files["manifest.json"]) throw new Error("Package needs manifest.json.");
  const manifest = JSON.parse(strFromU8(files["manifest.json"]));
  if (
    manifest.format !== "gaze-package" ||
    !["0.1.0", "0.2.0"].includes(manifest.version) ||
    manifest.coordinateSystem !== "stimulus-pixels-top-left" ||
    manifest.timeUnit !== "microseconds"
  )
    throw new Error("Unsupported package version or coordinate convention.");
  if (
    !Array.isArray(manifest.files) ||
    manifest.files.length !== Object.keys(files).length - 1 ||
    new Set(manifest.files.map((e: any) => e.path)).size !==
      manifest.files.length
  )
    throw new Error("Every package file must have a unique checksum entry.");
  for (const entry of manifest.files)
    if (
      !files[entry.path] ||
      files[entry.path].length !== entry.bytes ||
      (await sha256(files[entry.path])) !== entry.sha256
    )
      throw new Error(`Checksum mismatch: ${entry.path}`);
  const metadata = manifest.recording,
    bytes = files[metadata.mediaUrl];
  if (!bytes || !files["gaze.csv"] || !files["aois.json"])
    throw new Error("Package is missing media, gaze, or AOI data.");
  const mediaBlob = new Blob([bytes as Uint8Array<ArrayBuffer>], {
    type:
      metadata.mediaType === "image"
        ? metadata.mediaUrl.endsWith(".png")
          ? "image/png"
          : metadata.mediaUrl.endsWith(".svg")
            ? "image/svg+xml"
            : "image/jpeg"
        : metadata.mediaUrl.endsWith(".webm")
          ? "video/webm"
          : "video/mp4",
  });
  const text = strFromU8(files["gaze.csv"]),
    mapping = inferMapping(table(text), metadata.width, metadata.height);
  mapping.unit = "us";
  mapping.origin = "0";
  const rawFiles = (manifest.rawSources ?? []).map((entry: any) => {
    if (!files[entry.path]) throw new Error("Missing raw source file.");
    return {
      name: entry.name,
      blob: new Blob([files[entry.path] as Uint8Array<ArrayBuffer>], {
        type: entry.type,
      }),
    };
  });
  const r: Recording = {
    ...metadata,
    samples: importCSV(text, mapping),
    aois: JSON.parse(strFromU8(files["aois.json"])),
    frameTimes: files["frames.json"]
      ? JSON.parse(strFromU8(files["frames.json"]))
      : undefined,
    videoTracks: metadata.videoTracks?.map((track: any) => {
      if (!files[track.url]) throw new Error("Missing auxiliary video.");
      const blob = new Blob([files[track.url] as Uint8Array<ArrayBuffer>], {
        type: track.url.endsWith(".webm") ? "video/webm" : "video/mp4",
      });
      return { ...track, blob, url: URL.createObjectURL(blob) };
    }),
    mediaUrl: URL.createObjectURL(mediaBlob),
    mediaBlob,
    rawFiles,
  };
  validateRecording(r);
  return r;
}
export function importARFF(text: string, width: number, height: number) {
  const names: string[] = [];
  const lines: string[] = [];
  let data = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (/^@attribute\s+/i.test(line))
      names.push(line.split(/\s+/)[1].replace(/['"]/g, ""));
    else if (/^@data/i.test(line)) data = true;
    else if (data && line && !line.startsWith("%")) lines.push(line);
  }
  const csvText = [names.join(","), ...lines].join("\n"),
    mapping = inferMapping(table(csvText), width, height);
  mapping.time = "time";
  mapping.unit = "us";
  mapping.origin = "0";
  mapping.valid = names.includes("confidence") ? "confidence" : "";
  const samples = importCSV(csvText, mapping);
  const rows = table(csvText);
  const labelIndex = names.indexOf("handlabeller_final");
  samples.forEach((s, i) => {
    if (labelIndex >= 0) s.label = rows[i + 1][labelIndex];
  });
  return samples;
}
export async function readTextFile(file: File) {
  const b = new Uint8Array(await file.arrayBuffer());
  return strFromU8(file.name.endsWith(".gz") ? gunzipSync(b) : b);
}
export function importBIDS(
  text: string,
  sidecar: Record<string, any>,
  mapping: Mapping,
): Gaze[] {
  if (
    sidecar.PhysioType !== "eyetrack" ||
    !Array.isArray(sidecar.Columns) ||
    !sidecar.Columns.includes("timestamp") ||
    !sidecar.Columns.includes("x_coordinate") ||
    !sidecar.Columns.includes("y_coordinate")
  )
    throw new Error(
      "Expected a BIDS eye tracking sidecar with timestamp / x_coordinate / y_coordinate.",
    );
  const headers = sidecar.Columns.join("\t");
  return importCSV(headers + "\n" + text, {
    ...mapping,
    time: "timestamp",
    x: "x_coordinate",
    y: "y_coordinate",
    pupil: "pupil_size",
  });
}
export function exportBIDS(r: Recording): Blob {
  if (!r.recordedEye)
    throw new Error(
      "BIDS export needs a known recorded eye (left, right or cyclopean). Set it in the import metadata.",
    );
  const participants = [...new Set(r.samples.map((s) => s.participant))];
  if (participants.length !== 1)
    throw new Error("Select a single participant before BIDS export.");
  const dts = r.samples.slice(1).map((s, i) => s.t - r.samples[i].t);
  const dt = dts[0];
  if (!dt || dts.some((d) => Math.abs(d - dt) > 1))
    throw new Error(
      "BIDS continuous physio export requires uniform sampling. Preserve irregular data in a Gaze Package or explicitly resample first.",
    );
  const stem = "sub-01/beh/sub-01_task-view_recording-eye_physio";
  const rows = r.samples
    .map((s) =>
      [
        s.t / 1e6,
        s.valid ? (s.x ?? "n/a") : "n/a",
        s.valid ? (s.y ?? "n/a") : "n/a",
        s.pupil ?? "n/a",
      ].join("\t"),
    )
    .join("\n");
  const sidecar = {
    PhysioType: "eyetrack",
    RecordedEye: r.recordedEye,
    SampleCoordinateSystem: "gaze-on-screen",
    SamplingFrequency: 1e6 / dt,
    StartTime: r.samples[0].t / 1e6,
    Columns: ["timestamp", "x_coordinate", "y_coordinate", "pupil_size"],
    timestamp: { Units: "s", Origin: "Recording-relative gaze clock" },
    x_coordinate: {
      Units: "pixel",
      Description: "Native stimulus pixels, origin top left, positive right.",
    },
    y_coordinate: {
      Units: "pixel",
      Description: "Native stimulus pixels, origin top left, positive down.",
    },
    pupil_size: { Units: "arbitrary" },
    GazeStudio: {
      note: "BIDS export subset; review device, eye, pupil units and stimulus geometry before submission.",
      anchors: r.anchors,
      source: r.source,
    },
  };
  return new Blob(
    [
      zipSync({
        "dataset_description.json": strToU8(
          JSON.stringify({
            Name: r.title,
            BIDSVersion: "1.11.1",
            DatasetType: "raw",
            License: r.source.license,
          }),
        ),
        [`${stem}.json`]: strToU8(JSON.stringify(sidecar, null, 2)),
        [`${stem}.tsv.gz`]: gzipSync(strToU8(rows)),
        README: strToU8(
          "BIDS draft export. Media and presentation events remain in the companion Gaze Package. Device metadata and validator review required.",
        ),
      }) as Uint8Array<ArrayBuffer>,
    ],
    { type: "application/zip" },
  );
}
export function importCogixAOIs(
  value: any,
  duration: number,
  width: number,
  height: number,
): AOI[] {
  const items = Array.isArray(value)
    ? value
    : (value.aois ?? value.collections?.flatMap((c: any) => c.aois) ?? []);
  const coordinateSystem =
    value.metadata?.coordinateSystem ?? value.coordinateSystem;
  return items.map((a: any) => {
    if (a.shape && a.keyframes?.[0]?.points) return a;
    if (!["pixels", "normalized"].includes(coordinateSystem))
      throw new Error(
        "Cogix imports require metadata.coordinateSystem set to pixels or normalized. Coordinates will not be guessed.",
      );
    const scaleX = coordinateSystem === "normalized" ? width : 1,
      scaleY = coordinateSystem === "normalized" ? height : 1;
    const points = (coordinates: number[]): [number, number][] => {
      const c = coordinates.map((v, i) => v * (i % 2 ? scaleY : scaleX));
      if (a.type === "rectangle")
        return [
          [c[0], c[1]],
          [c[0] + c[2], c[1] + c[3]],
        ];
      if (a.type === "ellipse")
        return [
          [c[0] - c[2], c[1] - c[3]],
          [c[0] + c[2], c[1] + c[3]],
        ];
      return Array.from({ length: c.length / 2 }, (_, i) => [
        c[i * 2],
        c[i * 2 + 1],
      ]);
    };
    if (
      a.frameRange?.startFrame !== undefined &&
      a.frameRange.startTime === undefined
    )
      throw new Error(
        "Frame-only Cogix intervals require an explicit frame-to-time conversion first.",
      );
    return {
      id: a.id ?? crypto.randomUUID(),
      name: a.name ?? "Imported AOI",
      shape:
        a.type === "polygon" || a.type === "freehand"
          ? "polygon"
          : a.type === "ellipse"
            ? "ellipse"
            : "rectangle",
      color: a.color ?? "#0c9a87",
      start: Math.round((a.frameRange?.startTime ?? 0) * 1e6),
      end: Math.round((a.frameRange?.endTime ?? duration / 1e6) * 1e6),
      keyframes: a.keyframes?.length
        ? a.keyframes.map((k: any) => ({
            t: Math.round(k.time * 1e6),
            points: points(k.coordinates),
          }))
        : [{ t: 0, points: points(a.coordinates) }],
      source: "import",
      accepted: true,
    };
  });
}
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
