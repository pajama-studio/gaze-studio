/// <reference types="@cloudflare/workers-types" />
interface Env {
  DB: D1Database;
  DATA: R2Bucket;
  AI: Ai;
  ASSETS: Fetcher;
  CLOUD_ENABLED: string;
  MAX_OBJECT_BYTES: string;
  AI_DAILY_LIMIT: string;
}
const json = (body: unknown, status = 200, headers: HeadersInit = {}) =>
  Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
const fail = (message: string, status = 400): never => {
  throw Object.assign(new Error(message), { status });
};
const hash = async (s: string) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)),
    ),
  ]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
async function quota(env: Env, key: string, amount: number, limit: number) {
  const r = await env.DB.prepare(
    "INSERT INTO quotas(key,used) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET used=used+excluded.used WHERE used+excluded.used<=? RETURNING used",
  )
    .bind(key, amount, limit)
    .first();
  if (!r)
    fail(
      "This deployment has reached its usage limit. Local replay and analysis remain available.",
      429,
    );
}
async function identity(request: Request, env: Env) {
  const token = request.headers
    .get("Cookie")
    ?.match(/(?:^|;\s*)gaze_session=([a-f0-9]{64})(?:;|$)/)?.[1];
  if (!token) return null;
  return env.DB.prepare("SELECT id FROM sessions WHERE token_hash=?")
    .bind(await hash(token))
    .first<{ id: string }>();
}
async function bodyBytes(request: Request, maximum: number) {
  const length = Number(request.headers.get("Content-Length"));
  if (length > maximum) fail("Request is too large.", 413);
  if (!request.body) fail("Request body required.");
  const reader = request.body!.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maximum) {
      await reader.cancel();
      fail("Request is too large.", 413);
    }
    chunks.push(value);
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    result.set(c, offset);
    offset += c.length;
  }
  return result;
}
async function serveObject(
  request: Request,
  env: Env,
  key: string,
  publicExample = false,
): Promise<Response> {
  const head = await env.DATA.head(key);
  if (!head) fail("Object not found.", 404);
  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Cache-Control": publicExample
      ? "public, max-age=3600"
      : "private, max-age=0",
    ETag: head!.httpEtag,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
  });
  head!.writeHttpMetadata(headers);
  if (
    request.headers.get("If-None-Match") === head!.httpEtag &&
    !request.headers.has("Range")
  )
    return new Response(null, { status: 304, headers });
  let range: { offset: number; length: number } | undefined;
  const rangeHeader = request.headers.get("Range");
  if (
    rangeHeader &&
    (!request.headers.get("If-Range") ||
      request.headers.get("If-Range") === head!.httpEtag)
  ) {
    const r = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);
    if (!r || (!r[1] && !r[2]))
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${head!.size}` },
      });
    const offset = r[1] ? Number(r[1]) : Math.max(0, head!.size - Number(r[2]));
    const end =
      r[1] && r[2] ? Math.min(head!.size - 1, Number(r[2])) : head!.size - 1;
    if (offset >= head!.size || end < offset)
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${head!.size}` },
      });
    range = { offset, length: end - offset + 1 };
    headers.set("Content-Range", `bytes ${offset}-${end}/${head!.size}`);
  }
  headers.set("Content-Length", String(range?.length ?? head!.size));
  if (request.method === "HEAD")
    return new Response(null, { status: range ? 206 : 200, headers });
  const object = await env.DATA.get(key, range ? { range } : undefined);
  return new Response(object!.body, { status: range ? 206 : 200, headers });
}
async function handler(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url),
    path = url.pathname;
  if (!path.startsWith("/api/")) return env.ASSETS.fetch(request);
  if (path === "/api/health")
    return json({
      service: "gaze-studio",
      version: "0.1.0",
      storage: env.CLOUD_ENABLED === "true",
      ai: Boolean(env.AI),
      maxObjectBytes: Number(env.MAX_OBJECT_BYTES),
      aiModel: "@cf/facebook/detr-resnet-50",
    });
  if (
    path === "/api/examples/gazemining" &&
    ["GET", "HEAD"].includes(request.method)
  )
    return serveObject(request, env, "examples/gazemining-amazon.webm", true);
  if (env.CLOUD_ENABLED !== "true")
    fail("Cloud storage is not configured. Local tools are ready to use.", 503);
  if (!["GET", "HEAD"].includes(request.method)) {
    if (
      request.headers.get("Origin") &&
      request.headers.get("Origin") !== url.origin
    )
      fail("Cross-origin writes are not allowed.", 403);
    if (request.headers.get("X-Gaze-Studio") !== "1")
      fail("Missing request header.", 403);
  }
  let session = await identity(request, env);
  if (path === "/api/session" && request.method === "POST") {
    if (session) return json({ ready: true });
    await quota(
      env,
      `sessions:${new Date().toISOString().slice(0, 10)}`,
      1,
      100,
    );
    const token = [...crypto.getRandomValues(new Uint8Array(32))]
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("");
    const id = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO sessions VALUES(?,?,?)")
      .bind(id, await hash(token), Date.now())
      .run();
    return json({ ready: true }, 201, {
      "Set-Cookie": `gaze_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000${url.protocol === "https:" ? "; Secure" : ""}`,
    });
  }
  if (!session) fail("Connect this browser to a cloud workspace first.", 401);
  const owner = session!.id;
  if (path === "/api/recordings" && request.method === "GET") {
    const result = await env.DB.prepare(
      "SELECT id,title,description,created,bytes FROM recordings WHERE owner=? ORDER BY created DESC",
    )
      .bind(owner)
      .all();
    return json(result.results);
  }
  if (path === "/api/recordings" && request.method === "POST") {
    const input = JSON.parse(
      new TextDecoder().decode(await bodyBytes(request, 1024 * 1024)),
    );
    if (
      typeof input.title !== "string" ||
      input.title.length > 200 ||
      typeof input.manifest !== "object"
    )
      fail("Invalid recording metadata.");
    const count = await env.DB.prepare(
      "SELECT count(*) AS n FROM recordings WHERE owner=?",
    )
      .bind(owner)
      .first<{ n: number }>();
    if (count!.n >= 10)
      fail(
        "This workspace supports 10 cloud recordings. Delete a recording to free a slot.",
        429,
      );
    const id = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO recordings(id,owner,title,description,manifest,created) VALUES(?,?,?,?,?,?)",
    )
      .bind(
        id,
        owner,
        input.title,
        String(input.description ?? "").slice(0, 2000),
        JSON.stringify(input.manifest),
        Date.now(),
      )
      .run();
    return json({ id }, 201);
  }
  if (path === "/api/detect" && request.method === "POST") {
    if (!env.AI)
      fail(
        "Workers AI is not configured on this deployment. Manual and recorded-DOM AOIs remain available.",
        503,
      );
    const bytes = await bodyBytes(request, 1024 * 1024);
    if (
      !["image/jpeg", "image/png"].includes(
        request.headers.get("Content-Type") ?? "",
      )
    )
      fail("Send a JPEG or PNG frame.");
    await quota(
      env,
      `ai:${new Date().toISOString().slice(0, 10)}`,
      1,
      Number(env.AI_DAILY_LIMIT),
    );
    const model = "@cf/facebook/detr-resnet-50";
    const result = await env.AI.run(model, { image: [...bytes] });
    const id = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO detections VALUES(?,?,?,?,?)")
      .bind(id, owner, model, Date.now(), JSON.stringify(result))
      .run();
    return json({ id, model, detections: result });
  }
  const match = path.match(
    /^\/api\/recordings\/([a-f0-9-]+)(?:\/objects\/([a-z0-9._-]+))?$/,
  );
  if (!match) fail("Route not found.", 404);
  const [, id, name] = match!;
  const record = await env.DB.prepare(
    "SELECT * FROM recordings WHERE id=? AND owner=?",
  )
    .bind(id, owner)
    .first<{ manifest: string }>();
  if (!record) fail("Recording not found.", 404);
  if (!name && request.method === "GET")
    return json(JSON.parse(record!.manifest));
  if (!name && request.method === "DELETE") {
    const objects = await env.DB.prepare(
      "SELECT name FROM objects WHERE recording=?",
    )
      .bind(id)
      .all<{ name: string }>();
    await env.DATA.delete(objects.results.map((o) => `${id}/${o.name}`));
    await env.DB.batch([
      env.DB.prepare("DELETE FROM objects WHERE recording=?").bind(id),
      env.DB.prepare("DELETE FROM recordings WHERE id=? AND owner=?").bind(
        id,
        owner,
      ),
    ]);
    return json({ deleted: true });
  }
  if (!name) fail("Method not allowed.", 405);
  const key = `${id}/${name}`;
  if (request.method === "PUT") {
    if (
      ![
        "media",
        "gaze.csv",
        "aois.json",
        "analysis.json",
        "frames.json",
      ].includes(name) &&
      !/^raw-\d$/.test(name)
    )
      fail("Unsupported object name.");
    if (
      name === "media" &&
      ![
        "video/mp4",
        "video/webm",
        "image/png",
        "image/jpeg",
        "image/svg+xml",
      ].includes(request.headers.get("Content-Type") ?? "")
    )
      fail("Unsupported media content type.");
    const length = Number(request.headers.get("Content-Length"));
    if (
      !Number.isSafeInteger(length) ||
      length <= 0 ||
      length > Number(env.MAX_OBJECT_BYTES)
    )
      fail("Upload needs a known size of at most 100 MiB.", 413);
    if (
      await env.DB.prepare(
        "SELECT name FROM objects WHERE recording=? AND name=?",
      )
        .bind(id, name)
        .first()
    )
      fail("Objects are immutable. Save a new recording revision.", 409);
    await quota(env, "storage-uploaded-bytes", length, 1024 * 1024 * 1024);
    const stream = new FixedLengthStream(length);
    await Promise.all([
      request.body!.pipeTo(stream.writable),
      env.DATA.put(key, stream.readable, {
        httpMetadata: {
          contentType:
            name === "media"
              ? (request.headers.get("Content-Type") ??
                "application/octet-stream")
              : name.startsWith("raw-")
                ? "application/octet-stream"
                : name.endsWith(".json")
                  ? "application/json"
                  : "text/csv",
        },
      }),
    ]);
    await env.DB.batch([
      env.DB.prepare("INSERT INTO objects VALUES(?,?,?)").bind(
        id,
        name,
        length,
      ),
      env.DB.prepare("UPDATE recordings SET bytes=bytes+? WHERE id=?").bind(
        length,
        id,
      ),
    ]);
    return json({ stored: true, bytes: length }, 201);
  }
  if (request.method === "GET" || request.method === "HEAD")
    return serveObject(request, env, key);
  fail("Method not allowed.", 405);
}
export default {
  async fetch(request: Request, env: Env) {
    try {
      return await handler(request, env);
    } catch (error) {
      const e = error as Error & { status?: number };
      if (!e.status) console.error(e);
      return json(
        {
          error: e.status
            ? e.message
            : "Cloud request failed. Retry or continue locally.",
        },
        e.status ?? 500,
      );
    }
  },
} satisfies ExportedHandler<Env>;
