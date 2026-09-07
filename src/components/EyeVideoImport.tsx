import { useState } from "react";
import type { Recording, VideoTrack } from "../core/types";
export function EyeVideoImport({
  recording,
  onChange,
}: {
  recording: Recording;
  onChange: (r: Recording) => void;
}) {
  const [role, setRole] = useState<VideoTrack["role"]>("left-eye"),
    [offset, setOffset] = useState(0),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function attach(file: File) {
    setBusy(true);
    setError("");
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(Error("Video metadata timed out")),
          15000,
        );
        video.onloadedmetadata = () => {
          clearTimeout(timer);
          resolve();
        };
        video.onerror = () => {
          clearTimeout(timer);
          reject(Error("Use an H.264 MP4 or WebM video"));
        };
        video.src = url;
      });
      if (!Number.isFinite(video.duration) || video.duration <= 0)
        throw Error("Video duration unavailable");
      const duration = Math.round(video.duration * 1e6),
        start = Math.max(0, Math.round(offset * 1e6)),
        end = Math.min(recording.duration, Math.round(offset * 1e6) + duration);
      if (end <= start)
        throw Error("This offset places the video outside the recording");
      const track: VideoTrack = {
        id: crypto.randomUUID(),
        role,
        name: file.name,
        url,
        blob: file,
        width: video.videoWidth,
        height: video.videoHeight,
        duration,
        start,
        end,
        anchors: [{ gaze: Math.round(offset * 1e6), media: 0 }],
        source:
          "User-attached video with manually specified clock offset. Calibrate before precision analysis.",
      };
      onChange({
        ...recording,
        videoTracks: [
          ...(recording.videoTracks ?? []).filter((t) => t.role !== role),
          track,
        ],
      });
    } catch (e) {
      URL.revokeObjectURL(url);
      setError((e as Error).message);
    } finally {
      video.removeAttribute("src");
      video.load();
      setBusy(false);
    }
  }
  return (
    <div className="eye-import">
      <h4>Raw eye videos</h4>
      <p className="hint">
        Attach the camera recording for each eye. Set when video time zero
        occurs on the scene timeline. Portable packages can supply full drift
        anchors and frame timestamps.
      </p>
      <label>
        Camera
        <select
          aria-label="Eye camera"
          value={role}
          onChange={(e) => setRole(e.target.value as VideoTrack["role"])}
        >
          <option value="left-eye">Left eye</option>
          <option value="right-eye">Right eye</option>
          <option value="context">Context camera</option>
        </select>
      </label>
      <label>
        Video zero on scene timeline (s)
        <input
          type="number"
          step="0.001"
          aria-label="Eye video offset seconds"
          value={offset}
          onChange={(e) => setOffset(Number(e.target.value))}
        />
      </label>
      <label className="file-button">
        {busy ? "Reading video…" : "Attach eye video"}
        <input
          type="file"
          accept="video/mp4,video/webm"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void attach(file);
            e.target.value = "";
          }}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      {recording.videoTracks?.map((t) => (
        <div className="track-config" key={t.id}>
          <strong>
            {t.role}: {t.name}
          </strong>
          <label>
            Clock anchors (JSON)
            <textarea
              aria-label={`${t.role} clock anchors`}
              defaultValue={JSON.stringify(t.anchors)}
              key={JSON.stringify(t.anchors)}
              onBlur={(e) => {
                try {
                  onChange({
                    ...recording,
                    videoTracks: recording.videoTracks!.map((v) =>
                      v.id === t.id
                        ? { ...v, anchors: JSON.parse(e.target.value) }
                        : v,
                    ),
                  });
                  setError("");
                } catch (err) {
                  setError(String(err));
                }
              }}
            />
          </label>
          <button
            onClick={() =>
              onChange({
                ...recording,
                videoTracks: recording.videoTracks!.filter(
                  (v) => v.id !== t.id,
                ),
              })
            }
          >
            Remove {t.role} video
          </button>
        </div>
      ))}
    </div>
  );
}
