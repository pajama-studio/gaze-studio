import { RotateCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { frameAt, mapTime } from "@pajama-studio/gaze-core/time";
import type { VideoTrack } from "@pajama-studio/gaze-core";
import { clockLabel } from "./format";
export interface SynchronizedVideoProps {
  track: VideoTrack;
  time: number;
  playing: boolean;
  speed?: number;
  onRotationChange?: (
    rotation: NonNullable<VideoTrack["viewRotation"]>,
  ) => void;
}
/** The caller's stimulus clock is authoritative. Recorded anchors account for offset and drift; videos never extend beyond their declared capture interval. */
export function SynchronizedVideo({
  track,
  time,
  playing,
  speed = 1,
  onRotationChange,
}: SynchronizedVideoProps) {
  const video = useRef<HTMLVideoElement>(null),
    latest = useRef({ time, playing, speed });
  latest.current = { time, playing, speed };
  const [error, setError] = useState(""),
    [rotation, setRotation] = useState(track.viewRotation ?? 0),
    [original, setOriginal] = useState(false);
  const available = time >= track.start && time < track.end;
  const target = Math.min(
    track.duration - 1,
    Math.max(0, mapTime(time, track.anchors)),
  );
  const frame = track.frameTimes?.length
    ? frameAt(track.frameTimes, target)
    : null;
  const sync = () => {
    const v = video.current;
    if (!v || !v.readyState) return;
    const { time, playing, speed } = latest.current;
    if (time < track.start || time >= track.end) {
      v.pause();
      return;
    }
    const desired =
      Math.min(track.duration - 1, Math.max(0, mapTime(time, track.anchors))) /
      1e6;
    const drift = Math.abs(v.currentTime - desired);
    if ((!playing && drift > 0.001) || (playing && drift > 0.04))
      v.currentTime = desired;
    // Local clock slope over 100 ms avoids reacting to timestamp quantization on every frame.
    const rate =
      (speed *
        (mapTime(time + 50000, track.anchors) -
          mapTime(time - 50000, track.anchors))) /
      100000;
    const nextRate = Math.min(4, Math.max(0.25, rate));
    if (Math.abs(v.playbackRate - nextRate) > 0.02) v.playbackRate = nextRate;
    if (playing && v.paused) v.play().catch((e) => setError(e.message));
    if (!playing) v.pause();
  };
  useEffect(sync, [time, playing, speed, track]);
  useEffect(() => {
    setError("");
    setRotation(track.viewRotation ?? 0);
    setOriginal(false);
    const v = video.current;
    return () => v?.pause();
  }, [track.url]);
  useEffect(() => setRotation(track.viewRotation ?? 0), [track.viewRotation]);
  return (
    <figure
      className="eye-video"
      data-track-id={track.id}
      data-role={track.role}
      data-target-us={Math.round(target)}
    >
      <figcaption>
        <strong>
          {track.role === "left-eye"
            ? "Left eye"
            : track.role === "right-eye"
              ? "Right eye"
              : "Context"}
        </strong>
        <div className="eye-view-actions">
          <button
            aria-label={`${original ? "Show corrected" : "Show original"} ${track.role} orientation`}
            aria-pressed={original}
            title="Toggle the source camera orientation"
            onClick={() => setOriginal((v) => !v)}
          >
            {original ? "Raw" : `${rotation}°`}
          </button>
          <button
            aria-label={`Rotate ${track.role} view`}
            title="Rotate view 90° (original file unchanged)"
            onClick={() => {
              const next = ((rotation + 90) % 360) as NonNullable<
                VideoTrack["viewRotation"]
              >;
              setRotation(next);
              setOriginal(false);
              onRotationChange?.(next);
            }}
          >
            <RotateCw size={12} />
          </button>
        </div>
      </figcaption>
      <div
        className="eye-video-frame"
        style={{ aspectRatio: `${track.width}/${track.height}` }}
      >
        <video
          ref={video}
          src={track.url}
          muted
          playsInline
          preload="metadata"
          onLoadedData={sync}
          onError={() => setError("This video could not be loaded.")}
          style={{
            visibility: available ? "visible" : "hidden",
            transform: `rotate(${original ? 0 : rotation}deg) scale(${!original && rotation % 180 ? Math.min(track.width / track.height, track.height / track.width) : 1})`,
          }}
        />
        {!available && (
          <span className="eye-unavailable">No frame at this time</span>
        )}
        {error && <span className="eye-unavailable">{error}</span>}
      </div>
      <small>
        {available
          ? `${clockLabel(target)}${frame === null ? "" : ` · Frame ${frame + 1}`}`
          : "Outside recorded interval"}
        <span>
          {track.width} × {track.height}
        </span>
      </small>
    </figure>
  );
}
export function SynchronizedVideos({
  tracks,
  time,
  playing,
  speed = 1,
  onRotationChange,
}: {
  tracks: VideoTrack[];
  time: number;
  playing: boolean;
  speed?: number;
  onRotationChange?: (
    id: string,
    rotation: NonNullable<VideoTrack["viewRotation"]>,
  ) => void;
}) {
  const ordered = useMemo(
    () => [...tracks].sort((a, b) => a.role.localeCompare(b.role)),
    [tracks],
  );
  return (
    <div className="eye-videos" aria-label="Synchronized raw eye videos">
      {ordered.map((track) => (
        <SynchronizedVideo
          key={track.id + track.url}
          track={track}
          time={time}
          playing={playing}
          speed={speed}
          onRotationChange={
            onRotationChange
              ? (angle) => onRotationChange(track.id, angle)
              : undefined
          }
        />
      ))}
    </div>
  );
}
