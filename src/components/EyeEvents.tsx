import { useEffect, useState } from "react";
import type { Analysis } from "../core/types";
import { download } from "../core/io";
export function EyeEvents({
  result,
  onReplay,
}: {
  result: Analysis | null;
  onReplay: (t: number) => void;
}) {
  const [kind, setKind] = useState<"fixations" | "saccades">("fixations"),
    [page, setPage] = useState(0);
  useEffect(() => setPage(0), [kind, result]);
  const events =
    kind === "fixations"
      ? (result?.fixations ?? []).map((f) => ({
          start: f.start,
          end: f.end,
          participant: f.participant,
          x: f.x,
          y: f.y,
          amplitude: null as number | null,
          peak: null as number | null,
        }))
      : (result?.saccades ?? []).map((s) => ({
          start: s.start,
          end: s.end,
          participant: s.participant,
          x: s.endX,
          y: s.endY,
          amplitude: s.amplitude,
          peak: s.peakVelocity,
        }));
  const pages = Math.max(1, Math.ceil(events.length / 25));
  const csv = () =>
    download(
      new Blob(
        [
          [
            "type,participant,start_ms,end_ms,duration_ms,x_px,y_px,amplitude_px,peak_velocity_px_s",
            ...events.map((e) =>
              [
                kind === "fixations" ? "fixation" : "saccade_candidate",
                `"${e.participant.replaceAll('"', '""')}"`,
                e.start / 1000,
                e.end / 1000,
                (e.end - e.start) / 1000,
                e.x,
                e.y,
                e.amplitude ?? "",
                e.peak ?? "",
              ].join(","),
            ),
          ].join("\n"),
        ],
        { type: "text/csv" },
      ),
      `${kind}.csv`,
    );
  return (
    <section className="panel eye-events">
      <div className="section-heading">
        <div>
          <span className="eyebrow">EVENT INSPECTION</span>
          <h2>Eye movement events</h2>
        </div>
        <button onClick={csv} disabled={!events.length}>
          Export events CSV
        </button>
      </div>
      <div
        className="event-tabs"
        role="tablist"
        aria-label="Eye movement event type"
      >
        <button
          role="tab"
          aria-selected={kind === "fixations"}
          onClick={() => setKind("fixations")}
        >
          Fixations · {result?.fixations.length ?? "—"}
        </button>
        <button
          role="tab"
          aria-selected={kind === "saccades"}
          onClick={() => setKind("saccades")}
        >
          Saccade candidates · {result?.saccades?.length ?? "—"}
        </button>
      </div>
      <p className="hint">
        {kind === "fixations"
          ? `Detected using ${result?.parameters.method.toUpperCase() ?? "I-VT"}. Position is the mean gaze point of each fixation.`
          : `Contiguous gaze intervals above ${result?.parameters.velocity ?? 800} px/s for at least 10 ms; nearly coincident timestamps are excluded. Amplitude is endpoint displacement; peak speed uses adjacent valid samples. These are candidates, not validated physiological labels.`}
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Participant</th>
              <th>Start</th>
              <th>Duration</th>
              <th>{kind === "fixations" ? "Center (px)" : "Amplitude"}</th>
              {kind === "saccades" && <th>Peak speed</th>}
              <th>Evidence</th>
            </tr>
          </thead>
          <tbody>
            {events.slice(page * 25, (page + 1) * 25).map((e, i) => (
              <tr key={e.participant + ":" + e.start + ":" + i}>
                <td>{e.participant}</td>
                <td>{(e.start / 1e6).toFixed(3)} s</td>
                <td>{((e.end - e.start) / 1000).toFixed(1)} ms</td>
                <td>
                  {kind === "fixations"
                    ? `${e.x.toFixed(1)}, ${e.y.toFixed(1)}`
                    : `${e.amplitude?.toFixed(1)} px`}
                </td>
                {kind === "saccades" && <td>{e.peak?.toFixed(0)} px/s</td>}
                <td>
                  <button
                    className="table-replay"
                    aria-label={`Replay ${kind === "fixations" ? "fixation" : "saccade candidate"} ${page * 25 + i + 1}`}
                    onClick={() => onReplay(e.start)}
                  >
                    Replay event
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!events.length && (
        <p className="empty-inline">
          {result
            ? "No events in the selected analysis window."
            : "Analyzing gaze…"}
        </p>
      )}
      <div className="event-pagination">
        <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
          Previous events
        </button>
        <span>
          {page + 1} / {pages} · {events.length} events
        </span>
        <button
          disabled={page + 1 >= pages}
          onClick={() => setPage((p) => p + 1)}
        >
          Next events
        </button>
      </div>
    </section>
  );
}
