import { useSyncExternalStore } from "react";
import type { PlaybackClock } from "@pajama-studio/gaze-core";
import { GazeReplay, type GazeReplayProps } from "./GazeReplay";
export function ClockedReplay({
  clock,
  ...props
}: Omit<GazeReplayProps, "time" | "setTime"> & { clock: PlaybackClock }) {
  const time = useSyncExternalStore(clock.subscribe, clock.getTime, () => 0);
  return <GazeReplay {...props} time={time} setTime={clock.setTime} />;
}
