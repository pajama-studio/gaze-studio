import fs from "node:fs/promises";
import { spawnSync } from "node:child_process";
const base = process.env.DATASET_ORIGIN || "https://gaze.pajama.studio";
await fs.mkdir("artifacts/library/ci", { recursive: true });
const metadata = await fetch(base + "/api/datasets/emotion-p01-0a").then(
  (r) => {
    if (!r.ok) throw Error("Hosted dataset catalog unavailable");
    return r.json();
  },
);
const assets = metadata.assets.filter((a) => a.public);
const q = (s) => `'${String(s).replaceAll("'", "''")}'`;
let sql = `INSERT OR REPLACE INTO datasets VALUES('emotion-p01-0a','Through both eyes','Real binocular demo',${q(metadata.source_url)},${q(metadata.license)},'v1','datasets/emotion-p01-0a/v1/recording.json',1,0);\n`;
for (const a of assets) {
  const url =
    a.path === "recording.json"
      ? base + "/api/datasets/emotion-p01-0a/recording"
      : base + "/api/datasets/emotion-p01-0a/assets/" + a.path;
  const data = new Uint8Array(
    await fetch(url).then((r) => {
      if (!r.ok) throw Error("Dataset asset unavailable");
      return r.arrayBuffer();
    }),
  );
  const hash = Buffer.from(
    await crypto.subtle.digest("SHA-256", data),
  ).toString("hex");
  if (hash !== a.sha256 || data.length !== a.bytes)
    throw Error("Dataset checksum mismatch");
  const file = "artifacts/library/ci/" + a.path.replaceAll("/", "-");
  await fs.writeFile(file, data);
  const key = "datasets/emotion-p01-0a/v1/" + a.path;
  const r = spawnSync(
    "npx",
    [
      "wrangler",
      "r2",
      "object",
      "put",
      "gaze-studio-test/" + key,
      "--file",
      file,
      "--content-type",
      a.mime,
      "--local",
      "--config",
      "wrangler.test.jsonc",
    ],
    { stdio: "inherit" },
  );
  if (r.status) process.exit(r.status);
}
for (const a of metadata.assets)
  sql += `INSERT OR REPLACE INTO dataset_assets VALUES('emotion-p01-0a',${q(a.path)},${q("datasets/emotion-p01-0a/v1/" + a.path)},${q(a.sha256)},${a.bytes},${q(a.mime)},${q(a.role)},${+a.public});\n`;
await fs.writeFile("artifacts/library/ci/catalog.sql", sql);
const r = spawnSync(
  "npx",
  [
    "wrangler",
    "d1",
    "execute",
    "gaze-studio",
    "--local",
    "--file",
    "artifacts/library/ci/catalog.sql",
    "--config",
    "wrangler.test.jsonc",
  ],
  { stdio: "inherit" },
);
if (r.status) process.exit(r.status);
