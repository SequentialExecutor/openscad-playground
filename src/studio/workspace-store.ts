import type { State } from "../state/app-state";
import { Design, validateDesign } from "./document";
import { verifyMeshAssets } from "./mesh-asset";
import { WorkspaceCode } from "./workspace-code";
export interface WorkspaceRecord {
  id: string;
  revision: number;
  mode: "code" | "visual";
  visual: Design;
  baseline: WorkspaceCode;
  code: WorkspaceCode;
  previous?: Design;
  editedVisual?: Design;
  conversion?: "native" | "source";
}
const validId = (id: string) => /^[a-f0-9-]{36}$/.test(id);
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("forma3d-studio", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("projects");
    r.onerror = () => reject(r.error);
    r.onsuccess = () => resolve(r.result);
  });
}
export async function loadWorkspace(id: string): Promise<WorkspaceRecord> {
  if (!validId(id)) throw Error("Invalid shared-workspace ID.");
  const db = await database();
  try {
    const r = await new Promise<WorkspaceRecord>((resolve, reject) => {
      const q = db
        .transaction("projects")
        .objectStore("projects")
        .get("workspace:" + id);
      q.onerror = () => reject(q.error);
      q.onsuccess = () => resolve(q.result);
    });
    if (
      !r ||
      r.id !== id ||
      !Number.isInteger(r.revision) ||
      r.revision < 0 ||
      !["code", "visual"].includes(r.mode) ||
      !r.code?.params ||
      !r.baseline?.params
    )
      throw Error(
        "This shared workspace is unavailable. Reopen it from the workspace containing your latest design.",
      );
    r.visual = validateDesign(r.visual);
    await verifyMeshAssets(r.visual.meshAssets);
    if (r.editedVisual) {
      r.editedVisual = validateDesign(r.editedVisual);
      await verifyMeshAssets(r.editedVisual.meshAssets);
    }
    if (r.previous) {
      r.previous = validateDesign(r.previous);
      await verifyMeshAssets(r.previous.meshAssets);
    }
    return r;
  } finally {
    db.close();
  }
}
async function write(
  record: WorkspaceRecord,
  expected: number | undefined,
): Promise<WorkspaceRecord> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("projects", "readwrite"),
        store = tx.objectStore("projects"),
        request = store.get("workspace:" + record.id);
      let conflict: Error | undefined;
      request.onsuccess = () => {
        const previous = request.result as WorkspaceRecord | undefined;
        if (
          expected === undefined
            ? previous !== undefined
            : previous?.revision !== expected
        ) {
          conflict = Error(
            "This workspace changed in another tab. Download your current project/source before reopening it.",
          );
          tx.abort();
          return;
        }
        store.put(record, "workspace:" + record.id);
      };
      tx.oncomplete = () => resolve(record);
      tx.onabort = () =>
        reject(
          conflict ?? tx.error ?? Error("Shared-workspace write was aborted."),
        );
      tx.onerror = () => reject(conflict ?? tx.error);
    });
  } finally {
    db.close();
  }
}
export async function openWorkspaceCode(
  visual: Design,
  code: WorkspaceCode,
  prior?: WorkspaceRecord,
): Promise<WorkspaceRecord> {
  const record: WorkspaceRecord = {
    id: prior?.id ?? crypto.randomUUID(),
    revision: (prior?.revision ?? -1) + 1,
    mode: "code",
    visual: validateDesign(visual),
    baseline: code,
    code,
  };
  return write(record, prior?.revision);
}
export async function saveWorkspaceVisual(
  prior: WorkspaceRecord,
  design: Design,
): Promise<WorkspaceRecord> {
  if (prior.mode !== "visual")
    throw Error("This workspace is currently in Code mode.");
  return write(
    {
      ...prior,
      editedVisual: validateDesign(design),
      revision: prior.revision + 1,
    },
    prior.revision,
  );
}
export class WorkspaceSession {
  private queued: Promise<void> = Promise.resolve();
  private failure: unknown;
  private pending = 0;
  record: WorkspaceRecord;
  get unsaved() {
    return this.pending > 0 || !!this.failure;
  }
  constructor(record: WorkspaceRecord) {
    this.record = record;
  }
  save(code: WorkspaceCode): Promise<void> {
    code = copyWorkspaceCode(code);
    this.pending++;
    this.queued = this.queued
      .then(async () => {
        if (this.failure) throw this.failure;
        if (this.record.mode !== "code")
          throw Error("This tab has already returned to Visual Design.");
        this.record = await write(
          { ...this.record, code, revision: this.record.revision + 1 },
          this.record.revision,
        );
      })
      .catch((error) => {
        this.failure = error;
        throw error;
      })
      .finally(() => {
        this.pending--;
      });
    return this.queued;
  }
  async flush() {
    await this.queued;
    if (this.failure) throw this.failure;
  }
  async enterVisual(
    design: Design,
    conversion: "native" | "source",
    code: WorkspaceCode,
    previous?: Design,
  ) {
    await this.flush();
    this.record = await write(
      {
        ...this.record,
        mode: "visual",
        visual: validateDesign(design),
        previous: previous ?? this.record.visual,
        code,
        conversion,
        revision: this.record.revision + 1,
      },
      this.record.revision,
    );
    return this.record;
  }
}
export function workspaceUrl(mode: "code" | "visual", id: string): string {
  const url = new URL(location.href);
  url.hash = "";
  url.searchParams.delete("embed");
  if (mode === "visual") url.searchParams.set("studio", "1");
  else url.searchParams.delete("studio");
  url.searchParams.set("workspace", id);
  return url.href;
}
let activeSession: WorkspaceSession | undefined;
export function setWorkspaceSession(session: WorkspaceSession | undefined) {
  activeSession = session;
}
export function getWorkspaceSession() {
  return activeSession;
}
export function copyWorkspaceCode(code: WorkspaceCode): WorkspaceCode {
  const p = code.params;
  return {
    params: {
      ...p,
      sources: p.sources.map((s) => ({ ...s })),
      features: [...p.features],
      ...(p.vars ? { vars: structuredClone(p.vars) } : {}),
      ...(p.extruderColors ? { extruderColors: [...p.extruderColors] } : {}),
    },
    ...(code.view ? { view: structuredClone(code.view) } : {}),
  };
}
export function sameWorkspaceCode(a: WorkspaceCode, b: WorkspaceCode): boolean {
  if (a.params.sources.length !== b.params.sources.length) return false;
  if (
    a.params.sources.some((s, i) => {
      const t = b.params.sources[i];
      return s.path !== t.path || s.content !== t.content || s.url !== t.url;
    })
  )
    return false;
  return (
    JSON.stringify({ ...a.params, sources: undefined, view: a.view }) ===
    JSON.stringify({ ...b.params, sources: undefined, view: b.view })
  );
}
export function persistedWorkspaceCode(state: State): WorkspaceCode {
  return copyWorkspaceCode({ params: state.params, view: state.view });
}
