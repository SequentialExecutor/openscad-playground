import React, { useEffect, useState } from "react";
import { ModuleChoice, ModuleImportReview } from "./ModuleImportReview";
import { Body, Design, validateDesign } from "./document";
import {
  canonicalScad,
  mergeAuthoredSources,
  moduleInvocation,
  parseAuthoredProgram,
  readModuleInvocation,
} from "./authored-scad";
import { createModuleBody, sourceForSavedShape } from "./authored-design";
import {
  LibraryEntry,
  ModuleLibrary,
  loadModuleLibrary,
  saveModuleLibrary,
  validateLibrary,
} from "./module-library";
export default function ModuleLibraryPanel({
  design,
  selected,
  onCommit,
  onStatus,
}: {
  design: Design;
  selected?: string;
  onCommit: (d: Design) => void;
  onStatus: (text: string) => void;
}) {
  const [library, setLibrary] = useState<ModuleLibrary>(),
    [error, setError] = useState(""),
    [name, setName] = useState(""),
    [values, setValues] = useState<Record<string, string>>({}),
    [saveName, setSaveName] = useState("my_shape"),
    [pending, setPending] = useState<LibraryEntry>(),
    [review, setReview] = useState<ModuleChoice[]>(),
    [reviewError, setReviewError] = useState(""),
    [busy, setBusy] = useState(false);
  const refresh = () => {
    loadModuleLibrary()
      .then((l) => {
        setLibrary(l);
        setError("");
        setName((n) =>
          l.entries.some((e) => e.name === n) ? n : (l.entries[0]?.name ?? ""),
        );
      })
      .catch((e) =>
        setError(
          `Library unavailable: ${e}. Refresh to retry; the saved library has not been replaced.`,
        ),
      );
  };
  useEffect(() => {
    refresh();
    window.addEventListener("forma3d-module-library-changed", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("forma3d-module-library-changed", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);
  useEffect(() => setValues({}), [name, library?.revision]);
  const entry = library?.entries.find((e) => e.name === name),
    signature = entry
      ? parseAuthoredProgram(entry.source).declarations.find(
          (d) => d.kind === "module" && d.name === name,
        )
      : undefined;
  let expression = "",
    invalid = "";
  try {
    if (entry) expression = moduleInvocation(entry.source, name, values);
  } catch (e) {
    invalid = String(e);
  }
  const persist = async (entries: LibraryEntry[]) => {
    if (!library || error) return;
    setBusy(true);
    setReviewError("");
    try {
      const l = await saveModuleLibrary(library, entries);
      setLibrary(l);
      setPending(undefined);
      setReview(undefined);
      onStatus(
        `Saved ${entries.length} module(s) to the browser-local library.`,
      );
    } catch (e) {
      setReviewError(`Library save failed: ${e}`);
      onStatus(`Library save failed: ${e}`);
    } finally {
      setBusy(false);
    }
  };
  const saveShape = () => {
    try {
      if (!selected) throw Error("Select a shape or feature first.");
      const source = sourceForSavedShape(design, selected, saveName);
      const entry = { name: saveName, source };
      if (library?.entries.some((e) => e.name === saveName)) setPending(entry);
      else void persist([entry]);
    } catch (e) {
      onStatus(`Save module failed: ${e}`);
    }
  };
  const insert = () => {
    try {
      if (!entry) throw Error("Choose a library module.");
      const authoredSource = mergeAuthoredSources(
        design.authoredSource,
        entry.source,
      );
      const b = createModuleBody(authoredSource, expression);
      onCommit(
        validateDesign({
          ...design,
          authoredSource,
          bodies: [...design.bodies, b],
        }),
      );
      onStatus(`Inserted ${name}. The project keeps its own source snapshot.`);
    } catch (e) {
      onStatus(`Module insertion failed: ${e}`);
    }
  };
  return (
    <details className="studio-module-library">
      <summary>Module library</summary>
      <p>
        Reusable code modules are saved in this browser. Inserted shapes keep
        their own source, parameters and transforms. Values can be numbers,
        strings or vectors such as [0.5,0,0.5].
      </p>
      {error && <p role="alert">{error}</p>}
      <button onClick={refresh}>Refresh library</button>
      <label>
        Library module
        <select
          aria-label="Library module"
          value={name}
          onChange={(e) => setName(e.target.value)}
        >
          <option value="">Choose a module</option>
          {library?.entries.map((e) => (
            <option key={e.name} value={e.name}>
              {e.name}
            </option>
          ))}
        </select>
      </label>
      {signature?.parameters.map((p) => (
        <label key={p.name}>
          {p.name}
          {p.defaultValue === undefined ? " (required)" : ""}
          <input
            aria-label={`Module parameter ${p.name}`}
            placeholder={p.defaultValue ?? "Required SCAD value"}
            value={values[p.name] ?? ""}
            onChange={(e) =>
              setValues((v) => ({ ...v, [p.name]: e.target.value }))
            }
          />
        </label>
      ))}
      {invalid && <p>{invalid}</p>}
      <button
        disabled={!entry || !!invalid || !!error || busy}
        onClick={insert}
      >
        Insert module
      </button>
      {entry && (
        <details>
          <summary>View saved source</summary>
          <pre>{entry.source}</pre>
        </details>
      )}
      <h2>Save selected shape</h2>
      <label>
        Module name
        <input
          aria-label="Save module name"
          value={saveName}
          onChange={(e) => setSaveName(e.target.value)}
        />
      </label>
      <p>
        The module includes the selected result's current transform and code
        dependencies. Imported meshes cannot be saved as code modules.
      </p>
      <button
        disabled={!selected || !library || !!error || busy}
        onClick={saveShape}
      >
        Save selected as module
      </button>
      {pending && (
        <section aria-label="Replace library module">
          <p>
            A module named {pending.name} already exists. Replace its library
            entry? Existing projects keep their copies.
          </p>
          <button disabled={busy} onClick={() => void persist([pending])}>
            Replace library module
          </button>
          <button onClick={() => setPending(undefined)}>Cancel replace</button>
        </section>
      )}
      <button
        disabled={!library || !!error}
        onClick={() => {
          if (!library) return;
          const a = document.createElement("a"),
            url = URL.createObjectURL(
              new Blob([JSON.stringify({ ...library, revision: 0 }, null, 2)], {
                type: "application/json",
              }),
            );
          a.href = url;
          a.download = "forma3d-module-library.json";
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }}
      >
        Export module library
      </button>
      <label>
        Import library backup
        <input
          type="file"
          aria-label="Module library backup"
          accept=".json"
          disabled={busy || !library || !!error}
          onChange={async (e) => {
            try {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              if (file.size > 5 * 1024 * 1024)
                throw Error("Library backup exceeds 5 MB.");
              const incoming = validateLibrary(JSON.parse(await file.text()));
              const choices = incoming.entries.flatMap((entry) => {
                const old = library?.entries.find((e) => e.name === entry.name);
                return old &&
                  canonicalScad(old.source) === canonicalScad(entry.source)
                  ? []
                  : [{ entry, update: !!old }];
              });
              if (choices.length) setReview(choices);
              else onStatus("The module library is already up to date.");
            } catch (e) {
              onStatus(`Library import failed: ${e}`);
            }
          }}
        />
      </label>
      {review && (
        <ModuleImportReview
          returning={false}
          error={reviewError}
          choices={review}
          onSave={(entries) => void persist(entries)}
          onSkip={() => setReview(undefined)}
          onCancel={() => setReview(undefined)}
        />
      )}
    </details>
  );
}
export function ModuleCallInspector({
  body,
  design,
  onChange,
}: {
  body: Body;
  design: Design;
  onChange: (b: Body) => void;
}) {
  const expression = body.moduleCall!.expression,
    call = readModuleInvocation(design.authoredSource ?? "", expression),
    signature = call
      ? parseAuthoredProgram(design.authoredSource!).declarations.find(
          (d) => d.kind === "module" && d.name === call.name,
        )
      : undefined;
  const [error, setError] = useState("");
  return (
    <fieldset disabled={body.locked}>
      <legend>Authored code module</legend>
      <p>
        Source remains editable in Code. Parameters accept SCAD values and
        expressions.
      </p>
      {signature?.parameters.map((p) => (
        <label key={`${body.id}:${expression}:${p.name}`}>
          {p.name}
          <input
            aria-label={`Instance parameter ${p.name}`}
            defaultValue={call?.values[p.name] ?? ""}
            placeholder={p.defaultValue ?? "Required"}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                e.currentTarget.value = call?.values[p.name] ?? "";
                e.currentTarget.blur();
              }
            }}
            onBlur={(e) => {
              try {
                const values = { ...call!.values };
                if (e.target.value.trim()) values[p.name] = e.target.value;
                else delete values[p.name];
                const next = moduleInvocation(
                  design.authoredSource!,
                  call!.name,
                  values,
                );
                setError("");
                if (next !== expression)
                  onChange({ ...body, moduleCall: { expression: next } });
              } catch (err) {
                setError(String(err));
              }
            }}
          />
        </label>
      ))}
      {error && <p role="alert">{error}</p>}
      <details>
        <summary>View invocation</summary>
        <pre>{expression}</pre>
      </details>
    </fieldset>
  );
}
