import React, { useEffect, useRef, useState } from "react";
import {
  blankDesign,
  createBody,
  execute,
  generateScad,
  redo,
  undo,
  validateDesign,
  Body,
  Design,
  History,
  Shape,
  Vec3,
} from "./document";
import { loadRecovery, saveRecovery } from "./persistence";
import Viewport from "./Viewport";
import "./studio.css";

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
function Numeric({
  label,
  value,
  positive,
  onCommit,
}: {
  label: string;
  value: number;
  positive?: boolean;
  onCommit: (value: number) => void;
}) {
  const [text, setText] = useState(String(value));
  const canceled = useRef(false);
  useEffect(() => setText(String(Math.round(value * 1e5) / 1e5)), [value]);
  const apply = () => {
    const n = Number(text);
    if (
      text.trim() &&
      Number.isFinite(n) &&
      Math.abs(n) <= 1e6 &&
      (!positive || n >= 0.001)
    )
      onCommit(n);
    else setText(String(value));
  };
  return (
    <label>
      {label}
      <input
        aria-label={label}
        type="number"
        step="any"
        min={positive ? 0.001 : undefined}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (canceled.current) canceled.current = false;
          else apply();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            canceled.current = true;
            setText(String(value));
            e.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}
export default function Studio() {
  const [history, setHistory] = useState<History>({
    past: [],
    present: blankDesign(),
    future: [],
  });
  const design = history.present;
  const current = useRef(design);
  current.current = design;
  const [selected, setSelected] = useState<string>();
  const [draft, setDraft] = useState<Body>();
  const dragActive = useRef(false);
  dragActive.current = !!draft;
  const unsaved = useRef(false);
  const body = draft ?? design.bodies.find((b) => b.id === selected);
  const [mode, setMode] = useState<"translate" | "rotate" | "scale">(
    "translate",
  );
  const [snap, setSnap] = useState(true);
  const [orthographic, setOrthographic] = useState(false);
  const [view, setView] = useState<"iso" | "top" | "front" | "right">("iso");
  const [fit, setFit] = useState(0);
  const [status, setStatus] = useState("Loading local recovery…");
  const [ready, setReady] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const job = useRef<{ kill: () => void } | undefined>(undefined);
  const revision = useRef(0);
  useEffect(() => {
    let active = true;
    loadRecovery()
      .then((d) => {
        if (active) {
          if (d) setHistory({ past: [], present: d, future: [] });
          setStatus(d ? "Recovered local design" : "Ready • millimeters");
        }
      })
      .catch((e) => active && setStatus(`Recovery unavailable: ${e}`))
      .finally(() => active && setReady(true));
    return () => {
      active = false;
      job.current?.kill();
    };
  }, []);
  useEffect(() => {
    revision.current++;
    if (!ready) return;
    unsaved.current = true;
    setStatus("Saving locally…");
    const t = setTimeout(
      () =>
        saveRecovery(design)
          .then(() => {
            if (current.current === design) {
              unsaved.current = false;
              setStatus("Saved locally • millimeters");
            }
          })
          .catch((e) =>
            setStatus(`Autosave failed — download your project: ${e}`),
          ),
      500,
    );
    return () => clearTimeout(t);
  }, [design, ready]);
  const commit = (next: Design) => {
    try {
      setHistory((h) => execute(h, next));
    } catch (e) {
      setStatus(String(e));
    }
  };
  const changeBody = (b: Body) => {
    commit({
      ...design,
      bodies: design.bodies.map((old) => (old.id === b.id ? b : old)),
    });
    setDraft(undefined);
  };
  const add = (kind: Shape) => {
    const b = createBody(kind);
    commit({ ...design, bodies: [...design.bodies, b] });
    setSelected(b.id);
  };
  const remove = () => {
    if (body && !body.locked) {
      commit({
        ...design,
        bodies: design.bodies.filter((b) => b.id !== body.id),
      });
      setSelected(undefined);
    }
  };
  const duplicate = () => {
    if (body) {
      const b = {
        ...structuredClone(body),
        id: crypto.randomUUID(),
        name: `${body.name} copy`,
        position: [
          body.position[0] + 10,
          body.position[1],
          body.position[2],
        ] as Vec3,
      };
      commit({ ...design, bodies: [...design.bodies, b] });
      setSelected(b.id);
    }
  };
  const historyAction = (action: "undo" | "redo") => {
    setDraft(undefined);
    setHistory((h) => (action === "undo" ? undo(h) : redo(h)));
  };
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (dragActive.current) return;
      if (
        (e.target as HTMLElement)?.closest(
          "input,textarea,select,[contenteditable=true]",
        )
      )
        return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        historyAction(e.shiftKey ? "redo" : "undo");
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        historyAction("redo");
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (unsaved.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  const exportStl = async () => {
    if (busy || !design.bodies.some((b) => b.visible)) return;
    const snapshot = current.current;
    const token = revision.current;
    setBusy(true);
    setStatus("Evaluating exact geometry in OpenSCAD / Manifold…");
    let cancelRequested = false;
    job.current = {
      kill: () => {
        cancelRequested = true;
      },
    };
    try {
      const { renderIsolated } = await import("../runner/actions");
      if (cancelRequested) throw Error("Export canceled.");
      const task = renderIsolated({
        scadPath: "/forma.scad",
        sources: [{ path: "/forma.scad", content: generateScad(snapshot) }],
        isPreview: false,
        mountArchives: false,
        renderFormat: "stl",
        streamsCallback: () => {},
      })({ now: true });
      let cancel: (error: Error) => void = () => {};
      const canceled = new Promise<never>((_, reject) => {
        cancel = reject;
      });
      job.current = {
        kill: () => {
          task.kill();
          cancel(Error("Export canceled."));
        },
      };
      let timer: ReturnType<typeof setTimeout> | undefined;
      const output = await Promise.race([
        task,
        canceled,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            task.kill();
            reject(Error("Exact render exceeded 60 seconds."));
          }, 60000);
        }),
      ]).finally(() => clearTimeout(timer));
      if (token !== revision.current)
        throw Error(
          "Design changed during evaluation. Export again to use the current design.",
        );
      const data = await output.outFile.arrayBuffer();
      const header = new DataView(data);
      if (
        data.byteLength < 84 ||
        header.getUint32(80, true) === 0 ||
        data.byteLength !== 84 + header.getUint32(80, true) * 50
      )
        throw Error("The engine did not produce a valid nonempty binary STL.");
      // Reject nonfinite coordinates and zero-area triangles; no preview fallback.
      for (let o = 84; o < data.byteLength; o += 50) {
        const points: number[][] = [];
        for (let v = 0; v < 3; v++) {
          const p = [0, 1, 2].map((i) =>
            header.getFloat32(o + 12 + v * 12 + i * 4, true),
          );
          if (!p.every(Number.isFinite))
            throw Error("Nonfinite export coordinates.");
          points.push(p);
        }
        const a = points[1].map((n, i) => n - points[0][i]),
          b = points[2].map((n, i) => n - points[0][i]);
        if (
          Math.hypot(
            a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0],
          ) === 0
        )
          throw Error("Degenerate export triangle.");
      }
      download(output.outFile, "design.stl");
      setStatus(
        `Exact STL exported • ${header.getUint32(80, true)} triangles. Topology/printability analysis is not yet available.`,
      );
    } catch (e) {
      setStatus(`Export failed: ${e}`);
    } finally {
      job.current = undefined;
      setBusy(false);
    }
  };
  const open = async (file: File) => {
    try {
      if (file.size > 2 * 1024 * 1024)
        throw Error("Project exceeds 2 MB limit.");
      const next = validateDesign(JSON.parse(await file.text()));
      commit(next);
      setSelected(undefined);
      setStatus("Opened project");
    } catch (e) {
      setStatus(`Open failed: ${e}`);
    }
  };
  const source = generateScad(design);
  return (
    <main className="studio">
      <header>
        <div>
          <strong>
            Forma<span>3D</span> Studio
          </strong>
          <small>VISUAL DESIGN • FOUNDATION</small>
        </div>
        <a href={`?${location.hash}`}>Open Code workspace ↗</a>
      </header>
      <nav aria-label="Project tools">
        <button
          disabled={!ready}
          onClick={() => {
            if (
              window.confirm(
                "Create an empty design? Download the current project first to keep a separate copy.",
              )
            ) {
              commit(blankDesign());
              setSelected(undefined);
            }
          }}
        >
          New
        </button>
        <button disabled={!ready} onClick={() => fileInput.current?.click()}>
          Open project
        </button>
        <button
          disabled={!ready}
          onClick={() =>
            download(
              new Blob([JSON.stringify(design, null, 2)], {
                type: "application/json",
              }),
              "design.forma3d.json",
            )
          }
        >
          Save project
        </button>
        <input
          ref={fileInput}
          hidden
          type="file"
          accept=".json"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void open(f);
            e.target.value = "";
          }}
        />
        <span className="studio-divider" />
        <button
          disabled={!history.past.length || !!draft}
          onClick={() => historyAction("undo")}
        >
          Undo
        </button>
        <button
          disabled={!history.future.length || !!draft}
          onClick={() => historyAction("redo")}
        >
          Redo
        </button>
        <button disabled={!body} onClick={duplicate}>
          Duplicate
        </button>
        <button disabled={!body || body.locked} onClick={remove}>
          Delete
        </button>
        <span className="studio-divider" />
        <button
          disabled={busy || !design.bodies.some((b) => b.visible)}
          onClick={() => void exportStl()}
        >
          Export exact STL
        </button>
        {busy && (
          <button
            onClick={() => {
              job.current?.kill();
              setStatus("Canceling exact render…");
            }}
          >
            Cancel export
          </button>
        )}
        <button
          onClick={() => setShowSource((v) => !v)}
          aria-pressed={showSource}
        >
          Generated SCAD
        </button>
      </nav>
      <div className="studio-workspace" aria-busy={!ready}>
        <aside className="studio-left">
          <h2>Create a solid</h2>
          <div className="studio-primitives">
            {(["box", "sphere", "cylinder", "cone"] as Shape[]).map((kind) => (
              <button key={kind} disabled={!ready} onClick={() => add(kind)}>
                ＋ {kind}
              </button>
            ))}
          </div>
          <h2>
            Objects <small>{design.bodies.length}</small>
          </h2>
          {design.bodies.length === 0 && (
            <p className="studio-muted">
              Add a solid to start modeling. All dimensions are in millimeters.
            </p>
          )}
          <ul className="studio-tree">
            {design.bodies.map((b) => (
              <li key={b.id} className={b.id === selected ? "selected" : ""}>
                <button
                  aria-label={`Select ${b.name}`}
                  aria-pressed={b.id === selected}
                  onClick={() => setSelected(b.id)}
                >
                  {b.name}
                </button>
                <button
                  aria-label={`Toggle visibility ${b.name}`}
                  aria-pressed={b.visible}
                  onClick={() => changeBody({ ...b, visible: !b.visible })}
                >
                  {b.visible ? "◉" : "○"}
                </button>
                <button
                  aria-label={`Toggle lock ${b.name}`}
                  aria-pressed={b.locked}
                  onClick={() => changeBody({ ...b, locked: !b.locked })}
                >
                  {b.locked ? "🔒" : "◇"}
                </button>
              </li>
            ))}
          </ul>
          <details>
            <summary>Editing history ({history.past.length})</summary>
            <p>
              Each completed numeric edit or gizmo drag is one undo step. Camera
              changes are separate.
            </p>
          </details>
        </aside>
        <section className="studio-center" aria-label="Model workspace">
          <div className="studio-viewtools">
            {(["translate", "rotate", "scale"] as const).map((m) => (
              <button
                key={m}
                aria-pressed={mode === m}
                onClick={() => setMode(m)}
              >
                {m === "translate"
                  ? "Move"
                  : m === "rotate"
                    ? "Rotate"
                    : "Scale"}
              </button>
            ))}
            <label>
              <input
                type="checkbox"
                checked={snap}
                onChange={(e) => setSnap(e.target.checked)}
              />{" "}
              Snap: 1 mm / 15° / 0.1×
            </label>
            <select
              aria-label="Camera view"
              value={view}
              onChange={(e) => setView(e.target.value as typeof view)}
            >
              <option value="iso">Isometric</option>
              <option value="top">Top</option>
              <option value="front">Front</option>
              <option value="right">Right</option>
            </select>
            <button onClick={() => setFit((n) => n + 1)}>Fit all</button>
            <button
              aria-pressed={orthographic}
              onClick={() => setOrthographic((v) => !v)}
            >
              Orthographic
            </button>
          </div>
          <Viewport
            orthographic={orthographic}
            design={design}
            selected={selected}
            mode={mode}
            snap={snap}
            cameraView={view}
            fit={fit}
            onSelect={setSelected}
            onDraft={setDraft}
            onCommit={changeBody}
          />
          <div className="studio-legend">
            X red · Y green · Z blue • Grid 10 mm • Drag to orbit · right-drag
            to pan · wheel to zoom
          </div>
          {showSource && (
            <section className="studio-source">
              <h2>Generated source · read only</h2>
              <button
                onClick={() =>
                  download(
                    new Blob([source], { type: "text/plain" }),
                    "design.scad",
                  )
                }
              >
                Download SCAD
              </button>
              <textarea
                aria-label="Generated SCAD source"
                readOnly
                value={source}
              />
            </section>
          )}
        </section>
        <aside className="studio-right">
          <h2>Properties</h2>
          {body ? (
            <>
              <label>
                Name
                <input
                  aria-label="Object name"
                  key={`${body.id}:${body.name}`}
                  defaultValue={body.name}
                  maxLength={200}
                  disabled={body.locked}
                  onBlur={(e) => changeBody({ ...body, name: e.target.value })}
                />
              </label>
              <p className="studio-muted">
                {body.kind} • centered origin{body.locked ? " • locked" : ""}
              </p>
              <fieldset disabled={body.locked || !!draft}>
                <legend>Dimensions (mm)</legend>
                <p className="studio-muted">
                  Unscaled local bounding dimensions
                </p>
                <div className="studio-values">
                  {body.size.map((n, i) => (
                    <Numeric
                      key={i}
                      label={`${["Width", "Depth", "Height"][i]} (mm)`}
                      value={n}
                      positive
                      onCommit={(v) => {
                        const size = [...body.size] as Vec3;
                        size[i] = v;
                        changeBody({ ...body, size });
                      }}
                    />
                  ))}
                </div>
              </fieldset>
              {(["position", "rotation", "scale"] as const).map((key) => (
                <fieldset key={key} disabled={body.locked || !!draft}>
                  <legend>
                    {key === "position"
                      ? "Position (mm)"
                      : key === "rotation"
                        ? "Rotation (degrees)"
                        : "Scale"}
                  </legend>
                  <div className="studio-values">
                    {body[key].map((n, i) => (
                      <Numeric
                        key={i}
                        label={`${key} ${"XYZ"[i]}`}
                        value={n}
                        positive={key === "scale"}
                        onCommit={(v) => {
                          const vector = [...body[key]] as Vec3;
                          vector[i] = v;
                          changeBody({ ...body, [key]: vector });
                        }}
                      />
                    ))}
                  </div>
                </fieldset>
              ))}
              <button
                disabled={body.locked}
                onClick={() =>
                  changeBody({
                    ...body,
                    position: [0, 0, 0],
                    rotation: [0, 0, 0],
                    scale: [1, 1, 1],
                  })
                }
              >
                Reset transform
              </button>
            </>
          ) : (
            <p className="studio-muted">
              Select an object in the viewport or object list to edit its
              dimensions and transform.
            </p>
          )}
          <details>
            <summary>Current modeling limits</summary>
            <p>
              Primitive solids and transforms. Multiple bodies are unioned by
              OpenSCAD for final STL. Editable booleans, sketches, mesh imports
              and printability analysis are coming in later phases. The JSON
              project format is a versioned foundation format, not the planned
              asset ZIP format.
            </p>
          </details>
        </aside>
      </div>
      <footer role="status" aria-live="polite">
        {status}
        <span>
          {design.bodies.filter((b) => b.visible).length} visible bodies •
          Ctrl/⌘ Z undo • Escape cancels a gizmo drag
        </span>
      </footer>
    </main>
  );
}
