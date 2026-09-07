# Owned Cloudflare data library

The app and API run on `gaze.pajama.studio`, in `pajama-studio/gaze-studio`. The existing internal Worker/R2 names retain `cogix-gaze-studio`; this is a resource identifier, not the GitHub owner.

R2 stores the source files used by this project, compact replay derivatives and analysis evidence. D1 tables `datasets` and `dataset_assets` record provenance, license, revision, object role, byte count, SHA-256 and whether an asset is public. This curated catalog is separate from session-owned user recordings. Its write path is authenticated deployment tooling, not an anonymous browser API.

```text
R2 cogix-gaze-studio/
  catalog/v1/library.json
  datasets/emotion-p01-0a/v1/
    raw/{eye0.mp4,eye1.mp4,world.mp4,gaze.csv,pupil.csv,imu.csv,probe.json}
    provenance/{Zenodo metadata,ZIP entry metadata}
    {recording.json,synchronization.json,world.mp4,eye0.mp4,eye1.mp4}
    annotation/{submitted JPEGs,original DETR responses,AOIs,analysis,verification}
  datasets/harmonic-p122-011/v1/
    raw/{sample.tar.gz.part-000,...,archive.json}
    trial/{original videos,CSV,NPY,run_info.yaml}
    replay/{harmonic.gaze.zip,recording.json,derived videos}
  datasets/gazemining-amazon/v1/{raw/,replay/}
  datasets/gazecom/v1/raw/GazeCom.zip
  datasets/studio-verification/v1/{analysis and verification reports}
  {private recording UUID}/{media,track-0,track-1,gaze.csv,aois.json,analysis.json,raw-0,...}
```

The complete HARMONIC archive is larger than Wrangler's 300 MiB object-upload command limit. It is stored as exact 128 MiB chunks with individual and whole-archive SHA-256 values; concatenate them in numeric order to restore the original. This is a tooling choice, not an R2 object-size limitation.

The public dataset API:

- `GET /api/datasets`: available curated replay metadata.
- `GET /api/datasets/:id`: source/license metadata and asset inventory with checksums and public/private status.
- `GET /api/datasets/:id/recording`: the published recording manifest.
- `GET|HEAD /api/datasets/:id/assets/:path`: explicitly allowlisted public assets, including byte ranges and ETags.

Original research files remain private in R2 unless explicitly published. The public inventory can describe private files, but their bytes cannot be fetched through the public route. Only the compact Emotion derivative and GazeMining examples are published. The app sends no external-origin requests to play these examples.

```sh
python3 scripts/datasets/build-library.py
node scripts/sync-library.mjs --local   # seed test-config R2/D1
node scripts/sync-library.mjs           # archive sources + deploy production R2/D1 catalog
```

Uploads can resume using local per-object checksum state. Uploads finish before the D1 catalog is updated. The generated cloud catalog omits local file paths. A future production data lake should use content-addressed objects or new immutable revisions for every replacement; this preview's curated `v1` paths can be refreshed by authenticated deployment tooling. Private user recordings already save as immutable new revisions.

“All related data” here means the source files actually obtained and used by this implementation, their derived replays and analysis evidence. It does not claim to mirror every dataset listed in the research catalog or all 113.8 GB of the Emotion collection. External links remain provenance, not playback dependencies.
