import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MousePointer2,
  Square,
  Circle,
  Pentagon,
  Check,
  Crosshair,
  Flame,
  Route,
  Maximize2,
  ChevronDown,
} from "lucide-react";
import type { AOI, Analysis, Point, Recording } from "@pajama-studio/gaze-core";
import { PALETTE } from "@pajama-studio/gaze-core";
import { addKeyframe, pointsAt } from "@pajama-studio/gaze-core/aoi";
import { frameAt, mapTime, sampleWindow } from "@pajama-studio/gaze-core/time";
import { clockLabel } from "./format";
import { PlaybackControls } from "./PlaybackControls";
import { MediaTimeline } from "./MediaTimeline";
import { SynchronizedVideos } from "./SynchronizedVideos";
import { EyeSignalTimeline } from "./EyeSignalTimeline";
import { FixationHeatmap } from "./FixationHeatmap";
export interface GazeReplayProps {
  recording: Recording;
  time: number;
  setTime: (t: number) => void;
  playing: boolean;
  setPlaying: (p: boolean) => void;
  participant: string;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onAOIs: (aois: AOI[]) => void;
  analysis: Analysis | null;
  videoRef: React.RefObject<HTMLVideoElement | null>;
}
export function GazeReplay({
  recording: r,
  time,
  setTime,
  playing,
  setPlaying,
  participant,
  selected,
  onSelect,
  onAOIs,
  analysis,
  videoRef,
}: GazeReplayProps) {
  const svg = useRef<SVGSVGElement>(null);
  const monitor = useRef<HTMLDivElement>(null);
  const [showEyes, setShowEyes] = useState(true);
  const [tool, setTool] = useState<"select" | AOI["shape"]>("select"),
    [draft, setDraft] = useState<Point[]>([]),
    [drag, setDrag] = useState<{ index: number; points: Point[] } | null>(null);
  const [overlay, setOverlay] = useState<"gaze" | "scanpath" | "heatmap">(
      "gaze",
    ),
    [speed, setSpeed] = useState(1),
    [mediaError, setMediaError] = useState("");
  useEffect(() => {
    setDraft([]);
    setTool("select");
    setMediaError("");
  }, [r.id, r.mediaUrl]);
  useEffect(() => {
    const v = videoRef.current;
    if (!v || r.mediaType !== "video") return;
    v.playbackRate = speed;
    if (playing)
      v.play().catch((e) => {
        setPlaying(false);
        setMediaError(e.message);
      });
    else v.pause();
  }, [playing, speed, r.id, r.mediaUrl]);
  useEffect(() => {
    if (r.mediaType === "image") return;
    const v = videoRef.current;
    if (!v) return;
    let handle = 0;
    const frame = (_: number, meta: VideoFrameCallbackMetadata) => {
      setTime(Math.round(meta.mediaTime * 1e6));
      handle = v.requestVideoFrameCallback(frame);
    };
    if (v.requestVideoFrameCallback)
      handle = v.requestVideoFrameCallback(frame);
    return () => {
      if (handle) v.cancelVideoFrameCallback(handle);
    };
  }, [r.id, r.mediaUrl]);
  useEffect(() => {
    if (r.mediaType !== "image" || !playing) return;
    let previous = performance.now(),
      t = time,
      frame = 0;
    const tick = (now: number) => {
      t += (now - previous) * 1000 * speed;
      previous = now;
      if (t >= r.duration) {
        setTime(r.duration);
        setPlaying(false);
        return;
      }
      setTime(t);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, r.id, speed]);
  const seek = useCallback(
    (t: number) => {
      t = Math.min(r.duration, Math.max(0, t));
      setTime(t);
      if (
        videoRef.current &&
        Math.abs(videoRef.current.currentTime - t / 1e6) > 0.000001
      )
        videoRef.current.currentTime = t / 1e6;
    },
    [r.duration, videoRef, setTime],
  );
  const step = (direction: number) => {
    setPlaying(false);
    if (r.frameTimes?.length) {
      const i = frameAt(r.frameTimes, time);
      seek(
        r.frameTimes[
          Math.min(r.frameTimes.length - 1, Math.max(0, i + direction))
        ],
      );
    } else seek(time + direction * 100000);
  };
  const shortcuts = useRef({ time, playing, seek, step, setPlaying });
  shortcuts.current = { time, playing, seek, step, setPlaying };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.closest(
          'input,textarea,select,[contenteditable="true"],[role="slider"]',
        ) ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey
      )
        return;
      const state = shortcuts.current;
      if (e.code === "Space" && !target.closest("button,a")) {
        e.preventDefault();
        if (state.time >= r.duration - 1000) state.seek(0);
        state.setPlaying(!state.playing);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        if (e.shiftKey) {
          state.setPlaying(false);
          state.seek(state.time + (e.key === "ArrowRight" ? 1e6 : -1e6));
        } else state.step(e.key === "ArrowRight" ? 1 : -1);
      } else if (e.key === "Home" || e.key === "End") {
        e.preventDefault();
        state.setPlaying(false);
        state.seek(e.key === "Home" ? 0 : (r.frameTimes?.at(-1) ?? r.duration));
      } else if (e.key === "Escape") {
        setDraft([]);
        setDrag(null);
        setTool("select");
      } else if (e.key.toLowerCase() === "v") setTool("select");
      else if (e.key.toLowerCase() === "r") {
        state.setPlaying(false);
        setTool("rectangle");
      } else if (e.key.toLowerCase() === "g") setOverlay("gaze");
      else if (e.key.toLowerCase() === "h") setOverlay("heatmap");
    };
    const hidden = () => {
      if (document.hidden) shortcuts.current.setPlaying(false);
    };
    document.addEventListener("keydown", key);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      document.removeEventListener("keydown", key);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [r.id, r.duration, r.frameTimes]);
  const point = (e: React.PointerEvent): Point => {
    const rect = svg.current!.getBoundingClientRect();
    return [
      Math.max(
        0,
        Math.min(r.width, ((e.clientX - rect.left) / rect.width) * r.width),
      ),
      Math.max(
        0,
        Math.min(r.height, ((e.clientY - rect.top) / rect.height) * r.height),
      ),
    ];
  };
  const add = (points: Point[]) => {
    if (tool === "select" || points.length < (tool === "polygon" ? 3 : 2))
      return;
    const id = crypto.randomUUID();
    onAOIs([
      ...r.aois,
      {
        id,
        name: `Area ${r.aois.length + 1}`,
        shape: tool,
        color: PALETTE[r.aois.length % PALETTE.length],
        start: 0,
        end: r.duration,
        keyframes: [{ t: Math.round(time), points }],
        source: "manual",
        accepted: true,
      },
    ]);
    onSelect(id);
    setDraft([]);
    setTool("select");
  };
  const samples = sampleWindow(
    r.samples,
    mapTime(time, r.anchors, true),
    80000,
  ).filter(
    (s) =>
      s.valid &&
      s.x !== null &&
      s.y !== null &&
      !s.blink &&
      (participant === "all" || participant === s.participant),
  );
  const latest = new Map<string, (typeof samples)[number]>();
  samples.forEach((s) => latest.set(s.participant, s));
  const participants = useMemo(
    () => [...new Set(r.samples.map((s) => s.participant))],
    [r.samples],
  );
  const shape = (a: AOI, p: Point[], editable = true) => {
    const props = {
      stroke: a.color,
      strokeWidth: selected === a.id ? 3 : 2,
      fill: `${a.color}18`,
      vectorEffect: "non-scaling-stroke" as const,
      strokeDasharray: a.accepted ? undefined : "7 5",
      onPointerDown: (e: React.PointerEvent) => {
        if (tool === "select" && editable) {
          e.stopPropagation();
          onSelect(a.id);
        }
      },
    };
    if (a.shape === "polygon")
      return (
        <polygon points={p.map((v) => v.join(",")).join(" ")} {...props} />
      );
    const x = Math.min(p[0][0], p[1][0]),
      y = Math.min(p[0][1], p[1][1]),
      w = Math.abs(p[1][0] - p[0][0]),
      h = Math.abs(p[1][1] - p[0][1]);
    return a.shape === "rectangle" ? (
      <rect x={x} y={y} width={w} height={h} rx={3} {...props} />
    ) : (
      <ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} {...props} />
    );
  };
  return (
    <section className="player-card gaze-player">
      <div className="player-top">
        <span>
          <span className="live-dot" /> SCENE MONITOR
        </span>
        <span>
          {r.width} × {r.height} <span className="divider">/</span>{" "}
          {r.frameTimes
            ? `${r.frameTimes.length} indexed frames`
            : "Media clock"}
          <button
            className="monitor-expand"
            aria-label="Expand scene monitor"
            title="Expand scene monitor"
            onClick={() => {
              if (document.fullscreenElement) void document.exitFullscreen();
              else void monitor.current?.requestFullscreen();
            }}
          >
            <Maximize2 size={13} />
          </button>
        </span>
      </div>
      <div ref={monitor} className="camera-layout">
        <div
          className="stage"
          style={{
            aspectRatio: `${r.width}/${r.height}`,
            width: `min(100%, calc(var(--monitor-height, 340px) * ${r.width / r.height}))`,
          }}
        >
          {r.mediaType === "video" ? (
            <video
              key={r.mediaUrl}
              ref={videoRef}
              src={r.mediaUrl}
              preload="metadata"
              playsInline
              muted
              onLoadedMetadata={(e) => {
                if (time > 0) e.currentTarget.currentTime = time / 1e6;
              }}
              onEnded={() => setPlaying(false)}
              onSeeked={(e) =>
                setTime(Math.round(e.currentTarget.currentTime * 1e6))
              }
              onError={() =>
                setMediaError(
                  "This video could not be decoded. Try an H.264 MP4 or VP9 WebM.",
                )
              }
              onTimeUpdate={(e) => {
                if (!videoRef.current?.requestVideoFrameCallback)
                  setTime(Math.round(e.currentTarget.currentTime * 1e6));
              }}
            />
          ) : (
            <img src={r.mediaUrl} alt={r.title} />
          )}
          {mediaError && <div className="media-error">{mediaError}</div>}
          <FixationHeatmap
            width={r.width}
            height={r.height}
            fixations={analysis?.fixations ?? []}
            visible={overlay === "heatmap"}
          />
          <svg
            ref={svg}
            className={`overlay ${tool !== "select" ? "drawing" : ""}`}
            viewBox={`0 0 ${r.width} ${r.height}`}
            aria-label="Gaze overlay and AOI drawing canvas"
            onPointerDown={(e) => {
              setPlaying(false);
              if (tool === "select") {
                onSelect(null);
                return;
              }
              e.currentTarget.setPointerCapture(e.pointerId);
              const p = point(e);
              if (tool === "polygon") setDraft([...draft, p]);
              else setDraft([p, p]);
            }}
            onPointerMove={(e) => {
              if (drag) {
                const points = [...drag.points];
                points[drag.index] = point(e);
                setDrag({ ...drag, points });
              } else if (
                draft.length === 2 &&
                tool !== "polygon" &&
                tool !== "select"
              )
                setDraft([draft[0], point(e)]);
            }}
            onPointerUp={() => {
              if (drag && selected) {
                onAOIs(
                  r.aois.map((a) =>
                    a.id === selected
                      ? addKeyframe(a, Math.round(time), drag.points)
                      : a,
                  ),
                );
                setDrag(null);
              } else if (
                draft.length === 2 &&
                tool !== "polygon" &&
                Math.hypot(
                  draft[0][0] - draft[1][0],
                  draft[0][1] - draft[1][1],
                ) > 8
              )
                add(draft);
            }}
          >
            {r.aois.map((a) => {
              const p =
                a.id === selected && drag ? drag.points : pointsAt(a, time);
              if (!p) return null;
              return (
                <g key={a.id}>
                  {shape(a, p)}
                  <text
                    x={Math.min(...p.map((p) => p[0])) + 7}
                    y={Math.max(22, Math.min(...p.map((p) => p[1])) - 9)}
                    fill={a.color}
                    fontSize={r.width / 65}
                    fontWeight="600"
                    paintOrder="stroke"
                    stroke="#fff"
                    strokeWidth="2"
                  >
                    {a.name}
                  </text>
                  {selected === a.id &&
                    p.map(([x, y], i) => (
                      <circle
                        key={i}
                        cx={x}
                        cy={y}
                        r={r.width / 120}
                        fill="white"
                        stroke={a.color}
                        strokeWidth="2"
                        className="handle"
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          setPlaying(false);
                          svg.current!.setPointerCapture(e.pointerId);
                          setDrag({ index: i, points: p });
                        }}
                      />
                    ))}
                </g>
              );
            })}
            {overlay === "scanpath" &&
              participants.map((p, i) => {
                const fixes =
                  analysis?.fixations.filter(
                    (f) =>
                      f.participant === p &&
                      f.start <= time &&
                      f.end >= time - 5e6,
                  ) ?? [];
                return (
                  <g
                    key={p}
                    stroke={PALETTE[i % PALETTE.length]}
                    fill={PALETTE[i % PALETTE.length]}
                  >
                    <polyline
                      points={fixes.map((f) => `${f.x},${f.y}`).join(" ")}
                      fill="none"
                      strokeWidth="3"
                      opacity=".7"
                    />
                    {fixes.map((f, j) => (
                      <g key={f.start}>
                        <circle
                          cx={f.x}
                          cy={f.y}
                          r={Math.min(35, 10 + (f.end - f.start) / 30000)}
                          fillOpacity=".3"
                        />
                        <text
                          x={f.x}
                          y={f.y + 5}
                          textAnchor="middle"
                          fontSize="16"
                          stroke="none"
                          fill="white"
                        >
                          {j + 1}
                        </text>
                      </g>
                    ))}
                  </g>
                );
              })}
            {overlay === "gaze" &&
              [...latest].map(([p, s]) => {
                const age = time - mapTime(s.t, r.anchors);
                if (age > 75000) return null;
                const color = PALETTE[participants.indexOf(p) % PALETTE.length];
                return (
                  <g key={p}>
                    <circle
                      cx={s.x!}
                      cy={s.y!}
                      r={r.width / 75}
                      stroke={color}
                      strokeWidth="2"
                      fill={`${color}40`}
                    />
                    <circle
                      cx={s.x!}
                      cy={s.y!}
                      r={r.width / 240}
                      fill="white"
                    />
                    <text
                      x={s.x! + 20}
                      y={s.y! - 15}
                      fill="white"
                      fontSize="16"
                      stroke="#183531"
                      strokeWidth=".5"
                    >
                      {p}
                    </text>
                  </g>
                );
              })}
            {draft.length > 0 &&
              (tool === "polygon" ? (
                <polyline
                  points={draft.map((p) => p.join(",")).join(" ")}
                  stroke="#0c9a87"
                  strokeWidth="3"
                  fill="#0c9a8720"
                />
              ) : (
                draft.length === 2 &&
                shape(
                  {
                    id: "draft",
                    shape: tool as AOI["shape"],
                    color: "#0c9a87",
                    accepted: false,
                  } as AOI,
                  draft,
                  false,
                )
              ))}
          </svg>
          <div className="stage-label">
            {r.source.synthetic ? "SYNTHETIC FIXTURE" : "RECORDED GAZE"}{" "}
            <span>•</span> {clockLabel(time)}
          </div>
        </div>
      </div>
      {!!r.videoTracks?.length && (
        <div className="eye-monitor-panel">
          <button
            className="eye-panel-heading"
            aria-expanded={showEyes}
            onClick={() => setShowEyes((v) => !v)}
          >
            <span>
              <ChevronDown
                size={13}
                style={{ transform: showEyes ? undefined : "rotate(-90deg)" }}
              />
              EYE CAMERAS
            </span>
            <small>Original orientation · synchronized</small>
          </button>
          {showEyes && (
            <div className="eye-monitor-content">
              <SynchronizedVideos
                tracks={r.videoTracks}
                time={time}
                playing={playing}
                speed={speed}
              />
              {!!r.eyeSignals?.length && (
                <EyeSignalTimeline
                  signals={r.eyeSignals}
                  anchors={r.anchors}
                  time={time}
                  duration={r.duration}
                  onSeek={seek}
                />
              )}
            </div>
          )}
        </div>
      )}
      <div className="player-tools">
        <div className="tool-group">
          {(
            [
              ["select", MousePointer2, "Select AOI"],
              ["rectangle", Square, "Draw rectangle"],
              ["ellipse", Circle, "Draw ellipse"],
              ["polygon", Pentagon, "Draw polygon"],
            ] as const
          ).map(([value, Icon, title]) => (
            <button
              key={value}
              title={title}
              aria-label={title}
              className={tool === value ? "active" : ""}
              onClick={() => {
                setTool(value);
                setDraft([]);
                setPlaying(false);
              }}
            >
              <Icon size={16} />
            </button>
          ))}
          {tool === "polygon" && draft.length >= 3 && (
            <button onClick={() => add(draft)} aria-label="Finish polygon">
              <Check size={16} />
            </button>
          )}
        </div>
        <div className="tool-group">
          {(
            [
              ["gaze", Crosshair, "Gaze"],
              ["scanpath", Route, "Scanpath"],
              ["heatmap", Flame, "Heatmap"],
            ] as const
          ).map(([value, Icon, title]) => (
            <button
              key={value}
              className={overlay === value ? "active" : ""}
              aria-label={title}
              onClick={() => setOverlay(value)}
            >
              <Icon size={15} />
              <span>{title}</span>
            </button>
          ))}
        </div>
      </div>
      <PlaybackControls
        duration={r.duration}
        time={time}
        playing={playing}
        speed={speed}
        onPlay={() => {
          if (time >= r.duration - 1000) seek(0);
          setPlaying(!playing);
        }}
        onSeek={seek}
        onStep={step}
        onSpeed={setSpeed}
      />
      <MediaTimeline
        recording={r}
        analysis={analysis}
        participants={participants}
        participant={participant}
        time={time}
        onSeek={seek}
        onPause={() => setPlaying(false)}
      />
      <div className="player-foot">
        <span>
          {tool === "select"
            ? "Select an area. Drag a handle to add a keyframe at the playhead."
            : tool === "polygon"
              ? "Click vertices, then finish with the checkmark."
              : "Drag on the stimulus to draw an area of interest."}
        </span>
        <span>
          {overlay === "heatmap"
            ? "Fixation duration weighted"
            : "No gaze interpolation"}
        </span>
      </div>
    </section>
  );
}
