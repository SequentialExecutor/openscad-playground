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
- IndexedDB autosave/recovery and unsaved-navigation warnings.
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
- Earlier customizer zero/empty-value and 3MF build-UUID fixes retained.

## Not implemented yet

Sketches/constraints/extrusion; shell/fillet/chamfer; patterns; multi-selection;
mesh import and repair; imported project assets and recent projects; persistent
camera/workspace arrangement; interactive point/angle measurement, arbitrary wall-thickness analysis and mechanical templates.
Only four camera presets and world-space move/rotate are currently exposed.
The original Code workspace retains its broader export and library capabilities;
visual geometry export currently exposes SCAD and STL only, plus native projects.

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
