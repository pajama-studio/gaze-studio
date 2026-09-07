import type { Analysis, Recording, Settings } from "../core/types";
import {
  Download,
  Activity,
  Target,
  Timer,
  Eye,
  PlaySquare,
} from "lucide-react";
import { download } from "../core/io";
import { quantile } from "../core/analysis";
import { coveredDuration } from "../core/aoi";
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
  onReplayAOI,
}: {
  recording: Recording;
  result: Analysis | null;
  settings: Settings;
  onSettings: (s: Settings) => void;
  onReplayAOI: (id: string, time: number) => void;
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
              aois: recording.aois,
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
  const visibleAOIs = recording.aois.filter((a) =>
    result?.aoi.some((m) => m.id === a.id),
  );
  const windowEnd = Math.min(recording.duration, settings.end);
  const annotatedTime = coveredDuration(visibleAOIs, settings.start, windowEnd);
  const ranked = [...(result?.aoi ?? [])]
    .filter((a) => a.dwell > 0)
    .sort((a, b) => b.dwell - a.dwell)
    .slice(0, 6);
  const replayArea = (id: string) => {
    const area = recording.aois.find((a) => a.id === id)!;
    const metric = result?.aoi.find((a) => a.id === id);
    const firstHit = result?.sequences.find((s) => s.aoi === id)?.start;
    const t =
      metric?.ttff != null
        ? Math.max(settings.start, area.start) + metric.ttff
        : (firstHit ?? area.start);
    onReplayAOI(id, t);
  };
  return (
    <div className="analysis-view">
      <Metrics result={result} />
      {!!result?.eyeSignals?.length && (
        <section className="panel eye-statistics">
          <div className="section-heading">
            <div>
              <span className="eyebrow">PER-EYE SIGNALS</span>
              <h2>Pupil measurements</h2>
            </div>
          </div>
          <p className="muted">
            Descriptive statistics from the selected time window, computed in
            Rust. Confidence ≥60%; missing values and long gaps stay excluded.
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Eye</th>
                  <th>Valid samples</th>
                  <th>Time coverage</th>
                  <th>Mean</th>
                  <th>Median</th>
                  <th>SD</th>
                  <th>P05–P95</th>
                </tr>
              </thead>
              <tbody>
                {result.eyeSignals.map((s) => (
                  <tr key={s.eye}>
                    <td>{s.eye}</td>
                    <td>
                      {s.validSamples.toLocaleString()} /{" "}
                      {s.samples.toLocaleString()}
                    </td>
                    <td>{(s.coverage * 100).toFixed(1)}%</td>
                    <td>
                      {s.mean?.toFixed(2) ?? "—"} {s.unit}
                    </td>
                    <td>{s.median?.toFixed(2) ?? "—"}</td>
                    <td>{s.sd?.toFixed(2) ?? "—"}</td>
                    <td>
                      {s.p05?.toFixed(2) ?? "—"}–{s.p95?.toFixed(2) ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint">
            These measurements do not establish cognitive load or emotion.
            Image-pixel diameter changes with camera geometry.
          </p>
        </section>
      )}
      <section
        className="panel attention-summary"
        aria-label="Automatic AOI analysis summary"
      >
        <div className="section-heading">
          <div>
            <span className="eyebrow">ATTENTION WITH EVIDENCE</span>
            <h2>Where did the gaze go?</h2>
          </div>
          <label>
            AOI set
            <select
              aria-label="AOI set"
              value={settings.aoiScope ?? "all"}
              onChange={(e) => change("aoiScope", e.target.value)}
            >
              <option value="all">All accepted areas</option>
              <option value="automatic">Automatic areas only</option>
            </select>
          </label>
        </div>
        <p className="muted">
          {visibleAOIs.length} analyzed areas · visible during{" "}
          {(annotatedTime / 1e6).toFixed(1)}s of the{" "}
          {((windowEnd - settings.start) / 1e6).toFixed(1)}s window. Select a
          result to replay its first fixation or gaze hit.
        </p>
        <div className="attention-ranking">
          {ranked.map((a) => (
            <button
              key={a.id}
              onClick={() => replayArea(a.id)}
              aria-label={`Replay top area ${a.name}`}
            >
              <span>{a.name}</span>
              <span className="attention-bar">
                <i
                  style={{
                    width: `${(a.dwell / ranked[0].dwell) * 100}%`,
                    background: recording.aois.find((o) => o.id === a.id)
                      ?.color,
                  }}
                />
              </span>
              <strong>{(a.dwell / 1e6).toFixed(2)}s</strong>
              <PlaySquare size={16} />
            </button>
          ))}
        </div>
        {!ranked.length && (
          <p className="empty-inline">
            No valid dwell in the selected areas yet. Accept automatic
            candidates in Replay, or choose a different analysis window.
          </p>
        )}
        <p className="hint">
          Recorded page regions use source DOM geometry; AI objects use sampled
          visual detections. Regions can overlap and may cover only part of the
          session. These are analysis annotations, not independently verified
          semantic labels.
        </p>
      </section>
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
                <th>Evidence</th>
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
                  <td>
                    <button
                      className="table-replay"
                      aria-label={`Replay area ${a.name}`}
                      onClick={() => replayArea(a.id)}
                    >
                      <PlaySquare size={14} /> Replay area
                    </button>
                  </td>
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
