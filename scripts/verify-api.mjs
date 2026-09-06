import assert from "node:assert/strict";
import fs from "node:fs/promises";
const base = process.env.BASE_URL || "http://127.0.0.1:8798";
const writeHeaders = {
  "X-Gaze-Studio": "1",
  "Content-Type": "application/json",
};
const session = async () => {
  const r = await fetch(`${base}/api/session`, {
    method: "POST",
    headers: writeHeaders,
  });
  assert.equal(r.status, 201);
  assert.match(r.headers.get("set-cookie"), /HttpOnly/);
  assert.match(r.headers.get("set-cookie"), /SameSite=Strict/);
  return r.headers.get("set-cookie").split(";")[0];
};
const owner = await session(),
  other = await session(),
  passed = [];
let id;
const call = (path, options = {}, cookie = owner) =>
  fetch(`${base}/api${path}`, {
    ...options,
    headers: { ...writeHeaders, Cookie: cookie, ...options.headers },
  });
try {
  let r = await call("/recordings", {
    method: "POST",
    headers: { Origin: "https://unrelated.invalid" },
    body: "{}",
  });
  assert.equal(r.status, 403);
  passed.push("cross-origin mutation rejection");
  r = await fetch(`${base}/api/recordings`);
  assert.equal(r.status, 401);
  passed.push("unauthenticated catalog rejection");
  r = await call("/recordings", {
    method: "POST",
    body: JSON.stringify({
      title: "API conformance fixture",
      manifest: { title: "API conformance fixture" },
    }),
  });
  assert.equal(r.status, 201);
  id = (await r.json()).id;
  r = await call(`/recordings/${id}`, {}, other);
  assert.equal(r.status, 404);
  passed.push("cross-workspace object isolation");
  const bytes = Buffer.from("0123456789abcdefghij");
  r = await call(`/recordings/${id}/objects/media`, {
    method: "PUT",
    headers: { "Content-Type": "video/webm" },
    body: bytes,
  });
  assert.equal(r.status, 201);
  passed.push("streamed R2 object upload");
  r = await call(`/recordings/${id}/objects/media`, {
    headers: { Range: "bytes=3-8" },
  });
  assert.equal(r.status, 206);
  assert.equal(r.headers.get("Content-Range"), "bytes 3-8/20");
  assert.equal(await r.text(), "345678");
  const etag = r.headers.get("ETag");
  passed.push("HTTP 206 byte-range correctness");
  r = await call(`/recordings/${id}/objects/media`, {
    headers: { Range: "bytes=-4" },
  });
  assert.equal(r.status, 206);
  assert.equal(await r.text(), "ghij");
  passed.push("suffix ranges");
  r = await call(`/recordings/${id}/objects/media`, {
    headers: { Range: "bytes=50-60" },
  });
  assert.equal(r.status, 416);
  passed.push("unsatisfiable range rejection");
  r = await call(`/recordings/${id}/objects/media`, {
    headers: { Range: "bytes=0-1,3-4" },
  });
  assert.equal(r.status, 416);
  passed.push("unsupported multipart-range rejection");
  r = await call(`/recordings/${id}/objects/media`, {
    headers: { "If-None-Match": etag },
  });
  assert.equal(r.status, 304);
  passed.push("ETag validation");
  r = await call(`/recordings/${id}/objects/media`, { method: "HEAD" });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("Content-Length"), "20");
  assert.match(r.headers.get("Content-Security-Policy"), /sandbox/);
  passed.push("HEAD and safe content headers");
  r = await call(`/recordings/${id}/objects/media`, {
    method: "PUT",
    headers: { "Content-Type": "video/webm" },
    body: bytes,
  });
  assert.equal(r.status, 409);
  passed.push("immutable saved revisions");
  r = await call(`/recordings/${id}/objects/raw-0`, {
    method: "PUT",
    headers: { "Content-Type": "application/octet-stream" },
    body: Buffer.from("raw-source"),
  });
  assert.equal(r.status, 201);
  passed.push("raw source retention");
  r = await call(`/recordings/${id}`, { method: "DELETE" });
  assert.equal(r.status, 200);
  r = await call(`/recordings/${id}/objects/media`);
  assert.equal(r.status, 404);
  passed.push("recording and object deletion");
  id = null;
  await fs.mkdir("artifacts/verification", { recursive: true });
  await fs.writeFile(
    "artifacts/verification/api-results.json",
    JSON.stringify(
      { base, checkedAt: new Date().toISOString(), passed },
      null,
      2,
    ),
  );
  console.log(`${passed.length} API checks passed`);
} finally {
  if (id) await call(`/recordings/${id}`, { method: "DELETE" });
}
