/// <reference lib="webworker" />
import { stlBounds } from "./bounds";
self.onmessage = (event: MessageEvent<ArrayBuffer>) => {
  try {
    self.postMessage({ result: stlBounds(event.data) });
  } catch (e) {
    self.postMessage({ error: String(e) });
  }
};
