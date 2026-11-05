# Forma3D Studio foundation guide

Start the development server with `npm start` after the setup in README.md.
Open the **Forma3D Studio · Visual Design** link in the regular editor. Code and
Visual Design are separate documents; generated SCAD is read-only.

1. Choose **box**, **sphere**, **cylinder** or **cone** from the left palette.
2. Select a body in the list or click its surface in the workspace.
3. Enter dimensions in the inspector. Width/depth/height are the unscaled local
   bounds, in millimeters. Sphere dimensions can differ to create an ellipsoid.
   Commit numeric values with Enter or by leaving the field. Escape cancels a
   numeric edit. Dimensions and scales must be positive.
4. Use Move, Rotate or Scale and drag an axis handle. Numeric transform fields
   follow the drag. Escape cancels it; releasing normally creates one undo step.
5. Use **Undo/Redo** (Ctrl/Command Z, Shift Z or Y), Duplicate and Delete. A
   locked body cannot be transformed or deleted until unlocked. The visibility
   button hides a body from both workspace and export.
6. Orbit by dragging the workspace; right-drag to pan, wheel to zoom. Choose a
   camera preset, Fit all, or Orthographic. The grid spacing is 10 mm. Snapping
   uses 1 mm translation, 15 degree rotation and 0.1 scale increments.
7. **Save project** downloads a versioned `.forma3d` ZIP file with an integrity
   manifest. **Open project** validates and loads native files or older JSON files. One local recovery slot is autosaved in
   IndexedDB. Keep downloads for durable independent backups. New/Open replace
   the current recovery slot; New can be undone during the current session.
8. **Export exact STL** compiles the visible solids in an OpenSCAD worker. It
   exports the final geometry, never the interactive preview. If you change the
   document during evaluation, retry the rejected export. Use Cancel export to
   stop it. Watch the status bar for errors and local-save failures.
9. **Generated SCAD** opens read-only source with a download button. Use the
   separate Code workspace for manually edited SCAD and the existing customizer,
   library support and additional export formats.

Exported STL is in millimeters; many STL readers assume a unit because STL itself
has no reliable unit metadata. Final geometry from multiple visible bodies is
unioned by OpenSCAD. Mesh imports and manufacturing templates are still pending.
Mesh inspection does not guarantee printability.


## Editable boolean modeling

Create two solids, then choose **Base / first operand** and **Tool / second
operand** in the left panel. **Difference** subtracts the second from the first;
**Union** combines them; **Intersection** retains their overlap. Exact geometry
appears after a short worker evaluation. Operands stay in Objects and do not
render as additional standalone solids once consumed.

Select a boolean to edit its operation/references. Select an operand to change
its dimensions or transform; a wireframe helper and gizmo appear. For a circular
cylinder, **Diameter (mm)** changes both width and depth in one undo command.
An empty intersection reports a failure while keeping the project editable.
Correct an operand to recover. Remove dependent features before deleting an
operand; deleting a boolean releases its inputs. Nested booleans may reference
other results. Invalid cycles are rejected.

## Print setup and inspection

Expand **Print setup & mesh analysis** in the inspector. Set the dimensions for
your own printer: the outlined build volume is centered around X/Y zero and
starts at Z zero. Nozzle/layer/wall/overhang defaults are suggestions.

**Analyze exact mesh** first evaluates the current final model and then measures
it in a worker. Geometry defects, bounds, shell count and volume are separated
from heuristic warnings. Old results disappear when geometry or settings change.
The report does not check all wall thicknesses, self-intersections or support
requirements. STL volume assumes consistent material/cavity shell winding.
The edge weld tolerance is 0.00001 mm, and analysis supports up to 250,000 triangles.
Printer settings are included in autosave and native project files.

## Screenshots

![Visual modeling workspace](docs/images/studio-overview.png)

The hierarchy and inspector stay synchronized with the selected solid.

![Editable subtraction](docs/images/editable-boolean.png)

The cube and cylinder remain editable operands of the Difference feature.

![Mesh inspection](docs/images/mesh-analysis.png)

The report comes from actual evaluated triangles; heuristic warnings are labeled.

## Sketch profiles and extrusion

Choose **Sketch & extrude**. The sketch editor opens a separate draft transaction;
**Apply extrusion** commits one undo step and **Cancel sketch** keeps the previous
solid. Unapplied sketches cannot be saved/exported, and navigation warns about the
draft. Applied profiles and constraints participate in project recovery.

- **Rectangle** exposes width, depth and its fixed first-corner anchor. Its
  horizontal/vertical and dimensional constraints are verified by the solver.
- **Circle** exposes radius and center. The default center/radius constraints
  completely determine it. Removed dimensions can be restored explicitly.
- **Polygon / polyline** supports clicking points, grid/endpoint/origin snapping,
  dragging free vertices, or precise **Point X/Y** plus **Add point** entry.
  Close the profile before applying. Open, zero-length, degenerate and
  self-intersecting profiles are reported and cannot be extruded.
- The constraints panel supports fixed coordinates, horizontal/vertical edges,
  coincident points, signed X/Y distances and equal lengths for axis-aligned
  segments. The status reports the solver's remaining degrees of freedom;
  underconstrained polygons are not labeled fully constrained.
- Choose XY (extrude +Z), XZ (extrude −Y), or YZ (extrude +X), and a positive
  extrusion height. Use **Fit profile** or zoom controls when a dimension changes
  beyond the current view. The profile origin is retained, not recentered.

Select an extrusion in Objects to change its height, **Edit sketch**, or use
normal transform gizmos. Boolean features can reference the extrusion. Editing a
sketch dimension then recomputes dependent geometry; undo restores the prior
profile and exact result.

![Verified rectangular constraints and extrusion dimensions](docs/images/sketch-editor.png)

Profiles are limited to 64 points and 256 constraints. General nonlinear
constraints, arcs, multiple-contour sketches and arbitrary-face attachment are
not available. Coincident endpoints can close a profile even without its explicit
closing edge. Draft point positions are transient until Apply; the last valid
applied document remains intact after invalid edits or worker errors.
