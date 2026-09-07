import { Play, Pause, SkipBack, SkipForward } from "lucide-react";
import { clockLabel } from "./format";
export interface PlaybackControlsProps {
  duration: number;
  time: number;
  playing: boolean;
  speed: number;
  onPlay: () => void;
  onSeek: (t: number) => void;
  onStep: (direction: number) => void;
  onSpeed: (speed: number) => void;
}
export function PlaybackControls({
  duration,
  time,
  playing,
  speed,
  onPlay,
  onSeek,
  onStep,
  onSpeed,
}: PlaybackControlsProps) {
  return (
    <div className="transport">
      <button
        aria-label={playing ? "Pause" : "Play"}
        className="play-button"
        onClick={onPlay}
      >
        {playing ? <Pause size={19} /> : <Play size={19} />}
      </button>
      <button
        aria-label="Previous frame or 100 milliseconds"
        onClick={() => onStep(-1)}
      >
        <SkipBack size={15} />
      </button>
      <button
        aria-label="Next frame or 100 milliseconds"
        onClick={() => onStep(1)}
      >
        <SkipForward size={15} />
      </button>
      <span className="time-display">
        {clockLabel(time)} <small>/ {clockLabel(duration)}</small>
      </span>
      <input
        aria-label="Playback position"
        type="range"
        min="0"
        max={duration}
        step="1000"
        value={time}
        onChange={(e) => onSeek(Number(e.target.value))}
      />
      <select
        aria-label="Playback speed"
        value={speed}
        onChange={(e) => onSpeed(Number(e.target.value))}
      >
        {[0.25, 0.5, 1, 1.5, 2].map((s) => (
          <option key={s} value={s}>
            {s}×
          </option>
        ))}
      </select>
    </div>
  );
}
