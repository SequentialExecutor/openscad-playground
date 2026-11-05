import { analyzeStl, MeshAnalysis } from "./mesh-analysis";
export const MAX_MESH_TRIANGLES = 100000;
export const MAX_MESH_BYTES = 84 + MAX_MESH_TRIANGLES * 50;
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
export const MAX_PROJECT_MESH_BYTES = 20 * 1024 * 1024;
export const unitScale = {
  um: 0.001,
  mm: 1,
  cm: 10,
  m: 1000,
  in: 25.4,
  ft: 304.8,
} as const;
export type MeshUnit = keyof typeof unitScale;
export type MeshFormat = "stl" | "obj" | "3mf" | "glb" | "gltf";
export interface MeshAsset {
  id: string;
  format: MeshFormat;
  units: MeshUnit;
  data: string;
  warnings: string[];
}
export interface MeshInfo {
  data: ArrayBuffer;
  report: MeshAnalysis;
}
const cache = new Map<string, MeshInfo>();
export function toBase64(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data);
  let text = "";
  for (let i = 0; i < bytes.length; i += 32768)
    text += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(text);
}
export function fromBase64(text: string, limit = MAX_MESH_BYTES): ArrayBuffer {
  if (
    typeof text !== "string" ||
    text.length > Math.ceil(limit / 3) * 4 ||
    !text.length ||
    text.length % 4 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(text)
  )
    throw Error("Invalid or oversized mesh data.");
  const raw = atob(text);
  if (raw.length > limit) throw Error("Mesh data exceeds its size limit.");
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes.buffer;
}
export function meshInfo(asset: MeshAsset): MeshInfo {
  let value = cache.get(asset.data);
  if (value) return value;
  const data = fromBase64(asset.data),
    view = new DataView(data);
  if (data.byteLength < 84 || view.getUint32(80, true) > MAX_MESH_TRIANGLES)
    throw Error("Mesh exceeds 100,000 triangles or is malformed.");
  const report = analyzeStl(data);
  if (
    report.invalidTriangles ||
    report.bounds.min.some((n) => Math.abs(n) > 1e6) ||
    report.bounds.max.some((n) => Math.abs(n) > 1e6)
  )
    throw Error("Mesh coordinates must be finite and within ±1,000,000 mm.");
  value = { data, report };
  cache.set(asset.data, value);
  while (
    cache.size > 32 ||
    [...cache.values()].reduce((n, v) => n + v.data.byteLength, 0) >
      MAX_PROJECT_MESH_BYTES
  )
    cache.delete(cache.keys().next().value!);
  return value;
}
export function validateMeshAsset(a: MeshAsset): MeshAsset {
  if (
    !a ||
    typeof a.id !== "string" ||
    !/^[a-f0-9]{64}$/.test(a.id) ||
    !["stl", "obj", "3mf", "glb", "gltf"].includes(a.format) ||
    !Object.hasOwn(unitScale, a.units) ||
    !Array.isArray(a.warnings) ||
    a.warnings.length > 20 ||
    a.warnings.some((w) => typeof w !== "string" || w.length > 400)
  )
    throw Error("Invalid mesh asset metadata.");
  meshInfo(a);
  return {
    id: a.id,
    format: a.format,
    units: a.units,
    data: a.data,
    warnings: [...a.warnings],
  };
}
export async function meshDigest(data: ArrayBuffer): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", data))]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}
export function meshSources(source: string, assets: MeshAsset[]) {
  return assets
    .filter((a) => source.includes(`import("meshes/${a.id}.stl"`))
    .map((a) => ({
      path: `/meshes/${a.id}.stl`,
      url: `data:application/sla;base64,${a.data}`,
    }));
}

export async function verifyMeshAssets(assets: MeshAsset[]): Promise<void> {
  for (const asset of assets)
    if ((await meshDigest(meshInfo(asset).data)) !== asset.id)
      throw Error("Mesh integrity check failed.");
}
