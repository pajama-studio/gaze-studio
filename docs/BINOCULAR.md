# Raw eye imagery and synchronization

“Raw eyes” means camera images of each eye. It does not mean two numerical gaze columns. The default public replay contains two actual eye videos plus the viewed scene; the pupil curves are separate derived measurements.

## Included public replay

[Through the Eyes of Emotion](https://github.com/MultiRepEyeVR/Through-the-Eyes-of-Emotion), Yang et al., IMWUT 2025, DOI [10.1145/3749545](https://doi.org/10.1145/3749545). The [raw dataset record](https://zenodo.org/records/16794721) declares CC BY 4.0. Third-party film stimulus rights remain separate. Studio presents a short research replay excerpt, not a film distribution catalog.

The three-part ZIP is approximately 113.8 GB. A reproducible HTTP Range reader indexes its ZIP64 central directory and retrieves **only the selected P01/0a trial**. Each downloaded member is checked against its ZIP CRC and original size. We archive the complete selected eye0, eye1 and world movies, gaze/pupil/IMU CSVs, archive entry metadata and the Zenodo record metadata in our private R2 bucket. The entire 26-participant collection is not mirrored.

Public derivative: common video PTS interval **4–24 seconds**. World: 640×480, 600 frames; right eye (`eye0`): 400×400, 2,367 frames; left eye (`eye1`): 400×400, 2,390 frames. The excerpt contains 4,757 gaze samples and 4,757 per-eye pupil observations. Videos are re-encoded to H.264 CRF21 for a small browser download, preserving frame order without FPS resampling. They are derivatives; the original videos are retained separately.

Video timestamps are decoded with ffprobe and transformed with a common cut. The checked maximum original-to-derivative PTS differences are 71 µs (world), 301 µs (right), 76 µs (left). These small encoding differences are **not tracker accuracy**.

This trial does not distribute complete per-frame capture sidecars. Gaze epoch is estimated from the median difference between each world frame's encoded PTS and the midpoint of the gaze samples assigned to its `world_index`. Median frame-group residual: 0.907 ms; P95: 2.901 ms. This is agreement with recorded assignments, not independent evidence of physical camera synchronization. Capture latency and the physical gaze/scene alignment remain unvalidated. Original common video PTS are retained; eye images are not falsely paired one-to-one with pupil CSV rows (their counts differ).

Gaze coordinates transform normalized bottom-left into native scene pixels. Confidence ≥0.6 defines valid samples. Pupil measurements are **image pixels**, not millimetres. The app does not infer emotion, cognitive load or diagnostic meaning from them.

## HARMONIC: explicit capture timestamps

The [official HARMONIC sample](https://harplab.github.io/harmonic/) contains both IR eye cameras, a 1280×720 world video, gaze, pupil and per-frame NumPy capture timestamps. Citation: Newman et al. (2021), DOI [10.1177/02783649211050677](https://doi.org/10.1177/02783649211050677).

Downloaded archive: 318,222,191 bytes. Its offered name says 1.0.0; its internal root says `harmonic_0.5.0`. Both are recorded. No explicit dataset redistribution license was located, so the archive and derived package are stored privately in our Cloudflare account. Code remains MIT. Public availability of a research download is not labeled as CC0 or MIT.

The original world video encodes 2,499 frames over 83.30 seconds. Eye0 encodes 9,448 frames over 78.73 seconds; eye1 encodes 9,557 frames over 79.64 seconds. Their capture timestamps span roughly 84.75 seconds. Aligning all three by assumed 30/120 FPS or by equal video seconds would be wrong.

`prepare-harmonic.py` joins each frame's original capture timestamp to its actual encoded PTS, then maps both eye clocks through the world clock. It deliberately ignores suspicious `world_index` columns in the pupil export. The default 10–30 s capture excerpt contains 596 world, 2,231 right-eye and 2,266 left-eye frames, 4,140 gaze samples and 4,490 eye-signal samples. It generates a portable Gaze Package including the original timestamp sidecars and raw CSVs.

## Reproduce

Requires Python 3.11+ and ffmpeg/ffprobe. No NumPy dependency is required for these converters.

```sh
python3 scripts/datasets/index-emotion-archive.py
python3 scripts/datasets/fetch-emotion-trial.py
python3 scripts/datasets/prepare-emotion.py

# After extracting the official HARMONIC sample's trial files:
python3 scripts/datasets/prepare-harmonic.py --input artifacts/research/harmonic/extracted
```

Import the generated `harmonic.gaze.zip` through Studio's Import dialog. For another recording, attach left/right videos under **Sync → Raw eye videos**, specify their offset, and edit full anchors when known. In a Gaze Package, every video carries its own frame PTS, explicit visibility interval and clock transform.

## What these data evaluate

These data validate file ingestion, frame alignment, playback, AOI analysis and repeatable signal processing. Their near-eye infrared cameras are different from laptop RGB webcams. Replaying the recorded gaze does not evaluate a new webcam estimator. A webcam accuracy benchmark must run that estimator on a suitable labeled dataset with held-out participants and a documented calibration protocol.
