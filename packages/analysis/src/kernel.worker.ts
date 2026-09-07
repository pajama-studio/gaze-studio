import init, {
  analyze_json,
  merge_json,
  eye_summary_json,
  engine_version,
} from "../wasm/gaze_core.js";
const ready = init();
self.onmessage = async ({ data }) => {
  try {
    await ready;
    const output =
      data.op === "signals"
        ? eye_summary_json(JSON.stringify(data.input))
        : data.op === "merge"
          ? merge_json(JSON.stringify(data.parts))
          : analyze_json(
              JSON.stringify({
                recording: data.recording,
                settings: data.settings,
              }),
            );
    self.postMessage({
      id: data.id,
      value: JSON.parse(output),
      engine: engine_version(),
    });
  } catch (error) {
    self.postMessage({ id: data.id, error: String(error) });
  }
};
