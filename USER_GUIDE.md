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


## Advanced modeling

Select a solid, expand **Advanced modeling**, and confirm its **Source** before
creating a feature. The original solid stays editable in Objects; the feature
consumes its input for final output. Removing the feature releases that input.
Names, references, settings and independent result transforms persist in projects
and undo/redo. Move/rotate/scale gizmos also work on modeling results. Result
transforms use a world-origin pivot, so rotating a group moves its members around
that origin. Lock a result to protect its parameters and transform.

| Tool | Supported geometry and controls |
| --- | --- |
| Mirror | Reflect any solid about world X/Y/Z planes, with a plane offset and optional original. |
| Linear pattern | 2–100 instances, including the original; X/Y/Z spacing is per instance in world units. |
| Circular pattern | 2–100 instances about a world-origin axis; offset the source first. A full circle avoids a duplicate endpoint; a partial sweep includes both ends. |
| Group | Check independent roots, then **Group selected roots**. The group unions their geometry and adds an independent transform. |
| Box vertical fillet | Round all four vertical edges of a box with a radius smaller than half its width/depth. Outer dimensions stay fixed. |
| Box vertical chamfer | Cut all four vertical edges of a box with the specified straight setback. Outer dimensions stay fixed. |
| Shell | Hollow a box, circular cylinder, rectangular/circular sketch extrusion, or edge-treated box. Set wall thickness and choose an open extrusion end or closed top. |
| Profile offset | Offset a sketch before linear extrusion; choose round, miter or chamfer joins. Negative values inset. Collapsed profiles produce an evaluation error. |
| Revolution | Revolve an XY sketch about its Y axis, mapping sketch X to radius and Y to output Z height. The entire profile must satisfy X ≥ 0; its linear extrusion height is ignored. Set 0 < angle ≤ 360°. |

Fillet/chamfer are four-vertical-edge box operations; arbitrary edge picking is
not available. Shell supports the convex profiles listed above, not arbitrary
boolean or imported solids. Its wall is measured before source scaling; nonuniform
scale changes physical thickness. Apply shell before transforming an edge-treated
feature, then transform the shell result. Graphs are limited to 64 levels and
10,000 expanded primitive instances; very complex evaluations can time out.

For a ring, make an XY rectangle with width 5 mm, depth 20 mm and anchor X=10 mm,
apply its extrusion, then choose **Revolution**. The result has inner radius 10 mm,
outer radius 15 mm and height 20 mm. Edit the original sketch to change the ring.

![Editable circular pattern and result transform](docs/images/advanced-pattern.png)

## Align, distribute and place

Expand **Align & distribute**. Choose a target, reference and axis, then align
minimum bounds, centers or maximum bounds. **Center on origin** centers all three
bounds axes; **Place on build plate** moves the minimum Z to zero. These commands
measure actual world-space OpenSCAD STL geometry, including rotations, rather than
using object origins. A reference depending on the target is rejected.

For distribution, check at least three independent roots. Equal gaps uses actual
widths and rejects a layout without enough space; equal centers may overlap.
The outer objects stay fixed. Each action is one undo step. Boolean results get
a reversible transform group; source operands remain intact. Measuring can be
canceled and rejects results if the design changes before completion.

## Mechanical templates

Expand **Mechanical templates**, choose a template and **Add mechanical template**.
Edit its dimensional controls in the inspector; bounds are derived from those
parameters. Templates start at Z=0 and support normal transforms and booleans.

- **Enclosure:** open-top box, wall/floor thickness, rounded vertical corners,
  optional four mounting posts and optional through-holes in posts and floor.
  Mounting inset is measured from the outer edges; posts and holes follow width
  and depth edits. Invalid wall/post fits are rejected.
- **Spacer / Standoff:** outer/bore diameters and height; standoff adds a flange.
  A zero bore creates a solid post.
- **Hole cutter:** clearance, counterbore or countersink solid. Nominal diameter
  plus allowance gives the shaft diameter. Head diameter and recess depth or
  countersink angle set the opening. Position it through your part and subtract
  it with **Difference**; adding the cutter alone does not create a hole.
- **Mounting tab:** rounded rectangular tab with a dimensioned offset hole.
- **Alignment pin:** shaft with a tapered tip, with configurable dimensions.
- **Snap-fit reference:** cantilever beam with a triangular latch ramp. This is
  reference geometry; it does not calculate strain, material strength or fit.

Printer tolerances, material behavior and snap-fit strength require physical
validation. The supplied enclosure example is 120 × 60 × 30 mm with a 3 mm floor,
four 8 mm posts and 3 mm through-holes. Open
[`parametric-enclosure.forma3d`](examples/forma3d/parametric-enclosure.forma3d) to
change its parameters; the adjacent STL is actual kernel output.

![Parametric enclosure with posts and holes](docs/images/mechanical-enclosure.png)

Mesh import remains deferred. These tools operate on the document's native
parametric geometry.
