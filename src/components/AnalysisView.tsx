import type { Analysis, Recording, Settings } from "../core/types";
import { Download, Activity, Target, Timer, Eye } from "lucide-react";
import { download } from "../core/io";
import { quantile } from "../core/analysis";
const ms = (t: number) => `${(t / 1000).toFixed(0)} ms`;
export function Metrics({ result }: { result: Analysis | null }) {
  const r = result;
  return (
    <div className="metrics-grid">
      {[
        {
          icon: Eye,
          label: "Valid time coverage",
          value: r ? `${(r.coverage * 100).toFixed(1)}%` : "—",
          detail: r
            ? `${r.validSamples.toLocaleString()} valid samples`
            : "Processing gaze",
        },
        {
          icon: Target,
          label: "Detected fixations",
          value: r?.fixations.length.toLocaleString() ?? "—",
          detail: r
            ? `${r.parameters.method.toUpperCase()} · ${r.parameters.minFixation / 1000} ms minimum`
            : "Worker analysis",
        },
        {
          icon: Timer,
          label: "Median fixation",
          value: r?.fixations.length
            ? ms(
                quantile(
                  r.fixations.map((f) => f.end - f.start),
                  0.5,
                ),
              )
            : "—",
          detail: "No bridging across tracking gaps",
        },
        {
          icon: Activity,
          label: "Median sample rate",
          value: r ? `${r.medianHz.toFixed(0)} Hz` : "—",
          detail: r
            ? `${r.gaps} long gaps detected`
            : "Measured from timestamps",
        },
      ].map(({ icon: Icon, label, value, detail }) => (
        <div className="metric" key={label}>
          <div>
            <span>{label}</span>
            <Icon size={16} />
          </div>
          <strong>{value}</strong>
          <small>{detail}</small>
        </div>
      ))}
    </div>
  );
}
export function AnalysisView({
  recording,
  result,
  settings,
  onSettings,
}: {
  recording: Recording;
  result: Analysis | null;
  settings: Settings;
  onSettings: (s: Settings) => void;
}) {
  const change = (key: keyof Settings, value: string | number) =>
    onSettings({ ...settings, [key]: value });
  const exportResult = () =>
    result &&
    download(
      new Blob(
        [
          JSON.stringify(
            {
              recordingId: recording.id,
              source: recording.source,
              anchors: recording.anchors,
              result,
            },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
      `${recording.title}-analysis.json`,
    );
  const exportAOI = () =>
    result &&
    download(
      new Blob(
        [
          [
            "aoi_id,name,dwell_ms,visits,ttff_ms,fixations,fixation_duration_ms",
            ...result.aoi.map((a) =>
              [
                a.id,
                `"${a.name.replaceAll('"', '""')}"`,
                a.dwell / 1000,
                a.visits,
                a.ttff === null ? "" : a.ttff / 1000,
                a.fixationCount,
                a.fixationDuration / 1000,
              ].join(","),
            ),
          ].join("\n"),
        ],
        { type: "text/csv" },
      ),
      "aoi-metrics.csv",
    );
  const velocities = result?.velocities ?? [];
  const bins = Array.from({ length: 600 }, () => 0);
  for (const v of velocities) {
    const index = Math.floor((v.t / recording.duration) * 599);
    if (index >= 0 && index < 600) bins[index] = Math.max(bins[index], v.v);
  }
  const maxV = Math.max(settings.velocity * 1.3, ...bins);
  return (
    <div className="analysis-view">
      <Metrics result={result} />
      <section className="panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow">REPRODUCIBLE BY DESIGN</span>
            <h2>From samples to attention.</h2>
          </div>
          <button onClick={exportResult} disabled={!result}>
            <Download size={15} /> Export analysis
          </button>
        </div>
        <div className="analysis-controls">
          <label>
            Event detector
            <select
              value={settings.method}
              onChange={(e) => change("method", e.target.value)}
            >
              <option value="ivt">I-VT · velocity threshold</option>
              <option value="idt">I-DT · dispersion threshold</option>
            </select>
          </label>
          <label>
            {settings.method === "ivt" ? "Velocity (px/s)" : "Dispersion (px)"}
            <input
              type="number"
              min="1"
              value={
                settings.method === "ivt"
                  ? settings.velocity
                  : settings.dispersion
              }
              onChange={(e) =>
                change(
                  settings.method === "ivt" ? "velocity" : "dispersion",
                  Math.max(1, +e.target.value),
                )
              }
            />
          </label>
          <label>
            Minimum fixation (ms)
            <input
              type="number"
              min="1"
              value={settings.minFixation / 1000}
              onChange={(e) =>
                change("minFixation", Math.max(1, +e.target.value) * 1000)
              }
            />
          </label>
          <label>
            Maximum gap (ms)
            <input
              type="number"
              min="1"
              value={settings.maxGap / 1000}
              onChange={(e) =>
                change("maxGap", Math.max(1, +e.target.value) * 1000)
              }
            />
          </label>
          <label>
            Window start (s)
            <input
              type="number"
              min="0"
              max={recording.duration / 1e6}
              value={settings.start / 1e6}
              onChange={(e) =>
                change("start", Math.max(0, +e.target.value) * 1e6)
              }
            />
          </label>
          <label>
            Window end (s)
            <input
              type="number"
              min="0"
              max={recording.duration / 1e6}
              value={Math.min(settings.end, recording.duration) / 1e6}
              onChange={(e) =>
                change(
                  "end",
                  Math.min(
                    recording.duration,
                    Math.max(0, +e.target.value) * 1e6,
                  ),
                )
              }
            />
          </label>
        </div>
        <div className="plot-label">
          <span>Gaze velocity</span>
          <span>Peak per bin · {maxV.toFixed(0)} px/s ceiling</span>
        </div>
        <svg
          className="velocity-plot"
          viewBox="0 0 600 130"
          preserveAspectRatio="none"
          aria-label="Gaze velocity plot"
        >
          <defs>
            <linearGradient id="plot-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#119781" stopOpacity=".25" />
              <stop offset="100%" stopColor="#119781" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0.25, 0.5, 0.75].map((y) => (
            <line
              key={y}
              x1="0"
              x2="600"
              y1={y * 130}
              y2={y * 130}
              stroke="#e7eeeb"
            />
          ))}
          <polygon
            points={`0,130 ${bins.map((v, i) => `${i},${130 - (v / maxV) * 120}`).join(" ")} 600,130`}
            fill="url(#plot-fill)"
          />
          <polyline
            points={bins
              .map((v, i) => `${i},${130 - (v / maxV) * 120}`)
              .join(" ")}
            fill="none"
            stroke="#119781"
            strokeWidth="1.3"
          />
          <line
            x1="0"
            x2="600"
            y1={130 - (settings.velocity / maxV) * 120}
            y2={130 - (settings.velocity / maxV) * 120}
            stroke="#e9a845"
            strokeDasharray="4 4"
          />
        </svg>
        <p className="hint">
          These threshold detectors produce fixation candidates. Slow pursuit
          can be classified as fixation; event labels and physiological
          interpretation need a validated protocol. Missing gaze is not
          automatically a blink.
        </p>
      </section>
      <section className="panel">
        <div className="section-heading">
          <h3>Areas of interest</h3>
          <button onClick={exportAOI} disabled={!result}>
            <Download size={15} /> Export CSV
          </button>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Area</th>
                <th>Dwell</th>
                <th>Visits</th>
                <th>First fixation</th>
                <th>Fixations</th>
              </tr>
            </thead>
            <tbody>
              {result?.aoi.map((a) => (
                <tr key={a.id}>
                  <td>
                    <span
                      className="color-dot"
                      style={{
                        background: recording.aois.find((o) => o.id === a.id)
                          ?.color,
                      }}
                    />
                    {a.name}
                  </td>
                  <td>{(a.dwell / 1e6).toFixed(2)} s</td>
                  <td>{a.visits}</td>
                  <td>{a.ttff === null ? "Not fixated" : ms(a.ttff)}</td>
                  <td>{a.fixationCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!result?.aoi.length && (
          <p className="empty-inline">
            Draw or accept an AOI in Replay to calculate attention metrics.
          </p>
        )}
        <p className="hint">
          Dwell uses valid adjacent sample intervals. Overlapping AOIs count
          independently. Aggregate TTFF is the earliest participant fixation;
          choose one participant for individual latency.
        </p>
      </section>
      <div className="two-panels">
        <section className="panel">
          <h3>AOI transitions</h3>
          {result?.transitions.length ? (
            result.transitions.map((t) => (
              <div className="transition-row" key={`${t.from}-${t.to}`}>
                <span>
                  {recording.aois.find((a) => a.id === t.from)?.name} →{" "}
                  {recording.aois.find((a) => a.id === t.to)?.name}
                </span>
                <strong>{t.count}</strong>
              </div>
            ))
          ) : (
            <p className="muted">No direct transitions in this window.</p>
          )}
          <p className="hint">
            First AOI in annotation order wins overlaps for sequences.
            Outside-AOI periods and invalid intervals break transitions.
          </p>
        </section>
        <section className="panel">
          <h3>Pupil & tracking quality</h3>
          <div className="detail-row">
            <span>Mean recorded pupil size</span>
            <strong>{result?.pupil.mean?.toFixed(3) ?? "Not recorded"}</strong>
          </div>
          <div className="detail-row">
            <span>Valid pupil samples</span>
            <strong>{result?.pupil.count ?? 0}</strong>
          </div>
          <div className="detail-row">
            <span>Explicit blink samples</span>
            <strong>{result?.blinkSamples ?? 0}</strong>
          </div>
          <div className="detail-row">
            <span>Observed valid time</span>
            <strong>{((result?.validTime ?? 0) / 1e6).toFixed(2)} s</strong>
          </div>
          <p className="hint">
            Pupil values retain the source unit. No cognitive-load score is
            inferred from raw diameter.
          </p>
        </section>
      </div>
    </div>
  );
}
