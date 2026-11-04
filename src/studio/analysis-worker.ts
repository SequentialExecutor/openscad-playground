/// <reference lib="webworker" />
import { analyzeStl, PrintSettings } from "./mesh-analysis";
self.onmessage = (
  event: MessageEvent<{ data: ArrayBuffer; settings: PrintSettings }>,
) => {
  try {
    self.postMessage({
      result: analyzeStl(event.data.data, event.data.settings),
    });
  } catch (e) {
    self.postMessage({ error: String(e) });
  }
};
