import {
  MeshAsset,
  verifyMeshAssets,
  meshInfo,
  meshDigest,
  toBase64,
  MAX_MESH_BYTES,
  MAX_PROJECT_MESH_BYTES,
} from "./mesh-asset";
import JSZip from "jszip";
import { Design, validateDesign } from "./document";
const MAX_DOCUMENT = 2 * 1024 * 1024;
const MAX_ARCHIVE = 25 * 1024 * 1024;
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
  const valid = validateDesign(design);
  const project = encoder.encode(
    JSON.stringify({
      ...valid,
      meshAssets: valid.meshAssets.map(({ data, ...metadata }) => metadata),
    }),
  );
  if (project.byteLength > MAX_DOCUMENT)
    throw Error("Project document exceeds 2 MB.");
  const zip = new JSZip();
  zip.file("project.json", project);
  const meshes = [];
  for (const asset of valid.meshAssets) {
    const data = meshInfo(asset).data;
    if ((await meshDigest(data)) !== asset.id)
      throw Error("Mesh integrity check failed.");
    const path = `meshes/${asset.id}.stl`;
    zip.file(path, data, { createFolders: false });
    meshes.push({ id: asset.id, path, sha256: asset.id });
  }
  zip.file(
    "manifest.json",
    JSON.stringify({
      format: "forma3d",
      version: meshes.length ? 2 : 1,
      ...(meshes.length ? { meshes } : {}),
      document: "project.json",
      sha256: await digest(project),
    }),
  );
  const result = new Uint8Array(
    await zip.generateAsync({
      type: "uint8array",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    }),
  );
  if (result.byteLength > MAX_ARCHIVE)
    throw Error("Project archive exceeds 25 MB.");
  return result;
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
  if (data.byteLength > MAX_ARCHIVE) throw Error("Project file exceeds 25 MB.");
  const bytes = new Uint8Array(data);
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    if (bytes.byteLength > MAX_DOCUMENT)
      throw Error("Legacy JSON project exceeds 2 MB.");
    const legacy = validateDesign(JSON.parse(decoder.decode(bytes)));
    await verifyMeshAssets(legacy.meshAssets);
    return legacy;
  }
  const zip = await JSZip.loadAsync(data);
  const entries = Object.values(zip.files);
  if (
    entries.length < 2 ||
    entries.length > 34 ||
    entries.some(
      (entry) =>
        entry.dir ||
        ((entry as JSZip.JSZipObject & { unsafeOriginalName?: string })
          .unsafeOriginalName ?? entry.name) !== entry.name,
    )
  )
    throw Error("Unexpected or unsafe project archive path.");
  const manifest = JSON.parse(
    decoder.decode(
      await readBounded(
        zip.file("manifest.json") ??
          (() => {
            throw Error("Missing manifest.");
          })(),
        16384,
      ),
    ),
  );
  if (
    manifest.format !== "forma3d" ||
    ![1, 2].includes(manifest.version) ||
    manifest.document !== "project.json" ||
    typeof manifest.sha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(manifest.sha256)
  )
    throw Error("Unsupported or invalid Forma3D container.");
  const expected = new Set(["manifest.json", "project.json"]);
  const meshes = manifest.version === 2 ? manifest.meshes : [];
  if (
    !Array.isArray(meshes) ||
    meshes.length > 32 ||
    (manifest.version === 2 && !meshes.length) ||
    (manifest.version === 1 && data.byteLength > 5 * 1024 * 1024)
  )
    throw Error("Invalid or oversized native container.");
  for (const mesh of meshes) {
    if (
      !mesh ||
      typeof mesh.id !== "string" ||
      !/^[a-f0-9]{64}$/.test(mesh.id) ||
      mesh.path !== `meshes/${mesh.id}.stl` ||
      mesh.sha256 !== mesh.id ||
      expected.has(mesh.path)
    )
      throw Error("Invalid or duplicate mesh archive path.");
    expected.add(mesh.path);
  }
  if (
    entries.length !== expected.size ||
    entries.some((e) => !expected.has(e.name))
  )
    throw Error("Unexpected or unsafe project archive path.");
  const project = await readBounded(zip.file("project.json")!, MAX_DOCUMENT);
  if ((await digest(project)) !== manifest.sha256)
    throw Error("Project integrity check failed.");
  const document = JSON.parse(decoder.decode(project));
  if (manifest.version === 2) {
    if (
      ![5, 6].includes(document.version) ||
      !Array.isArray(document.meshAssets) ||
      document.meshAssets.length !== meshes.length
    )
      throw Error("Mesh manifest does not match project.");
    let total = 0;
    const byId = new Map<string, string>();
    for (const mesh of meshes) {
      const bytes = await readBounded(zip.file(mesh.path)!, MAX_MESH_BYTES);
      total += bytes.byteLength;
      if (total > MAX_PROJECT_MESH_BYTES)
        throw Error("Project mesh data exceeds 20 MB.");
      const raw = new Uint8Array(bytes).buffer;
      if ((await meshDigest(raw)) !== mesh.sha256)
        throw Error("Mesh integrity check failed.");
      byId.set(mesh.id, toBase64(raw));
    }
    document.meshAssets = document.meshAssets.map((metadata: any) => {
      if (!metadata || "data" in metadata || !byId.has(metadata.id))
        throw Error("Mesh metadata does not match manifest.");
      return { ...metadata, data: byId.get(metadata.id) };
    });
  }
  const valid = validateDesign(document);
  await verifyMeshAssets(valid.meshAssets);
  return valid;
}
