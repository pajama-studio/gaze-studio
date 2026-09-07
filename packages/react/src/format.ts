export const clockLabel = (t: number) =>
  `${Math.floor(t / 60e6)
    .toString()
    .padStart(2, "0")}:${((t / 1e6) % 60).toFixed(2).padStart(5, "0")}`;
