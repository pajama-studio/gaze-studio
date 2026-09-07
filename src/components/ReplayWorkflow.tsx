import { Check, Play, Sparkles, Activity, X } from "lucide-react";
import type { Recording } from "../core/types";
import { isAutomaticAOI } from "../core/aoi";
import { hasRecordedDOM } from "../core/replay";
export function ReplayWorkflow({
  recording,
  busy,
  annotating,
  onPlay,
  onAnnotate,
  onAnalyze,
  onAccept,
  onReview,
  onCancel,
}: {
  recording: Recording;
  busy: boolean;
  annotating: boolean;
  onPlay: () => void;
  onAnnotate: () => void;
  onAnalyze: () => void;
  onAccept: () => void;
  onReview: () => void;
  onCancel: () => void;
}) {
  const automatic = recording.aois.filter(isAutomaticAOI),
    pending = automatic.filter((a) => !a.accepted).length,
    accepted = automatic.length - pending;
  return (
    <section
      className="replay-workflow editor-workflow"
      aria-label="Replay and automatic AOI workflow"
    >
      <div className="workflow-context">
        <span className="status-dot" />
        <strong>Sequence</strong>
        <span>{(recording.duration / 1e6).toFixed(0)}s</span>
        <span>{recording.samples.length.toLocaleString()} samples</span>
      </div>
      <div className="workflow-actions">
        <button onClick={onPlay} disabled={busy} title="Start replay · Space">
          <Play size={13} />
          Start replay
        </button>
        <button
          onClick={onAnnotate}
          disabled={busy}
          title={
            hasRecordedDOM(recording)
              ? "Recover regions from the recorded DOM"
              : "Detect objects in the next 10 seconds"
          }
        >
          <Sparkles size={14} />
          {busy ? "Working…" : "Auto annotate"}
        </button>
        {pending > 0 && (
          <button
            className="candidate-count"
            onClick={onReview}
            title="Review first candidate"
            aria-label="Review first candidate"
          >
            {pending} candidates to review
          </button>
        )}
        <button
          className="primary"
          disabled={busy || (!pending && !accepted)}
          onClick={pending ? onAccept : onAnalyze}
        >
          {pending ? <Check size={14} /> : <Activity size={14} />}{" "}
          {pending ? "Accept & analyze" : "Analyze automatic areas"}
        </button>
        {annotating && (
          <button onClick={onCancel} aria-label="Cancel annotation">
            <X size={14} />
          </button>
        )}
      </div>
    </section>
  );
}
