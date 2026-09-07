import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Film, Eye, ZoomIn, ZoomOut, ScanLine } from "lucide-react";
import type { Recording, Analysis } from "@pajama-studio/gaze-core";
import { clockLabel } from "./format";
import { AOITimeline } from "./AOITimeline";
export interface MediaTimelineProps {
  recording: Recording;
  analysis: Analysis | null;
  participants: string[];
  participant: string;
  time: number;
  onSeek: (time: number) => void;
  onPause: () => void;
}
const MediaLanes = memo(function MediaLanes({
  recording: r,
}: {
  recording: Recording;
}) {
  return (
    <>
      <div className="media-lane">
        <span>
          <Film size={12} />
          Scene
        </span>
        <div className="media-clip scene-clip" title={r.mediaName}>
          {r.mediaName}
        </div>
      </div>
      {[...(r.videoTracks ?? [])]
        .sort((a, b) => a.role.localeCompare(b.role))
        .map((t) => (
          <div className="media-lane" key={t.id}>
            <span>
              <Eye size={12} />
              {t.role === "left-eye"
                ? "Left eye"
                : t.role === "right-eye"
                  ? "Right eye"
                  : "Context"}
            </span>
            <div className="clip-bed">
              <div
                className={`media-clip ${t.role}`}
                style={{
                  left: `${(t.start / r.duration) * 100}%`,
                  width: `${((t.end - t.start) / r.duration) * 100}%`,
                }}
                title={t.source}
              >
                {t.name}
                <small>{t.frameTimes?.length.toLocaleString()} frames</small>
              </div>
            </div>
          </div>
        ))}
    </>
  );
});
export function MediaTimeline({
  recording: r,
  analysis,
  participants,
  participant,
  time,
  onSeek,
  onPause,
}: MediaTimelineProps) {
  const [zoom, setZoom] = useState(1);
  const scroll = useRef<HTMLDivElement>(null),
    drag = useRef(false),
    pending = useRef<number | null>(null),
    raf = useRef(0);
  const latest = useRef(onSeek);
  latest.current = onSeek;
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  useEffect(() => setZoom(1), [r.id]);
  const ticks = useMemo(
    () =>
      Array.from(
        { length: 5 * zoom + 1 },
        (_, i) => (i / (5 * zoom)) * r.duration,
      ).filter((t) => t <= r.duration),
    [zoom, r.duration],
  );
  const position = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return Math.max(
      0,
      Math.min(r.duration, ((e.clientX - rect.left) / rect.width) * r.duration),
    );
  };
  const queue = (t: number) => {
    pending.current = t;
    if (!raf.current)
      raf.current = requestAnimationFrame(() => {
        raf.current = 0;
        if (pending.current !== null) latest.current(pending.current);
      });
  };
  return (
    <div className="media-timeline">
      <div className="timeline-header">
        <span>
          <ScanLine size={13} />
          TIMELINE
        </span>
        <span className="timeline-shortcuts">
          Space play / pause <i /> ← → frame <i /> Shift ← → 1s
        </span>
        <div>
          <button
            aria-label="Zoom timeline out"
            disabled={zoom === 1}
            onClick={() => setZoom((z) => Math.max(1, z / 2))}
          >
            <ZoomOut size={14} />
          </button>
          <span>{zoom}×</span>
          <button
            aria-label="Zoom timeline in"
            disabled={zoom === 8}
            onClick={() => setZoom((z) => Math.min(8, z * 2))}
          >
            <ZoomIn size={14} />
          </button>
        </div>
      </div>
      <div className="timeline-scroll" ref={scroll}>
        <div className="timeline-content" style={{ width: `${zoom * 100}%` }}>
          <div className="timeline-ruler">
            <span>TIME</span>
            <div>
              {ticks.map((t) => (
                <span key={t} style={{ left: `${(t / r.duration) * 100}%` }}>
                  {clockLabel(t)}
                </span>
              ))}
            </div>
          </div>
          <div className="timeline-tracks">
            <MediaLanes recording={r} />
            <div
              className="timeline-hit"
              role="slider"
              tabIndex={0}
              aria-label="Multi-track timeline"
              aria-valuemin={0}
              aria-valuemax={r.duration / 1e6}
              aria-valuenow={time / 1e6}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                  e.preventDefault();
                  e.stopPropagation();
                  onPause();
                  onSeek(
                    Math.max(
                      0,
                      Math.min(
                        r.duration,
                        time +
                          (e.key === "ArrowRight" ? 1 : -1) *
                            (e.shiftKey ? 1e6 : 100000),
                      ),
                    ),
                  );
                }
              }}
              onPointerDown={(e) => {
                e.preventDefault();
                onPause();
                drag.current = true;
                e.currentTarget.setPointerCapture(e.pointerId);
                queue(position(e));
              }}
              onPointerMove={(e) => {
                if (drag.current) queue(position(e));
              }}
              onPointerUp={(e) => {
                drag.current = false;
                cancelAnimationFrame(raf.current);
                raf.current = 0;
                pending.current = null;
                onSeek(position(e));
              }}
              onPointerCancel={() => {
                drag.current = false;
              }}
            >
              <div
                className="timeline-playhead"
                style={{ left: `${(time / r.duration) * 100}%` }}
              >
                <b />
              </div>
            </div>
          </div>
          <AOITimeline
            participants={participants}
            participant={participant}
            sequences={analysis?.sequences ?? []}
            aois={r.aois}
            time={time}
            duration={r.duration}
            onSeek={onSeek}
          />
        </div>
      </div>
    </div>
  );
}
