# Modular replay and analysis

This is new MIT-licensed implementation code. Cogix informed the workflow and import interface; its application code is not a dependency.

| Module | Responsibilities | Does not depend on |
|---|---|---|
| `packages/core` / `@pajama-studio/gaze-core` | Typed recordings, eye-video tracks, AOIs, clock mapping, frame lookup and geometry | React, storage, Cloudflare |
| `crates/gaze-core` | Rust I-VT/I-DT, quality intervals, fixation attribution, AOI dwell/visits/TTFF/transitions and partition merging | DOM, React, Cloudflare |
| `packages/analysis` / `@pajama-studio/gaze-analysis` | Compiled WASM, bounded Web Worker pool, cancellation and batch execution | React, Studio UI |
| `packages/react` / `@pajama-studio/gaze-react` | GazeReplay, PlaybackControls, AOITimeline, FixationHeatmap, SynchronizedVideo(s), EyeSignalTimeline, useGazeAnalysis, ClockedReplay, MediaTimeline, SignalTimeline | Studio application, D1, R2 |
| `src/core/io.ts`, `storage.ts` | Format adapters, portable ZIP checksums, IndexedDB and private cloud revisions | Detector implementations |
| `worker/detectors.ts` | Backend object detection provider contract and Workers AI DETR implementation | React and playback |
| `worker/datasets.ts` | Read-only curated dataset catalog and allowlisted R2 assets | Analysis engine |

## Reuse

The workspace packages export TypeScript source for bundlers such as Vite. They have not been published to npm. Build the WASM artifact before consuming the analysis package. A working independent application is in `embed/`: [live component example](https://gaze.pajama.studio/embed/?sample=binocular).

```tsx
import { GazeReplay, useGazeAnalysis } from '@pajama-studio/gaze-react';
import '@pajama-studio/gaze-react/style.css';

const { result, execution, error } = useGazeAnalysis(recording, settings);
<GazeReplay
  recording={recording} analysis={result}
  time={time} setTime={setTime} playing={playing} setPlaying={setPlaying}
  participant="all" selected={selected} onSelect={setSelected}
  onAOIs={aois => setRecording({ ...recording, aois })}
  videoRef={videoRef}
/>;
```

Each visualization also exports independently. `SynchronizedVideos` takes tracks, master time, playing and speed; `AOITimeline` takes sequences, AOIs, time and an `onSeek` callback. These components have no opinion about authentication, where data lives, or which gaze estimator produced it. The combined replay includes optional AOI editing; use individual controls for a read-only application.

## Rust and parallelism

`wasm-pack` compiles the Rust kernel to a 202 kB uncompressed WASM module in this revision. Each Web Worker initializes its own WASM instance. The default pool is bounded by hardware concurrency, up to four workers; callers can explicitly choose 1–8.

A recording is partitioned by complete participant streams. Different participants run concurrently, and a Rust reduction merges interval distributions, AOI metrics and transitions. Single-participant data uses **one computation worker**; it is not advertised as parallel computation within one stream. `AnalysisPool.analyzeMany` shares the same pool across recordings. No SharedArrayBuffer, COOP/COEP or Rayon is required. Cancellation removes queued jobs and replaces busy workers; stale runs cannot overwrite newer results.

This partition strategy preserves fixation boundaries. Arbitrarily slicing one participant into equal temporal chunks would require overlap and explicit event reconciliation; that is not implemented. Very large trials still need chunked storage and a streaming kernel. JSON transfer also incurs serialization cost. No speedup claim is made without a matched benchmark.

The old TypeScript analysis implementation is retained as a test oracle. Differential tests execute the actual compiled WASM against real GazeMining and a three-participant fixture for both methods, both AOI scopes, participant filters, invalid samples, irregular intervals and drift. Native Rust tests additionally check invalid input and clock mapping.

## Backend AOIs

The deployed provider is **Cloudflare Workers AI `@cf/facebook/detr-resnet-50`**. Scene frames go to the backend; eye-camera images are not needed for object AOIs. Sampled detections are associated by label and box overlap, with histogram cut detection preventing tracks from crossing scene cuts. The user reviews candidates before analysis.

SAM is **not deployed** in this release. The backend detector interface makes replacement possible. A future segmentation provider must return masks/polygons with image dimensions, frame timestamp, model/weights version and confidence, and persist those outputs before polygon simplification. MobileSAM on a CPU Cloudflare Container is one potential extension; its latency, model license, runtime resource limits and actual inference must be tested before exposing it as a working feature. DETR boxes are not relabeled as SAM masks.

## Editor performance

`PlaybackClock` is an external store. `ClockedReplay` subscribes to frame-time updates; the Studio shell, inspector and catalog do not subscribe. Participant indexes and static AOI timeline segments are memoized. Frame lookups use binary search; video streams play natively instead of extracting all images into React. Eye videos stop when collapsed, video metadata is loaded on demand, and redundant playback-rate writes are avoided.

The multi-track timeline coalesces pointer moves with requestAnimationFrame and flushes the final position on release. Keyboard shortcuts support Space, left/right frame stepping, Shift left/right one second, Home/End, R/V drawing selection, G/H overlays, Escape to cancel, and Ctrl/Command Z / Shift Z for AOI undo/redo. Editable fields keep native keyboard handling. Camera rotation changes presentation only.

Import and benchmark views load as separate chunks. AOI name edits commit on blur/Enter instead of resaving raw recordings and cancelling analysis on every keystroke. The worker pool caches participant partitions for unchanged sample arrays.

`SignalTimeline` is an independent five-track React control. Numeric trace geometry is memoized and decimated with extrema and gap preservation; playback only updates cursors and current sample readouts. Saccade candidates are derived in Rust per participant and merged by the existing worker pool. Synthetic recordings and their image assets live exclusively in `tests/fixtures/`.
