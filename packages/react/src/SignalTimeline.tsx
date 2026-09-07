import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Analysis, Recording } from "@pajama-studio/gaze-core";
import {
  buildSignalRows,
  pointAt,
  signalPath,
  type SignalEvent,
  type SignalRow,
  type SignalTrackId,
} from "./signal-data";
import { clockLabel } from "./format";
export interface SignalTimelineProps {
  recording: Recording;
  analysis: Analysis | null;
  participant: string;
  time: number;
  hidden?: ReadonlySet<SignalTrackId>;
  onSeek: (time: number) => void;
  onPause: () => void;
}
const TrackPlot = memo(function TrackPlot({
  row,
  duration,
  maxGap,
  onSeek,
  onEvent,
}: {
  row: SignalRow;
  duration: number;
  maxGap: number;
  onSeek: (t: number) => void;
  onEvent: (event: SignalEvent) => void;
}) {
  const paths = useMemo(
    () =>
      row.series.map((s) => ({
        ...s,
        d: signalPath(s.points, duration, s.min, s.max, maxGap),
      })),
    [row, duration, maxGap],
  );
  const pending = useRef<number | null>(null),
    raf = useRef(0),
    drag = useRef(false);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  const position = (e: React.PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    return Math.max(
      0,
      Math.min(duration, ((e.clientX - box.x) / box.width) * duration),
    );
  };
  const queue = (t: number) => {
    pending.current = t;
    if (!raf.current)
      raf.current = requestAnimationFrame(() => {
        raf.current = 0;
        if (pending.current !== null) onSeek(pending.current);
      });
  };
  const hasData = paths.some((p) => p.d) || row.events.length > 0;
  return (
    <svg
      viewBox="0 0 1000 52"
      preserveAspectRatio="none"
      className="signal-plot"
      role="slider"
      tabIndex={0}
      aria-label={`${row.label} timeline`}
      aria-valuemin={0}
      aria-valuemax={duration / 1e6}
      aria-valuetext="Use arrow keys to seek or select an event"
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          e.preventDefault();
          e.stopPropagation();
          const t = Number(e.currentTarget.dataset.time ?? 0);
          onSeek(
            t + (e.key === "ArrowRight" ? 1 : -1) * (e.shiftKey ? 1e6 : 100000),
          );
        }
      }}
      onPointerDown={(e) => {
        if ((e.target as Element).closest("[data-signal-event]")) return;
        e.preventDefault();
        drag.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        queue(position(e));
      }}
      onPointerMove={(e) => {
        if (drag.current) queue(position(e));
      }}
      onPointerUp={(e) => {
        if (!drag.current) return;
        drag.current = false;
        cancelAnimationFrame(raf.current);
        raf.current = 0;
        pending.current = null;
        onSeek(position(e));
      }}
      onPointerCancel={() => {
        drag.current = false;
        pending.current = null;
        cancelAnimationFrame(raf.current);
        raf.current = 0;
      }}
    >
      <path d="M0,8H1000 M0,26H1000 M0,44H1000" className="signal-grid" />
      {row.id === "quality" && row.series[0]?.label !== "Validity" && (
        <rect x={0} y={22.4} width={1000} height={21.6} fill="#b8754330" />
      )}
      {paths.map((s) => (
        <path
          key={s.label + s.unit}
          d={s.d}
          stroke={s.color}
          strokeWidth={1.3}
          vectorEffect="non-scaling-stroke"
          fill="none"
        />
      ))}
      {row.events.map((event) => (
        <rect
          key={event.id}
          data-signal-event={event.id}
          role="button"
          tabIndex={0}
          aria-label={`${event.label}, ${clockLabel(event.start)}, ${event.detail}`}
          x={(event.start / duration) * 1000}
          width={Math.max(0.7, ((event.end - event.start) / duration) * 1000)}
          y={row.id === "quality" ? 37 : 12}
          height={row.id === "quality" ? 12 : 28}
          rx={1.5}
          fill={event.color}
          fillOpacity={row.id === "quality" ? 0.65 : 0.82}
          onClick={(e) => {
            e.stopPropagation();
            onEvent(event);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              onEvent(event);
            }
          }}
        >
          <title>
            {event.label} · {event.detail}
          </title>
        </rect>
      ))}
      {!hasData && (
        <text x={14} y={30} className="signal-empty">
          {row.empty}
        </text>
      )}
    </svg>
  );
});
export function SignalTimeline({
  recording: r,
  analysis,
  participant,
  time,
  hidden,
  onSeek,
  onPause,
}: SignalTimelineProps) {
  const participants = useMemo(
    () => [...new Set(r.samples.map((g) => g.participant))],
    [r.samples],
  );
  const [chosen, setChosen] = useState(""),
    [selected, setSelected] = useState<SignalEvent | null>(null);
  const active =
    participant !== "all"
      ? participant
      : participants.includes(chosen)
        ? chosen
        : (participants[0] ?? "");
  const rows = useMemo(
    () => buildSignalRows(r, analysis, active),
    [
      r.samples,
      r.anchors,
      r.eyeSignals,
      r.width,
      r.height,
      r.duration,
      analysis,
      active,
    ],
  );
  const maxGap = analysis?.parameters.maxGap ?? 75000;
  const latest = useRef({ onSeek, onPause, duration: r.duration });
  latest.current = { onSeek, onPause, duration: r.duration };
  const seek = useCallback((t: number) => {
    latest.current.onPause();
    latest.current.onSeek(
      Math.max(0, Math.min(latest.current.duration, Math.round(t))),
    );
  }, []);
  const select = useCallback(
    (event: SignalEvent) => {
      setSelected(event);
      seek(event.start);
    },
    [seek],
  );
  useEffect(() => {
    setSelected(null);
  }, [r.id, active, analysis]);
  const root = useRef<HTMLDivElement>(null);
  // Only cursor/readout attributes change while playing. Static SVG geometry is memoized.
  useEffect(() => {
    root.current?.querySelectorAll<SVGElement>(".signal-plot").forEach((e) => {
      e.dataset.time = String(time);
      e.setAttribute("aria-valuenow", String(time / 1e6));
    });
  }, [time, hidden, active, r.id]);
  const visible = rows.filter((row) => !hidden?.has(row.id));
  if (!visible.length) return null;
  return (
    <div
      className="signal-timeline"
      ref={root}
      aria-label="Eye tracking data tracks"
    >
      {participants.length > 1 && participant === "all" && (
        <label className="signal-participant">
          Signal participant{" "}
          <select
            aria-label="Signal participant"
            value={active}
            onChange={(e) => setChosen(e.target.value)}
          >
            {participants.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
      )}
      {visible.map((row) => (
        <div className="signal-row" key={row.id} data-signal-track={row.id}>
          <div
            className="signal-name"
            title={`${row.label}: ${row.description}`}
          >
            <strong>{row.label}</strong>
            <small>
              {row.series.length
                ? row.series.map((s) => s.label).join(" / ")
                : `${row.events.length} events`}
            </small>
          </div>
          <div className="signal-track-content">
            <TrackPlot
              row={row}
              duration={r.duration}
              maxGap={maxGap}
              onSeek={seek}
              onEvent={select}
            />
            <div className="signal-readout" aria-label={`${row.label} values`}>
              {row.series.map((s) => {
                const p = pointAt(s.points, time, maxGap);
                return (
                  <span key={s.label + s.unit} style={{ color: s.color }}>
                    {s.label}{" "}
                    {p?.value == null
                      ? "—"
                      : `${p.value.toFixed(s.unit === "%" ? 0 : 1)} ${s.unit}`}
                  </span>
                );
              })}
              {!row.series.length && (
                <span>
                  {row.events.find((e) => e.start <= time && time < e.end)
                    ?.label ?? row.description}
                </span>
              )}
            </div>
          </div>
        </div>
      ))}
      <div className="signal-cursor-bed" aria-hidden="true">
        <div
          className="signal-cursor"
          style={{ left: `${Math.min(1, time / r.duration) * 100}%` }}
        />
      </div>
      {selected && (
        <div className="signal-event-detail" role="status">
          <strong>{selected.label}</strong>
          <span>
            {clockLabel(selected.start)} – {clockLabel(selected.end)}
          </span>
          <span>{selected.detail}</span>
          <button onClick={() => seek(selected.start)}>Replay event</button>
          <button
            onClick={() => setSelected(null)}
            aria-label="Close event details"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
