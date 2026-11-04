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
7. **Save project** downloads a versioned `.forma3d.json` file. **Open project**
   validates and loads that format. One local recovery slot is autosaved in
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
unioned by OpenSCAD. The current editor does not offer editable boolean features,
mesh imports, sketches, manufacturing tolerances or printability guarantees.
