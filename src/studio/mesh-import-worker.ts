/// <reference lib="webworker" />
import { parseMesh } from "./mesh-import";
self.onmessage = async (e) => {
  try {
    const asset = await parseMesh(e.data.data, e.data.name, e.data.units);
    self.postMessage({ asset });
  } catch (error) {
    self.postMessage({ error: String(error) });
  }
};
