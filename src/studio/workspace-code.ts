import type { State } from "../state/app-state";
import { Design, generateScad, validateDesign } from "./document";
import { validateCodeProject, MAX_CODE_TEXT } from "./code-project";
import {
  importNativeScad,
  updateNativeFromCode,
  updateReadableFromCode,
  scadTokens,
} from "./scad-roundtrip";
import {
  generateReadableScad,
  hasMeshBodies,
  importedCodeReason,
} from "./readable-scad";
export interface WorkspaceCode {
  params: State["params"];
  view?: State["view"];
}
export function codeSignature(code: WorkspaceCode): string {
  return JSON.stringify(code.params);
}
export function hasGeneratedModules(code: WorkspaceCode): boolean {
  const source =
    code.params.sources.find((f) => f.path === code.params.activePath)
      ?.content ?? "";
  const tokens = scadTokens(source);
  return tokens.some(
    (t, i) =>
      t.kind === "id" &&
      t.value === "module" &&
      /^n\d+$/.test(tokens[i + 1]?.value ?? "") &&
      tokens[i + 2]?.value === "(",
  );
}
export function workspaceCodeForDesign(input: Design): WorkspaceCode {
  const design = validateDesign(input);
  if (hasMeshBodies(design)) throw Error(importedCodeReason);
  const source = generateReadableScad(design);
  if (new TextEncoder().encode(source).length > MAX_CODE_TEXT)
    throw Error("Generated source exceeds the 1 MB editable-code limit.");
  return {
    params: {
      activePath: "/forma3d.scad",
      sources: [{ path: "/forma3d.scad", content: source }],
      features: [],
      vars: {},
      exportFormat2D: "svg",
      exportFormat3D: "stl",
    },
  };
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
  if (hasMeshBodies(base) || !sameOtherFiles(baseline, current))
    return undefined;
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
  if (original === generateReadableScad(base))
    return updateReadableFromCode(
      base,
      original,
      edited,
      current.params.vars ?? {},
    );
  // Backward compatibility for already-open workspaces from earlier releases.
  if (original !== generateScad(base)) return undefined;
  return updateNativeFromCode(
    base,
    original,
    edited,
    current.params.vars ?? {},
  );
}
export async function designFromCode(
  code: WorkspaceCode,
  _read: (file: State["params"]["sources"][number]) => Promise<Uint8Array>,
  base: Design | undefined,
  baseline: WorkspaceCode | undefined,
  signal: AbortSignal,
): Promise<{ design: Design; mode: "native" }> {
  if (signal.aborted) throw Error("Workspace switch canceled.");
  if (base && baseline && !hasMeshBodies(base)) {
    const native = nativeCodeRoundTrip(base, baseline, code);
    if (native) return { design: native, mode: "native" };
  }
  if (code.params.sources.some((f) => f.content === undefined))
    throw Error(
      "Visual editing needs native SCAD shapes. Imported files and mesh geometry stay in Code.",
    );
  const project = validateCodeProject({
    entryPath: code.params.activePath,
    files: code.params.sources.map((f) => ({
      path: f.path,
      content: f.content!,
    })),
    vars: code.params.vars ?? {},
    features: code.params.features,
  });
  const native = importNativeScad(project);
  if (native)
    return {
      design: {
        ...native,
        name: base?.name ?? native.name,
        print: base?.print ?? native.print,
      },
      mode: "native",
    };
  throw Error(
    "This code cannot yet be edited as native visual shapes. Your source stays in Code; it will not be replaced with an opaque mesh object.",
  );
}
