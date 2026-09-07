import type {
  Analysis,
  EyeSummary,
  Gaze,
  Recording,
  Settings,
} from "@pajama-studio/gaze-core";
export interface Execution {
  engine: "rust-wasm";
  workers: number;
  partitions: number;
  elapsedMs: number;
}
export interface AnalysisRun {
  result: Analysis;
  execution: Execution;
}
interface Job {
  id: number;
  payload: object;
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  detach: () => void;
}
interface Slot {
  worker: Worker;
  job?: Job;
}
/** Independent participant partitions preserve complete event boundaries. No shared-memory or cross-origin isolation is required. */
export class AnalysisPool {
  readonly size: number;
  private slots: Slot[] = [];
  private queue: Job[] = [];
  private sequence = 0;
  private closed = false;
  private groupsCache = new WeakMap<Gaze[], Map<string, Gaze[]>>();
  constructor(
    size = Math.min(
      4,
      Math.max(1, (globalThis.navigator?.hardwareConcurrency ?? 2) - 1),
    ),
  ) {
    this.size = Math.max(1, Math.min(8, Math.floor(size)));
    this.slots = Array.from({ length: this.size }, () => this.slot());
  }
  private slot(): Slot {
    const slot: Slot = {
      worker: new Worker(new URL("./kernel.worker.ts", import.meta.url), {
        type: "module",
      }),
    };
    slot.worker.onmessage = ({ data }) => {
      const job = slot.job;
      if (!job || job.id !== data.id) return;
      slot.job = undefined;
      job.detach();
      if (data.error) job.reject(new Error(data.error));
      else job.resolve(data.value);
      this.dispatch();
    };
    slot.worker.onerror = (event) => {
      const job = slot.job;
      slot.job = undefined;
      if (job) {
        job.detach();
        job.reject(new Error(event.message || "WASM worker failed"));
      }
      const index = this.slots.indexOf(slot);
      slot.worker.terminate();
      if (index >= 0 && !this.closed) this.slots[index] = this.slot();
      this.dispatch();
    };
    return slot;
  }
  private dispatch() {
    if (this.closed) return;
    for (const slot of this.slots)
      if (!slot.job && this.queue.length) {
        slot.job = this.queue.shift()!;
        slot.worker.postMessage({ ...slot.job.payload, id: slot.job.id });
      }
  }
  private job(payload: object, signal?: AbortSignal) {
    return new Promise<unknown>((resolve, reject) => {
      if (this.closed || signal?.aborted) {
        reject(new DOMException("Analysis cancelled", "AbortError"));
        return;
      }
      const job: Job = {
        id: ++this.sequence,
        payload,
        resolve,
        reject,
        detach: () => signal?.removeEventListener("abort", abort),
      };
      const abort = () => {
        this.queue = this.queue.filter((j) => j !== job);
        const index = this.slots.findIndex((s) => s.job === job);
        if (index >= 0) {
          this.slots[index].worker.terminate();
          this.slots[index] = this.slot();
        }
        job.detach();
        reject(new DOMException("Analysis cancelled", "AbortError"));
        this.dispatch();
      };
      signal?.addEventListener("abort", abort, { once: true });
      this.queue.push(job);
      this.dispatch();
    });
  }
  async analyze(
    recording: Recording,
    settings: Settings,
    signal?: AbortSignal,
  ): Promise<AnalysisRun> {
    const started = performance.now();
    const normalized = {
      ...settings,
      end: Math.min(recording.duration, settings.end),
    };
    let groups = this.groupsCache.get(recording.samples);
    if (!groups) {
      groups = new Map<string, Gaze[]>();
      for (const sample of recording.samples) {
        const group = groups.get(sample.participant) ?? [];
        group.push(sample);
        groups.set(sample.participant, group);
      }
      this.groupsCache.set(recording.samples, groups);
    }
    const selected = [...groups]
      .filter(
        ([p]) => settings.participant === "all" || p === settings.participant,
      )
      .map(([, samples]) => samples);
    const partitions = selected.length ? selected : [[]];
    const parts = await Promise.all(
      partitions.map((samples) =>
        this.job(
          {
            op: "analyze",
            recording: {
              duration: recording.duration,
              anchors: recording.anchors,
              aois: recording.aois,
              samples,
            },
            settings: normalized,
          },
          signal,
        ),
      ),
    );
    const result = (await this.job({ op: "merge", parts }, signal)) as Analysis;
    if (recording.eyeSignals?.length)
      result.eyeSignals = (await this.job(
        {
          op: "signals",
          input: {
            signals: recording.eyeSignals,
            anchors: recording.anchors,
            settings: normalized,
          },
        },
        signal,
      )) as EyeSummary[];
    return {
      result,
      execution: {
        engine: "rust-wasm",
        workers: Math.min(partitions.length, this.size),
        partitions: partitions.length,
        elapsedMs: performance.now() - started,
      },
    };
  }
  /** Batch recordings share the same bounded worker pool. */
  analyzeMany(
    recordings: Recording[],
    settings: Settings,
    signal?: AbortSignal,
  ) {
    return Promise.all(
      recordings.map((r) => this.analyze(r, settings, signal)),
    );
  }
  dispose() {
    this.closed = true;
    const error = new DOMException("Analysis pool disposed", "AbortError");
    for (const job of [
      ...this.queue,
      ...this.slots.flatMap((s) => (s.job ? [s.job] : [])),
    ]) {
      job.detach();
      job.reject(error);
    }
    this.queue = [];
    for (const slot of this.slots) slot.worker.terminate();
  }
}
