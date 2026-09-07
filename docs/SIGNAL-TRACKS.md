# Synchronized eye tracking data tracks

The workspace contains two real public examples. Attention Garden and its SVG have been removed from the application and production assets. Deterministic synthetic fixtures remain under `tests/fixtures/` for numerical regression tests.

The reusable `SignalTimeline` places five data tracks under the scene/eye media lanes and AOI scarf. All use the scene clock, shared zoom and playhead. Raw gaze and pupil timestamps map through recording anchors once; Rust event timestamps are already in scene time and are not mapped again.

| Track | Input and displayed values | Meaning |
|---|---|---|
| Gaze position | Raw X/Y in native scene pixels; separate X and Y axes use their own scene extent | Actual samples; invalid samples and long gaps break the trace. X=0 or Y=0 remains valid. |
| Fixations | Rust I-VT or I-DT events: onset, duration, mean X/Y | Analysis settings and participant/window selection apply. |
| Saccade candidates | Rust contiguous above-velocity intervals: onset, duration, endpoint displacement and peak velocity | A transparent threshold method, not a validated physiological label. |
| Pupil diameter | Actual per-eye pupil measurements and source units | Values below 0.6 confidence are omitted. Pixels and mm are never mixed. |
| Tracking quality | Per-eye pupil-detection confidence, or binary sample validity when confidence is unavailable | Invalid gaze and capture gaps appear as quality intervals; neither implies a blink. Explicit source blink flags remain separately labeled. |

The supplied binocular sample has combined scene gaze plus independent eye images and pupil signals. It does not supply two independently mapped scene-gaze streams; the viewer does not manufacture them. For multi-participant recordings, a signal-participant selector disambiguates raw curves. Unattributed eye signals are not silently attached to a selected person in a multi-participant import.

Use **Tracks** to hide/show channels. Click or drag a numeric trace to seek; arrow keys step 100 ms (Shift: 1 s). Select a fixation or saccade bar to inspect its evidence and seek all synchronized videos. Event bars are keyboard accessible. **Analysis → Eye movement events** offers paginated inspection and CSV export. The source data and complete analysis JSON remain available through the existing exports.

## Saccade candidate method

Engine `gaze-studio-rust/0.2.1` partitions complete participant streams, maps gaze timestamps through source anchors and selects samples inside the analysis window. Candidate boundaries are not joined across participants or analysis windows.

For each participant/window, compute the median of positive adjacent intervals no larger than `maxGap`. Reject velocity pairs with invalid coordinates, source blink flags, nonpositive intervals, capture gaps or intervals below one quarter of that median. The last guard avoids immense finite-difference speeds from nearly coincident exported timestamps. It is an explicit numerical guard, not a physical sensor validation.

Compute Euclidean gaze displacement / elapsed seconds in **px/s**. Consecutive valid pairs exceeding the configured velocity threshold form a candidate. Keep candidates lasting at least **10 ms**. Amplitude is endpoint displacement in pixels; peak velocity is the largest retained adjacent-pair speed. The velocity threshold remains configurable for both I-VT and I-DT fixation settings. No angular-accuracy or smooth-pursuit classification claim is made.

This is new code using the existing modular Rust pipeline. The previous private Cogix UI was inspected to understand its gaze/fixation/saccade/pupil/confidence track categories; its implementation was not copied into this public repository.

## Verification and performance

`npm test` runs 74 tests, including signal-clock mapping, extrema/gap-preserving decimation, zero-coordinate handling, participant separation, pupil units, camera metadata round trips and compiled-WASM candidate results. Five native Rust tests cover threshold candidates, invalid/gap boundaries, near-coincident timestamps, clock mapping and pupil statistics.

`BASE_URL=… npm run test:signals` covers eight browser workflows: real-only examples, corrected/raw orientation, five live tracks and keyboard seek, event details, track visibility and ruler alignment, event CSV/replay, persisted rotation, mobile bounds, and saved/empty workspaces when public example metadata is unavailable (several checks are grouped).

Static plot geometry is memoized. Buckets retain endpoints and extrema while explicit invalid samples and long gaps remain path breaks. Playback updates only cursors, sample readouts and accessible values. There is no per-frame full-sample processing. This remains an interactive trial viewer rather than a streaming million-sample engine.
