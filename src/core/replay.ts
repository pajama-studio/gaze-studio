import { gunzipSync, strFromU8 } from "fflate";
import type { Recording, Settings } from "./types";
import { DEFAULT_SETTINGS } from "./types";
import { gazeMiningLayers } from "./dom";

export function hasRecordedDOM(r: Recording) {
  return (
    r.source.format?.startsWith("GazeMining") === true &&
    !!(r.source.rawUrl || r.rawFiles?.length)
  );
}

export function replaySettings(
  r: Recording,
  settings = r.analysisSettings ?? DEFAULT_SETTINGS,
): Settings {
  const start = Math.round(
    Math.max(0, Math.min(r.duration - 1, settings.start)),
  );
  const end = Math.round(
    Math.max(start + 1, Math.min(settings.end, r.duration)),
  );
  return { ...settings, start, end };
}

export async function recordedAOIs(r: Recording, signal?: AbortSignal) {
  if (!hasRecordedDOM(r))
    throw new Error(
      "This recording has no supported recorded page regions. Use AI objects or draw areas.",
    );
  const decode = async (blob: Blob) => {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return JSON.parse(
      strFromU8(
        bytes[0] === 31 && bytes[1] === 139 ? gunzipSync(bytes) : bytes,
      ),
    );
  };
  // A portable or cloud recording must use its preserved input first.
  for (const file of r.rawFiles ?? []) {
    if (!/\.json(?:\.gz)?$/i.test(file.name)) continue;
    signal?.throwIfAborted();
    const data = await decode(file.blob);
    if (Array.isArray(data.Layers)) return gazeMiningLayers(data, r);
  }
  if (!r.source.rawUrl)
    throw new Error("Recorded DOM source unavailable in this package.");
  const response = await fetch(r.source.rawUrl, { signal });
  if (!response.ok) throw new Error("Recorded DOM source unavailable.");
  return gazeMiningLayers(await decode(await response.blob()), r);
}
