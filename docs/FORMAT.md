# Gaze Package 0.1.0

Status: experimental, public application interchange format. It complements BIDS and vendor exports; it is not an adopted industry standard. The implementation is `src/core/types.ts`, `io.ts`, `time.ts`, and the JSON schemas in `schemas/`.

## Container and scope

One ZIP package represents one media stimulus and the gaze streams that share its presentation timeline. Multiple participants can view the same stimulus. Separate trials/media belong in separate packages for this version. A cloud workspace catalogs many packages/recordings.

```text
recording.gaze.zip
├── manifest.json
├── gaze.csv
├── aois.json
├── frames.json                 # optional: video presentation timestamps in µs
├── media/stimulus.webm         # or MP4 / PNG / JPG / SVG fixture
└── raw/source-0                # optional original bytes; name/type in manifest
```

ZIP uses standard compression; exports currently store entries without compression to reduce browser CPU cost. PNG/JPEG/video are already compressed. Each entry other than the manifest has SHA-256 and byte length in `manifest.files`. Checksums detect accidental modification, not an untrusted author's false claims.

Interactive limits: 500,000 samples, 100 MiB media for export, 130 MiB input ZIP, 150 MiB expanded ZIP. Original source attachments are limited to 15 MB each in portable export. Oversized datasets should be partitioned by recording/trial; indexed out-of-core processing is a later version.

## Manifest

```json
{
  "format": "gaze-package",
  "version": "0.1.0",
  "coordinateSystem": "stimulus-pixels-top-left",
  "timeUnit": "microseconds",
  "clockExtrapolation": "linear",
  "recording": {
    "id": "study1-session1-trial1",
    "title": "Shopping task",
    "description": "One recorded presentation",
    "width": 1024,
    "height": 768,
    "duration": 78000000,
    "mediaType": "video",
    "mediaName": "amazon.webm",
    "mediaUrl": "media/stimulus.webm",
    "recordedEye": "left",
    "anchors": [{ "gaze": 0, "media": 0 }],
    "source": {
      "license": "CC0-1.0",
      "synthetic": false,
      "url": "https://zenodo.org/records/5031618",
      "format": "GazeMining left eye",
      "originalTimeOrigin": "1552383049162 ms UTC"
    }
  },
  "rawSources": [],
  "files": []
}
```

The empty `files` array above is illustrative only; an actual package must list its media and data with real hashes. Optional screen geometry is `geometry: {widthMm, heightMm, distanceMm}`. These dimensions describe the same physical rectangular surface as the stimulus pixels. Do not attach full-monitor geometry to a cropped viewport without adjusting the model.

## Gaze stream

```csv
t_us,x_px,y_px,valid,participant_id,pupil,blink,label
0,501.2,312.8,1,P01,3.5,0,
10000,,,0,P01,,0,
20000,-20,730,1,P01,3.6,0,
```

- `t_us`: signed integer microseconds in the gaze clock relative to a recorded origin. Negative samples are allowed. JavaScript safe-integer range is required. Global ordering is by time; per-participant times must increase strictly.
- `x_px`, `y_px`: floating-point pixels in the **native stimulus** coordinate system. Origin is top-left, X points right, Y points down. Off-screen coordinates are retained. Missing coordinates are empty cells; zero is a real coordinate.
- `valid`: explicit `1`/`0`, separate from in-bounds status. A missing coordinate makes a sample unusable even if the vendor validity field says true.
- `participant_id`: required stable pseudonym in portable/benchmark CSV. Generic imports may assign `P01` when the source lacks a column.
- `pupil`: optional source value. No mm conversion or baseline inference is automatic; preserve vendor units in provenance.
- `blink`: explicit annotation. Missing gaze is not a blink by default.
- `label`: optional original event label. Its vocabulary belongs in provenance; the tool does not interpret every vendor label as equivalent.

Internally these fields are `t/x/y/valid/participant/pupil/blink/label`. If left and right eyes have the same timestamps, import as separate recordings or apply a documented combination policy. Do not disguise two eye streams as two human participants. `recordedEye` describes the resulting stream.

CSV imports preserve the original input as a raw attachment. For the GazeMining example, duplicate Qt receipt milliseconds are grouped and left-eye values averaged within each group. The original full datacast is supplied separately, with hashes and the transformation documented. No sub-millisecond sample times were invented.

## Video and clock alignment

`frames.json` is a strictly increasing array of media presentation timestamps in integer microseconds. Extract from the actual video bitstream with `scripts/frame-index.py`. Zero is not necessarily the first sensor timestamp. The included GazeMining example has 382 decoded frames whose PTS exactly match the supplied frame index.

`anchors` map gaze clock → media clock. A single anchor uses a fixed offset. Between multiple anchors the mapping is piecewise affine, with positive slope. Outside the anchors, version 0.1 explicitly extrapolates the first/last segment. Frame stepping uses PTS; without a frame index, the UI steps 100 ms and does not claim a true frame step.

For example, `{gaze: 1000000, media: 0}` means gaze-clock time 1 s corresponds to the start of the movie. Two endpoints can correct clock-rate drift. More anchors can represent measured synchronization landmarks. Anchors must increase strictly in both clocks; pauses/resets that make the relationship non-invertible must be represented as separate presentation episodes/packages in 0.1.

Pupil Cloud Unix nanoseconds exceed exact Number precision. Subtract the integer origin with BigInt/decimal arithmetic **before** converting to relative microseconds. `scripts/convert-pupil.py` aligns world sensor timestamps to the decoded scene-video PTS one-to-one, rather than assuming 30 FPS. It refuses section/frame-count mismatches.

