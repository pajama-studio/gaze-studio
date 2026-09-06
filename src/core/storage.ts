import type { Recording, Analysis } from "./types";
import { csv, importCSV, inferMapping, table, validateRecording } from "./io";
const openDB = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("gaze-studio", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("recordings", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
export async function saveLocal(recording: Recording) {
  const db = await openDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction("recordings", "readwrite");
    tx.objectStore("recordings").put(recording);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}
export async function loadLocal(): Promise<Recording[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("recordings"),
      r = tx.objectStore("recordings").getAll();
    r.onsuccess = () =>
      resolve(
        r.result.map((recording: Recording) => ({
          ...recording,
          mediaUrl: recording.mediaBlob
            ? URL.createObjectURL(recording.mediaBlob)
            : recording.mediaUrl,
        })),
      );
    r.onerror = () => reject(r.error);
    tx.oncomplete = () => db.close();
  });
}
export async function deleteLocal(id: string) {
  const db = await openDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction("recordings", "readwrite");
    tx.objectStore("recordings").delete(id);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}
export async function api(path: string, options: RequestInit = {}) {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: { "X-Gaze-Studio": "1", ...options.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(
      body?.error ?? `Cloud request failed (${response.status}).`,
    );
  }
  return response;
}
export async function connectCloud() {
  await api("/session", { method: "POST" });
}
export async function saveCloud(
  r: Recording,
  onProgress: (text: string) => void,
  analysis?: Analysis | null,
) {
  await connectCloud();
  const {
    samples,
    aois,
    mediaBlob,
    mediaUrl: _,
    cloudId: __,
    rawFiles,
    ...metadata
  } = r;
  const media = mediaBlob ?? (await fetch(r.mediaUrl).then((r) => r.blob()));
  if (!media) throw new Error("Media is unavailable.");
  if (media.size > 100 * 1024 * 1024)
    throw new Error(
      "This cloud deployment supports media up to 100 MiB per recording.",
    );
  const sources = [...(rawFiles ?? [])];
  if (!sources.length && r.source.rawUrl) {
    const response = await fetch(r.source.rawUrl);
    if (!response.ok) throw new Error("Original raw source is unavailable.");
    sources.push({ name: "original.json.gz", blob: await response.blob() });
  }
  if (sources.length > 10)
    throw new Error("At most 10 raw source attachments per recording.");
  const rawSources = sources.map((source, i) => ({
    name: source.name,
    object: `raw-${i}`,
    type: source.blob.type,
  }));
  const { id } = await api("/recordings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: r.title,
      description: r.description,
      manifest: {
        ...metadata,
        mediaMime: media.type,
        rawSources,
        analysisVersion: analysis?.version,
      },
    }),
  }).then((r) => r.json());
  try {
    const objects: [string, Blob][] = [
      ["media", media],
      ["gaze.csv", new Blob([csv(samples)], { type: "text/csv" })],
      [
        "aois.json",
        new Blob([JSON.stringify(aois)], { type: "application/json" }),
      ],
      ...sources.map((s, i): [string, Blob] => [`raw-${i}`, s.blob]),
    ];
    if (analysis)
      objects.push([
        "analysis.json",
        new Blob([JSON.stringify(analysis)], { type: "application/json" }),
      ]);
    for (const [name, blob] of objects) {
      onProgress(`Uploading ${name}…`);
      await api(`/recordings/${id}/objects/${name}`, {
        method: "PUT",
        headers: { "Content-Type": blob.type },
        body: blob,
      });
    }
  } catch (error) {
    await api(`/recordings/${id}`, { method: "DELETE" }).catch(() => {});
    throw error;
  }
  return id as string;
}
export async function loadCloud(id: string): Promise<Recording> {
  const metadata = await api(`/recordings/${id}`).then((r) => r.json());
  const text = await api(`/recordings/${id}/objects/gaze.csv`).then((r) =>
    r.text(),
  );
  const aois = await api(`/recordings/${id}/objects/aois.json`).then((r) =>
    r.json(),
  );
  const rawFiles = await Promise.all(
    (metadata.rawSources ?? []).map(
      async (s: { name: string; object: string }) => ({
        name: s.name,
        blob: await api(`/recordings/${id}/objects/${s.object}`).then((r) =>
          r.blob(),
        ),
      }),
    ),
  );
  const r = {
    ...metadata,
    id: `cloud-${id}`,
    cloudId: id,
    rawFiles,
    samples: importCSV(
      text,
      inferMapping(table(text), metadata.width, metadata.height),
    ),
    aois,
    mediaUrl: `/api/recordings/${id}/objects/media`,
  };
  validateRecording(r);
  return r;
}
