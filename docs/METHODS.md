# Numerical methods and interpretation

Implementation version: `gaze-studio-analysis/0.1.0`. Units are native stimulus pixels and integer microseconds. Default thresholds are **software defaults**, not universally validated physiological constants.

## Quality and coverage

Samples are grouped by participant before derivatives or event detection. Gaze timestamps are mapped into media time before windowing. A usable sample has explicit validity, finite X/Y, and no explicit blink flag.

Valid observed time sums adjacent sample intervals when both endpoints are usable, the interval is positive, and the gap is no larger than `maxGap` (default 75 ms). Intervals are clipped to the selected media window. No duration is invented after the final sample. Coverage divides this valid time by selected-window duration × selected-participant count. Therefore short/partial recordings have lower coverage even if their available samples are valid.

Median sample rate is 1 / median positive observed inter-sample interval. It is not a claim of constant acquisition rate; receipt jitter, duplicate aggregation and gaps may differ from vendor nominal frequency. The included GazeMining recording has 7,013 original samples, 6,718 distinct receipt timestamps after the documented aggregation, and an observed median interval of 11 ms (~91 Hz). The original experiment's stated rate was 90 Hz.

## Fixation candidates

**I-VT:** Euclidean displacement divided by adjacent elapsed time, in px/s. Consecutive low-velocity samples form candidates. Candidates must span at least `minFixation` (default 100 ms); velocity default is 800 px/s. Invalid samples, zero/negative intervals and gaps split sequences.

**I-DT:** Grow a window while `(max X − min X) + (max Y − min Y)` is within the dispersion threshold (default 65 px). Emit when the duration exceeds the same minimum. If too short, advance the starting sample. This simple spatial threshold method is offered as an explicit alternative, not a guaranteed improvement.

Centroids are the arithmetic mean of candidate samples. Durations span first to last sample, without adding an artificial terminal sample interval. No smoothing or blink interpolation is applied. Pixel thresholds vary with screen geometry and source resolution. Slow smooth pursuit can pass these fixation criteria; dedicated pursuit/saccade classification and reference-tool parity are future work. Keep vendor/expert event labels as separate provenance.

For mature signal processing and natural-viewing event detectors, compare [pymovements](https://github.com/pymovements/pymovements) and [REMoDNaV](https://github.com/psychoinformatics-de/remodnav). Evaluation should include event-level matching, not only sample-wise agreement; [GazeCom evaluation materials](https://michaeldorr.de/smoothpursuit/) demonstrate why class definitions matter.

## AOI metrics

- **Dwell:** sum valid adjacent sample intervals whose left sample falls inside the AOI. Visibility start/end boundaries split intervals exactly. Moving geometry is evaluated at the interval's left boundary; this is a sampled approximation, not continuous motion intersection.
- **Visit:** contiguous runs of valid AOI-hit intervals. Invalid data and outside intervals break visits. A visit is not necessarily a fixation.
- **TTFF:** first detected fixation whose centroid lies inside the AOI at fixation start, relative to the later of analysis-window start and AOI visibility onset. No fixation → null, never zero. In an aggregate view, the current table shows the earliest participant TTFF; select a participant for an individual latency.
- **Fixation count/duration:** centroid-in-AOI at fixation start, using the detector's full event span. Dynamic AOI boundaries may move during an event; this event-assignment rule is different from raw-sample dwell.
- **Overlaps:** dwell/visits/fixations count independently in each AOI. For scarf sequences and transitions, first accepted AOI in annotation order wins. Outside/invalid intervals break transitions; no participant-to-participant transitions are created.
- **Heatmap:** visual kernel accumulation weighted by fixation duration in the selected analysis window. It is a qualitative overlay, not a calibrated probability density or statistical test.
- **Scanpath:** recent detected fixation centroids, linked separately per participant. Raw gaze is never connected across lost intervals by the gaze overlay.

These definitions are intentionally exported with algorithm parameters and version. Cross-tool comparisons must use the same overlap, interval, fixation and censoring rules.

## Pupil and blink data

The current view reports valid positive pupil values in their original units, valid pupil sample count and explicitly annotated blink sample count. It does not estimate blinks from missing gaze, convert area to diameter, interpolate across blinks, apply baseline correction, or infer cognitive load. Those require a separately specified acquisition/preprocessing protocol and source metadata.

## Prediction accuracy and precision

The benchmark tool accepts **two independent** canonical CSVs. It uses participant-specific nearest adjacent timestamps, greedy one-to-one reference usage and a configurable tolerance. Predictions are processed in time order. It reports unpaired samples through both prediction match rate and reference coverage; results with poor pairing coverage need investigation.

Pixel error is Euclidean prediction-to-reference distance. Mean, median, P90 and RMSE are computed over matched pairs. Per-participant and macro-average mean errors avoid relying only on a sample-weighted headline.

Angular error uses full pixel positions projected onto a centered physical screen rectangle and the angle between the resulting 3D viewing rays. Width/height and viewing distance must describe that surface. A cropped viewport or scene-camera view generally needs a more complete calibrated camera model; the simple screen model must not be applied blindly.

**Accuracy is not precision.** The optional precision result groups exact constant-reference target runs with at least 5 samples, at least 100 ms span, and no gap >75 ms. It reports RMS sample-to-sample displacement and pooled within-target spatial SD. Settling and drift remain included; define an appropriate stable-fixation protocol before interpreting this as tracker precision. Moving/noisy reference streams often produce no qualifying group, in which case precision is null.

The scorer does not train or execute a webcam model, choose a lawful dataset license, or establish a real-world accuracy claim. EVE requires authorized access and source-specific camera/screen preprocessing. Keep subject and target holdouts independent from calibration. See [the evaluation plan](PLAN.zh-CN.md).
