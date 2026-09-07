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
}
/** The caller's stimulus clock is authoritative. Recorded anchors account for offset and drift; videos never extend beyond their declared capture interval. */
export function SynchronizedVideo({
  track,
  time,
  playing,
  speed = 1,
}: SynchronizedVideoProps) {
  const video = useRef<HTMLVideoElement>(null),
    latest = useRef({ time, playing, speed });
  latest.current = { time, playing, speed };
  const [error, setError] = useState(""),
    [rotation, setRotation] = useState(0);
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
    setRotation(0);
    const v = video.current;
    return () => v?.pause();
  }, [track.url]);
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
        <button
          aria-label={`Rotate ${track.role} view`}
          title="Rotate view 90° (original file unchanged)"
          onClick={() => setRotation((r) => (r + 90) % 360)}
        >
          <RotateCw size={12} />
        </button>
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
            transform: `rotate(${rotation}deg)`,
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
}: {
  tracks: VideoTrack[];
  time: number;
  playing: boolean;
  speed?: number;
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
        />
      ))}
    </div>
  );
}
