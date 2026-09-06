import { build } from "vite";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, v, i, a) => {
    if (v.startsWith("--")) pairs.push([v.slice(2), a[i + 1]]);
    return pairs;
  }, []),
);
if (
  !args.predictions ||
  !args.reference ||
  !args.protocol ||
  !args.width ||
  !args.height
) {
  console.error(
    "Usage: node scripts/benchmark.mjs --predictions predictions.csv --reference reference.csv --protocol protocol.txt --width 1920 --height 1080 [--tolerance-ms 8] [--out benchmark.json]",
  );
  process.exit(1);
}
await build({
  configFile: false,
  logLevel: "silent",
  build: {
    target: "es2022",
    outDir: "artifacts/cli",
    emptyOutDir: false,
    lib: { entry: "src/core/cli.ts", formats: ["es"], fileName: "core" },
    minify: false,
  },
});
const core = await import(pathToFileURL(path.resolve("artifacts/cli/core.js")));
const load = async (filename) => {
  const text = await fs.readFile(filename, "utf8");
  const rows = core.table(text);
  if (!rows[0].includes("t_us") || !rows[0].includes("participant_id"))
    throw new Error(
      "Use canonical t_us / participant_id CSV columns; no automatic clock origin inference in benchmarks.",
    );
  return core.importCSV(
    text,
    core.inferMapping(rows, Number(args.width), Number(args.height)),
  );
};
const geometry =
  args["screen-width-mm"] && args["screen-height-mm"] && args["distance-mm"]
    ? {
        widthMm: Number(args["screen-width-mm"]),
        heightMm: Number(args["screen-height-mm"]),
        distanceMm: Number(args["distance-mm"]),
      }
    : undefined;
const report = {
  ...core.benchmark(
    await load(args.predictions),
    await load(args.reference),
    Number(args["tolerance-ms"] ?? 8) * 1000,
    Number(args.width),
    Number(args.height),
    geometry,
  ),
  protocol: await fs.readFile(args.protocol, "utf8"),
  dimensions: { width: Number(args.width), height: Number(args.height) },
};
await fs.writeFile(
  args.out ?? "benchmark.json",
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify({
    matched: report.matched,
    meanPixelError: report.pixelError?.mean,
    meanAngularError: report.angularError?.mean,
    coverage: report.predictionMatchRate,
  }),
);
