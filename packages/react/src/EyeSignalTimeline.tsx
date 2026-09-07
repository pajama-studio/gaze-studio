import { useMemo } from "react";
import type { Anchor, EyeSignal } from "@pajama-studio/gaze-core";
import { mapTime } from "@pajama-studio/gaze-core/time";
export function EyeSignalTimeline({
  signals,
  anchors,
  time,
  duration,
  onSeek,
}: {
  signals: EyeSignal[];
  anchors: Anchor[];
  time: number;
  duration: number;
  onSeek: (t: number) => void;
}) {
  const rows = useMemo(
    () =>
      ["left", "right"].map((eye) => {
        const all = signals
          .filter((s) => s.eye === eye)
          .map((s) => ({ ...s, t: mapTime(s.t, anchors) }));
        const values = all.filter(
          (s) => s.pupil !== null && s.confidence >= 0.6,
        );
        const min = 0,
          max = values.reduce((m, s) => Math.max(m, s.pupil!), 1);
        // Min/max decimation preserves brief excursions instead of dropping every nth sample.
        const buckets = new Map<number, EyeSignal[]>();
        for (const s of all) {
          const x = Math.floor((s.t / duration) * 700);
          const b = buckets.get(x) ?? [];
          b.push(s);
          buckets.set(x, b);
        }
        const points: EyeSignal[] = [];
        for (const b of buckets.values()) {
          const v = b.filter((s) => s.pupil !== null && s.confidence >= 0.6);
          if (!v.length) {
            points.push({ ...b[0], pupil: null });
            continue;
          }
          const sorted = [...v].sort((a, b) => a.pupil! - b.pupil!);
          points.push(
            ...[sorted[0], sorted[sorted.length - 1]].sort((a, b) => a.t - b.t),
          );
        }
        let d = "",
          previous = -Infinity;
        for (const s of points) {
          if (s.pupil === null) {
            previous = -Infinity;
            continue;
          }
          d += `${s.t - previous > 75000 ? "M" : "L"}${(s.t / duration) * 1000},${60 - ((s.pupil - min) / (max - min)) * 50} `;
          previous = s.t;
        }
        return {
          eye,
          all,
          d,
          min,
          max,
          unit: values[0]?.pupilUnit ?? "arbitrary",
        };
      }),
    [signals, anchors, duration],
  );
  return (
    <div className="eye-signals" aria-label="Per-eye pupil timeline">
      {rows.map((row) => {
        const i = (() => {
            let lo = 0,
              hi = row.all.length;
            while (lo < hi) {
              const m = (lo + hi) >>> 1;
              if (row.all[m].t <= time) lo = m + 1;
              else hi = m;
            }
            return lo - 1;
          })(),
          current = i < 0 ? null : row.all[i];
        const fresh = current && time - current.t < 75000;
        return (
          <div className="eye-signal-row" key={row.eye}>
            <div>
              <strong>{row.eye === "left" ? "Left" : "Right"} pupil</strong>
              <small>
                {fresh && current.pupil !== null && current.confidence >= 0.6
                  ? `${current.pupil.toFixed(2)} ${current.pupilUnit}`
                  : "No valid sample"}
              </small>
            </div>
            <svg
              viewBox="0 0 1000 70"
              preserveAspectRatio="none"
              role="slider"
              tabIndex={0}
              aria-label={`${row.eye} pupil timeline`}
              aria-valuemin={0}
              aria-valuemax={duration / 1e6}
              aria-valuenow={time / 1e6}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                  e.preventDefault();
                  onSeek(
                    Math.max(
                      0,
                      Math.min(
                        duration,
                        time + (e.key === "ArrowRight" ? 100000 : -100000),
                      ),
                    ),
                  );
                }
              }}
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                onSeek(((e.clientX - rect.left) / rect.width) * duration);
              }}
            >
              <path
                d={row.d}
                fill="none"
                stroke={row.eye === "left" ? "#0c9a87" : "#a47cdf"}
                strokeWidth="1.5"
                vectorEffect="non-scaling-stroke"
              />
              <line
                x1={(time / duration) * 1000}
                x2={(time / duration) * 1000}
                y1="0"
                y2="70"
                stroke="#eb9b30"
                strokeWidth="2"
              />
            </svg>
            <small>
              {fresh
                ? `${Math.round(current.confidence * 100)}% confidence`
                : "—"}
              <br />
              {row.max.toFixed(1)} {row.unit} max
            </small>
          </div>
        );
      })}
      <p>
        Derived pupil measurements · gaps stay visible · click a trace to seek
      </p>
    </div>
  );
}
