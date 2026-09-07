# Editor and binocular verification

The v0.2 editor adds a real binocular replay, reusable controls, Rust/WASM analysis and an owned Cloudflare dataset library. Verification is separated by what it establishes.

The initial editor source is `878391c6b1dd3b8e7b829fba68a8cdc3897d610b`; [its CI run passed](https://github.com/pajama-studio/gaze-studio/actions/runs/34071511158). Published reports retain their actual test endpoint and timestamp.

- **69 TypeScript/WASM tests**: existing methods and formats plus saved AOI scope, actual compiled Rust differential comparisons, camera-stream package round trips and external playback-clock behavior.
- **3 native Rust tests**: clock drift, invalid analysis input and confidence-filtered pupil statistics with mixed-unit rejection.
- **11 general browser flows**: real GazeMining playback, drawing, keyframes/undo, exports, portable raw sources, cloud revisions and mobile import.
- **7 replay workflow flows**: original DOM proposals, review/accept/analyze, seek from analysis, package recovery, dataset launch, uploaded videos using mocked detection responses, mobile workflow.
- **7 binocular flows**: actual scene/left/right decoding from our assets, clocked seek and speeds, pupil trace seeking, offline package media, catalog checksums/private-asset denial, standalone package integration, mobile bounds.
- **7 editor flows**: side-by-side eye ordering, scrub/zoom, keyboard play/frame/edit controls, view-only rotation/collapse, three-participant Rust pool, per-eye statistics and mobile layout.
- **13 API checks**: sessions, ownership, origin rules, immutable streamed R2 writes, ranges/ETags/HEAD and deletion.
- **Raw cloud round trip**: actual Emotion and HARMONIC packages with all three video streams, derived eye signals and independent frame clocks saved to and reopened from private D1/R2 revisions. Test uploads are deleted afterward.
- **Real backend AI**: six JPEG frames from the actual Emotion scene sent to Workers AI DETR. Eleven candidate tracks were produced; accepted analysis had positive gaze dwell in detected person/bench regions. Frames, unmodified responses, proposal geometry and numerical output are archived. This establishes a working pipeline, not object-detection accuracy; proposals include false positives and remain reviewable.

## Performance measurement

`node scripts/measure-playback.mjs BEFORE_URL AFTER_URL` uses Chromium, the same host, 4× CPU throttling and a five-second playback window after media is ready. The initial pair compared the prior deployed UI with the built local editor:

| Metric | Prior UI | Editor |
|---|---:|---:|
| Main-thread script duration | 725.0 ms | 362.3 ms |
| Total task duration | 1,555.6 ms | 1,341.7 ms |
| Layout duration | 208.0 ms | 216.2 ms |
| rAF interval P95 | 18.0 ms | 19.6 ms |
| Observed long tasks | 0 | 0 |

This single pair supports reduced JavaScript work for this recording. It does not establish a universal speedup, improved FPS on every device, or lower layout cost. The 120 Hz eye videos can exceed the display's presentation rate; browser dropped-frame counters are not lost source frames. Collapsing eye monitors removes their active video elements when they are not needed.

The primary architectural improvement is that frame-time updates no longer re-render the Studio shell. Participant and static timeline indexes are cached; pointer moves are coalesced; redundant rate writes are avoided; import and benchmark tools are loaded separately. The numerical kernel runs outside the UI thread. It remains bounded to interactive trials; a streaming implementation for multi-million-sample recordings is still future work.

See `docs/verification/` for preserved reports and `artifacts/verification/` for local/CI outputs. Reproduction commands are listed in the root README and package scripts.

A subsequent CSS adjustment reduces ruler labels in narrow reusable players. [Production measurements](verification/v0.2-compact-timeline.json) checked non-overlap at 390px for 1×, 2×, 4× and 8× zoom. The full editor checks also passed again after this adjustment.

[Final deployment CI](https://github.com/pajama-studio/gaze-studio/actions/runs/34072025822) passed for `1ed80ec407686377dd0158d518bd5cf1cb93371d`, including all 32 browser flows and the native/WASM/API checks above.

## Signal tracks update

The subsequent signal-track revision removes the synthetic product example and defaults the Emotion left-eye view to a reversible 180° correction. It adds five reusable data tracks, Rust saccade candidates, event inspection/CSV exports, and explicit browser-save feedback. Current validation is **74 TypeScript/WASM tests, 5 native Rust tests, and 8 additional signal-track browser workflows** (40 browser flows in the full suite). Details are in [SIGNAL-TRACKS.md](SIGNAL-TRACKS.md). Earlier reports and performance figures above describe their original source revisions.

[Signal-track CI](https://github.com/pajama-studio/gaze-studio/actions/runs/34074121738) passed for source `a32ea1bb7f252699137b56976a07456b1a7c7d66`. The public domain separately passed [eight signal workflows](verification/v0.2.1-signals.json), [seven binocular workflows](verification/v0.2.1-binocular.json) and [both real three-video cloud round trips](verification/v0.2.1-raw-cloud.json). [Deployment metadata](verification/v0.2.1-deployment.json) identifies the exact Cloudflare version.
