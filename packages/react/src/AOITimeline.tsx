import { useMemo } from "react";
import { PALETTE, type AOI, type Analysis } from "@pajama-studio/gaze-core";
import { clockLabel } from "./format";
export interface AOITimelineProps {
  participants: string[];
  participant: string;
  sequences: Analysis["sequences"];
  aois: AOI[];
  time: number;
  duration: number;
  onSeek: (t: number) => void;
}
export function AOITimeline({
  participants,
  participant,
  sequences,
  aois,
  time,
  duration,
  onSeek,
}: AOITimelineProps) {
  const segments = useMemo(
    () =>
      Object.fromEntries(
        participants.map((p) => [
          p,
          sequences
            .filter((s) => s.participant === p && s.aoi)
            .map((s, j) => (
              <i
                key={j}
                style={{
                  left: `${(s.start / duration) * 100}%`,
                  width: `${((s.end - s.start) / duration) * 100}%`,
                  background: aois.find((a) => a.id === s.aoi)?.color,
                }}
                title={`${aois.find((a) => a.id === s.aoi)?.name}: ${clockLabel(s.start)}–${clockLabel(s.end)}`}
              />
            )),
        ]),
      ),
    [participants, sequences, aois, duration],
  );
  return (
    <div className="scarf">
      {participants
        .filter((p) => participant === "all" || p === participant)
        .map((p, i) => (
          <div className="scarf-row" key={p}>
            <span style={{ color: PALETTE[i % PALETTE.length] }}>{p}</span>
            <div
              className="scarf-track"
              role="slider"
              tabIndex={0}
              aria-label={`${p} AOI timeline`}
              aria-valuemin={0}
              aria-valuemax={duration / 1e6}
              aria-valuenow={time / 1e6}
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
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
              {segments[p]}
              <b
                className="playhead"
                style={{ left: `${(time / duration) * 100}%` }}
              />
            </div>
          </div>
        ))}
    </div>
  );
}
