import type { MeshAsset } from "./mesh-asset";
import { fromBase64 } from "./mesh-asset";
export interface CodeFile {
  path: string;
  content?: string;
  url?: string;
  meshAssetId?: string;
}
export interface CodeProject {
  entryPath: string;
  files: CodeFile[];
  vars: Record<string, unknown>;
  features: string[];
}
export const MAX_CODE_TEXT = 1024 * 1024;
export function validCodePath(path: unknown): path is string {
  return (
    typeof path === "string" &&
    path.startsWith("/") &&
    path.length <= 400 &&
    !/[\x00-\x1f\\<>]/.test(path) &&
    !path.split("/").some((p) => p === ".." || p === ".")
  );
}
export function scadValue(value: unknown, depth = 0): string {
  if (depth > 12) throw Error("Code parameter nesting exceeds 12 levels.");
  if (value === null) return "undef";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean" || typeof value === "string")
    return JSON.stringify(value);
  if (Array.isArray(value) && value.length <= 10000)
    return `[${value.map((v) => scadValue(v, depth + 1)).join(",")}]`;
  throw Error("Code parameters must be finite SCAD scalar/array values.");
}
export function validateCodeProject(p: CodeProject): CodeProject {
  if (
    !p ||
    !validCodePath(p.entryPath) ||
    !p.entryPath.endsWith(".scad") ||
    !Array.isArray(p.files) ||
    p.files.length < 1 ||
    p.files.length > 64 ||
    !p.vars ||
    typeof p.vars !== "object" ||
    Array.isArray(p.vars) ||
    !Array.isArray(p.features) ||
    p.features.length > 50 ||
    p.features.some(
      (f) => typeof f !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(f),
    )
  )
    throw Error("Invalid or oversized linked SCAD project.");
  const paths = new Set<string>();
  let size = 0;
  const files = p.files.map((f) => {
    if (
      !f ||
      !validCodePath(f.path) ||
      paths.has(f.path) ||
      [f.content, f.url, f.meshAssetId].filter((v) => v !== undefined)
        .length !== 1
    )
      throw Error("Invalid or duplicate linked SCAD source path.");
    paths.add(f.path);
    if (f.content !== undefined) {
      if (typeof f.content !== "string")
        throw Error("Invalid SCAD source text.");
      size += new TextEncoder().encode(f.content).length;
      return { path: f.path, content: f.content };
    }
    if (f.meshAssetId !== undefined) {
      if (!/^[a-f0-9]{64}$/.test(f.meshAssetId))
        throw Error("Invalid linked mesh reference.");
      return { path: f.path, meshAssetId: f.meshAssetId };
    }
    if (
      typeof f.url !== "string" ||
      !/^data:[a-zA-Z0-9.+/-]+;base64,[A-Za-z0-9+/]*={0,2}$/.test(f.url)
    )
      throw Error("Linked source assets must be embedded, not remote URLs.");
    const raw = fromBase64(f.url.split(",")[1], 256 * 1024);
    size += f.url.length;
    return { path: f.path, url: f.url };
  });
  if (
    !paths.has(p.entryPath) ||
    typeof files.find((f) => f.path === p.entryPath)?.content !== "string" ||
    size > MAX_CODE_TEXT
  )
    throw Error(
      "Linked SCAD text/attachments exceed 1 MB, or the entry source is missing.",
    );
  const vars = Object.fromEntries(
    Object.entries(p.vars).map(([key, value]) => {
      if (!/^\$?[A-Za-z_][A-Za-z0-9_]*$/.test(key) || key.length > 100)
        throw Error("Invalid SCAD parameter name.");
      scadValue(value);
      return [key, value];
    }),
  );
  if (JSON.stringify(vars).length > 100000)
    throw Error("Code parameters are too large.");
  return { entryPath: p.entryPath, files, vars, features: [...p.features] };
}
export function codeSources(p: CodeProject, assets: MeshAsset[]) {
  return p.files.map((f) => {
    if (f.meshAssetId) {
      const a = assets.find((a) => a.id === f.meshAssetId);
      if (!a) throw Error("Linked code is missing a mesh asset.");
      return { path: f.path, url: `data:application/sla;base64,${a.data}` };
    }
    return f.content !== undefined
      ? { path: f.path, content: f.content }
      : { path: f.path, url: f.url! };
  });
}
