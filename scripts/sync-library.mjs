import fs from "node:fs/promises";
import { spawn } from "node:child_process";
const local = process.argv.includes("--local"),
  config = local ? "wrangler.test.jsonc" : "wrangler.jsonc",
  bucket = local ? "gaze-studio-test" : "cogix-gaze-studio";
const plan = JSON.parse(
  await fs.readFile("artifacts/library/upload-plan.json", "utf8"),
);
const statePath = `artifacts/library/uploaded-${local ? "local" : "remote"}.json`;
const state = JSON.parse(
  await fs.readFile(statePath, "utf8").catch(() => "{}"),
);
const log = await fs.open(
  `artifacts/library/upload-${local ? "local" : "remote"}.log`,
  "a",
);
async function wrangler(args) {
  await new Promise((resolve, reject) => {
    const p = spawn("npx", ["wrangler", ...args, "--config", config], {
      stdio: ["ignore", log.fd, log.fd],
    });
    p.on("error", reject);
    p.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(Error(`Wrangler exited ${code}; see upload log`)),
    );
  });
}
try {
  for (const dataset of plan.datasets)
    for (const a of dataset.assets) {
      if (local && !a.public) continue;
      if (state[a.key] === a.sha256) continue;
      console.log("Storing", a.key, `${(a.bytes / 1048576).toFixed(2)} MiB`);
      await wrangler([
        "r2",
        "object",
        "put",
        `${bucket}/${a.key}`,
        "--file",
        a.file,
        "--content-type",
        a.mime,
        local ? "--local" : "--remote",
      ]);
      state[a.key] = a.sha256;
      await fs.writeFile(statePath, JSON.stringify(state, null, 2));
    }
  const q = (s) =>
    s == null ? "NULL" : `'${String(s).replaceAll("'", "''")}'`;
  let sql = "";
  for (const d of plan.datasets) {
    sql += `INSERT INTO datasets VALUES(${[d.id, d.title, d.description, d.sourceUrl, d.license, d.revision, d.manifestKey].map(q).join(",")},${+d.public},${plan.created}) ON CONFLICT(id) DO UPDATE SET title=excluded.title,description=excluded.description,license=excluded.license,revision=excluded.revision,manifest_key=excluded.manifest_key,public=excluded.public;\n`;
    for (const a of d.assets)
      sql += `INSERT INTO dataset_assets VALUES(${[d.id, a.path, a.key, a.sha256].map(q).join(",")},${a.bytes},${[a.mime, a.role].map(q).join(",")},${+a.public}) ON CONFLICT(dataset,path) DO UPDATE SET sha256=excluded.sha256,bytes=excluded.bytes,mime=excluded.mime,public=excluded.public;\n`;
  }
  const sqlPath = "artifacts/library/catalog.sql";
  await fs.writeFile(sqlPath, sql);
  await wrangler([
    "d1",
    "migrations",
    "apply",
    "gaze-studio",
    local ? "--local" : "--remote",
  ]);
  await wrangler([
    "d1",
    "execute",
    "gaze-studio",
    local ? "--local" : "--remote",
    "--file",
    sqlPath,
  ]);
  const manifest = {
    ...plan,
    datasets: plan.datasets.map((d) => ({
      ...d,
      assets: d.assets.map(({ file, ...a }) => a),
    })),
  };
  await fs.writeFile(
    "artifacts/library/catalog.json",
    JSON.stringify(manifest, null, 2),
  );
  if (!local)
    await wrangler([
      "r2",
      "object",
      "put",
      `${bucket}/catalog/v1/library.json`,
      "--file",
      "artifacts/library/catalog.json",
      "--content-type",
      "application/json",
      "--remote",
    ]);
  console.log("Catalog deployed:", plan.datasets.length, "datasets");
} finally {
  await log.close();
}
