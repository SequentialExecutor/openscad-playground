# Forma3D Studio architecture

## Baseline and scope

Audited baseline: `d4552def6a9b047b016b321f31cdcdcb7e6cfd5b`.
The remote default branch is `main`; this cloud checkout uses branch `work`.
This document describes the original application and the visual foundation now
implemented under `src/studio`. The published network configuration enabled the
WASM download; the baseline production build, type check and four representative
rendering/diagnostic browser tests passed before visual implementation.

## Existing system

`src/index.tsx` starts engine compilation and initializes a BrowserFS editor
filesystem. Standalone mode initializes Monaco and restores source/view state
from a URL fragment, or local storage in installed mode. MCP mode dynamically
loads its bridge and mounts `McpApp`, retaining host state separately.

`App` owns React state and creates a `Model` facade. `Model.mutate` performs
immutable updates through `deep-mutate`, then invokes the state persister.
`State.params` contains source files, active path, customizer variables, feature
flags and export formats. It is a source document, not a CAD feature graph.
`State.view` and transient output/busy/error fields share that state.

`FullLayout` composes `EditorPanel` (Monaco or text fallback), `ViewerPanel`
(model-viewer, GLB display, camera and screenshot APIs), `CustomizerPanel`
(OpenSCAD-generated parameters), panel switching and status UI. Embed mode
retains a compact viewer; MCP app tools operate through the same model.
The viewer has no editable per-body scene graph or transform gizmos.

`runner/actions.ts` debounces syntax checks and preview renders. It generates
OpenSCAD CLI arguments with the Manifold backend and explicit binary STL output.
`openscad-runner.ts` creates a fresh worker for each invocation, terminates it on
completion/cancellation, shares compiled WASM and retries missing library mounts.
`openscad-worker-core.ts` mounts selected archives in an Emscripten filesystem,
writes sources, invokes `callMain` and collects output/diagnostics. Preview and
export use separate supersession slots; Model generation counters guard output
publication. Worker error/rejection and timeout coverage need further audit;
there is no global resource budget for arbitrary source evaluation.

`src/fs` indexes libraries, resolves transitive archive dependencies and lazily
mounts ZIPs. Files are local by default; explicitly URL-backed source files may
be fetched. Existing Monaco/assets can require network access. Do not describe
the current application as having a zero-network privacy guarantee.

STL/OFF/SVG/DXF come from OpenSCAD. OFF is parsed to indexed triangles for
`export_glb.ts` and `export_3mf.ts`. The latter constructs an OPC ZIP with a
model, relationships and content types. Structural regression tests now check
geometry and UUIDs, but do not establish complete 3MF specification compliance
or slicer acceptance. Existing export code is reusable, not yet a full mesh
validation pipeline. Source download bypasses geometry evaluation by design.

## Extension boundaries

1. A versioned, serializable document in millimeters is authoritative. Typed
   feature nodes use stable IDs and explicit input references. Validate finite
   parameters, units, graph cycles, missing references and bounded asset sizes
   at every import boundary. Imported SCAD remains opaque, with supported
   explicit parameters; never infer a complete history from arbitrary source.
2. Commands update the document and implement undo/redo transactions. A drag
   records one command; cancellation restores its initial transform. Camera and
   selection state are separate from geometry history.
3. A dedicated Three.js viewport derives objects from the document, owns and
   disposes GPU resources, raycasts selection and isolates camera/gizmo events.
   Primitive previews are interactive representations, never final boolean
   results or fallback export meshes.
4. A deterministic compiler emits SCAD from the feature graph. A versioned
   geometry adapter submits immutable document snapshots to the existing worker
   pipeline. Only results matching the current document revision may publish.
   Preserve documents on worker failures and implement bounded timeouts.
5. Exact meshes feed independent bounds/topology analysis and export modules.
   Distinguish verified defects from thin-wall/overhang heuristics. Final export
   must fail explicitly when evaluation fails or the result is stale.
6. IndexedDB persistence and versioned `.forma3d` ZIP containers preserve the
   feature graph, local assets, camera, units and print settings. Validate ZIP
   paths, expanded sizes, schema and references before committing a load.
7. Visual Design and existing Code mode coexist. Generated code is read-only;
   switching modes must never overwrite unrelated source-backed documents.

## Delivery gates

Phase 0: audit, regression fixes and a working baseline build/render suite.
Phase 1: usable primitive editor, hierarchy, selection, numeric editing, gizmos
and transactional history. Phase 2: exact graph evaluation and editable booleans.
Phase 3: closed sketch profiles, bounded constraints, extrusion and proven narrow
features. Phase 4: recovery, native projects and tested mesh interoperability.
Phase 5: geometry inspection, build plate and print templates. Phase 6: browser,
accessibility, security, performance and acceptance-scenario verification.

Do not expose later operations as working toolbar buttons. Do not advance past
unresolved foundational build/render failures. See TESTING.md for evidence and
FEATURES.md for current product scope.


## Implemented visual foundation

`?studio=1` loads `Studio` as a separate lazy entry inside the existing webpack
application. The regular URL, embed mode and MCP application retain their
existing workflows. `document.ts` owns a version-1 document of centered primitive
bodies, with millimeter dimensions, degree rotations, positive scales, stable IDs,
visibility and locks. The flat body collection is the first document schema, not
the planned dependent feature graph. Imported documents are bounded and validated;
unknown versions are rejected rather than silently migrated.

`execute`, `undo` and `redo` retain immutable document snapshots (100 undo steps).
Numeric controls commit on blur/Enter; a mouse drag commits once on release.
The viewport owns Three.js meshes, raycasting, OrbitControls and TransformControls.
It disposes replaced geometry/materials and renderer resources. Gizmo feedback is
transient and updates the inspector; cancellation restores the starting transform.
SCAD XYZ rotations and Three.js Euler ZYX composition produce matching geometry.

`generateScad` is deterministic for a given document. STL export snapshots the
document and invokes the existing isolated worker with `isPreview:false`. It
rejects stale revisions, timeouts, empty/malformed binary STL and nonfinite or
zero-area triangles. This is bounded structural validation, not a complete
watertightness or printability check. No mesh preview is used as export fallback.

IndexedDB contains one local recovery document, saved after a debounce. Downloads
and uploads use `.forma3d.json` with a 2 MB import limit. This is deliberately
separate from the future ZIP format with imported assets. Persistence failures
remain visible; pending unsaved work triggers the browser's navigation warning.
Camera changes and transient selection never enter geometry undo history.
