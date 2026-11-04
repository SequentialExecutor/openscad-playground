import JSZip from "jszip";
import { Design, validateDesign } from "./document";
const MAX_DOCUMENT = 2 * 1024 * 1024;
const MAX_ARCHIVE = 5 * 1024 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
async function digest(data: Uint8Array<ArrayBuffer>): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", data))]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}
/** Format v1: bounded JSON document plus a SHA-256 integrity manifest. */
export async function encodeProject(
  design: Design,
): Promise<Uint8Array<ArrayBuffer>> {
  const project = encoder.encode(JSON.stringify(validateDesign(design)));
  if (project.byteLength > MAX_DOCUMENT)
    throw Error("Project document exceeds 2 MB.");
  const zip = new JSZip();
  zip.file("project.json", project);
  zip.file(
    "manifest.json",
    JSON.stringify({
      format: "forma3d",
      version: 1,
      document: "project.json",
      sha256: await digest(project),
    }),
  );
  return new Uint8Array(
    await zip.generateAsync({
      type: "uint8array",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    }),
  );
}
/** Stream with a hard expanded-size limit; do not inflate all entries for a CRC check first. */
function readBounded(
  entry: JSZip.JSZipObject,
  limit: number,
): Promise<Uint8Array<ArrayBuffer>> {
  return new Promise((resolve, reject) => {
    let size = 0,
      stopped = false;
    const chunks: Uint8Array[] = [];
    // JSZip exposes this public streaming API, but its bundled object type omits it.
    const stream = (
      entry as JSZip.JSZipObject & {
        internalStream(type: "uint8array"): JSZip.JSZipStreamHelper<Uint8Array>;
      }
    ).internalStream("uint8array");
    stream.on("data", (chunk: Uint8Array) => {
      if (stopped) return;
      size += chunk.byteLength;
      if (size > limit) {
        stopped = true;
        stream.pause();
        reject(Error("Expanded project data exceeds its size limit."));
        return;
      }
      chunks.push(chunk);
    });
    stream.on("error", reject);
    stream.on("end", () => {
      if (stopped) return;
      const result = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.byteLength;
      }
      resolve(result);
    });
    stream.resume();
  });
}
export async function decodeProject(data: ArrayBuffer): Promise<Design> {
  if (data.byteLength > MAX_ARCHIVE) throw Error("Project file exceeds 5 MB.");
  const bytes = new Uint8Array(data);
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    if (bytes.byteLength > MAX_DOCUMENT)
      throw Error("Legacy JSON project exceeds 2 MB.");
    return validateDesign(JSON.parse(decoder.decode(bytes)));
  }
  const zip = await JSZip.loadAsync(data);
  const entries = Object.values(zip.files);
  if (
    entries.length !== 2 ||
    entries.some(
      (entry) =>
        entry.dir ||
        !["manifest.json", "project.json"].includes(entry.name) ||
        ((entry as JSZip.JSZipObject & { unsafeOriginalName?: string })
          .unsafeOriginalName ?? entry.name) !== entry.name,
    )
  )
    throw Error("Unexpected or unsafe project archive path.");
  const manifest = JSON.parse(
    decoder.decode(await readBounded(zip.file("manifest.json")!, 4096)),
  );
  if (
    manifest.format !== "forma3d" ||
    manifest.version !== 1 ||
    manifest.document !== "project.json" ||
    typeof manifest.sha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(manifest.sha256)
  )
    throw Error("Unsupported or invalid Forma3D container.");
  const project = await readBounded(zip.file("project.json")!, MAX_DOCUMENT);
  if ((await digest(project)) !== manifest.sha256)
    throw Error("Project integrity check failed.");
  return validateDesign(JSON.parse(decoder.decode(project)));
}
