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
- Versioned `.forma3d.json` project download/upload, bounded schema validation,
  one IndexedDB autosave/recovery slot and unsaved-navigation warnings.
- Resizable side panels on desktop; wrapping tools and properties on narrow
  screens. Full layout persistence and collapsible panels remain future work.
- Earlier customizer zero/empty-value and 3MF build-UUID fixes retained.

## Not implemented yet

Dependent feature graph; editable union/difference/intersection features;
sketches/constraints/extrusion; shell/fillet/chamfer; patterns; multi-selection;
mesh import and repair; project asset ZIPs/migrations/recent projects; persistent
camera/workspace arrangement; 3D measurement tools and printer analysis/templates.
Only four camera presets and world-space move/rotate are currently exposed.
The original Code workspace retains its broader export and library capabilities;
visual mode currently exposes SCAD and STL only.

Multiple visible bodies are implicitly unioned for final export. They remain
separate primitives in the document, not editable boolean features. Hidden bodies
are omitted. Locking protects direct edits/deletion, but visibility and explicit
unlock remain available. The document uses millimeters; presentation-unit
conversion is not yet supported. Generated meshes are not guaranteed printable;
watertightness, connected shells and overhangs are not yet analyzed.

The foundation is usable; the full Forma3D product and scenarios A–G are not
complete. See TESTING.md for exact evidence and ARCHITECTURE.md for the roadmap.
