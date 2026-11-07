import {
  canonicalScad,
  moduleBundle,
  parseAuthoredProgram,
  validateAuthoredSource,
} from "./authored-scad";
export interface LibraryEntry {
  name: string;
  source: string;
}
export interface ModuleLibrary {
  version: 1;
  revision: number;
  entries: LibraryEntry[];
}
export const emptyLibrary = (): ModuleLibrary => ({
  version: 1,
  revision: 0,
  entries: [],
});
export function validateLibrary(input: unknown): ModuleLibrary {
  const lib = input as ModuleLibrary;
  if (
    !lib ||
    lib.version !== 1 ||
    !Number.isInteger(lib.revision) ||
    lib.revision < 0 ||
    !Array.isArray(lib.entries) ||
    lib.entries.length > 200
  )
    throw Error("Invalid module library.");
  const seen = new Set<string>();
  let size = 0;
  const entries = lib.entries.map((e) => {
    if (
      !e ||
      typeof e.name !== "string" ||
      !/^[$A-Za-z_][A-Za-z0-9_]*$/.test(e.name) ||
      seen.has(e.name)
    )
      throw Error("Invalid or duplicate library module name.");
    seen.add(e.name);
    const source = validateAuthoredSource(e.source);
    const bytes = new TextEncoder().encode(source).length;
    size += bytes;
    if (
      bytes > 256 * 1024 ||
      !parseAuthoredProgram(source).declarations.some(
        (d) => d.kind === "module" && d.name === e.name,
      )
    )
      throw Error("Module entry is missing or exceeds 256 KB.");
    return { name: e.name, source };
  });
  if (size > 2 * 1024 * 1024) throw Error("The module library exceeds 2 MB.");
  return { version: 1, revision: lib.revision, entries };
}
async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const q = indexedDB.open("forma3d-studio", 1);
    q.onupgradeneeded = () => q.result.createObjectStore("projects");
    q.onsuccess = () => resolve(q.result);
    q.onerror = () => reject(q.error);
  });
}
export async function loadModuleLibrary(): Promise<ModuleLibrary> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const q = db
        .transaction("projects")
        .objectStore("projects")
        .get("module-library");
      q.onsuccess = () =>
        resolve(
          q.result === undefined ? emptyLibrary() : validateLibrary(q.result),
        );
      q.onerror = () => reject(q.error);
    });
  } finally {
    db.close();
  }
}
export async function saveModuleLibrary(
  previous: ModuleLibrary,
  selected: LibraryEntry[],
): Promise<ModuleLibrary> {
  const map = new Map(previous.entries.map((e) => [e.name, e]));
  for (const entry of selected) map.set(entry.name, entry);
  const next = validateLibrary({
    version: 1,
    revision: previous.revision + 1,
    entries: [...map.values()],
  });
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("projects", "readwrite"),
        store = tx.objectStore("projects"),
        q = store.get("module-library");
      let failure: Error | undefined;
      q.onsuccess = () => {
        if ((q.result?.revision ?? 0) !== previous.revision) {
          failure = Error(
            "The library changed in another tab. Refresh and review your import again.",
          );
          tx.abort();
        } else store.put(next, "module-library");
      };
      tx.oncomplete = () => resolve();
      tx.onabort = () =>
        reject(failure ?? tx.error ?? Error("Library save aborted."));
      tx.onerror = () => reject(failure ?? tx.error);
    });
  } finally {
    db.close();
  }
  window.dispatchEvent(new Event("forma3d-module-library-changed"));
  return next;
}
export function detectedLibraryEntries(
  source: string,
  library: ModuleLibrary,
  baselineSource?: string,
): { entry: LibraryEntry; update: boolean }[] {
  const p = parseAuthoredProgram(source);
  return p.declarations
    .filter((d) => d.kind === "module")
    .map((d) => ({ name: d.name, source: moduleBundle(p, d.name) }))
    .flatMap((entry) => {
      const old = library.entries.find((e) => e.name === entry.name);
      if (old && canonicalScad(old.source) === canonicalScad(entry.source))
        return [];
      if (old && baselineSource) {
        const baseline = parseAuthoredProgram(baselineSource);
        if (
          baseline.declarations.some(
            (d) => d.kind === "module" && d.name === entry.name,
          ) &&
          canonicalScad(moduleBundle(baseline, entry.name)) ===
            canonicalScad(entry.source)
        )
          return [];
      }
      return [{ entry, update: !!old }];
    });
}
