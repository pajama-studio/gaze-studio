import { useState } from "react";
import {
  X,
  Upload,
  FileVideo,
  FileSpreadsheet,
  ArrowRight,
} from "lucide-react";
import {
  importPackage,
  readTextFile,
  inferMapping,
  table,
  importCSV,
  importARFF,
  importBIDS,
  validateRecording,
  type Mapping,
} from "../core/io";
import type { Recording } from "../core/types";
export function ImportDialog({
  close,
  onImport,
}: {
  close: () => void;
  onImport: (r: Recording) => void;
}) {
  const [media, setMedia] = useState<File | null>(null),
    [data, setData] = useState(""),
    [filename, setFilename] = useState(""),
    [headers, setHeaders] = useState<string[]>([]),
    [sidecar, setSidecar] = useState<Record<string, any> | null>(null);
  const [mapping, setMapping] = useState<Mapping>(inferMapping([])),
    [title, setTitle] = useState("My recording"),
    [license, setLicense] = useState("LicenseRef-Private"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [duration, setDuration] = useState(20),
    [rawFile, setRawFile] = useState<File | null>(null),
    [eye, setEye] = useState("");
  const update = (key: keyof Mapping, value: string | number) =>
    setMapping((m) => ({ ...m, [key]: value }));
  async function readData(file: File) {
    setError("");
    try {
      if (file.name.endsWith(".zip")) {
        setBusy(true);
        onImport(await importPackage(file));
        close();
        return;
      }
      const text = await readTextFile(file);
      setData(text);
      setFilename(file.name);
      setRawFile(file);
      if (!file.name.endsWith(".arff")) {
        const rows = table(text);
        setHeaders(rows[0]);
        setMapping(inferMapping(rows, mapping.width, mapping.height));
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function load() {
    setError("");
    setBusy(true);
    let url = "";
    try {
      if (!media || !data)
        throw new Error("Choose a stimulus and gaze data file.");
      url = URL.createObjectURL(media);
      const isImage = media.type.startsWith("image/");
      const info = await new Promise<{
        width: number;
        height: number;
        duration: number;
      }>((resolve, reject) => {
        const m = document.createElement(isImage ? "img" : "video") as
          HTMLImageElement | HTMLVideoElement;
        m.addEventListener(
          isImage ? "load" : "loadedmetadata",
          () =>
            resolve(
              m instanceof HTMLVideoElement
                ? {
                    width: m.videoWidth,
                    height: m.videoHeight,
                    duration: Math.round(m.duration * 1e6),
                  }
                : {
                    width: m.naturalWidth,
                    height: m.naturalHeight,
                    duration: Math.round(duration * 1e6),
                  },
            ),
          { once: true },
        );
        m.addEventListener(
          "error",
          () => reject(new Error("Unsupported media format.")),
          { once: true },
        );
        m.src = url;
      });
      // Use source dimensions explicitly supplied in mapping, not CSS dimensions.
      const samples = filename.endsWith(".arff")
        ? importARFF(data, mapping.width, mapping.height)
        : sidecar
          ? importBIDS(data, sidecar, mapping)
          : importCSV(data, mapping);
      if (mapping.width !== info.width || mapping.height !== info.height) {
        const sx = info.width / mapping.width,
          sy = info.height / mapping.height;
        samples.forEach((s) => {
          if (s.x !== null) s.x *= sx;
          if (s.y !== null) s.y *= sy;
        });
      }
      const r: Recording = {
        id: crypto.randomUUID(),
        title,
        description: `Imported from ${filename}`,
        ...info,
        mediaType: isImage ? "image" : "video",
        mediaUrl: url,
        mediaName: media.name,
        mediaBlob: media,
        rawFiles: rawFile ? [{ name: rawFile.name, blob: rawFile }] : [],
        recordedEye: (sidecar?.RecordedEye ||
          eye ||
          undefined) as Recording["recordedEye"],
        samples,
        aois: [],
        anchors: [{ gaze: 0, media: 0 }],
        source: {
          license,
          synthetic: false,
          originalTimeOrigin: mapping.origin,
          format: sidecar
            ? "BIDS physio subset"
            : filename.endsWith(".arff")
              ? "GazeCom ARFF"
              : "mapped CSV",
        },
      };
      validateRecording(r);
      onImport(r);
      close();
    } catch (e) {
      if (url) URL.revokeObjectURL(url);
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="modal-backdrop">
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-title"
      >
        <div className="modal-heading">
          <div>
            <span className="eyebrow">BRING YOUR OWN DATA</span>
            <h2 id="import-title">A recording, ready to explore.</h2>
          </div>
          <button onClick={close} aria-label="Close import">
            <X size={20} />
          </button>
        </div>
        <p className="muted">
          Files stay in this browser until you choose Save to cloud. A Gaze
          Package ZIP includes everything; otherwise pair media with CSV, TSV or
          ARFF.
        </p>
        <div className="import-files">
          <label className="dropzone">
            <FileVideo size={25} />
            <strong>{media?.name ?? "Choose stimulus"}</strong>
            <span>MP4, WebM, JPG or PNG</span>
            <input
              type="file"
              accept="video/mp4,video/webm,image/jpeg,image/png"
              onChange={(e) => setMedia(e.target.files?.[0] ?? null)}
            />
          </label>
          <label className="dropzone">
            <FileSpreadsheet size={25} />
            <strong>{filename || "Choose gaze data"}</strong>
            <span>CSV, TSV(.gz), ARFF or package ZIP</span>
            <input
              type="file"
              accept=".csv,.tsv,.gz,.arff,.zip"
              onChange={(e) =>
                e.target.files?.[0] && readData(e.target.files[0])
              }
            />
          </label>
        </div>
        <div className="form-grid">
          <label>
            Recording name
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label>
            Recorded eye
            <select value={eye} onChange={(e) => setEye(e.target.value)}>
              <option value="">Unknown</option>
              <option value="left">Left</option>
              <option value="right">Right</option>
              <option value="cyclopean">Combined / cyclopean</option>
            </select>
          </label>
          <label>
            Data license
            <input
              value={license}
              onChange={(e) => setLicense(e.target.value)}
              placeholder="CC0-1.0, CC-BY-4.0, or private"
            />
          </label>
          <label>
            Source coordinate width
            <input
              type="number"
              min="1"
              value={mapping.width}
              onChange={(e) => update("width", +e.target.value)}
            />
          </label>
          <label>
            Source coordinate height
            <input
              type="number"
              min="1"
              value={mapping.height}
              onChange={(e) => update("height", +e.target.value)}
            />
          </label>
        </div>
        {media?.type.startsWith("image/") && (
          <label>
            Image presentation duration (seconds)
            <input
              type="number"
              min=".1"
              value={duration}
              onChange={(e) => setDuration(+e.target.value)}
            />
          </label>
        )}
        {data && !filename.endsWith(".arff") && (
          <>
            <h3>Confirm column mapping</h3>
            <div className="form-grid">
              {(
                [
                  ["time", "Timestamp"],
                  ["x", "Gaze X"],
                  ["y", "Gaze Y"],
                  ["participant", "Participant"],
                  ["valid", "Validity (> 0)"],
                  ["pupil", "Pupil"],
                ] as const
              ).map(([key, label]) => (
                <label key={key}>
                  {label}
                  <select
                    value={mapping[key]}
                    onChange={(e) => update(key, e.target.value)}
                  >
                    <option value="">
                      {["participant", "valid", "pupil"].includes(key)
                        ? "Not provided"
                        : "Select a column"}
                    </option>
                    {headers.map((h) => (
                      <option key={h}>{h}</option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <div className="form-grid">
              <label>
                Timestamp unit
                <select
                  value={mapping.unit}
                  onChange={(e) => update("unit", e.target.value)}
                >
                  <option value="s">Seconds</option>
                  <option value="ms">Milliseconds</option>
                  <option value="us">Microseconds</option>
                  <option value="ns">Nanoseconds (integer)</option>
                </select>
              </label>
              <label>
                Subtract this time origin
                <input
                  value={mapping.origin}
                  onChange={(e) => update("origin", e.target.value)}
                />
              </label>
              <label>
                Coordinate system
                <select
                  value={mapping.coordinates}
                  onChange={(e) => update("coordinates", e.target.value)}
                >
                  <option value="pixels">Pixels · top left</option>
                  <option value="normalized">
                    Normalized [0,1] · top left
                  </option>
                  <option value="normalized-bottom-left">
                    Normalized [0,1] · bottom left
                  </option>
                </select>
              </label>
              <label>
                BIDS sidecar (optional)
                <input
                  type="file"
                  accept=".json"
                  onChange={async (e) => {
                    try {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const s = JSON.parse(await file.text());
                      setSidecar(s);
                      setHeaders(s.Columns ?? []);
                      setMapping((m) => ({
                        ...m,
                        time: "timestamp",
                        x: "x_coordinate",
                        y: "y_coordinate",
                        pupil: "pupil_size",
                        unit: s.timestamp?.Units ?? "s",
                      }));
                    } catch {
                      setError("Invalid sidecar JSON.");
                    }
                  }}
                />
              </label>
            </div>
            <p className="hint">
              The origin must be the media start in the gaze clock. A guessed
              first gaze timestamp is only a starting point: verify it in Sync.
              Off-screen samples are preserved.
            </p>
          </>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button onClick={close}>Cancel</button>
          <button
            className="primary"
            disabled={busy || !media || !data}
            onClick={load}
          >
            <Upload size={16} />
            {busy ? "Importing…" : "Open recording"}
            <ArrowRight size={16} />
          </button>
        </div>
      </section>
    </div>
  );
}
