# Forma3D Studio: implemented scope

A working visual foundation is available through the **Forma3D Studio · Visual
Design** link in the regular editor, or the `?studio=1` query parameter.
The existing OpenSCAD, embedded and MCP workflows remain available.

## Implemented

- Parametric box, sphere/ellipsoid, cylinder/elliptic cylinder and cone.
- Stable body IDs, names, visibility, locking, duplication and deletion.
- Perspective or orthographic Three.js workspace, orbit/pan/zoom, 10 mm grid,
  axes, isometric/top/front/right views and fit all.
- Raycast single selection and highlighted selected solid.
- Move/rotate/scale gizmos with immediate feedback and axis constraints;
  optional 1 mm / 15 degree / 0.1 scale snapping; Escape cancels a drag.
- Numeric dimensions, position, rotation and positive nonuniform scale.
- Document undo/redo; each gizmo drag or completed numeric edit is one command.
- Read-only deterministic generated SCAD and SCAD download.
- Exact binary STL from the OpenSCAD/Manifold worker, with stale-result rejection,
  cancellation, a 60-second timeout and basic binary/triangle validation.
- Native `.forma3d` ZIP project save/open with a SHA-256 integrity manifest,
  bounded decompression and safe path validation; older JSON projects migrate.
- IndexedDB autosave/recovery and unsaved-navigation warnings. Failed recovery
  reads or schema validation pause autosave while preserving the stored record.
- Editable union, difference and intersection features with preserved operands,
  validated DAG references, nested feature support and debounced exact display.
- A circular cylinder/cone diameter control updates width/depth as one undo step.
- Document-owned printer build volume, nozzle, layer height, minimum suggested
  wall and overhang settings, plus a build-volume outline in the viewport.
- Worker-based exact mesh inspection: bounds, area, signed volume for valid edge
  topology, boundary/non-manifold/inconsistent edges, duplicate/degenerate/invalid
  triangles and shell count. Build-volume checks and labeled overhang/elevated
  shell/small-dimension heuristics are provided.
- Resizable side panels on desktop; wrapping tools and properties on narrow
  screens. Full layout persistence and collapsible panels remain future work.
- Rectangle, circle and polygon/polyline sketch editing with grid, origin and
  endpoint snapping; pointer drawing/vertex manipulation and numeric point entry.
- Deterministic linear constraint solving with explicit rank/remaining degrees
  of freedom: fixed coordinates, horizontal/vertical, coincident, signed X/Y
  dimensions and axis-aligned equal lengths. Inconsistent systems are rejected.
- Principal-plane XY/XZ/YZ linear extrusion and dependent boolean recomputation.
  Only closed, nondegenerate, non-self-intersecting profiles may be applied.
- Applied sketch constraints, extrusion parameters and IDs persist in native
  projects and autosave. Older schema-1/2/3/4/5/6 documents migrate to schema 7.
- Non-destructive mirror, linear/circular patterns and groups, with preserved
  inputs, independent result transforms/gizmos and lock controls.
- Sketch profile offset with round/miter/chamfer joins and rotational extrusion.
- Box fillet/chamfer on all four vertical edges; bounds are preserved. Convex
  profile shells with a floor and optional closed top, including edge-treated boxes.
- Exact world-mesh bounds alignment, centering, build-plate placement and root
  distribution by equal gaps or centers. Group/distribution use explicit checkboxes.
- Parametric enclosures with optional four mounting posts/through-holes, spacers,
  standoffs, clearance/counterbore/countersink cutting solids, mounting tabs,
  tapered alignment pins and a snap-fit reference beam. No material/fit guarantee.
- STL/OBJ and compatible core 3MF/static embedded glTF/GLB geometry import,
  explicit unit confirmation, source placement, bounds/area/topology diagnostics,
  transforms/gizmos and closed-mesh feature/boolean participation.
- Hash-checked native mesh assets, schema-7 recovery/history, native container v2
  and portable SCAD-plus-mesh ZIP downloads. Open meshes remain visible/savable;
  unsupported solid operations report explicit errors without guessing a repair.
- Earlier customizer zero/empty-value and 3MF build-UUID fixes retained.

## Not implemented yet

Arcs, arbitrary-face sketches, multiple contours and general nonlinear constraints;
arbitrary-edge fillets/chamfers and general solid shelling; viewport multi-selection;
standalone/open-sketch persistence; additional primitives/text and clipboard commands;
general mesh repair/reconstruction, texture/material import and recent projects;
persistent camera/workspace arrangement; interactive point/angle measurement and
arbitrary wall-thickness analysis.
Only four camera presets and world-space move/rotate are currently exposed.
The original Code workspace retains its broader export and library capabilities;
visual geometry export currently exposes SCAD (bundled with assets for mesh-backed
models) and STL, plus native projects.

Unconsumed visible roots are unioned for final export. Boolean operands remain
editable and may be shared by nested features. Hidden roots are omitted; hidden
operands still participate in the features that reference them. Locking protects direct edits/deletion, but visibility and explicit
unlock remain available. The document uses millimeters; presentation-unit
conversion is not yet supported. Generated meshes are not guaranteed printable;
edge topology and connected shells are measured, while overhangs are heuristic.
Self-intersections, non-manifold vertices, actual internal wall thickness and
slicer acceptance are not verified. Analysis is limited to 250,000 triangles.

The foundation is usable; the full Forma3D product and scenarios A–G are not
complete. See TESTING.md for exact evidence and ARCHITECTURE.md for the roadmap.

## Linked visual and Code workspaces

- Native shapes synchronize between visual modeling and direct OpenSCAD expressions.
- Unchanged native graphs survive round trips; generated primitive dimensions
  and transforms map back to existing native bodies.
- Editable source uses actual `cube`, `sphere`, `cylinder`, boolean and pattern
  expressions without generated object modules or aliases.
- Any mesh body blocks switching to Code, including hidden and consumed inputs.
- Unsupported source stays in Code without automatic mesh substitution. Legacy
  mesh/source metadata remains readable in native projects.
- Local saves survive reloads, syntax failures preserve code, and revision checks
  prevent stale tabs from silently overwriting newer shared work.

See [the workflow, supported subset and limits](USER_GUIDE.md#switch-between-visual-modeling-and-code).

## Authored modules and reusable library

- Explicit authored modules are allowed alongside direct native expressions.
- Returning from Code offers a source/dependency review for new modules and
  optional updates; cancel and skip preserve source.
- Browser-local library supports save selected shape, parameterized insertion,
  reviewed backup import/export and revision-conflict protection.
- Project snapshots embed declarations and invocations, keeping existing designs
  stable across library updates; schema 7 migrates earlier projects.
- Imported mesh bodies still block Code. Module code must be self-contained and
  cannot import external geometry or shadow native built-in operations.
