import { useEffect, useRef, useState } from "react";
import { AnalysisPool, type AnalysisRun } from "@pajama-studio/gaze-analysis";
import type { Recording, Settings } from "@pajama-studio/gaze-core";
export function useGazeAnalysis(recording: Recording, settings: Settings) {
  const pool = useRef<AnalysisPool | null>(null);
  const [run, setRun] = useState<AnalysisRun | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const p = new AnalysisPool();
    pool.current = p;
    return () => p.dispose();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setRun(null);
    setError("");
    const timer = setTimeout(
      () =>
        pool.current
          ?.analyze(recording, settings, controller.signal)
          .then((value) => {
            if (!controller.signal.aborted) setRun(value);
          })
          .catch((e) => {
            if (e.name !== "AbortError") setError(String(e));
          }),
      40,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [recording, settings]);
  return {
    result: run?.result ?? null,
    execution: run?.execution ?? null,
    error,
    pending: !run && !error,
  };
}
