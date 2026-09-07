import { expect, it } from "vitest";
import { PlaybackClock } from "../packages/core/src";
it("notifies only replay clock subscribers and rejects invalid time without losing the last frame", () => {
  const clock = new PlaybackClock();
  let n = 0;
  const off = clock.subscribe(() => n++);
  clock.setTime(1234.2);
  clock.setTime(1234.4);
  clock.setTime(NaN);
  expect(n).toBe(1);
  expect(clock.getTime()).toBe(1234);
  off();
  clock.setTime(2000);
  expect(n).toBe(1);
  expect(clock.getTime()).toBe(2000);
});
