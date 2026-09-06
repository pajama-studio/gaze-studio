import { useEffect, useRef, useState } from "react";
import {
  Eye,
  Library,
  Upload,
  Cloud,
  Download,
  Plus,
  Check,
  X,
  Trash2,
  Undo2,
  Sparkles,
  Activity,
  FlaskConical,
  PlaySquare,
  ArrowUpRight,
  Code2,
  FolderOpen,
  Search,
  ChevronDown,
  FileJson,
  RefreshCw,
  Link2,
} from "lucide-react";
import type { AOI, Analysis, Recording, Settings } from "./core/types";
import { DEFAULT_SETTINGS } from "./core/types";
import { Player } from "./components/Player";
import { ImportDialog } from "./components/ImportDialog";
import { AnalysisView, Metrics } from "./components/AnalysisView";
import { BenchmarkView } from "./components/BenchmarkView";
import {
  api,
  connectCloud,
  deleteLocal,
  loadCloud,
  loadLocal,
  saveCloud,
  saveLocal,
} from "./core/storage";
import {
  csv,
  download,
  exportBIDS,
  exportPackage,
  importCogixAOIs,
  validateRecording,
} from "./core/io";
import { detectAOIs } from "./core/detection";
import { fixture } from "./core/fixture";
import { DATASETS } from "./core/catalog";
import { validateAnchors } from "./core/time";
import { gazeMiningLayers } from "./core/dom";
import { gunzipSync, strFromU8 } from "fflate";
type Tab = "replay" | "analysis" | "benchmark" | "datasets";
export function App() {
  const [recordings, setRecordings] = useState<Recording[]>([fixture()]),
    [active, setActive] = useState("clock-fixture"),
    [tab, setTab] = useState<Tab>("replay"),
    [panel, setPanel] = useState<"aoi" | "sync" | "details">("aoi");
  const [time, setTime] = useState(0),
    [playing, setPlaying] = useState(false),
    [importing, setImporting] = useState(false),
    [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS),
    [result, setResult] = useState<Analysis | null>(null),
    [selected, setSelected] = useState<string | null>(null);
  const [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [query, setQuery] = useState(""),
    [cloudRecords, setCloudRecords] = useState<
      { id: string; title: string; bytes: number }[]
    >([]),
    [mobileMenu, setMobileMenu] = useState(false),
    [cloudOpen, setCloudOpen] = useState(false),
    [exportOpen, setExportOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null),
    undo = useRef<AOI[][]>([]),
    worker = useRef<Worker | null>(null),
    request = useRef(0),
    detectionAbort = useRef<AbortController | null>(null),
    activeRef = useRef(active);
  const recording = recordings.find((r) => r.id === active) ?? recordings[0];
  const aoi = recording.aois.find((a) => a.id === selected);
  const participants = [
    ...new Set(recording.samples.map((s) => s.participant)),
  ];
  const [anchorsText, setAnchorsText] = useState("0, 0");
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const local = await loadLocal();
      const demoResponse = await fetch("/datasets/gazemining.json");
      const demo =
        demoResponse.ok &&
        demoResponse.headers.get("content-type")?.includes("json")
          ? ((await demoResponse.json()) as Recording)
          : null;
      if (cancelled) return;
      if (demo) validateRecording(demo);
      const all = [fixture(), ...(demo ? [demo] : []), ...local];
      const unique = [...new Map(all.map((r) => [r.id, r])).values()];
      setRecordings(unique);
      if (demo) setActive(demo.id);
    })().catch((e) => setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    const w = new Worker(
      new URL("./core/analysis.worker.ts", import.meta.url),
      { type: "module" },
    );
    worker.current = w;
    w.onmessage = (e) => {
      if (e.data.id !== request.current) return;
      if (e.data.error) setError(e.data.error);
      else setResult(e.data.result);
    };
    return () => w.terminate();
  }, []);
  useEffect(() => {
    const { mediaBlob: _, rawFiles: __, ...serializable } = recording;
    worker.current?.postMessage({
      id: ++request.current,
      recording: serializable,
      settings,
    });
  }, [recording, settings]);
  useEffect(() => {
    activeRef.current = active;
    detectionAbort.current?.abort();
    setPlaying(false);
    setTime(0);
    setSelected(null);
    setSettings({ ...DEFAULT_SETTINGS });
    undo.current = [];
    setAnchorsText(
      recording.anchors
        .map((a) => `${a.gaze / 1e6}, ${a.media / 1e6}`)
        .join("\n"),
    );
  }, [active]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 7000);
    return () => clearTimeout(t);
  }, [notice]);
  const update = (updated: Recording) => {
    validateRecording(updated);
    setRecordings((items) =>
      items.map((r) => (r.id === updated.id ? updated : r)),
    );
    saveLocal(updated).catch((e) => setError(`Local save failed: ${e}`));
  };
  const updateAOIs = (aois: AOI[]) => {
    undo.current.push(structuredClone(recording.aois));
    if (undo.current.length > 30) undo.current.shift();
    update({ ...recording, aois });
  };
  const addRecording = (r: Recording) => {
    setRecordings((items) => [...items.filter((i) => i.id !== r.id), r]);
    saveLocal(r).catch((e) => setError(String(e)));
    setActive(r.id);
    setTab("replay");
    setNotice("Recording added to this browser.");
  };
  const run = async (work: () => Promise<void>) => {
    setError("");
    setBusy(true);
    try {
      await work();
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const detect = (batch: boolean) =>
    run(async () => {
      setPlaying(false);
      const id = active,
        start = Math.max(0, time),
        count = batch && recording.mediaType === "video" ? 6 : 1;
      const span = Math.min(10e6, recording.duration - start - 10000);
      const times = Array.from({ length: count }, (_, i) =>
        Math.round(start + (Math.max(0, span) * i) / Math.max(1, count - 1)),
      );
      const controller = new AbortController();
      detectionAbort.current = controller;
      const proposals = await detectAOIs(
        recording,
        times,
        setNotice,
        controller.signal,
      );
      if (activeRef.current !== id) return;
      updateAOIs([...recording.aois, ...proposals]);
      setNotice(
        proposals.length
          ? `${proposals.length} candidate areas found. Review and accept them to include in analysis.`
          : "No objects above 65% confidence. Try another frame or draw an area.",
      );
    });
  const refreshCloud = async () => {
    await connectCloud();
    setCloudRecords(await api("/recordings").then((r) => r.json()));
    setCloudOpen(true);
  };
  const exportData = (type: "package" | "gaze" | "aoi" | "bids") =>
    run(async () => {
      setExportOpen(false);
      if (type === "package") {
        setNotice("Packaging media, gaze, AOIs and checksums…");
        download(await exportPackage(recording), `${recording.title}.gaze.zip`);
      } else if (type === "gaze")
        download(
          new Blob([csv(recording.samples)], { type: "text/csv" }),
          "gaze.csv",
        );
      else if (type === "aoi")
        download(
          new Blob([JSON.stringify(recording.aois, null, 2)], {
            type: "application/json",
          }),
          "aois.json",
        );
      else
        download(
          exportBIDS({
            ...recording,
            samples: recording.samples.filter(
              (s) =>
                settings.participant === "all" ||
                s.participant === settings.participant,
            ),
          }),
          "bids-draft.zip",
        );
      setNotice("Export ready.");
    });
  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileMenu ? "mobile-open" : ""}`}>
        <a className="brand" href="/">
          <span className="brand-icon">
            <Eye size={22} />
          </span>
          <div>
            gaze<span>studio</span>
          </div>
        </a>
        <button
          className="mobile-menu"
          aria-label="Toggle workspace navigation"
          aria-expanded={mobileMenu}
          onClick={() => setMobileMenu(!mobileMenu)}
        >
          <Library size={17} />
        </button>
        <div className="workspace-label">
          PAJAMA WORKSPACE <span>OPEN SOURCE</span>
        </div>
        <nav>
          <button
            className={tab !== "datasets" ? "nav-item active" : "nav-item"}
            onClick={() => setTab("replay")}
          >
            <Library size={18} /> My recordings <span>{recordings.length}</span>
          </button>
          <button
            className={tab === "datasets" ? "nav-item active" : "nav-item"}
            onClick={() => setTab("datasets")}
          >
            <Search size={18} /> Public datasets <ArrowUpRight size={14} />
          </button>
          <button className="nav-item" onClick={() => run(refreshCloud)}>
            <Cloud size={18} /> Cloud workspace
          </button>
        </nav>
        <div className="sidebar-section">
          <span>RECORDINGS</span>
          <button
            aria-label="Import recording"
            onClick={() => setImporting(true)}
          >
            <Plus size={16} />
          </button>
        </div>
        <div className="recording-list">
          {recordings.map((r) => (
            <button
              key={r.id}
              className={
                r.id === active ? "recording-item selected" : "recording-item"
              }
              onClick={() => {
                setActive(r.id);
                setTab("replay");
              }}
            >
              <span className="recording-symbol">
                <PlaySquare size={19} />
              </span>
              <span>
                <strong>{r.title}</strong>
                <small>
                  {r.source.synthetic
                    ? "Synthetic fixture"
                    : (r.source.format ?? "Imported recording")}{" "}
                  · {(r.duration / 1e6).toFixed(0)} s
                </small>
              </span>
            </button>
          ))}
        </div>
        <button className="sidebar-import" onClick={() => setImporting(true)}>
          <Upload size={17} /> Import recording
        </button>
        <div className="sidebar-bottom">
          <div className="local-badge">
            <span className="live-dot" /> Local analysis. Yours to keep.
          </div>
          <p>Your files stay in this browser until you save them to cloud.</p>
          <a
            href="https://github.com/pajama-studio/gaze-studio"
            target="_blank"
            rel="noreferrer"
          >
            <Code2 size={16} /> Built in the open <ArrowUpRight size={14} />
          </a>
          <small>
            GAZE STUDIO <span>v0.1.0</span>
          </small>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div>
            <span className="breadcrumb">
              Workspace <span>/</span>{" "}
              {tab === "datasets" ? "Discover" : "Recordings"}
            </span>
            <span className="project-tag">RESEARCH PREVIEW</span>
          </div>
          <div className="top-actions">
            <button onClick={() => setImporting(true)}>
              <Plus size={16} /> Import
            </button>
            <a
              className="icon-button"
              href="https://github.com/pajama-studio/gaze-studio"
              aria-label="Source on GitHub"
              target="_blank"
              rel="noreferrer"
            >
              <Code2 size={19} />
            </a>
            <span className="avatar">C</span>
          </div>
        </header>
        <div className="main-content">
          {tab === "datasets" ? (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">THE OPEN GAZE INDEX</span>
                  <h1>More data. Better questions.</h1>
                  <p>
                    Research datasets organized by what they can actually
                    evaluate.
                  </p>
                </div>
              </div>
              <div className="catalog-search">
                <Search size={18} />
                <input
                  aria-label="Search datasets"
                  placeholder="Search datasets, signals, or use cases…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <div className="dataset-grid">
                {DATASETS.filter((d) =>
                  JSON.stringify(d).toLowerCase().includes(query.toLowerCase()),
                ).map((d) => (
                  <article className="dataset-card" key={d.name}>
                    <span className="eyebrow">{d.tag}</span>
                    <h2>{d.name}</h2>
                    <p>{d.content}</p>
                    <div className="dataset-signal">{d.input}</div>
                    <dl>
                      <dt>Good for</dt>
                      <dd>{d.use}</dd>
                      <dt>Access</dt>
                      <dd>{d.access}</dd>
                      <dt>Rights</dt>
                      <dd>{d.license}</dd>
                    </dl>
                    <a href={d.url} target="_blank" rel="noreferrer">
                      Source & download <ArrowUpRight size={16} />
                    </a>
                  </article>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">
                    {recording.source.synthetic
                      ? "SYNTHETIC TEST RECORDING"
                      : "ATTENTION, IN CONTEXT"}
                  </span>
                  <h1>{recording.title}</h1>
                  <p>{recording.description}</p>
                </div>
                <div className="heading-actions">
                  <button
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        const id = await saveCloud(
                          recording,
                          setNotice,
                          result,
                        );
                        update({ ...recording, cloudId: id });
                        setNotice(
                          "Saved to your private cloud workspace. Keep this browser session or export a portable backup.",
                        );
                      })
                    }
                  >
                    <Cloud size={16} /> Save to cloud
                  </button>
                  <div className="menu-anchor">
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() => setExportOpen(!exportOpen)}
                    >
                      <Download size={16} /> Export <ChevronDown size={14} />
                    </button>
                    {exportOpen && (
                      <div className="dropdown">
                        {(
                          [
                            ["package", "Portable Gaze Package"],
                            ["gaze", "Canonical gaze CSV"],
                            ["aoi", "AOI annotations JSON"],
                            ["bids", "BIDS draft (one participant)"],
                          ] as const
                        ).map(([type, label]) => (
                          <button key={type} onClick={() => exportData(type)}>
                            {label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="tabbar">
                <div>
                  {(
                    [
                      ["replay", PlaySquare, "Replay"],
                      ["analysis", Activity, "Analysis"],
                      ["benchmark", FlaskConical, "Benchmark"],
                    ] as const
                  ).map(([value, Icon, label]) => (
                    <button
                      key={value}
                      className={tab === value ? "active" : ""}
                      onClick={() => {
                        setTab(value);
                        setPlaying(false);
                      }}
                    >
                      <Icon size={17} />
                      {label}
                    </button>
                  ))}
                </div>
                <label className="participant-select">
                  <span className="live-dot" />
                  <select
                    aria-label="Participant"
                    value={settings.participant}
                    onChange={(e) =>
                      setSettings({ ...settings, participant: e.target.value })
                    }
                  >
                    <option value="all">
                      All participants ({participants.length})
                    </option>
                    {participants.map((p) => (
                      <option key={p}>{p}</option>
                    ))}
                  </select>
                </label>
              </div>
              {tab === "replay" && (
                <>
                  <div className="replay-grid">
                    <Player
                      recording={recording}
                      time={time}
                      setTime={setTime}
                      playing={playing}
                      setPlaying={setPlaying}
                      participant={settings.participant}
                      selected={selected}
                      onSelect={setSelected}
                      onAOIs={updateAOIs}
                      analysis={result}
                      videoRef={videoRef}
                    />
                    <aside className="inspector">
                      <div className="inspector-tabs">
                        {(["aoi", "sync", "details"] as const).map((p) => (
                          <button
                            className={panel === p ? "active" : ""}
                            key={p}
                            onClick={() => setPanel(p)}
                          >
                            {p === "aoi"
                              ? "Areas of interest"
                              : p === "sync"
                                ? "Sync"
                                : "Info"}
                          </button>
                        ))}
                      </div>
                      {panel === "aoi" && (
                        <>
                          <div className="inspector-heading">
                            <h3>
                              Find the focus{" "}
                              <span>{recording.aois.length}</span>
                            </h3>
                            <button
                              aria-label="Undo AOI edit"
                              disabled={!undo.current.length}
                              onClick={() => {
                                const previous = undo.current.pop();
                                if (previous)
                                  update({ ...recording, aois: previous });
                              }}
                            >
                              <Undo2 size={16} />
                            </button>
                          </div>
                          <div className="ai-box">
                            <Sparkles size={18} />
                            <strong>Let AI find the objects.</strong>
                            <p>
                              Detect objects in the scene, then review the
                              suggested areas.
                            </p>
                            <div>
                              <button
                                disabled={busy}
                                onClick={() => detect(false)}
                              >
                                This frame
                              </button>
                              <button
                                disabled={
                                  busy || recording.mediaType === "image"
                                }
                                onClick={() => detect(true)}
                              >
                                Track next 10s
                              </button>
                            </div>
                            <small>
                              Cloudflare AI · up to 6 sampled frames
                            </small>
                          </div>
                          {recording.source.rawUrl && (
                            <button
                              className="dom-detect"
                              disabled={busy}
                              onClick={() =>
                                run(async () => {
                                  const response = await fetch(
                                    recording.source.rawUrl!,
                                  );
                                  if (!response.ok)
                                    throw new Error(
                                      "Raw DOM source unavailable.",
                                    );
                                  const source = JSON.parse(
                                    strFromU8(
                                      gunzipSync(
                                        new Uint8Array(
                                          await response.arrayBuffer(),
                                        ),
                                      ),
                                    ),
                                  );
                                  const proposals = gazeMiningLayers(
                                    source,
                                    recording,
                                  );
                                  updateAOIs([
                                    ...recording.aois.filter(
                                      (a) => !a.id.startsWith("dom-"),
                                    ),
                                    ...proposals,
                                  ]);
                                  setNotice(
                                    `${proposals.length} recorded DOM areas found. Select an area to jump to its visibility interval.`,
                                  );
                                })
                              }
                            >
                              <FileJson size={14} /> Find recorded page regions
                            </button>
                          )}
                          {recording.aois.some((a) => !a.accepted) && (
                            <div className="proposal-actions">
                              <button
                                onClick={() =>
                                  updateAOIs(
                                    recording.aois.map((a) => ({
                                      ...a,
                                      accepted: true,
                                    })),
                                  )
                                }
                              >
                                <Check size={14} /> Accept candidates
                              </button>
                              <button
                                aria-label="Reject all candidates"
                                onClick={() =>
                                  updateAOIs(
                                    recording.aois.filter((a) => a.accepted),
                                  )
                                }
                              >
                                <X size={15} />
                              </button>
                            </div>
                          )}
                          <div className="aoi-list">
                            {recording.aois.map((a) => (
                              <button
                                className={
                                  selected === a.id
                                    ? "aoi-item selected"
                                    : "aoi-item"
                                }
                                key={a.id}
                                onClick={() => {
                                  setSelected(a.id);
                                  if (time < a.start || time >= a.end) {
                                    setPlaying(false);
                                    setTime(a.start);
                                    if (videoRef.current)
                                      videoRef.current.currentTime =
                                        a.start / 1e6;
                                  }
                                }}
                              >
                                <span
                                  className="color-dot"
                                  style={{ background: a.color }}
                                />
                                <span>
                                  <strong>{a.name}</strong>
                                  <small>
                                    {a.accepted
                                      ? a.keyframes.length > 1
                                        ? `${a.keyframes.length} keyframes`
                                        : "Static area"
                                      : a.source === "import"
                                        ? `DOM · ${(a.start / 1e6).toFixed(1)}s`
                                        : `Candidate · ${((a.score ?? 0) * 100).toFixed(0)}%`}
                                  </small>
                                </span>
                                <span className="aoi-dwell">
                                  {(
                                    (result?.aoi.find((m) => m.id === a.id)
                                      ?.dwell ?? 0) / 1e6
                                  ).toFixed(1)}
                                  s
                                </span>
                              </button>
                            ))}
                          </div>
                          {!recording.aois.length && (
                            <div className="empty-aoi">
                              <Plus size={26} />
                              <p>
                                Draw on the video to create your first area.
                              </p>
                            </div>
                          )}
                          {aoi && (
                            <div className="aoi-editor">
                              <label>
                                Area name
                                <input
                                  value={aoi.name}
                                  onChange={(e) =>
                                    updateAOIs(
                                      recording.aois.map((a) =>
                                        a.id === aoi.id
                                          ? { ...a, name: e.target.value }
                                          : a,
                                      ),
                                    )
                                  }
                                />
                              </label>
                              <div className="form-grid">
                                <label>
                                  Visible from (s)
                                  <input
                                    type="number"
                                    step=".1"
                                    min="0"
                                    max={(aoi.end - 1) / 1e6}
                                    value={aoi.start / 1e6}
                                    onChange={(e) => {
                                      const start = Math.round(
                                        +e.target.value * 1e6,
                                      );
                                      if (start < aoi.end && start >= 0)
                                        updateAOIs(
                                          recording.aois.map((a) =>
                                            a.id === aoi.id
                                              ? { ...a, start }
                                              : a,
                                          ),
                                        );
                                    }}
                                  />
                                </label>
                                <label>
                                  Until (s)
                                  <input
                                    type="number"
                                    step=".1"
                                    min={(aoi.start + 1) / 1e6}
                                    max={recording.duration / 1e6}
                                    value={aoi.end / 1e6}
                                    onChange={(e) => {
                                      const end = Math.round(
                                        +e.target.value * 1e6,
                                      );
                                      if (end > aoi.start)
                                        updateAOIs(
                                          recording.aois.map((a) =>
                                            a.id === aoi.id ? { ...a, end } : a,
                                          ),
                                        );
                                    }}
                                  />
                                </label>
                              </div>
                              <div className="aoi-editor-actions">
                                <input
                                  aria-label="AOI color"
                                  type="color"
                                  value={aoi.color}
                                  onChange={(e) =>
                                    updateAOIs(
                                      recording.aois.map((a) =>
                                        a.id === aoi.id
                                          ? { ...a, color: e.target.value }
                                          : a,
                                      ),
                                    )
                                  }
                                />
                                {!aoi.accepted && (
                                  <button
                                    onClick={() =>
                                      updateAOIs(
                                        recording.aois.map((a) =>
                                          a.id === aoi.id
                                            ? { ...a, accepted: true }
                                            : a,
                                        ),
                                      )
                                    }
                                  >
                                    <Check size={14} /> Accept
                                  </button>
                                )}
                                <button
                                  aria-label="Delete selected AOI"
                                  onClick={() => {
                                    updateAOIs(
                                      recording.aois.filter(
                                        (a) => a.id !== aoi.id,
                                      ),
                                    );
                                    setSelected(null);
                                  }}
                                >
                                  <Trash2 size={15} />
                                </button>
                              </div>
                              <p className="hint">
                                Seek, then drag a corner to create a dynamic
                                keyframe. Positions interpolate linearly between
                                keyframes.
                              </p>
                            </div>
                          )}
                          <label className="text-upload">
                            <FileJson size={15} /> Import AOIs
                            <input
                              type="file"
                              accept=".json"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file)
                                  run(async () => {
                                    const aois = importCogixAOIs(
                                      JSON.parse(await file.text()),
                                      recording.duration,
                                      recording.width,
                                      recording.height,
                                    );
                                    updateAOIs([
                                      ...new Map(
                                        [...recording.aois, ...aois].map(
                                          (a) => [a.id, a],
                                        ),
                                      ).values(),
                                    ]);
                                  });
                              }}
                            />
                          </label>
                        </>
                      )}
                      {panel === "sync" && (
                        <div className="inspector-body">
                          <span className="eyebrow">ONE SHARED TIMELINE</span>
                          <h3>Align gaze and video.</h3>
                          <p>
                            Each row links a gaze timestamp to a media
                            timestamp, in seconds. Add two or more anchors to
                            correct clock drift.
                          </p>
                          <label>
                            Gaze seconds, media seconds
                            <textarea
                              rows={7}
                              value={anchorsText}
                              onChange={(e) => setAnchorsText(e.target.value)}
                            />
                          </label>
                          <button
                            className="primary"
                            onClick={() => {
                              try {
                                const anchors = anchorsText
                                  .trim()
                                  .split("\n")
                                  .map((line) => {
                                    const parts = line
                                      .split(",")
                                      .map((v) =>
                                        Math.round(Number(v.trim()) * 1e6),
                                      );
                                    if (parts.length !== 2)
                                      throw new Error(
                                        "Each row requires two times separated by a comma.",
                                      );
                                    return { gaze: parts[0], media: parts[1] };
                                  });
                                validateAnchors(anchors);
                                update({ ...recording, anchors });
                                setNotice("Clock mapping updated.");
                              } catch (e) {
                                setError(String(e));
                              }
                            }}
                          >
                            <Link2 size={15} /> Apply alignment
                          </button>
                          <p className="hint">
                            One anchor applies an offset; multiple anchors use
                            piecewise linear mapping with linear extrapolation.
                            Verify landmarks before interpreting gaze.
                          </p>
                          <label className="dropzone small">
                            <FileJson size={20} />
                            <strong>Import frame clock</strong>
                            <span>JSON: frame_times_us + optional anchors</span>
                            <input
                              type="file"
                              accept=".json"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file)
                                  run(async () => {
                                    const j = JSON.parse(await file.text());
                                    const r = {
                                      ...recording,
                                      frameTimes: Array.isArray(j)
                                        ? j
                                        : j.frame_times_us,
                                      anchors: j.anchors ?? recording.anchors,
                                    };
                                    update(r);
                                    setAnchorsText(
                                      r.anchors
                                        .map(
                                          (a: {
                                            gaze: number;
                                            media: number;
                                          }) =>
                                            `${a.gaze / 1e6}, ${a.media / 1e6}`,
                                        )
                                        .join("\n"),
                                    );
                                    setNotice(
                                      "Frame presentation index imported.",
                                    );
                                  });
                              }}
                            />
                          </label>
                        </div>
                      )}
                      {panel === "details" && (
                        <div className="inspector-body">
                          <span className="eyebrow">RECORDING PROVENANCE</span>
                          <h3>Know your source.</h3>
                          <dl className="info-list">
                            <dt>Gaze samples</dt>
                            <dd>{recording.samples.length.toLocaleString()}</dd>
                            <dt>Coordinates</dt>
                            <dd>Native stimulus pixels, top left</dd>
                            <dt>Time</dt>
                            <dd>Integer microseconds, relative clock</dd>
                            <dt>Source</dt>
                            <dd>{recording.source.format ?? "Gaze Package"}</dd>
                            <dt>License</dt>
                            <dd>{recording.source.license}</dd>
                            <dt>Citation</dt>
                            <dd>
                              {recording.source.citation ??
                                "User-supplied / synthetic fixture"}
                            </dd>
                          </dl>
                          {recording.source.url && (
                            <a
                              href={recording.source.url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Original dataset <ArrowUpRight size={14} />
                            </a>
                          )}
                          <p className="hint">
                            Portable packages retain raw samples,
                            synchronization anchors, frame times, annotations,
                            provenance and file checksums.
                          </p>
                          <button
                            className="danger-text"
                            onClick={() =>
                              run(async () => {
                                await deleteLocal(recording.id);
                                setRecordings((items) =>
                                  items.filter((r) => r.id !== recording.id),
                                );
                                setActive(
                                  recordings.find((r) => r.id !== recording.id)
                                    ?.id ?? "clock-fixture",
                                );
                              })
                            }
                            disabled={
                              recordings.length <= 1 ||
                              [
                                "clock-fixture",
                                "gazemining-p1-amazon",
                              ].includes(recording.id)
                            }
                          >
                            <Trash2 size={15} /> Remove local recording
                          </button>
                        </div>
                      )}
                    </aside>
                  </div>
                  <Metrics result={result} />
                  <div className="under-player">
                    <span>
                      <span className="live-dot" /> Analysis runs in a browser
                      worker
                    </span>
                    <button onClick={() => setTab("analysis")}>
                      Explore the analysis <ArrowUpRight size={15} />
                    </button>
                  </div>
                </>
              )}
              {tab === "analysis" && (
                <AnalysisView
                  recording={recording}
                  result={result}
                  settings={settings}
                  onSettings={setSettings}
                />
              )}
              {tab === "benchmark" && (
                <BenchmarkView key={recording.id} recording={recording} />
              )}
            </>
          )}
          <footer>
            <span>
              PAJAMA STUDIO <span className="divider">/</span> OPEN TO DISCOVERY.
            </span>
            <a
              href="https://github.com/pajama-studio/gaze-studio/blob/main/docs/PLAN.zh-CN.md"
              target="_blank"
              rel="noreferrer"
            >
              Architecture & research ↗
            </a>
          </footer>
        </div>
      </main>
      {notice && (
        <div className="toast" role="status">
          <Check size={17} />
          <span>{notice}</span>
          {busy && detectionAbort.current && (
            <button onClick={() => detectionAbort.current?.abort()}>
              Cancel
            </button>
          )}
        </div>
      )}
      {error && (
        <div className="error-toast" role="alert">
          <span>{error}</span>
          <button aria-label="Dismiss error" onClick={() => setError("")}>
            <X size={17} />
          </button>
        </div>
      )}
      {importing && (
        <ImportDialog
          close={() => setImporting(false)}
          onImport={addRecording}
        />
      )}
      {cloudOpen && (
        <div className="modal-backdrop">
          <section
            className="modal cloud-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Cloud workspace"
          >
            <div className="modal-heading">
              <div>
                <span className="eyebrow">PRIVATE TO THIS BROWSER SESSION</span>
                <h2>Cloud workspace</h2>
              </div>
              <button
                aria-label="Close cloud workspace"
                onClick={() => setCloudOpen(false)}
              >
                <X size={20} />
              </button>
            </div>
            <p className="muted">
              Media and gaze live in Cloudflare R2; the catalog lives in D1.
              Export a Gaze Package to share a recording or keep a portable
              backup.
            </p>
            {cloudRecords.map((r) => (
              <div className="cloud-row" key={r.id}>
                <FolderOpen size={19} />
                <span>
                  <strong>{r.title}</strong>
                  <small>{(r.bytes / 1024 / 1024).toFixed(1)} MiB</small>
                </span>
                <button
                  onClick={() =>
                    run(async () => {
                      addRecording(await loadCloud(r.id));
                      setCloudOpen(false);
                    })
                  }
                >
                  Open
                </button>
                <button
                  aria-label={`Delete cloud recording ${r.title}`}
                  onClick={() =>
                    run(async () => {
                      await api(`/recordings/${r.id}`, { method: "DELETE" });
                      await refreshCloud();
                    })
                  }
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
            {!cloudRecords.length && (
              <div className="empty-inline">
                Your cloud workspace is empty. Open a recording and choose Save
                to cloud.
              </div>
            )}
            <button onClick={() => run(refreshCloud)}>
              <RefreshCw size={15} /> Refresh
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
