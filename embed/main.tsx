import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { GazeReplay, useGazeAnalysis } from "@pajama-studio/gaze-react";
import { DEFAULT_SETTINGS, type Recording } from "@pajama-studio/gaze-core";
import "@pajama-studio/gaze-react/style.css";
import "./style.css";
function Replay({ initial }: { initial: Recording }) {
  const [recording, setRecording] = useState(initial),
    [time, setTime] = useState(0),
    [playing, setPlaying] = useState(false),
    [selected, onSelect] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const { result, execution, error } = useGazeAnalysis(
    recording,
    DEFAULT_SETTINGS,
  );
  return (
    <>
      <GazeReplay
        recording={recording}
        time={time}
        setTime={setTime}
        playing={playing}
        setPlaying={setPlaying}
        participant="all"
        selected={selected}
        onSelect={onSelect}
        onAOIs={(aois) => setRecording({ ...recording, aois })}
        analysis={result}
        videoRef={videoRef}
      />
      <p role="status">
        {error ||
          (execution
            ? `${result?.fixations.length} fixations · Rust / WASM · ${execution.workers} worker(s)`
            : "Loading analysis…")}
      </p>
    </>
  );
}
function App() {
  const [r, setR] = useState<Recording | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    fetch(
      new URLSearchParams(location.search).get("sample") === "binocular"
        ? "/api/datasets/emotion-p01-0a/recording"
        : "/datasets/gazemining.json",
    )
      .then((r) => {
        if (!r.ok) throw Error("Sample unavailable");
        return r.json();
      })
      .then(setR)
      .catch((e) => setError(String(e)));
  }, []);
  return (
    <main>
      <header>
        <span>PAJAMA STUDIO / COMPONENT LIBRARY</span>
        <h1>Replay, wherever you build.</h1>
        <p>
          This page uses the reusable React controls and Rust analysis package
          without the Studio application.
        </p>
        <a href="/">Open Gaze Studio ↗</a>
      </header>
      {r ? <Replay initial={r} /> : <p>{error || "Loading recording…"}</p>}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
