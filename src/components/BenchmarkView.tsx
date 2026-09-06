import { useState } from "react";
import { Download, FlaskConical } from "lucide-react";
import { benchmark } from "../core/benchmark";
import { download, importCSV, inferMapping, table } from "../core/io";
import type { Gaze, Recording } from "../core/types";
export function BenchmarkView({ recording }: { recording: Recording }) {
  const [predictions, setPredictions] = useState<Gaze[] | null>(null),
    [references, setReferences] = useState<Gaze[] | null>(null),
    [error, setError] = useState(""),
    [tolerance, setTolerance] = useState(8),
    [geometry, setGeometry] = useState(
      recording.geometry ?? { widthMm: 0, heightMm: 0, distanceMm: 0 },
    ),
    [protocol, setProtocol] = useState(""),
    [result, setResult] = useState<ReturnType<typeof benchmark> | null>(null);
  const parse = async (file: File, setter: (g: Gaze[]) => void) => {
    try {
      const text = await file.text(),
        rows = table(text);
      const mapping = inferMapping(rows, recording.width, recording.height);
      if (!rows[0].includes("t_us") || !rows[0].includes("participant_id"))
        throw new Error(
          "Benchmark CSV must use t_us and participant_id with x_px / y_px. Export canonical CSV or use the import mapper first.",
        );
      setter(importCSV(text, mapping));
      setResult(null);
      setError("");
    } catch (e) {
      setError(String(e));
    }
  };
  return (
    <div className="benchmark-view">
      <section className="benchmark-intro">
        <div className="icon-tile">
          <FlaskConical size={25} />
        </div>
        <span className="eyebrow">MEASURE WHAT YOU CAN PROVE</span>
        <h2>Accuracy needs a reference.</h2>
        <p>
          Compare model predictions with independent gaze labels, using one
          shared time and coordinate system. Webcam evaluation also requires the
          original face video and a held-out evaluation protocol.
        </p>
        <a href="https://ait.ethz.ch/eve" target="_blank" rel="noreferrer">
          Explore EVE: webcam + screen + reference gaze ↗
        </a>
      </section>
      <section className="panel">
        <div className="import-files">
          <label className="dropzone">
            Predictions CSV
            <strong>
              {predictions
                ? `${predictions.length.toLocaleString()} predictions`
                : "Choose model output"}
            </strong>
            <span>t_us, x_px, y_px, valid, participant_id</span>
            <input
              type="file"
              accept=".csv"
              onChange={(e) =>
                e.target.files?.[0] && parse(e.target.files[0], setPredictions)
              }
            />
          </label>
          <label className="dropzone">
            Reference CSV
            <strong>
              {references
                ? `${references.length.toLocaleString()} reference samples`
                : "Choose ground truth"}
            </strong>
            <span>Same clock, pixels and participant IDs</span>
            <input
              type="file"
              accept=".csv"
              onChange={(e) =>
                e.target.files?.[0] && parse(e.target.files[0], setReferences)
              }
            />
          </label>
        </div>
        <div className="form-grid">
          <label>
            Maximum pairing offset (ms)
            <input
              type="number"
              value={tolerance}
              min="0"
              onChange={(e) => setTolerance(Math.max(0, +e.target.value))}
            />
          </label>
          <label>
            Screen width (mm, optional)
            <input
              type="number"
              min="0"
              value={geometry.widthMm}
              onChange={(e) =>
                setGeometry({ ...geometry, widthMm: +e.target.value })
              }
            />
          </label>
          <label>
            Screen height (mm, optional)
            <input
              type="number"
              min="0"
              value={geometry.heightMm}
              onChange={(e) =>
                setGeometry({ ...geometry, heightMm: +e.target.value })
              }
            />
          </label>
          <label>
            Viewing distance (mm, optional)
            <input
              type="number"
              min="0"
              value={geometry.distanceMm}
              onChange={(e) =>
                setGeometry({ ...geometry, distanceMm: +e.target.value })
              }
            />
          </label>
        </div>
        <label>
          Evaluation protocol
          <textarea
            value={protocol}
            onChange={(e) => setProtocol(e.target.value)}
            placeholder="Model/version, dataset/split, held-out participants, allowed calibration samples, label source…"
          />
        </label>
        <button
          className="primary"
          disabled={!predictions || !references || !protocol.trim()}
          onClick={() => {
            try {
              setResult(
                benchmark(
                  predictions!,
                  references!,
                  tolerance * 1000,
                  recording.width,
                  recording.height,
                  Object.values(geometry).every((v) => v > 0)
                    ? geometry
                    : undefined,
                ),
              );
              setError("");
            } catch (e) {
              setError(String(e));
            }
          }}
        >
          <FlaskConical size={16} /> Run evaluation
        </button>
        {error && <p className="error">{error}</p>}
      </section>
      {result && (
        <section className="panel">
          <div className="section-heading">
            <h3>Offline evaluation results</h3>
            <button
              onClick={() =>
                download(
                  new Blob(
                    [
                      JSON.stringify(
                        {
                          ...result,
                          protocol,
                          dimensions: {
                            width: recording.width,
                            height: recording.height,
                          },
                        },
                        null,
                        2,
                      ),
                    ],
                    { type: "application/json" },
                  ),
                  "benchmark.json",
                )
              }
            >
              <Download size={15} /> Export report
            </button>
          </div>
          <div className="metrics-grid">
            {[
              [
                "Mean error",
                result.pixelError
                  ? `${result.pixelError.mean.toFixed(2)} px`
                  : "No matches",
              ],
              [
                "P90 error",
                result.pixelError
                  ? `${result.pixelError.p90.toFixed(2)} px`
                  : "—",
              ],
              [
                "Angular error",
                result.angularError
                  ? `${result.angularError.mean.toFixed(2)}°`
                  : "Geometry required",
              ],
              [
                "Prediction match rate",
                `${(result.predictionMatchRate * 100).toFixed(1)}%`,
              ],
            ].map(([label, value]) => (
              <div className="metric" key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
          <p className="muted">
            {result.matched} unique pairs ·{" "}
            {(result.referenceCoverage * 100).toFixed(1)}% reference coverage ·
            one-to-one nearest timestamps within {tolerance} ms.
          </p>
          <table>
            <thead>
              <tr>
                <th>Participant</th>
                <th>Mean pixel error</th>
                <th>P90 pixel error</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(result.perParticipant).map(([p, r]) => (
                <tr key={p}>
                  <td>{p}</td>
                  <td>{r?.mean.toFixed(2)}</td>
                  <td>{r?.p90.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint">
            {result.staticTargetPrecision
              ? `Static-target RMS sample-to-sample precision: ${result.staticTargetPrecision.rmsSampleToSamplePx.toFixed(2)} px; pooled spatial SD: ${result.staticTargetPrecision.pooledWithinTargetSDPx.toFixed(2)} px (${result.staticTargetPrecision.groups} qualifying runs). `
              : "Precision unavailable: no qualifying constant-reference runs. "}
            Reported errors depend on the quality of supplied labels and
            geometry. Literature benchmark numbers do not establish this app’s
            live webcam accuracy.
          </p>
        </section>
      )}
    </div>
  );
}
