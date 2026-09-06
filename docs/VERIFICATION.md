# Verification

The application is a research preview, not a validated eye tracker. Checks below establish software behavior, not human webcam accuracy.

The initial production checks ran on **2026-09-06** against Cloudflare version `ff20ae31-e264-4257-ae1c-1baf6f5f4e7b`, before the move to [gaze.pajama.studio](https://gaze.pajama.studio). Published [machine-readable reports](verification/) retain their actual endpoint and time; CI artifacts capture subsequent runs separately.

The custom-domain deployment `93648ec6-3823-4493-9bdf-7f0dd137ede2` passed the same **13 API checks and 11 browser flows**. Cloudflare and Google public DNS returned its new address; the local router retained an earlier NXDOMAIN answer, so these checks used a process-local mapping to the independently resolved address, with normal HTTPS certificate validation. [Domain API report](verification/domain-api-results.json) · [Domain browser report](verification/domain-browser-results.json) · [Domain and branding checks](verification/domain-ui.json).

After the local DNS cache updated, a fresh Chromium browser using its default resolver also passed HTTPS navigation, the Pajama Studio title, native video loading and seeking. The successful default-resolver recheck is timestamped in the domain UI report.

[GitHub CI](https://github.com/pajama-studio/gaze-studio/actions/runs/34067238558) passed on Ubuntu/Node 22: unit tests, application build, Worker type checking, local D1/R2 setup and API/browser tests. Current [screenshots](screenshots/) show the Pajama Studio deployment.

## Automated checks

- **50 unit tests**: integer-nanosecond handling, offset/drift/inverse clocks, VFR indexing, missing/off-screen gaze, duplicate rejection, CSV quoting, package integrity and raw-source round trips, Cogix rectangle/ellipse conversion, recorded DOM geometry, I-VT/I-DT events, time-weighted dwell, gaps, participants, AOI visibility boundaries, independent label matching, angular geometry, bias versus jitter.
- **13 Cloudflare API checks**: session/cookie behavior, cross-origin rejection, owner isolation, streamed R2 writes, prefix/suffix/invalid ranges, ETag, HEAD, immutable revisions, raw-source retention, deletion. Run with `node scripts/verify-api.mjs`.
- **11 browser flows**: real GazeMining data/worker analysis, playback and seek, manual rectangle, dynamic keyframe/undo, polygon, analysis export, portable package round trip, cloud upload/reopen/seek, cleanup, dataset filtering, 390px mobile import/layout. Run with `node scripts/verify-browser.mjs`.
- **3 additional production UI checks**: independent CSV benchmark with a known 10px error, synchronization anchor editing, and mobile workspace navigation. See [the report](verification/ui-extra.json).
- **Optional real AI verification**: one single-frame request and six sampled-frame requests. The observed test produced 1 single-frame candidate, 6 track candidates and 14 recorded DOM regions. `node scripts/verify-ai.mjs` calls real Workers AI; counts may change with model/service updates and source frame selection. All generated regions are proposals until accepted.
- TypeScript application and Worker checks; production Vite build; npm audit reported no vulnerabilities for the installed dependency tree at verification time.

Browser/API scripts accept `BASE_URL` and produce machine-readable JSON and screenshots in ignored `artifacts/verification/`. They create isolated browser sessions and delete their cloud test recordings. No credentials or session cookies are written to the published verification reports.

## Real data and numerical conformance

GazeMining p1 Amazon: 78 seconds, 1024×768, 7,013 original samples, 6,718 distinct Qt timestamps after documented grouping, 382 decoded frames. Every decoded frame PTS matches the source frame-time file (maximum disagreement: 0 µs). This proves file-time consistency, not sensor-to-display physical latency. Raw gaze remains available as a source attachment.

The CLI scorer's deterministic test pairs 11 predictions with 11 references at an exact 10px constant offset: mean pixel error 10, coverage 100%, zero constant-target jitter. This tests the metric definitions, not a webcam model.

The native sample video is served through a **public allowlisted R2 route** (`/api/examples/gazemining`) supporting HTTP byte ranges. Serving it directly through the local Cloudflare static-asset path reproduced seek-to-zero behavior in Chromium; the R2 route resolves that failure and shares the tested media-serving code with private recordings.

## Not established by these checks

- Real human webcam accuracy, calibration drift or commercial eye-tracker equivalence.
- EVE model performance: access-controlled source data was not obtained or evaluated in this session.
- Dense video object tracking, semantic correctness of every automatic AOI, or pursuit classification validity.
- Full BIDS validator conformance. Export remains an explicitly labelled draft subset.
- TB-scale out-of-core processing, durable background jobs, multi-user team authorization or large-load/cost benchmarks.

See [METHODS.md](METHODS.md), [FORMAT.md](FORMAT.md) and [the roadmap](PLAN.zh-CN.md) for definitions and limits.
