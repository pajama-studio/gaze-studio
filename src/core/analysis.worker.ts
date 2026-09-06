import { analyze } from "./analysis";
self.onmessage = ({ data }) => {
  try {
    self.postMessage({
      id: data.id,
      result: analyze(data.recording, data.settings),
    });
  } catch (e) {
    self.postMessage({ id: data.id, error: String(e) });
  }
};