The browser uses `requestVideoFrameCallback` media times when available, with `timeupdate` fallback. Browser scheduling, dropped display frames and the source camera's capture latency still limit physical synchronization; matching file clocks does not prove photon-level timing accuracy.

## AOI annotations

```json
{
  "id": "product-1",
  "name": "Product image",
  "shape": "rectangle",
  "color": "#0c9a87",
  "start": 1000000,
  "end": 9000000,
  "keyframes": [
    {
      "t": 1000000,
      "points": [
        [100, 150],
        [400, 500]
      ]
    },
    {
      "t": 4000000,
      "points": [
        [130, 150],
        [430, 500]
      ]
    }
  ],
  "source": "manual",
  "accepted": true
}
```

AOI times use the **media clock**, with half-open visibility `[start,end)`. Rectangle and ellipse use opposite bounding-box corners. Polygon points follow the perimeter. Keyframes interpolate vertices linearly when topology matches; otherwise the earlier geometry is held. Before the first and after the last keyframe, geometry is held while the AOI is visible. Split discontinuous visibility into separate AOIs/episodes. Version 0.1 does not solve polygon self-intersection or occlusion automatically.

Model proposals have `source: model`, `accepted: false`, `model` and `score`. The analysis ignores unaccepted candidates. Dynamic detection samples up to six frames and uses same-label IoU association with a coarse histogram cut guard. It is not dense optical-flow tracking. Imported DOM regions use `source: import` and remain candidates until accepted.

## Cogix compatibility

The older Cogix AOI convention differs: rectangle `[x,y,width,height]`, ellipse `[centerX,centerY,radiusX,radiusY]`, polygon/freehand flat vertex pairs. The importer converts these into bounding corners/vertices. `metadata.coordinateSystem` must explicitly be `pixels` or `normalized`; it never guesses from small coordinate values. Keyframe `time` and `frameRange.startTime/endTime` are seconds in the old schema. Frame-only annotations require a frame index conversion first.

```json
{
  "metadata": { "format": "cogix-aoi-v1", "coordinateSystem": "normalized" },
  "aois": [
    {
      "id": "a",
      "name": "Button",
      "type": "rectangle",
      "color": "#0c9a87",
      "coordinates": [0.1, 0.2, 0.3, 0.15]
    }
  ]
}
```

Cogix gaze CSVs with `timestamp`, `gaze_x`, `gaze_y`, `participant_id`, confidence and optional pupil values can use the mapping UI. Confirm timestamp units and origin explicitly. This is an interface bridge, not a republication of private Cogix code.

## BIDS compatibility

[BIDS 1.11.1](https://bids-specification.readthedocs.io/en/stable/modality-specific-files/physiological-recordings.html) is the scientific archive target. Import currently handles one headerless `physio.tsv(.gz)` plus its resolved sidecar. Supply inherited metadata yourself; choose actual time/coordinate units in the mapper. This version does not walk complete BIDS hierarchies or import stimulus presentation events automatically.

BIDS draft export writes one participant with known recorded eye and approximately uniform integer-microsecond intervals (1 µs rounding tolerance), headerless gzipped TSV, sidecar and dataset_description. It refuses irregular sampling rather than silently resampling. It does **not** claim validator-complete BIDS: stimulus files/events, device metadata, physical coordinate details, pupil units and subject metadata need curation. Keep the complete Gaze Package as the companion archive.

## Future version policy

- Breaking clock/coordinate/metric semantics require a new major format version.
- Optional extensions use named, versioned metadata; unknown extensions are retained where possible, never interpreted silently.
- Planned dataset-level manifests will index many recordings and time-partitioned Arrow/Parquet objects while retaining the same explicit clock and geometry contracts.
- Annotation revisions and analysis runs will reference immutable source/parameter/AOI hashes. Current packages already carry source file hashes and analysis exports carry parameters/version; a content-addressed analysis cache is not implemented yet.


## Version 0.2: raw eye-camera streams

The exporter now writes `0.2.0`; the reader accepts `0.1.0` and `0.2.0`. This is an experimental project protocol, not an industry standard.

`recording.videoTracks` holds up to six auxiliary videos. Each has a unique `id`, `role` (`left-eye`, `right-eye`, `context`), name, native dimensions, encoded duration, media path, optional actual frame PTS and `anchors`. Every embedded video is a checksummed package file. `start` and `end` form a half-open interval on the master scene clock; outside it the UI shows no frame.

**Clock distinction:** recording-level anchors map gaze timestamps to scene-video PTS. For auxiliary video anchors, the existing `gaze` field means **master scene-video PTS**, and `media` means that auxiliary video's PTS. Both are integer microseconds. Anchors must be strictly increasing on both axes. This reused field name is retained for compatibility; consumers must use the documented track context. For example, `[{gaze:1000000,media:0},{gaze:11000000,media:9900000}]` describes an eye camera starting at scene 1 s with a different clock rate.

`recording.eyeSignals` holds time-stamped derived measurements: `t` (gaze clock), `eye`, confidence in [0,1], nullable pupil diameter and an explicit `pupilUnit` (`mm`, `px`, `arbitrary`). These are separate from raw eye images. Streams are strictly increasing per eye; mixed pupil units are rejected by the Rust summary. Current auxiliary streams describe one participant's camera rig.

`recording.analysisSettings` preserves finite analysis windows, method, thresholds, participant and `aoiScope` (`all` or `automatic`). Only reviewed areas enter metrics. Portable export caps combined embedded data at 128 MiB; it does not silently omit an eye movie. Larger original archives live in R2 with an inventory.

IndexedDB refreshes object URLs for all embedded media on reload. Private cloud revisions upload auxiliary videos as `track-0` through `track-5`, then load them through the same authenticated range-serving API as the scene video.
