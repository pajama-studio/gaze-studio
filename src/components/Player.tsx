import { useEffect, useRef, useState } from "react";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  MousePointer2,
  Square,
  Circle,
  Pentagon,
  Check,
  Crosshair,
  Flame,
  Route,
} from "lucide-react";
import type { AOI, Analysis, Point, Recording } from "../core/types";
import { PALETTE } from "../core/types";
import { addKeyframe, pointsAt } from "../core/aoi";
import { frameAt, mapTime, sampleWindow } from "../core/time";
export const clockLabel = (t: number) =>
  `${Math.floor(t / 60e6)
    .toString()
    .padStart(2, "0")}:${((t / 1e6) % 60).toFixed(2).padStart(5, "0")}`;
interface Props {
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
export function Player({
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
}: Props) {
  const svg = useRef<SVGSVGElement>(null),
    heat = useRef<HTMLCanvasElement>(null);
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
  useEffect(() => {
    if (overlay !== "heatmap" || !heat.current || !analysis) return;
    const canvas = heat.current,
      ctx = canvas.getContext("2d")!;
    canvas.width = r.width;
    canvas.height = r.height;
    ctx.clearRect(0, 0, r.width, r.height);
    ctx.globalCompositeOperation = "screen";
    for (const f of analysis.fixations) {
      const radius = Math.max(24, r.width * 0.045),
        g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, radius);
      const weight = Math.min(0.6, (f.end - f.start) / 2e6);
      g.addColorStop(0, `rgba(255,55,55,${weight})`);
      g.addColorStop(0.45, `rgba(255,180,30,${weight * 0.6})`);
      g.addColorStop(1, "rgba(20,150,220,0)");
      ctx.fillStyle = g;
      ctx.fillRect(f.x - radius, f.y - radius, radius * 2, radius * 2);
    }
  }, [overlay, analysis, r.width, r.height]);
  const seek = (t: number) => {
    t = Math.min(r.duration, Math.max(0, t));
    setTime(t);
    if (videoRef.current) videoRef.current.currentTime = t / 1e6;
  };
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
    600000,
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
  const participants = [...new Set(r.samples.map((s) => s.participant))];
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
    <section className="player-card">
      <div className="player-top">
        <span>
          <span className="live-dot" /> STIMULUS VIEW
        </span>
        <span>
          {r.width} × {r.height} <span className="divider">/</span>{" "}
          {r.frameTimes
            ? `${r.frameTimes.length} indexed frames`
            : "Media clock"}
        </span>
      </div>
      <div className="stage" style={{ aspectRatio: `${r.width}/${r.height}` }}>
        {r.mediaType === "video" ? (
          <video
            key={r.mediaUrl}
            ref={videoRef}
            src={r.mediaUrl}
            preload="auto"
            playsInline
            muted
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
        <canvas
          ref={heat}
          className="heat-layer"
          style={{ display: overlay === "heatmap" ? "block" : "none" }}
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
              Math.hypot(draft[0][0] - draft[1][0], draft[0][1] - draft[1][1]) >
                8
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
                  <circle cx={s.x!} cy={s.y!} r={r.width / 240} fill="white" />
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
              onClick={() => setOverlay(value)}
            >
              <Icon size={15} />
              <span>{title}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="transport">
        <button
          aria-label={playing ? "Pause" : "Play"}
          className="play-button"
          onClick={() => {
            if (time >= r.duration - 1000) seek(0);
            setPlaying(!playing);
          }}
        >
          {playing ? <Pause size={19} /> : <Play size={19} />}
        </button>
        <button
          aria-label="Previous frame or 100 milliseconds"
          onClick={() => step(-1)}
        >
          <SkipBack size={15} />
        </button>
        <button
          aria-label="Next frame or 100 milliseconds"
          onClick={() => step(1)}
        >
          <SkipForward size={15} />
        </button>
        <span className="time-display">
          {clockLabel(time)} <small>/ {clockLabel(r.duration)}</small>
        </span>
        <input
          aria-label="Playback position"
          type="range"
          min="0"
          max={r.duration}
          step="1000"
          value={time}
          onChange={(e) => seek(Number(e.target.value))}
        />
        <select
          aria-label="Playback speed"
          value={speed}
          onChange={(e) => setSpeed(Number(e.target.value))}
        >
          {[0.25, 0.5, 1, 1.5, 2].map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>
      </div>
      <div className="scarf">
        {participants
          .filter((p) => participant === "all" || p === participant)
          .map((p, i) => (
            <div className="scarf-row" key={p}>
              <span style={{ color: PALETTE[i % PALETTE.length] }}>{p}</span>
              <div
                className="scarf-track"
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  seek(((e.clientX - rect.left) / rect.width) * r.duration);
                }}
              >
                {analysis?.sequences
                  .filter((s) => s.participant === p && s.aoi)
                  .map((s, j) => (
                    <i
                      key={j}
                      style={{
                        left: `${(s.start / r.duration) * 100}%`,
                        width: `${((s.end - s.start) / r.duration) * 100}%`,
                        background: r.aois.find((a) => a.id === s.aoi)?.color,
                      }}
                      title={`${r.aois.find((a) => a.id === s.aoi)?.name}: ${clockLabel(s.start)}–${clockLabel(s.end)}`}
                    />
                  ))}
                <b
                  className="playhead"
                  style={{ left: `${(time / r.duration) * 100}%` }}
                />
              </div>
            </div>
          ))}
      </div>
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
