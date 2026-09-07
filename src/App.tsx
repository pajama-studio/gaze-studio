import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
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
  Redo2,
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
import type { AOI, Recording, Settings } from "./core/types";
import { DEFAULT_SETTINGS } from "./core/types";
import { useGazeAnalysis } from "@pajama-studio/gaze-react";
import { ClockedReplay as Player } from "@pajama-studio/gaze-react";
import { PlaybackClock } from "@pajama-studio/gaze-core";
import { EyeVideoImport } from "./components/EyeVideoImport";
const ImportDialog = lazy(() =>
  import("./components/ImportDialog").then((m) => ({
    default: m.ImportDialog,
  })),
);
import { AnalysisView, Metrics } from "./components/AnalysisView";
const BenchmarkView = lazy(() =>
  import("./components/BenchmarkView").then((m) => ({
    default: m.BenchmarkView,
  })),
);
import { ReplayWorkflow } from "./components/ReplayWorkflow";
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
import { DATASETS } from "./core/catalog";
import { validateAnchors } from "./core/time";
import { hasRecordedDOM, recordedAOIs, replaySettings } from "./core/replay";
import { isAutomaticAOI } from "./core/aoi";
type Tab = "replay" | "analysis" | "benchmark" | "datasets";
// Only used while loading or when the workspace is empty. Never a demo recording.
const EMPTY_RECORDING: Recording = {
  id: "",
  title: "",
  description: "",
  width: 1,
  height: 1,
  duration: 1,
  mediaUrl: "",
  mediaName: "",
  mediaType: "image",
  samples: [],
  aois: [],
  anchors: [{ gaze: 0, media: 0 }],
  source: { license: "", synthetic: false },
};
export function App() {
  const [recordings, setRecordings] = useState<Recording[]>([]),
    [active, setActive] = useState(""),
    [tab, setTab] = useState<Tab>("replay"),
    [panel, setPanel] = useState<"aoi" | "sync" | "details">("aoi");
  const clock = useMemo(() => new PlaybackClock(), []);
  const setTime = clock.setTime;
  const [playing, setPlaying] = useState(false),
    [importing, setImporting] = useState(false),
    [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS),
    [selected, setSelected] = useState<string | null>(null);
  const [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [annotating, setAnnotating] = useState(false),
    [query, setQuery] = useState(""),
    [cloudRecords, setCloudRecords] = useState<
      { id: string; title: string; bytes: number }[]
    >([]),
    [mobileMenu, setMobileMenu] = useState(false),
    [cloudOpen, setCloudOpen] = useState(false),
    [exportOpen, setExportOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null),
    hydrated = useRef(false),
    undo = useRef<AOI[][]>([]),
    redo = useRef<AOI[][]>([]),
    detectionAbort = useRef<AbortController | null>(null),
    activeRef = useRef(active);
  const recording =
    recordings.find((r) => r.id === active) ?? recordings[0] ?? EMPTY_RECORDING;
  const {
    result,
    execution,
    error: analysisError,
  } = useGazeAnalysis(recording, settings);
  useEffect(() => {
    if (analysisError) setError(analysisError);
  }, [analysisError]);
  const aoi = recording.aois.find((a) => a.id === selected);
  const participants = useMemo(
    () => [...new Set(recording.samples.map((s) => s.participant))],
    [recording.samples],
  );
  const [anchorsText, setAnchorsText] = useState("0, 0");
  const [localSaveState, setLocalSaveState] = useState("");
  const saveSequence = useRef(0);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const preferred = localStorage.getItem("gaze-studio-active");
      const example = async (url: string): Promise<Recording | null> => {
        try {
          const response = await fetch(url);
          if (
            !response.ok ||
            !response.headers.get("content-type")?.includes("json")
          )
            return null;
          const value = (await response.json()) as Recording;
          validateRecording(value);
          return value;
        } catch {
          return null;
        }
      };
      const [saved, demo, binocular] = await Promise.all([
        loadLocal().catch(() => [] as Recording[]),
        example("/datasets/gazemining.json"),
        example("/api/datasets/emotion-p01-0a/recording"),
      ]);
      const local = saved
        .filter((r) => r.id !== "clock-fixture")
        .map((r) =>
          r.id === "emotion-p01-0a"
            ? ({
                ...r,
                videoTracks: r.videoTracks?.map((t) => ({
                  ...t,
                  viewRotation:
                    t.viewRotation ?? (t.role === "left-eye" ? 180 : 0),
                })),
              } as Recording)
            : r,
        );
      if (cancelled) return;
      if (demo) validateRecording(demo);
      if (binocular) validateRecording(binocular);
      const all = [
        ...(demo ? [demo] : []),
        ...(binocular ? [binocular] : []),
        ...local,
      ];
      const unique = [...new Map(all.map((r) => [r.id, r])).values()];
      hydrated.current = true;
      setRecordings(unique);
      if (preferred && unique.some((r) => r.id === preferred))
        setActive(preferred);
      else if (binocular) setActive(binocular.id);
      else if (demo) setActive(demo.id);
      else setActive(unique[0]?.id ?? "");
    })().catch((e) => {
      hydrated.current = true;
      setError(String(e));
    });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    activeRef.current = active;
    ++saveSequence.current;
    setLocalSaveState("");
    if (hydrated.current && recordings.some((r) => r.id === active))
      localStorage.setItem("gaze-studio-active", active);
    detectionAbort.current?.abort();
    setPlaying(false);
    setTime(0);
    setSelected(null);
    setSettings(replaySettings(recording));
    undo.current = [];
    redo.current = [];
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
    const sequence = ++saveSequence.current;
    setLocalSaveState("Saving in browser…");
    saveLocal(updated)
      .then(() => {
        if (sequence === saveSequence.current)
          setLocalSaveState("Saved in browser");
      })
      .catch((e) => {
        setLocalSaveState("Local save failed");
        setError(`Local save failed: ${e}`);
      });
  };
  const updateAOIs = (aois: AOI[]) => {
    redo.current = [];
    undo.current.push(structuredClone(recording.aois));
    if (undo.current.length > 30) undo.current.shift();
    update({ ...recording, aois });
  };
  const undoAOI = () => {
    const previous = undo.current.pop();
    if (previous) {
      redo.current.push(structuredClone(recording.aois));
      update({ ...recording, aois: previous });
    }
  };
  const redoAOI = () => {
    const next = redo.current.pop();
    if (next) {
      undo.current.push(structuredClone(recording.aois));
      update({ ...recording, aois: next });
    }
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        (e.ctrlKey || e.metaKey) &&
        e.key.toLowerCase() === "z" &&
        !(e.target as HTMLElement).closest(
          'input,textarea,[contenteditable="true"]',
        )
      ) {
        e.preventDefault();
        if (e.shiftKey) redoAOI();
        else undoAOI();
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [recording]);
  const addRecording = (r: Recording) => {
    setRecordings((items) => [...items.filter((i) => i.id !== r.id), r]);
    saveLocal(r).catch((e) => setError(String(e)));
    setActive(r.id);
    setSettings(replaySettings(r));
    setTime(0);
    setSelected(null);
    undo.current = [];
    redo.current = [];
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
      setAnnotating(true);
      setPlaying(false);
      const id = active,
        start = Math.min(recording.duration - 1, Math.max(0, clock.getTime())),
        count = batch && recording.mediaType === "video" ? 6 : 1;
      const span = Math.min(10e6, recording.duration - start);
      const times = [
        ...new Set(
          Array.from({ length: count }, (_, i) =>
            Math.min(
              recording.duration - 1,
              Math.round(start + (span * i) / count),
            ),
          ),
        ),
      ];
      const controller = new AbortController();
      detectionAbort.current = controller;
      try {
        const proposals = await detectAOIs(
          recording,
          times,
          setNotice,
          controller.signal,
          batch ? start + span : undefined,
        );
        if (activeRef.current !== id) return;
        updateAOIs([
          ...recording.aois.filter(
            (a) =>
              !(
                a.source === "model" &&
                !a.accepted &&
                a.end > start &&
                a.start < start + (batch ? span : 1e6)
              ),
          ),
          ...proposals,
        ]);
        setNotice(
          proposals.length
            ? `${proposals.length} candidate areas found. Review and accept them to include in analysis.`
            : "No objects above 65% confidence. Try another frame or draw an area.",
        );
        setPanel("aoi");
      } finally {
        detectionAbort.current = null;
        setAnnotating(false);
      }
    });
  const findPageRegions = () =>
    run(async () => {
      setAnnotating(true);
      setPlaying(false);
      const id = active,
        controller = new AbortController();
      detectionAbort.current = controller;
      try {
        setNotice("Recovering recorded page regions…");
        const proposals = await recordedAOIs(recording, controller.signal);
        controller.signal.throwIfAborted();
        if (activeRef.current !== id) return;
        updateAOIs([
          ...recording.aois.filter(
            (a) => !a.model?.startsWith("recorded-dom:"),
          ),
          ...proposals,
        ]);
        setPanel("aoi");
        setNotice(
          `${proposals.length} recorded page regions ready. Inspect the candidates, then choose Accept & analyze.`,
        );
      } finally {
        detectionAbort.current = null;
        setAnnotating(false);
      }
    });
  const changeSettings = (next: Settings) => {
    const saved = replaySettings(recording, next);
    setSettings(saved);
    update({ ...recording, analysisSettings: saved });
  };
  const analyzeAutomatic = (accept = false) => {
    const next = replaySettings(recording, {
      ...settings,
      aoiScope: "automatic",
    });
    const aois = recording.aois.map((a) =>
      accept && isAutomaticAOI(a) ? { ...a, accepted: true } : a,
    );
    if (accept) undo.current.push(structuredClone(recording.aois));
    update({ ...recording, aois, analysisSettings: next });
    setSettings(next);
    setPlaying(false);
    setTab("analysis");
    setNotice(
      "Analyzing accepted automatic areas. Use Replay area to inspect the underlying gaze.",
    );
  };
  const openExampleReplay = (sample = "gazemining") =>
    run(async () => {
      const response = await fetch(
        sample === "gazemining"
          ? "/datasets/gazemining.json"
          : `/api/datasets/${sample}/recording`,
      );
      if (!response.ok) throw new Error("Example recording unavailable.");
      const original = (await response.json()) as Recording;
      validateRecording(original);
      if (sample !== "gazemining") {
        addRecording({ ...original, id: crypto.randomUUID() });
        setPanel("aoi");
        setMobileMenu(false);
        setNotice(
          "Real eye cameras and scene video loaded. Auto annotate sends scene frames to the backend for reviewable object AOIs.",
        );
        return;
      }
      const r: Recording = {
        ...original,
        id: crypto.randomUUID(),
        title: "GazeMining · Amazon replay",
        aois: [],
        analysisSettings: replaySettings(original, {
          ...DEFAULT_SETTINGS,
          aoiScope: "automatic",
        }),
      };
      r.aois = await recordedAOIs(r);
      addRecording(r);
      setPanel("aoi");
      setMobileMenu(false);
      setNotice(
        `${r.aois.length} automatic page regions recovered from the original recording. Play the gaze, then Accept & analyze.`,
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
        download(
          await exportPackage({
            ...recording,
            analysisSettings: replaySettings(recording, settings),
          }),
          `${recording.title}.gaze.zip`,
        );
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
  if (!hydrated.current)
    return (
      <main className="initial-loading">
        <Eye size={30} />
        <p>Loading your recordings…</p>
      </main>
    );
  if (!recordings.length)
    return (
      <main className="initial-loading">
        <Eye size={30} />
        <h1>Open a recording</h1>
        <p>
          {error || "Import a video and gaze data, or a portable Gaze Package."}
        </p>
        <button onClick={() => setImporting(true)}>Import recording</button>
        <button onClick={() => location.reload()}>
          Reload public recordings
        </button>
        {importing && (
          <Suspense fallback={<p>Opening import…</p>}>
            <ImportDialog
              close={() => setImporting(false)}
              onImport={addRecording}
            />
          </Suspense>
        )}
      </main>
    );
  return (
    <div className={`app-shell editor-shell tab-${tab}`} data-playing={playing}>
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
            GAZE STUDIO <span>v0.2.0</span>
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
                    {d.replay && (
                      <button
                        className="primary dataset-replay"
                        disabled={busy}
                        onClick={() => openExampleReplay(d.replay)}
                      >
                        <PlaySquare size={16} /> Open replay + auto AOIs
                      </button>
                    )}
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
                          {
                            ...recording,
                            analysisSettings: replaySettings(
                              recording,
                              settings,
                            ),
                          },
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
                      changeSettings({
                        ...settings,
                        participant: e.target.value,
                      })
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
                  <ReplayWorkflow
                    recording={recording}
                    busy={busy}
                    annotating={annotating}
                    onPlay={() => {
                      if (clock.getTime() >= recording.duration - 1000) {
                        setTime(0);
                        if (videoRef.current) videoRef.current.currentTime = 0;
                      }
                      setPlaying(true);
                    }}
                    onAnnotate={() =>
                      hasRecordedDOM(recording)
                        ? findPageRegions()
                        : detect(recording.mediaType === "video")
                    }
                    onAnalyze={() => analyzeAutomatic()}
                    onAccept={() => analyzeAutomatic(true)}
                    onReview={() => {
                      const first = recording.aois.find(
                        (a) => isAutomaticAOI(a) && !a.accepted,
                      );
                      if (!first) return;
                      setPlaying(false);
                      setSelected(first.id);
                      setPanel("aoi");
                      setTime(first.start);
                      if (videoRef.current)
                        videoRef.current.currentTime = first.start / 1e6;
                    }}
                    onCancel={() => {
                      detectionAbort.current?.abort();
                      setNotice("Annotation cancelled.");
                    }}
                  />
                  <div className="replay-grid">
                    <Player
                      recording={recording}
                      clock={clock}
                      playing={playing}
                      setPlaying={setPlaying}
                      participant={settings.participant}
                      selected={selected}
                      onSelect={setSelected}
                      onAOIs={updateAOIs}
                      onVideoTracks={(tracks) =>
                        update({ ...recording, videoTracks: tracks })
                      }
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
                              onClick={undoAOI}
                            >
                              <Undo2 size={16} />
                            </button>
                            <button
                              aria-label="Redo AOI edit"
                              title="Redo · Shift Ctrl/⌘ Z"
                              disabled={!redo.current.length}
                              onClick={redoAOI}
                            >
                              <Redo2 size={14} />
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
                          {hasRecordedDOM(recording) && (
                            <button
                              className="dom-detect"
                              disabled={busy}
                              onClick={findPageRegions}
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
                                  if (
                                    clock.getTime() < a.start ||
                                    clock.getTime() >= a.end
                                  ) {
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
                                  key={aoi.id + ":" + aoi.name}
                                  defaultValue={aoi.name}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter")
                                      e.currentTarget.blur();
                                    if (e.key === "Escape") {
                                      e.currentTarget.value = aoi.name;
                                      e.currentTarget.blur();
                                    }
                                  }}
                                  onBlur={(e) => {
                                    const name = e.target.value.trim();
                                    if (name && name !== aoi.name)
                                      updateAOIs(
                                        recording.aois.map((a) =>
                                          a.id === aoi.id ? { ...a, name } : a,
                                        ),
                                      );
                                    else e.target.value = aoi.name;
                                  }}
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
                      {panel === "sync" && (
                        <div className="inspector-body">
                          <EyeVideoImport
                            recording={recording}
                            onChange={update}
                          />
                        </div>
                      )}
                      {panel === "details" && (
                        <div className="inspector-body">
                          <span className="eyebrow">RECORDING PROVENANCE</span>
                          <h3>Know your source.</h3>
                          <dl className="info-list">
                            <dt>Eye videos</dt>
                            <dd>
                              {recording.videoTracks
                                ?.filter((t) => t.role.endsWith("eye"))
                                .map((t) =>
                                  t.role === "left-eye" ? "Left" : "Right",
                                )
                                .join(" + ") || "Not included in this dataset"}
                            </dd>
                            <dt>Gaze samples</dt>
                            <dd>{recording.samples.length.toLocaleString()}</dd>
                            <dt>Transformation / synchronization</dt>
                            <dd>
                              {recording.source.transform ??
                                "Original imported coordinates"}
                            </dd>
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
                                "User-supplied recording"}
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
                                    ?.id ?? "",
                                );
                              })
                            }
                            disabled={
                              recordings.length <= 1 ||
                              ["gazemining-p1-amazon"].includes(recording.id)
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
                    {localSaveState && (
                      <span role="status" aria-live="polite">
                        {localSaveState}
                      </span>
                    )}
                    <span>
                      <span className="live-dot" />{" "}
                      {execution
                        ? `Rust / WASM · ${execution.workers} worker${execution.workers === 1 ? "" : "s"} · ${execution.elapsedMs.toFixed(0)} ms`
                        : "Analyzing with Rust / WASM…"}
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
                  onSettings={changeSettings}
                  onReplayTime={(t) => {
                    setTab("replay");
                    setTime(t);
                    setPlaying(false);
                  }}
                  onReplayAOI={(id, t) => {
                    setTab("replay");
                    setPanel("aoi");
                    setSelected(id);
                    setTime(Math.min(recording.duration - 1, t));
                    setPlaying(false);
                  }}
                />
              )}
              {tab === "benchmark" && (
                <Suspense
                  fallback={
                    <div className="panel">Loading benchmark tools…</div>
                  }
                >
                  <BenchmarkView key={recording.id} recording={recording} />
                </Suspense>
              )}
            </>
          )}
          <footer>
            <span>
              PAJAMA STUDIO <span className="divider">/</span> OPEN TO
              DISCOVERY.
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
        <Suspense
          fallback={
            <div className="toast" role="status">
              Loading import tools…
            </div>
          }
        >
          <ImportDialog
            close={() => setImporting(false)}
            onImport={addRecording}
          />
        </Suspense>
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
