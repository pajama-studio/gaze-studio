/** Frame-rate updates only notify replay subscribers; the surrounding application does not re-render. */
export class PlaybackClock {
  private time = 0;
  private listeners = new Set<() => void>();
  getTime = () => this.time;
  setTime = (time: number) => {
    if (!Number.isFinite(time)) return;
    const t = Math.round(time);
    if (t === this.time) return;
    this.time = t;
    for (const listener of this.listeners) listener();
  };
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
}
