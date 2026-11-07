import ModuleLibraryPanel, { ModuleCallInspector } from "./ModuleLibraryPanel";
import {
  generateReadableScad,
  hasMeshBodies,
  importedCodeReason,
} from "./readable-scad";
import {
  loadWorkspace,
  openWorkspaceCode,
  saveWorkspaceVisual,
  workspaceUrl,
  WorkspaceRecord,
} from "./workspace-store";
import { workspaceCodeForDesign, hasGeneratedModules } from "./workspace-code";
import { MeshImportTools, MeshInspector, MeshPlacement } from "./MeshTools";
import { MeshUnit, MeshAsset, MAX_IMPORT_BYTES } from "./mesh-asset";
import { encodeScadBundle } from "./scad-bundle";
import { ModelingTools, ModelingInspector } from "./ModelingTools";
import { MechanicalTools, MechanicalInspector } from "./MechanicalTools";
import { createModelingFeature, modelingNames } from "./advanced";
import PositioningTools, { PositionAction } from "./PositioningTools";
import { translated, independentReference, distribution } from "./positioning";
import SketchEditor from "./SketchEditor";
import { Extrusion, rectangleSketch } from "./sketch";
import { encodeProject, decodeProject } from "./project-file";
import Numeric from "./Numeric";
import React, { useEffect, useRef, useState } from "react";
import {
  BooleanFeature,
  Feature,
  Transformable,
  createTemplateBody,
  createMeshBody,
  createBoolean,
  rootNodes,
  blankDesign,
  createBody,
  createExtrusion,
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
  const [positioning, setPositioning] = useState(false);
  const [importing, setImporting] = useState(false);
  const design = history.present;
  const printSettings = design.print;

  const nodes = [...design.bodies, ...design.features];
  const initialDesign = useRef(design);
  const current = useRef(design);
  current.current = design;
  const [selected, setSelected] = useState<string>();
  const exactFeatures = useFeatureMeshes(design, selected);
  const [editingSketch, setEditingSketch] = useState<{
    bodyId?: string;
    value: Extrusion;
  }>();
  const sketchActive = useRef(false);
  sketchActive.current = !!editingSketch;
  const [draft, setDraft] = useState<Transformable>();
  const feature =
    draft && "spec" in draft
      ? draft
      : design.features.find((f) => f.id === selected);
  const dragActive = useRef(false);
  dragActive.current = !!draft;
  const unsaved = useRef(false);
  const body =
    draft && "kind" in draft
      ? draft
      : design.bodies.find((b) => b.id === selected);
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
  const [switchingWorkspace, setSwitchingWorkspace] = useState(false);
  const sharedWorkspace = useRef<WorkspaceRecord | undefined>(undefined);
  const workspaceSaves = useRef<Promise<void>>(Promise.resolve());
  const [recoveryLoaded, setRecoveryLoaded] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const job = useRef<{ kill: () => void } | undefined>(undefined);
  const revision = useRef(0);
  useEffect(() => {
    let active = true;
    (async () => {
      let recovered: Design | undefined,
        readSucceeded = false,
        recoveryError: unknown;
      try {
        recovered = await loadRecovery();
        readSucceeded = true;
      } catch (error) {
        recoveryError = error;
      }
      let shared: WorkspaceRecord | undefined;
      const id = new URLSearchParams(location.search).get("workspace");
      if (id) {
        try {
          shared = await loadWorkspace(id);
          if (shared.mode !== "visual")
            throw Error(
              "The shared workspace is still in Code mode. Return using its Visual Design link.",
            );
        } catch (error) {
          if (active) {
            setStatus(`Shared workspace unavailable: ${error}`);
            setReady(true);
          }
          return;
        }
      }
      if (!active) return;
      sharedWorkspace.current = shared;
      if (shared) {
        const previous = shared.previous ?? recovered;
        setHistory({
          past:
            previous &&
            JSON.stringify(previous) !==
              JSON.stringify(shared.editedVisual ?? shared.visual)
              ? [previous]
              : [],
          present: shared.editedVisual ?? shared.visual,
          future: [],
        });
        setStatus(
          shared.conversion === "source"
            ? "Recovered a legacy mesh snapshot. Code is unavailable while mesh bodies remain."
            : "Synchronized visual design and code.",
        );
      } else if (recovered) {
        setHistory({ past: [], present: recovered, future: [] });
        setStatus("Recovered local design");
      } else
        setStatus(
          readSucceeded
            ? "Ready • millimeters"
            : `Recovery unavailable: ${recoveryError}`,
        );
      setRecoveryLoaded(readSucceeded);
      setReady(true);
    })().catch((error) => {
      if (active) {
        setStatus(`Workspace load failed: ${error}`);
        setReady(true);
      }
    });
    return () => {
      active = false;
      job.current?.kill();
    };
  }, []);
  useEffect(() => {
    revision.current++;
    if (!ready) return;
    // A failed read must never authorize replacing an unknown recovery document.
    // Editing and project downloads remain available, but only a successful
    // startup read (including a missing record) enables this session's autosave.
    if (!recoveryLoaded) {
      unsaved.current = design !== initialDesign.current;
      setSaveStatus(
        "Local autosave paused: recovery could not be read. Download your work before reloading to retry.",
      );
      return;
    }
    unsaved.current = true;
    setSaveStatus("Saving locally…");
    const t = setTimeout(
      () =>
        (workspaceSaves.current = workspaceSaves.current
          .catch(() => {})
          .then(async () => {
            const prior = sharedWorkspace.current;
            if (prior)
              sharedWorkspace.current = await saveWorkspaceVisual(
                prior,
                design,
              );
            await saveRecovery(design);
          }))
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
  }, [design, ready, recoveryLoaded]);
  const commit = (next: Design) => {
    try {
      const validated = validateDesign(next);
      setHistory((h) => execute(h, validated));
      setStatus("Design updated");
    } catch (e) {
      setStatus(String(e));
    }
  };
  const openCodeWorkspace = async () => {
    if (!ready || busy || draft || editingSketch || switchingWorkspace) return;
    if (hasMeshBodies(current.current)) {
      setStatus(importedCodeReason);
      return;
    }
    setSwitchingWorkspace(true);
    setStatus("Synchronizing this design with the Code workspace…");
    const snapshot = current.current,
      token = revision.current;
    try {
      await workspaceSaves.current;
      const prior = sharedWorkspace.current;
      const code =
        prior &&
        JSON.stringify(snapshot) === JSON.stringify(prior.visual) &&
        (!!snapshot.authoredSource || !hasGeneratedModules(prior.code))
          ? prior.code
          : workspaceCodeForDesign(snapshot);
      const record = await openWorkspaceCode(snapshot, code, prior);
      sharedWorkspace.current = record;
      if (token !== revision.current)
        throw Error(
          "Design changed while switching. Open Code again for the current design.",
        );
      unsaved.current = false;
      location.assign(workspaceUrl("code", record.id));
    } catch (error) {
      setStatus(`Workspace switch failed: ${error}`);
      setSwitchingWorkspace(false);
    }
  };
  const changeFeature = (f: Feature) =>
    commit({
      ...design,
      features: design.features.map((old) => (old.id === f.id ? f : old)),
    });
  const removeFeature = () => {
    if (feature && !("locked" in feature && feature.locked))
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
      if (b.extrusion) b.extrusion.sketch.id = crypto.randomUUID();
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
      if (dragActive.current || sketchActive.current) return;
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
      if (unsaved.current || sketchActive.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  const importMesh = async (
    file: File,
    units: MeshUnit | "file",
    placement: MeshPlacement,
  ): Promise<boolean> => {
    if (busy) return false;
    if (!file.size || file.size > MAX_IMPORT_BYTES) {
      setStatus("Mesh import failed: choose a file between 1 byte and 10 MB.");
      return false;
    }
    const snapshot = current.current,
      token = revision.current;
    let canceled = false,
      cancelWorker: (() => void) | undefined;
    setBusy(true);
    setImporting(true);
    setStatus("Reading and inspecting mesh geometry…");
    job.current = {
      kill: () => {
        canceled = true;
        cancelWorker?.();
      },
    };
    try {
      const data = await file.arrayBuffer();
      if (canceled) throw Error("Mesh import canceled.");
      const asset = await new Promise<MeshAsset>((resolve, reject) => {
        const worker = new Worker(
          new URL("./mesh-import-worker.ts", import.meta.url),
        );
        const cleanup = () => {
          clearTimeout(timer);
          worker.terminate();
        };
        const timer = setTimeout(() => {
          cleanup();
          reject(Error("Mesh import exceeded 30 seconds."));
        }, 30000);
        cancelWorker = () => {
          cleanup();
          reject(Error("Mesh import canceled."));
        };
        worker.onmessage = (e) => {
          cleanup();
          if (e.data.error) reject(Error(e.data.error));
          else resolve(e.data.asset);
        };
        worker.onerror = (e) => {
          cleanup();
          reject(Error(e.message));
        };
        worker.postMessage({ data, name: file.name, units }, [data]);
      });
      if (canceled || token !== revision.current)
        throw Error("Mesh import canceled or design changed; import again.");
      const b = createMeshBody(
        asset,
        file.name.replace(/[\x00-\x1f]/g, ""),
        placement,
      );
      const next = validateDesign({
        ...snapshot,
        meshAssets: snapshot.meshAssets.some((a) => a.id === asset.id)
          ? snapshot.meshAssets
          : [...snapshot.meshAssets, asset],
        bodies: [...snapshot.bodies, b],
      });
      commit(next);
      setSelected(b.id);
      setFit((n) => n + 1);
      setStatus("Mesh imported. Review source units and topology diagnostics.");
      return true;
    } catch (e) {
      setStatus(`Mesh import failed: ${e}`);
      return false;
    } finally {
      job.current = undefined;
      setBusy(false);
      setImporting(false);
    }
  };
  const positionObjects = async (action: PositionAction) => {
    if (busy) return;
    const snapshot = current.current,
      token = revision.current;
    if (action.kind === "align") {
      try {
        independentReference(snapshot, action.target, action.reference);
      } catch (e) {
        setStatus(String(e));
        return;
      }
    }
    const ids =
      action.kind === "distribute"
        ? action.members
        : action.kind === "align"
          ? [action.target, action.reference]
          : [action.target];
    if (
      action.kind === "distribute" &&
      ids.some((id) => !rootNodes(snapshot).some((n) => n.id === id))
    ) {
      setStatus("Choose independent roots for distribution.");
      return;
    }
    let canceled = false,
      activeCancel: (() => void) | undefined;
    setBusy(true);
    setPositioning(true);
    setStatus("Measuring exact geometry for positioning…");
    job.current = {
      kill: () => {
        canceled = true;
        activeCancel?.();
      },
    };
    try {
      const measurements = [];
      for (const id of ids) {
        if (canceled) throw Error("Positioning canceled.");
        const task = evaluateExact(
          generateScad(snapshot, [id]),
          "export",
          snapshot.meshAssets,
        );
        activeCancel = task.cancel;
        const result = await task.promise;
        if (canceled) throw Error("Positioning canceled.");
        const bounds = await new Promise<{ min: number[]; max: number[] }>(
          (resolve, reject) => {
            const worker = new Worker(
              new URL("./bounds-worker.ts", import.meta.url),
            );
            const timer = setTimeout(() => {
              worker.terminate();
              reject(Error("Bounds measurement exceeded 30 seconds."));
            }, 30000);
            const cleanup = () => {
              clearTimeout(timer);
              worker.terminate();
            };
            activeCancel = () => {
              cleanup();
              reject(Error("Positioning canceled."));
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
            worker.postMessage(result.data, [result.data]);
          },
        );
        measurements.push({ id, bounds });
      }
      if (canceled || token !== revision.current)
        throw Error(
          "Positioning canceled or design changed; repeat the operation.",
        );
      let moves: { id: string; delta: Vec3 }[];
      if (action.kind === "distribute")
        moves = distribution(measurements, action.axis, action.mode);
      else {
        const a = measurements[0].bounds,
          delta: Vec3 = [0, 0, 0];
        if (action.kind === "align") {
          const b = measurements[1].bounds;
          const coordinate = (b: typeof a) =>
            action.anchor === "center"
              ? (b.min[action.axis] + b.max[action.axis]) / 2
              : b[action.anchor][action.axis];
          delta[action.axis] = coordinate(b) - coordinate(a);
        } else if (action.kind === "plate") delta[2] = -a.min[2];
        else for (let i = 0; i < 3; i++) delta[i] = -(a.min[i] + a.max[i]) / 2;
        moves = [{ id: action.target, delta }];
      }
      const next = translated(snapshot, moves),
        added = next.features.find(
          (f) => !snapshot.features.some((old) => old.id === f.id),
        );
      commit(next);
      setSelected(added?.id ?? action.target);
      setStatus("Exact positioning complete.");
    } catch (e) {
      setStatus(`Positioning failed: ${e}`);
    } finally {
      job.current = undefined;
      setBusy(false);
      setPositioning(false);
    }
  };
  const exportStl = async (analyze = false) => {
    if (busy || !rootNodes(design).length) return;
    const snapshot = current.current;
    const token = revision.current;
    setBusy(true);
    setAnalyzing(analyze);
    setPositioning(false);
    setStatus("Evaluating exact geometry in OpenSCAD / Manifold…");
    const task = evaluateExact(
      generateScad(snapshot),
      "export",
      snapshot.meshAssets,
    );
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
          source: generateReadableScad(snapshot),
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
  const source = generateReadableScad(design);
  const containsMesh = hasMeshBodies(design);
  return (
    <main className="studio">
      <header inert={!!editingSketch || switchingWorkspace}>
        <div>
          <strong>
            Forma<span>3D</span> Studio
          </strong>
          <small>VISUAL DESIGN • FOUNDATION</small>
        </div>
        <a
          href={containsMesh ? undefined : "?"}
          role="link"
          title={
            containsMesh ? importedCodeReason : "Edit native shapes as OpenSCAD"
          }
          aria-disabled={
            !ready ||
            busy ||
            !!draft ||
            !!editingSketch ||
            switchingWorkspace ||
            containsMesh
          }
          onClick={(e) => {
            e.preventDefault();
            void openCodeWorkspace();
          }}
        >
          {containsMesh
            ? "Code unavailable — mesh in design"
            : "Open Code workspace ↗"}
        </a>
      </header>
      <nav
        aria-label="Project tools"
        inert={!!editingSketch || switchingWorkspace}
      >
        <button
          disabled={!ready || !!editingSketch}
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
        <button
          disabled={!ready || !!editingSketch}
          onClick={() => fileInput.current?.click()}
        >
          Open project
        </button>
        <button
          disabled={!ready || !!editingSketch}
          onClick={() => void saveProject()}
        >
          Save project
        </button>
        <input
          ref={fileInput}
          aria-label="Project file"
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
          disabled={busy || !!editingSketch || !rootNodes(design).length}
          onClick={() => void exportStl()}
        >
          Export exact STL
        </button>
        {busy && (
          <button
            onClick={() => {
              job.current?.kill();
              setStatus("Canceling current operation…");
            }}
          >
            {importing
              ? "Cancel import"
              : positioning
                ? "Cancel positioning"
                : analyzing
                  ? "Cancel analysis"
                  : "Cancel export"}
          </button>
        )}
        <button
          onClick={() => setShowSource((v) => !v)}
          aria-pressed={showSource}
        >
          Generated SCAD
        </button>
      </nav>
      <div
        className="studio-workspace"
        aria-busy={!ready}
        inert={!!editingSketch}
      >
        <aside className="studio-left">
          <h2>Create a solid</h2>
          <div className="studio-primitives">
            {(["box", "sphere", "cylinder", "cone"] as Shape[]).map((kind) => (
              <button
                key={kind}
                disabled={!ready || !!editingSketch}
                onClick={() => add(kind)}
              >
                ＋ {kind}
              </button>
            ))}
          </div>
          <ModuleLibraryPanel
            design={design}
            selected={selected}
            onCommit={(next) => {
              commit(next);
              setSelected(next.bodies.at(-1)?.id);
            }}
            onStatus={setStatus}
          />
          <BooleanTools
            nodes={nodes}
            onCreate={(operation, inputs) => {
              const f = createBoolean(operation, inputs);
              commit({ ...design, features: [...design.features, f] });
              setSelected(f.id);
            }}
          />
          <button
            disabled={!ready || !!editingSketch}
            onClick={() =>
              setEditingSketch({
                value: { height: 10, sketch: rectangleSketch() },
              })
            }
          >
            Sketch & extrude
          </button>
          <ModelingTools
            nodes={nodes}
            roots={rootNodes(design).map((n) => n.id)}
            selected={selected}
            onCreate={(op, inputs) => {
              const f = createModelingFeature(op, inputs, design);
              try {
                const next = validateDesign({
                  ...design,
                  features: [...design.features, f],
                });
                commit(next);
                setSelected(f.id);
              } catch (e) {
                setStatus(`Modeling failed: ${e}`);
              }
            }}
          />
          <MeshImportTools busy={busy} ready={ready} onImport={importMesh} />
          <MechanicalTools
            onAdd={(spec) => {
              const b = createTemplateBody(spec);
              commit({ ...design, bodies: [...design.bodies, b] });
              setSelected(b.id);
            }}
          />
          <PositioningTools
            nodes={nodes}
            roots={rootNodes(design).map((n) => n.id)}
            selected={selected}
            busy={busy}
            onAction={(action) => void positionObjects(action)}
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
                  {f.name} • {"spec" in f ? "feature" : "boolean"}
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
            onCommit={(node) => {
              if ("kind" in node) changeBody(node);
              else {
                changeFeature(node);
                setDraft(undefined);
              }
            }}
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
                onClick={async () => {
                  try {
                    const bundle = await encodeScadBundle(design);
                    download(
                      new Blob([bundle.data], { type: bundle.type }),
                      bundle.name,
                    );
                  } catch (e) {
                    setStatus(`SCAD download failed: ${e}`);
                  }
                }}
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
          {feature && !("spec" in feature) && (
            <BooleanInspector
              feature={feature}
              nodes={nodes}
              onChange={changeFeature}
              onRemove={removeFeature}
            />
          )}
          {feature && "spec" in feature && (
            <ModelingInspector
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
                {body.kind} •{" "}
                {body.kind === "extrusion"
                  ? "sketch origin"
                  : body.kind === "template"
                    ? "template origin (base Z=0)"
                    : body.kind === "module"
                      ? "authored module origin"
                      : body.kind === "mesh"
                        ? "source mesh origin"
                        : "centered origin"}
                {body.locked ? " • locked" : ""}
              </p>
              {body.codeProject && (
                <section aria-label="Linked SCAD source">
                  <h2>Source-backed SCAD</h2>
                  <p>
                    Original code and project files are retained. Transform this
                    result or add visual features. Retained source stays in the
                    native project; mesh bodies block Code access.
                  </p>
                </section>
              )}
              {body.kind === "mesh" && (
                <MeshInspector
                  body={body}
                  asset={
                    design.meshAssets.find((a) => a.id === body.meshAssetId)!
                  }
                />
              )}
              {body.kind === "template" && body.template && (
                <fieldset disabled={body.locked || !!draft}>
                  <MechanicalInspector
                    spec={body.template}
                    onChange={(template) => changeBody({ ...body, template })}
                  />
                  <p>Derived local bounds: {body.size.join(" × ")} mm</p>
                </fieldset>
              )}
              {body.kind === "extrusion" && body.extrusion && (
                <fieldset disabled={body.locked || !!draft}>
                  <legend>Sketch extrusion</legend>
                  <button
                    onClick={() =>
                      setEditingSketch({
                        bodyId: body.id,
                        value: body.extrusion!,
                      })
                    }
                  >
                    Edit sketch
                  </button>
                  <Numeric
                    label="Extrusion height (mm)"
                    value={body.extrusion.height}
                    positive
                    onCommit={(height) =>
                      changeBody({
                        ...body,
                        extrusion: { ...body.extrusion!, height },
                      })
                    }
                  />
                  <p>
                    Local bounds: {body.size.join(" × ")} mm • plane{" "}
                    {body.extrusion.sketch.plane}
                  </p>
                </fieldset>
              )}
              {body.kind === "module" && (
                <ModuleCallInspector
                  key={body.id}
                  body={body}
                  design={design}
                  onChange={changeBody}
                />
              )}
              {body.kind !== "module" &&
                body.kind !== "template" &&
                body.kind !== "extrusion" &&
                body.kind !== "mesh" && (
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
                )}
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
              mesh inspection, sketch extrusions, mesh imports and bounded
              advanced modeling are available. Mesh bodies disable the Code
              workspace; arbitrary edge editing is not supported. Mesh analysis
              does not certify printability.
            </p>
          </details>
        </aside>
      </div>
      {editingSketch && (
        <SketchEditor
          initial={editingSketch.value}
          onCancel={() => setEditingSketch(undefined)}
          onApply={(extrusion) => {
            if (editingSketch.bodyId) {
              const old = design.bodies.find(
                (b) => b.id === editingSketch.bodyId,
              )!;
              changeBody({ ...old, extrusion });
            } else {
              const b = createExtrusion(extrusion);
              commit({ ...design, bodies: [...design.bodies, b] });
              setSelected(b.id);
            }
            setEditingSketch(undefined);
          }}
        />
      )}
      <footer role="status" aria-live="polite" inert={!!editingSketch}>
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
