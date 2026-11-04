import { encodeProject, decodeProject } from "./project-file";
import Numeric from "./Numeric";
import React, { useEffect, useRef, useState } from "react";
import {
  BooleanFeature,
  createBoolean,
  rootNodes,
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
import { useFeatureMeshes } from "./useFeatureMeshes";
import { BooleanTools, BooleanInspector } from "./BooleanTools";
import { evaluateExact, inspectStl } from "./evaluate";
import { PrintPanel } from "./PrintPanel";
import { MeshAnalysis } from "./mesh-analysis";
import "./studio.css";

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export default function Studio() {
  const [history, setHistory] = useState<History>({
    past: [],
    present: blankDesign(),
    future: [],
  });
  const [analysis, setAnalysis] = useState<{
    source: string;
    settings: string;
    report: MeshAnalysis;
  }>();
  const [analyzing, setAnalyzing] = useState(false);
  const design = history.present;
  const printSettings = design.print;
  const exactFeatures = useFeatureMeshes(design);
  const nodes = [...design.bodies, ...design.features];
  const current = useRef(design);
  current.current = design;
  const [selected, setSelected] = useState<string>();
  const feature = design.features.find((f) => f.id === selected);
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
  const [saveStatus, setSaveStatus] = useState("");
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
    setSaveStatus("Saving locally…");
    const t = setTimeout(
      () =>
        saveRecovery(design)
          .then(() => {
            if (current.current === design) {
              unsaved.current = false;
              setSaveStatus("Saved locally • millimeters");
            }
          })
          .catch((e) =>
            setSaveStatus(`Autosave failed — download your project: ${e}`),
          ),
      500,
    );
    return () => clearTimeout(t);
  }, [design, ready]);
  const commit = (next: Design) => {
    try {
      const validated = validateDesign(next);
      setHistory((h) => execute(h, validated));
      setStatus("Design updated");
    } catch (e) {
      setStatus(String(e));
    }
  };
  const changeFeature = (f: BooleanFeature) =>
    commit({
      ...design,
      features: design.features.map((old) => (old.id === f.id ? f : old)),
    });
  const removeFeature = () => {
    if (feature)
      commit({
        ...design,
        features: design.features.filter((f) => f.id !== feature.id),
      });
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
  const exportStl = async (analyze = false) => {
    if (busy || !rootNodes(design).length) return;
    const snapshot = current.current;
    const token = revision.current;
    setBusy(true);
    setAnalyzing(analyze);
    setStatus("Evaluating exact geometry in OpenSCAD / Manifold…");
    const task = evaluateExact(generateScad(snapshot), "export");
    job.current = { kill: () => task.cancel() };
    try {
      const output = await task.promise;
      if (token !== revision.current)
        throw Error(
          "Design changed during evaluation. Export again to use the current design.",
        );
      const triangleCount = inspectStl(output.data);
      if (analyze) {
        const report = await new Promise<MeshAnalysis>((resolve, reject) => {
          const worker = new Worker(
            new URL("./analysis-worker.ts", import.meta.url),
          );
          const cleanup = () => {
            clearTimeout(timer);
            worker.terminate();
          };
          const timer = setTimeout(() => {
            cleanup();
            reject(Error("Mesh analysis exceeded 30 seconds."));
          }, 30000);
          job.current = {
            kill: () => {
              cleanup();
              reject(Error("Mesh analysis canceled."));
            },
          };
          worker.onmessage = (e) => {
            cleanup();
            if (e.data.error) reject(Error(e.data.error));
            else resolve(e.data.result);
          };
          worker.onerror = (e) => {
            cleanup();
            reject(Error(e.message));
          };
          worker.postMessage({ data: output.data, settings: printSettings }, [
            output.data,
          ]);
        });
        if (token !== revision.current)
          throw Error(
            "Design changed during analysis. Analyze the current revision again.",
          );
        setAnalysis({
          source: generateScad(snapshot),
          settings: JSON.stringify(printSettings),
          report,
        });
        setStatus(
          "Exact mesh analysis complete. Review defects and heuristic warnings in Print setup.",
        );
        return;
      }
      download(output.file, "design.stl");
      setStatus(
        `Exact STL exported • ${triangleCount} triangles. Topology/printability analysis is not yet available.`,
      );
    } catch (e) {
      setStatus(`${analyze ? "Analysis" : "Export"} failed: ${e}`);
    } finally {
      job.current = undefined;
      setBusy(false);
    }
  };
  const open = async (file: File) => {
    try {
      if (file.size > 5 * 1024 * 1024)
        throw Error("Project exceeds 5 MB limit.");
      const token = revision.current;
      const next = await decodeProject(await file.arrayBuffer());
      if (token !== revision.current)
        throw Error("Design changed while opening the file. Open it again.");
      commit(next);
      setSelected(undefined);
      setStatus("Opened project");
    } catch (e) {
      setStatus(`Open failed: ${e}`);
    }
  };
  const saveProject = async () => {
    try {
      download(
        new Blob([await encodeProject(design)], { type: "application/zip" }),
        "design.forma3d",
      );
    } catch (e) {
      setStatus(`Save failed: ${e}`);
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
        <button disabled={!ready} onClick={() => void saveProject()}>
          Save project
        </button>
        <input
          ref={fileInput}
          hidden
          type="file"
          accept=".forma3d,.json"
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
          disabled={busy || !rootNodes(design).length}
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
          <BooleanTools
            nodes={nodes}
            onCreate={(operation, inputs) => {
              const f = createBoolean(operation, inputs);
              commit({ ...design, features: [...design.features, f] });
              setSelected(f.id);
            }}
          />
          <h2>
            Objects <small>{nodes.length}</small>
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
            {design.features.map((f) => (
              <li key={f.id} className={f.id === selected ? "selected" : ""}>
                <button
                  aria-label={`Select ${f.name}`}
                  aria-pressed={f.id === selected}
                  onClick={() => setSelected(f.id)}
                >
                  {f.name} • boolean
                </button>
                <button
                  aria-label={`Toggle visibility ${f.name}`}
                  aria-pressed={f.visible}
                  onClick={() => changeFeature({ ...f, visible: !f.visible })}
                >
                  {f.visible ? "◉" : "○"}
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
            featureMeshes={exactFeatures.meshes}
            selected={selected}
            mode={mode}
            snap={snap}
            cameraView={view}
            fit={fit}
            onSelect={setSelected}
            onDraft={setDraft}
            onCommit={changeBody}
          />
          {exactFeatures.progress && (
            <div className="studio-legend" role="status" aria-live="polite">
              {exactFeatures.progress}
            </div>
          )}
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
          {feature && (
            <BooleanInspector
              feature={feature}
              nodes={nodes}
              onChange={changeFeature}
              onRemove={removeFeature}
            />
          )}
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
                {(body.kind === "cylinder" || body.kind === "cone") && (
                  <Numeric
                    label="Diameter (mm)"
                    value={body.size[0]}
                    positive
                    onCommit={(v) =>
                      changeBody({ ...body, size: [v, v, body.size[2]] })
                    }
                  />
                )}
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
              Select a primitive in the object list to edit its dimensions and
              transform.
            </p>
          )}
          <PrintPanel
            settings={printSettings}
            onSettings={(settings) => commit({ ...design, print: settings })}
            busy={busy || !rootNodes(design).length}
            onAnalyze={() => void exportStl(true)}
            report={
              analysis?.source === source &&
              analysis.settings === JSON.stringify(printSettings)
                ? analysis.report
                : undefined
            }
          />
          <details>
            <summary>Current modeling limits</summary>
            <p>
              Primitive solids, editable booleans, native projects and bounded
              mesh inspection are available. Sketches, mesh imports and advanced
              solid operations are still pending. Mesh analysis does not certify
              printability.
            </p>
          </details>
        </aside>
      </div>
      <footer role="status" aria-live="polite">
        {status}
        <span>{saveStatus}</span>
        <span>
          {rootNodes(design).length} visible results • Ctrl/⌘ Z undo • Escape
          cancels a gizmo drag
        </span>
      </footer>
    </main>
  );
}
