import type { State } from "../state/app-state";
import {
  Design,
  generateScad,
  validateDesign,
  createMeshBody,
  blankDesign,
} from "./document";
import {
  CodeProject,
  CodeFile,
  codeSources,
  scadValue,
  validateCodeProject,
  MAX_CODE_TEXT,
  validCodePath,
} from "./code-project";
import { MeshAsset, meshInfo, toBase64 } from "./mesh-asset";
import { importNativeScad, updateNativeFromCode } from "./scad-roundtrip";
export interface WorkspaceCode {
  params: State["params"];
  view?: State["view"];
}
export function codeSignature(code: WorkspaceCode): string {
  return JSON.stringify(code.params);
}
/** OpenSCAD `use` is legal only at top level, even when reached through include.
 * Move reachable local-file declarations to the scene entry, leaving annotated
 * source in place. Files reached through `use` retain their own library scope.
 */
function sceneSources(p: CodeProject, assets: MeshAsset[]) {
  const files = codeSources(p, assets).map((f) => ({ ...f }));
  const byPath = new Map(files.map((f) => [f.path, f]));
  const visited = new Set<string>(),
    uses = new Set<string>();
  const directive =
    /(\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*")|\b(use|include)\s*<([^<>\r\n]+)>[ \t]*;?/g;
  const visit = (path: string) => {
    if (visited.has(path)) return;
    visited.add(path);
    const f = byPath.get(path);
    if (f?.content === undefined) return;
    // A fresh regex per recursion avoids shared lastIndex during replacements.
    f.content = f.content.replace(
      new RegExp(directive.source, "g"),
      (all, ignored, kind, target) => {
        if (ignored || !kind) return all;
        const joined = target.startsWith("/")
          ? target
          : path.slice(0, path.lastIndexOf("/") + 1) + target;
        const parts: string[] = [];
        for (const part of joined.split("/")) {
          if (part === "..") parts.pop();
          else if (part && part !== ".") parts.push(part);
        }
        const candidate = "/" + parts.join("/");
        const resolved = byPath.has(candidate) ? candidate : target;
        if (kind === "include") {
          if (byPath.has(candidate)) visit(candidate);
          return all;
        }
        uses.add(`use <${resolved}>`);
        return `/* ${all.replace(/\*\//g, "* /")} — declared in the generated scene entry */`;
      },
    );
  };
  visit(p.entryPath);
  return { files, uses };
}
export function workspaceCodeForDesign(input: Design): WorkspaceCode {
  const d = validateDesign(input);
  let source = generateScad(d);
  const files = new Map<
    string,
    { path: string; content?: string; url?: string }
  >();
  const features = new Set<string>(),
    uses = new Set<string>();
  const put = (file: { path: string; content?: string; url?: string }) => {
    const previous = files.get(file.path);
    if (previous && JSON.stringify(previous) !== JSON.stringify(file))
      throw Error(
        `Code file conflict at ${file.path}. Keep independent source-backed projects in separate documents.`,
      );
    files.set(file.path, file);
  };
  for (const a of d.meshAssets)
    put({
      path: `/meshes/${a.id}.stl`,
      url: `data:application/sla;base64,${a.data}`,
    });
  for (const b of d.bodies) {
    if (!b.codeProject) continue;
    const p = validateCodeProject(b.codeProject);
    for (const feature of p.features) features.add(feature);
    const scene = sceneSources(p, d.meshAssets);
    for (const declaration of scene.uses) uses.add(declaration);
    for (const file of scene.files) {
      let content = file.content;
      if (file.path === p.entryPath && Object.keys(p.vars).length)
        content +=
          "\n// Applied Code customizer values; edit these assignments to change them.\n" +
          Object.entries(p.vars)
            .map(([key, value]) => `${key}=${scadValue(value)};`)
            .join("\n");
      put(
        content !== undefined
          ? { path: file.path, content }
          : { path: file.path, url: file.url },
      );
    }
    const index = d.bodies.indexOf(b);
    let helper = `forma3d_source_${b.id.replace(/[^a-zA-Z0-9_]/g, "_")}`;
    while (p.files.some((f) => f.content?.includes(helper))) helper += "_";
    source = source
      .split("\n")
      .map((line) =>
        line.startsWith(`module n${index}()`)
          ? line.replace(
              `import("meshes/${b.meshAssetId}.stl",convexity=10);`,
              `${helper}();`,
            )
          : line,
      )
      .join("\n");
    // Includes containing module definitions belong in a module body, rather
    // than the child block of a transform. Preserve the original curve defaults.
    source += `\nmodule ${helper}($fn=0,$fa=12,$fs=2) { include <${p.entryPath}>\n}\n`;
  }
  if (uses.size) source = [...uses].join("\n") + "\n" + source;
  let entry = "/forma3d.scad",
    i = 1;
  while (files.has(entry)) entry = `/forma3d-scene-${i++}.scad`;
  return {
    params: {
      activePath: entry,
      sources: [{ path: entry, content: source }, ...files.values()],
      features: [...features],
      vars: {},
      exportFormat2D: "svg",
      exportFormat3D: "stl",
    },
  };
}
/** Resolve snapshot sources before crossing workspaces; no live remote URLs persist. */
export async function snapshotCode(
  code: WorkspaceCode,
  read: (file: State["params"]["sources"][number]) => Promise<Uint8Array>,
  known: MeshAsset[],
): Promise<{ project: CodeProject; assets: MeshAsset[] }> {
  const assets = [...known],
    files: CodeFile[] = [];
  let text = 0;
  for (const file of code.params.sources) {
    if (!validCodePath(file.path)) throw Error("Invalid code source path.");
    if (file.content !== undefined) {
      text += new TextEncoder().encode(file.content).length;
      files.push({ path: file.path, content: file.content });
    } else {
      const knownAsset = assets.find(
        (a) => file.url === `data:application/sla;base64,${a.data}`,
      );
      if (knownAsset) {
        files.push({ path: file.path, meshAssetId: knownAsset.id });
        continue;
      }
      const bytes = await read(file);
      if (file.path.endsWith(".scad")) {
        const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        text += bytes.length;
        files.push({ path: file.path, content });
      } else if (/\.stl$/i.test(file.path)) {
        const { parseMesh } = await import("./mesh-import");
        const asset = await parseMesh(
          new Uint8Array(bytes).buffer,
          file.path,
          "mm",
        );
        if (!assets.some((a) => a.id === asset.id)) assets.push(asset);
        files.push({ path: file.path, meshAssetId: asset.id });
      } else {
        if (bytes.length > 256 * 1024)
          throw Error(
            "Additional code attachments exceed 256 KB; use native mesh assets for larger STL files.",
          );
        const url = `data:application/octet-stream;base64,${toBase64(new Uint8Array(bytes).buffer)}`;
        text += url.length;
        files.push({ path: file.path, url });
      }
    }
    if (text > MAX_CODE_TEXT)
      throw Error("SCAD source text/attachments exceed 1 MB.");
  }
  const project = validateCodeProject({
    entryPath: code.params.activePath,
    files,
    vars: code.params.vars ?? {},
    features: code.params.features,
  });
  return { project, assets };
}
function sameOtherFiles(a: WorkspaceCode, b: WorkspaceCode): boolean {
  if (a.params.activePath !== b.params.activePath) return false;
  const without = (p: WorkspaceCode) =>
    p.params.sources
      .filter((f) => f.path !== p.params.activePath)
      .sort((x, y) => x.path.localeCompare(y.path));
  return (
    JSON.stringify(without(a)) === JSON.stringify(without(b)) &&
    JSON.stringify(a.params.features) === JSON.stringify(b.params.features)
  );
}
export function nativeCodeRoundTrip(
  base: Design,
  baseline: WorkspaceCode,
  current: WorkspaceCode,
): Design | undefined {
  if (!sameOtherFiles(baseline, current)) return undefined;
  const original = baseline.params.sources.find(
      (f) => f.path === baseline.params.activePath,
    )?.content,
    edited = current.params.sources.find(
      (f) => f.path === current.params.activePath,
    )?.content;
  if (original === undefined || edited === undefined) return undefined;
  if (
    JSON.stringify(current.params.vars ?? {}) !==
    JSON.stringify(baseline.params.vars ?? {})
  )
    return undefined;
  if (original === edited) return validateDesign(base);
  // Only generated standard SCAD modules can be reverse-mapped conservatively.
  if (original !== generateScad(base)) return undefined;
  return updateNativeFromCode(
    base,
    original,
    edited,
    current.params.vars ?? {},
  );
}
/** Render current source directly, never reuse a possibly stale Code preview. */
export async function renderCodeSnapshot(
  project: CodeProject,
  assets: MeshAsset[],
  signal: AbortSignal,
): Promise<ArrayBuffer> {
  const { renderIsolated } = await import("../runner/actions");
  if (signal.aborted) throw Error("Workspace switch canceled.");
  const task = renderIsolated({
    scadPath: project.entryPath,
    sources: codeSources(project, assets),
    vars: project.vars,
    features: project.features,
    isPreview: false,
    mountArchives: true,
    renderFormat: "stl",
    streamsCallback: () => {},
  })({ now: true });
  let timer: ReturnType<typeof setTimeout>;
  let cancel: (() => void) | undefined;
  try {
    return await Promise.race([
      (async () => {
        const result = await task;
        return result.outFile.arrayBuffer();
      })(),
      new Promise<never>((_, reject) => {
        cancel = () => {
          task.kill();
          reject(Error("Workspace switch canceled."));
        };
        signal.addEventListener("abort", cancel, { once: true });
        timer = setTimeout(() => {
          task.kill();
          reject(Error("Code evaluation exceeded 60 seconds."));
        }, 60000);
      }),
    ]);
  } finally {
    clearTimeout(timer!);
    if (cancel) signal.removeEventListener("abort", cancel);
  }
}
export async function designFromCode(
  code: WorkspaceCode,
  read: (file: State["params"]["sources"][number]) => Promise<Uint8Array>,
  base: Design | undefined,
  baseline: WorkspaceCode | undefined,
  signal: AbortSignal,
): Promise<{ design: Design; mode: "native" | "source" }> {
  if (base && baseline) {
    const native = nativeCodeRoundTrip(base, baseline, code);
    if (native) return { design: native, mode: "native" };
  }
  if (signal.aborted) throw Error("Workspace switch canceled.");
  const readUntilCanceled = (file: State["params"]["sources"][number]) =>
    new Promise<Uint8Array>((resolve, reject) => {
      const cancel = () => reject(Error("Workspace switch canceled."));
      signal.addEventListener("abort", cancel, { once: true });
      if (signal.aborted) cancel();
      else
        read(file)
          .then(resolve, reject)
          .finally(() => signal.removeEventListener("abort", cancel));
    });
  const { project, assets } = await snapshotCode(
    code,
    readUntilCanceled,
    base?.meshAssets ?? [],
  );
  const native = importNativeScad(project);
  if (native)
    return {
      design: { ...native, print: base?.print ?? native.print },
      mode: "native",
    };
  // Such programs can observe the additional user-module scope in generated scenes.
  if (
    project.files.some(
      (f) =>
        f.content &&
        /(?:\$parent_modules|\bparent_module\s*\(|\$children)/.test(f.content),
    )
  )
    throw Error(
      "Context-dependent parent_module/$children code cannot be mirrored safely. Keep this program in Code mode.",
    );
  const data = await renderCodeSnapshot(project, assets, signal);
  if (signal.aborted) throw Error("Workspace switch canceled.");
  const { parseMesh } = await import("./mesh-import");
  const asset = await parseMesh(data, "SCAD-model.stl", "mm");
  if (!meshInfo(asset).report.closed)
    throw Error(
      "The code result does not have closed edge topology; keep editing the source before switching.",
    );
  const body = createMeshBody(asset, "SCAD model", "preserve");
  body.codeProject = project;
  const d = blankDesign();
  d.name = base?.name ?? "Code design";
  d.print = base?.print ?? d.print;
  d.bodies = [body];
  d.meshAssets = [...assets.filter((a) => a.id !== asset.id), asset];
  return { design: validateDesign(d), mode: "source" };
}
