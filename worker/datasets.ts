interface DatasetEnv {
  DB: D1Database;
  DATA: R2Bucket;
}
type Serve = (
  request: Request,
  env: DatasetEnv,
  key: string,
  publicExample?: boolean,
) => Promise<Response>;
/** Curated catalog writes happen through authenticated deployment tooling. Public reads only expose explicitly published derivatives. */
export async function datasetRoute(
  request: Request,
  env: DatasetEnv,
  serve: Serve,
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (!path.startsWith("/api/datasets")) return null;
  if (!["GET", "HEAD"].includes(request.method))
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  if (path === "/api/datasets") {
    const rows = await env.DB.prepare(
      "SELECT id,title,description,source_url AS sourceUrl,license,revision,manifest_key IS NOT NULL AS replay FROM datasets WHERE public=1 ORDER BY title",
    ).all();
    return Response.json(rows.results, {
      headers: { "Cache-Control": "public, max-age=300" },
    });
  }
  const match = path.match(
    /^\/api\/datasets\/([a-z0-9-]+)(?:\/(recording|assets\/(.+)))?$/,
  );
  if (!match)
    return Response.json({ error: "Dataset not found" }, { status: 404 });
  const row = await env.DB.prepare(
    "SELECT * FROM datasets WHERE id=? AND public=1",
  )
    .bind(match[1])
    .first<{ id: string; manifest_key: string }>();
  if (!row)
    return Response.json({ error: "Dataset not found" }, { status: 404 });
  if (match[2] === "recording") {
    if (!row.manifest_key)
      return Response.json({ error: "No replay available" }, { status: 404 });
    const response = await serve(request, env, row.manifest_key, true);
    response.headers.set("Cache-Control", "public, max-age=0, must-revalidate");
    return response;
  }
  if (match[3]) {
    const asset = await env.DB.prepare(
      "SELECT r2_key FROM dataset_assets WHERE dataset=? AND path=? AND public=1",
    )
      .bind(row.id, match[3])
      .first<{ r2_key: string }>();
    if (!asset)
      return Response.json({ error: "Asset not found" }, { status: 404 });
    return serve(request, env, asset.r2_key, true);
  }
  const assets = await env.DB.prepare(
    "SELECT path,sha256,bytes,mime,role,public FROM dataset_assets WHERE dataset=? ORDER BY role,path",
  )
    .bind(row.id)
    .all();
  const { manifest_key: _, ...metadata } = row;
  return Response.json(
    { ...metadata, assets: assets.results },
    { headers: { "Cache-Control": "public, max-age=300" } },
  );
}
