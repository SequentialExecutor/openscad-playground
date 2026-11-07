# Validation record

Baseline: `d4552def6a9b047b016b321f31cdcdcb7e6cfd5b`, remote default `main`.
Environment: Linux, Node 24.22.1, npm 11.9.0, system Chromium.
Root/server dependencies use their lockfiles. The published network policy now
allows `files.openscad.org`; the configured upstream WASM release downloaded
successfully without disabling TLS or replacing checksums. The earlier HTTP 403
and resulting missing-module build/type failures are resolved.

## Foundation and document checks

From the repository root, after installing root and server dependencies:

```sh
node --import ./server/node_modules/tsx/dist/loader.mjs --test tests/foundation.test.tsx tests/studio-document.test.ts
npx --no-install tsc --noEmit
node tests/foundation-browser.mjs
```

Seven Node tests passed: 3MF package geometry/relationships/UUIDs, actual
customizer markup, document schema/ID validation, serialization, history and
deterministic SCAD generation. The original customizer/UUID tests reproduced two
failures before the fixes. Chromium customizer typing/reset passed independently.
The UUID's extra brace was inside a quoted XML attribute: it invalidated the UUID
value, rather than making the XML unparseable. Complete 3MF schema/slicer
interoperability remains untested.

## Browser workflows

```sh
CI=true PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e -- --runInBand
CI=true PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e -- --runInBand tests/studio.test.js
```

The full development suite passed 54 tests with 26 conditionally skipped tests
before the final import/cancellation cases were added. The original four-test
baseline subset (default page, cube, valid GLB, syntax-error locations) also
passed before visual implementation. Skipped tests are not counted as passing.

Visual tests exercise real React controls and WebGL, raycast selection, actual
pointer gizmo movement, transaction undo, Escape cancellation, numeric edits,
visibility/locks, duplication/deletion, IndexedDB reload with stable IDs, project
validation, orthographic mode, export cancellation/retry, and actual OpenSCAD
worker-generated binary STL. A 50 × 30 × 20 mm box rotated 90° around Z exports
with bounds (0, −25, 0) to (30, 25, 20) mm after translation. Every STL vertex
is read back to check finite coordinates and bounds. The emitted sample project
and mesh are in `examples/forma3d`.

Downloads are captured from the application's actual blob URL in the test browser;
these tests do not substitute generated source or a Three.js mesh for kernel
output. The pointer test projects the real world-space gizmo into screen space
and sends browser mouse events. Browser fixture selection was corrected after an
initial triple-click appended text rather than selecting the numeric field.

## Production and MCP

```sh
npm run build
(cd server && npm run build)
(cd server && PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium npm test)
```

The production baseline and first visual build passed with webpack asset-size
warnings. `three` and its types are pinned to 0.187.0. Root dev dependency
`esbuild@0.28.2` is declared because the existing MCP cross-origin browser test
requires it from the root; previously this check failed with MODULE_NOT_FOUND
once a real dist build became available. No assertion was disabled to fix it.

## Limits

Chromium is the only browser engine verified so far. A second engine, full mesh
topology/slicer compatibility, context-loss recovery, performance benchmarks,
feature graph/boolean/sketch acceptance scenarios A–G, and imported mesh roundtrip
are not complete. No guarantee of printability is inferred from passing tests.
At the initial foundation checkpoint, persistence used primitive JSON; the newer
container/feature-graph increment is documented below. Imported assets remain unsupported. TESTING.md distinguishes historical,
current and skipped outcomes; a successful compile alone is not geometry proof.

## Foundation production validation (commit 2be4756)

The final source passed `npm run build` and `npx --no-install tsc --noEmit`.
The expanded visual suite passed all 5 tests in development. A focused production
run then passed 12 tests across 3 suites: 5 visual workflows, 4 original Code-mode
rendering/diagnostic checks, and 3 bundle checks; 45 other tests were excluded by
the explicit test-name filter, rather than executed and passed.

Production validation served the actual `dist` directory with the repository's
`serve` dependency on port 3000 and used this configuration outside the checkout:

```js
module.exports = {
  launch: { headless: true, args: ['--no-sandbox'] },
  server: {
    command: 'npx --no-install serve --listen 3000 .',
    port: 3000,
    launchTimeout: 30000,
  },
};
```

With that file saved as `/tmp/forma-prod-puppeteer.cjs`, the command was:

```sh
NODE_ENV=production E2E_BASE_URL=http://localhost:3000/dist/ \
JEST_PUPPETEER_CONFIG=/tmp/forma-prod-puppeteer.cjs \
CI=true PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
npm run test:e2e -- --runInBand tests/studio.test.js tests/e2e.test.js tests/bundle.test.js \
  --testNamePattern='Forma3D visual foundation|load the default page|can render cube|displayed model is a valid GLB|syntax error markers|bundle'
```

The complete MCP suite passed 115 non-browser checks plus its cross-origin
browser render/screenshot scenario (28 asset requests, no leaked requests or CSP
violations). It ran against the first visual production build. The final unit
run passed all 7 tests, and the standalone Chromium customizer check passed.
`git diff --check` passed. Webpack's asset-size warnings remain; they are not
compilation errors.

The expanded tests initially exposed a stale autosave status after a new edit:
“Saved locally” could remain visible until the next write completed. This caused
navigation hooks to move on while the before-unload protection was still active.
The application now explicitly reports “Saving locally…” for the pending revision;
the rerun passed. Numeric Escape cancellation and rename undo were also checked.

## Boolean, native-container and inspection increment

Nineteen Node tests pass across `foundation.test.tsx`, `studio-document.test.ts`,
`mesh-analysis.test.ts` and `project-file.test.ts`. They cover version-1 migration,
boolean references/root selection, nested source, missing operands, cycles,
printer settings, ZIP roundtrip, payload integrity, unsafe paths, expanded-size
limits, topology defects, connected shells, area/volume and warning settings.

Seven visual browser workflows pass in the focused development run (the original
5 plus 2 boolean scenarios). The boolean scenario verifies an actual through-hole
with 10 mm then 15 mm diameter and a one-command undo back to 10 mm, checking STL
inner radius, void crossings, volume and bounds. Save/reload preserves operand
IDs. Union/intersection volumes are measured; an empty intersection rejects
export, preserves the document and recovers after editing the operand.

The same real mesh is sent to the analysis worker. Its volume matches the direct
STL volume calculation; changing the saved build volume produces the expected
warning. Native ZIP files are saved and uploaded through the browser, while
legacy JSON and invalid-document cases remain covered. The native hole example
and exact STL are in `examples/forma3d/editable-hole.*`.

New command for unit validation:

```sh
node --import ./server/node_modules/tsx/dist/loader.mjs --test \
  tests/foundation.test.tsx tests/studio-document.test.ts \
  tests/mesh-analysis.test.ts tests/project-file.test.ts
```

The expanded suite initially had an incorrect readiness predicate: negating an
optional button lookup treated an absent button as ready. The predicate now
requires an existing enabled button. No application behavior or assertion was
disabled to pass it. Autosave status is now displayed separately from operation
results so a successful background save cannot erase a modeling error.

Analysis does not certify manifold vertices, shell self-intersections, actual
internal wall thickness, slicing success or material fit. Multiple-shell volume
assumes consistent material/cavity winding. Coordinate welding uses 0.00001 mm,
analysis is capped at 250,000 triangles, exact evaluation at 60 seconds and
inspection at 30 seconds. These are implementation limits, not skipped proofs.

Final results for this increment:

- Full development browser suite: 58 passed, 26 conditionally skipped.
- Final production subset: 14 passed across 4 suites; 45 unrelated tests excluded
  by the explicit name filter. Includes both boolean scenarios, all five visual
  workflows, four Code-mode checks and three bundle checks.
- Unit suite: 19 passed. Production build and strict type check passed.
- `git diff --check` passed. Existing webpack size warnings remain.

The first focused production run passed 13 checks but timed out in one navigation
hook. The hooks now wait two animation frames for pending React updates before
asserting that the current document is saved. Navigation protection and all save
assertions remain active; the final 14-check rerun passed. The separate operation
and save statuses keep modeling errors from being overwritten by background saves.

Numeric fields now commit only after an actual edit. A production regression
check preserves a 0.000004 mm position through focus/blur even when its display
rounds to five decimals. The exact value is available in the field's tooltip.
Unusual imported feature IDs use prototype-free lookup records; canonical
validation strips unknown printer fields. Archive roundtrip tests include an
unusual `__proto__` feature ID.

## Schema-3 sketches and documentation screenshots

The focused development run passed 11 browser workflows, including four sketch
cases: dimensioned rectangle extrusion with a dependent hole/width change and
undo/redo/reload; circular extrusion on YZ; pointer-drawn polygons with rejection
of self-intersection; and precise numeric vertex entry. Kernel STL bounds and
volume are inspected. The full development run passed 62 tests with 26 skipped
by the suite's existing conditions.

All 25 unit tests pass. Six sketch tests cover solver rank, dimensional
propagation, inconsistent constraints, underconstrained/open/self-intersecting
profiles, coincidence, axis-aligned equal length, circle parameters, plane frames,
serialization and derived dimension validation. The original model/file/topology
checks remain in the unit command:

```sh
node --import ./server/node_modules/tsx/dist/loader.mjs --test \
  tests/foundation.test.tsx tests/studio-document.test.ts \
  tests/mesh-analysis.test.ts tests/project-file.test.ts tests/sketch.test.ts
```

`examples/forma3d/sketch-plate.forma3d` and its STL were captured from the actual
browser/kernel workflow. The 60 × 30 × 12 mm plate has a 6 mm through-hole.

Documentation screenshots are actual production-app captures at 1600 × 1100,
device pixel ratio 1, using system Chromium. The capture script runs a temporary
local static server, opens the editable-hole native example, evaluates the actual
model/inspection and opens a 40 × 30 mm sketch draft with 12 mm extrusion height.
It closes its browser/server afterward. No screenshots were generated with mock
geometry or manually overlaid controls. README.md and USER_GUIDE.md link all four
images under `docs/images`.

The final review makes background UI inert during a sketch transaction and keeps
focus inside the modal when Escape cancels numeric input. General nonlinear
constraints, arbitrary-face sketches, arcs, multiple contours and a second browser
engine remain unverified/unsupported; no general constraint-solver claim is made.

Final production validation for this increment passed 18 checks across five
suites: all 11 visual workflows, four original Code-mode checks and three bundle
checks. Forty-five other tests were excluded by the explicit name filter rather
than executed and passed. Production build, strict type check and whitespace
validation passed. The final sketch assertions also verify YZ minimum/maximum
bounds, Escape focus retention and inert background controls.

The full development suite passed 62 tests with 26 conditionally skipped tests.
The selected production command extends the earlier command with
`tests/studio-sketch.test.js` and `Parametric sketch extrusion` in its filter.
No unsupported solver operation or unexecuted browser engine is counted as passing.

A fresh production rerun of the four sketch cases passed after the final focus
and plane-bound assertions were added. The checked-in example was independently
reopened with the final decoder: schema 3, rectangle area 1800 mm², zero free
variables, STL dimensions 60 × 30 × 12 mm, closed edge topology and volume
21261.2527609 mm³. This agrees with the 64-segment 6 mm hole through the plate.

## Schema-4 advanced modeling

The new `advanced-modeling.test.ts` adds six unit cases. The combined suite now
executes 31 assertions covering model/schema validation, migrations, graph roots,
modeling parameters, dependency restrictions, instance budgets, template fits,
measured-bounds positioning, solver behavior, native containers and topology.
The complete command is:

```sh
node --import ./server/node_modules/tsx/dist/loader.mjs --test \
  tests/foundation.test.tsx tests/studio-document.test.ts \
  tests/mesh-analysis.test.ts tests/project-file.test.ts tests/sketch.test.ts \
  tests/advanced-modeling.test.ts
```

`studio-advanced.test.js` exercises real application controls and OpenSCAD binary
STL, including volume, finite bounds and paired, consistently oriented triangle
edges. Cases cover:

- Four-vertical-edge box fillet/radius changes and true chamfer setbacks; open
  and closed shells, and a shell derived from a filleted box. Rounded-shell
  expected volume accounts for the actual 64-segment outline's uniform inset.
- Mirrors, editable linear/circular patterns, result transforms and preserved
  source poses. The result gizmo receives actual mouse events, changes the final
  kernel mesh and commits exactly one undo step.
- Positive/negative sketch offsets and full/partial revolutions with analytically
  checked dimensions and volumes.
- Enclosure width changes with four posts/holes: new hole positions, old hole
  positions, floor/post heights, saved parameters and native reload.
- Counterbore and countersink subtraction with measured recess depths/volumes,
  plus spacer, standoff, tab, pin and snap-reference exports.
- Exact-bounds distribution, alignment, plate placement and group transforms.

The checked-in enclosure example was independently decoded as schema 4 and its
STL inspected: 2,604 triangles, bounds (−60, −30, 0) to (60, 30, 30) mm, one shell,
closed edge topology, no boundary/non-manifold/inconsistent edges or invalid,
degenerate or duplicate triangles, and volume 50184.0386307 mm³. This is geometry
validation, not a material-strength or slicer certification.

All six documentation screenshots are captured from the production application.
The enclosure capture orbits the real viewport to expose all four posts; the
circular pattern capture shows the independent result transform controls. The
capture script retains the four earlier workflows and closes all browser/server
resources. Mesh import remains deferred and is not counted as implemented.


The full development run passed 74 browser tests across eight suites, with four
suites/26 tests conditionally skipped by the existing test conditions. It ran
before the final numeric rejected-value display fix. The final unit run executes
and passes all 31 assertions; production build and strict type check pass.
Webpack's existing bundle/WASM size warnings remain.

A rejected numeric edit now restores the accepted document value in the input.
The advanced production regression attempts an invalid 100 mm fillet radius,
checks the visible value returns to 4 mm, then verifies the kernel volume remains
unchanged. Unchanged-field precision protection remains active.

The final production command uses the temporary server configuration described
above and executes all visual workflows plus representative Code/bundle checks:

```sh
NODE_ENV=production E2E_BASE_URL=http://localhost:3000/dist/ \
JEST_PUPPETEER_CONFIG=/tmp/forma-prod-puppeteer.cjs \
CI=true PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
npm run test:e2e -- --runInBand \
  tests/studio.test.js tests/studio-booleans.test.js tests/studio-sketch.test.js \
  tests/studio-advanced.test.js tests/e2e.test.js tests/bundle.test.js \
  --testNamePattern='Forma3D visual foundation|Editable boolean geometry|Parametric sketch extrusion|Advanced parametric modeling|load the default page|can render cube|displayed model is a valid GLB|syntax error markers|bundle'
```

Final production validation passed all 30 selected checks across six suites,
including all 23 visual workflows. Forty-five other tests were excluded by the
explicit name filter, rather than executed and passed. The rejected-radius
regression passed against the final build. The full development record above
and the final production record have different scopes and are not combined into
a single test count. All six screenshots were refreshed against the final build;
`git diff --cached --check` passed.

## Recovery preservation and template-fit repairs

The recovery regression uses isolated Chromium contexts and real IndexedDB. One
case injects a transient recovery read error; another stores an invalid-schema
record. Each verifies the existing record remains unchanged after
startup and after subsequent edits, waiting beyond the autosave debounce. Native
project download remains available, unsaved navigation raises a warning, a fresh
successful startup restores the original body ID, and later edits autosave again.
An empty recovery slot remains a successful read and supports normal autosave.

Two additional template unit cases bring the executed unit suite to 33 passing
tests. Rounded-enclosure checks reject protruding mounting posts and a fit
that would pass an ideal-circle test but clips the actual faceted cavity corner;
a valid inset and straight-side tangency remain accepted. Countersink checks
accept a 1 mm depth with a 0.4 mm conical recess despite a stored 3 mm counterbore
depth, while rejecting oversized cones and genuinely oversized counterbores.

Browser geometry regressions check rejected enclosure edits preserve the previous
parameters, accept relocated posts/holes inside a 29 mm rounded corner, and
export a closed 100 × 60 × 30 mm mesh with measured post heights/hole positions.
The thin-part countersink test subtracts a 3.2 mm shaft/4 mm head, 90° cutter
from a 20 × 20 × 1 mm plate and checks exact STL bounds, paired/oriented edges,
conical surface height and analytic volume.

The targeted development command is:

```sh
CI=true PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
npm run test:e2e -- --runInBand tests/studio-recovery.test.js tests/studio-advanced.test.js
```

The production command from the preceding section additionally includes
`tests/studio-recovery.test.js` and `Recovery failure protection` in the name
filter. Root/server lockfiles and geometry schema remain unchanged.

Final repair validation: all 33 unit tests pass; all 16 targeted development
browser cases pass; all 34 selected production checks pass across seven suites
(27 visual/recovery workflows, four Code checks and three bundle checks).
Forty-five other production tests were excluded by the explicit name filter,
not executed and passed. Production build, strict type check and staged diff
whitespace validation pass. Existing webpack bundle/WASM size warnings remain.

## Schema-5 mesh import and systems verification

Nine mesh unit cases extend the combined suite to 42 tests. Coverage includes
binary/ASCII STL (including binary `solid` headers), OBJ convex-face triangulation
and negative indices, core 3MF component/build transforms and unit metadata,
embedded glTF/GLB transforms, reflected winding, meters and Y-up conversion.
External buffers, required extensions, invalid accessors, cycles, unsafe packages,
DTD/entities, oversized expanded XML, nonfinite coordinates and file/triangle
limits are rejected. The normal document, solver, topology and archive checks
remain in the combined command:

```sh
node --import ./server/node_modules/tsx/dist/loader.mjs --test \
  tests/foundation.test.tsx tests/studio-document.test.ts \
  tests/mesh-analysis.test.ts tests/project-file.test.ts tests/sketch.test.ts \
  tests/advanced-modeling.test.ts tests/mesh-import.test.ts
```

Nine new Chromium workflows verify actual mesh-file selection and unit confirmation,
transformed exact STL dimensions, closed-mesh editable booleans and undo, all five
supported formats, source asset IDs through native save/open and IndexedDB reload,
portable SCAD-plus-assets ZIPs, open-mesh diagnostics, malformed files and canceled
imports. Native metadata intentionally contains asset references rather than inline
triangle data; mesh bytes are checked in the native ZIP. Open topology remains
savable and visible but cannot enter solid evaluation.

The new native example contains a 10 mm imported cube and editable 4 mm through-hole.
`source-cube.stl` is the known triangle input; `imported-mesh.stl` is actual
OpenSCAD/Manifold worker output generated by the documentation capture. The seventh
screenshot shows the preserved source mesh diagnostics and its exact boolean result.
RUN_FORMA3D.md covers clone, dependencies, all assets, development/production modes,
optional MCP, verification, backups and troubleshooting.

A fresh GitHub clone was installed with both committed lockfiles, with the pending
implementation applied for verification. The clean setup downloaded the configured
engine, fonts and all 25 pinned library archives, generated the index, and built
production. The first attempt hit a GitHub HTTP 503 while fetching a pinned OpenSCAD
submodule. Repeating the asset-build command succeeded without replacing commits,
changing network policy or weakening TLS. The final clean installation was rebuilt
with the final dependency lockfile. Its production browser run passed all 13 selected
checks: nine mesh workflows and four original Code checks; 45 other Code tests were
excluded by the name filter. No copied node_modules or prebuilt assets were used.

Root and MCP-server production dependency audits were run. The initial root audit
reported DOMPurify 3.4.15 advisories through Monaco 0.57.0. A root override pins the
compatible patched 3.4.17 dependency without changing Monaco's API version. Final
installed-production dependency audits report zero advisories in both projects.
This does not audit external CDN payloads or promise future advisory-free releases.

The MCP suite passed all 115 non-browser checks and its actual cross-origin browser
scenario: 29 asset-origin requests, no leaked asset requests and no CSP violations.
Root/server production builds and the root strict type check passed, with the existing
bundle/WASM size warnings. The first full development browser run passed 85 tests but
failed two 15-second recovery setup hooks. Pointer-hit
instrumentation and a screenshot identified a webpack runtime-error overlay over
the box button, triggered by a ResizeObserver feedback loop at narrow viewports.
The viewport now schedules drawing-buffer resizing outside the observer callback,
leaves CSS sizing unchanged, skips unchanged sizes, cancels pending resize work on
disposal, and positions the canvas independently of the parent layout. A dedicated
responsive-pointer regression checks small/large views, projection toggles, runtime
errors, click targets and actual geometry export. The recovery tests keep their
original data-preservation assertions and operation deadlines. The final rerun is
recorded below.


Additional final checks: the clean installation was rebuilt with the responsive
viewport correction and passed all 14 selected browser checks (nine mesh cases,
one responsive-pointer case and four Code cases; 50 cases excluded by filtering).
An explicit 100,000-triangle, 5,000,084-byte STL capacity probe parsed in about
1.4 seconds on this environment with correct 166670 × 10 × 10 mm bounds. Its last
cube was intentionally partial, so this proves bounded import processing, not
closed-solid evaluation, viewport performance or general modeling scalability.
The native example was independently decoded as schema 5/container v2: one stored
mesh asset, two bodies, a closed one-shell 10 × 10 × 10 mm final STL, 272 triangles
and volume 874.53806234 mm³, matching the 64-segment 4 mm through-hole.
All six main documentation files were checked for missing local links; an older
README license link was corrected. Seven screenshots were refreshed from the final
production application and reviewed, including the imported-mesh diagnostics view.


The final full development run passed all 88 executed tests across ten suites,
with four suites/26 tests skipped by the existing suite conditions (114 total).
The original recovery tests passed unchanged; the new responsive-pointer case also
passed. Final unit validation passed all 42 cases, and the final strict type check
and production rebuild passed. The final MCP cross-origin check was also rerun
against the rebuilt artifacts; its result and production subset are recorded below.

Final production verification passed all 44 selected checks across eight suites:
all 37 visual/recovery/mesh workflows, four Code checks and three bundle checks.
Forty-five other tests were excluded by the explicit filter rather than executed
and passed. The final MCP cross-origin rerun again served 29 asset-origin requests
with no leaked asset requests or CSP violations. Together with the full 88-test
development run, 42 unit tests, clean-install 14-check run, production builds,
strict type check, documentation link review and zero installed-production audit
advisories, these checks establish the tested scope; they do not certify unsupported
formats, arbitrary mesh repair, other browser engines or general printability.
`git diff --cached --check` passed. Existing webpack bundle/WASM size warnings remain.

## Linked visual and Code workspaces (schema 6)

Starting from `ba7643a`, the workspace links now carry the current model and
sources through a revisioned IndexedDB handoff. Eight new unit cases bring the
combined suite to **50 passing cases**. They cover native graph preservation,
primitive dimensions/transforms and stable IDs, conservative SCAD parsing,
unsupported semantics, native ZIP source metadata, dependency paths, declaration
lifting and isolation from nested mutable editor state. The strict root type
check and production webpack build pass; the existing bundle-size warnings remain.

The final unit run invoked each TypeScript test file directly with the existing
server `tsx` loader, so individual case counts were visible:

```sh
for suite in tests/foundation.test.tsx tests/studio-document.test.ts \
  tests/mesh-analysis.test.ts tests/project-file.test.ts tests/sketch.test.ts \
  tests/advanced-modeling.test.ts tests/mesh-import.test.ts \
  tests/workspace-roundtrip.test.ts; do
  node --import ./server/node_modules/tsx/dist/loader.mjs "$suite" || exit
done
npx --no-install tsc --noEmit
npm run build
```

Seven new browser workflows use real typing, IndexedDB, native ZIP downloads,
OpenSCAD workers and exported geometry. They check visual → Code → visual edits,
stable primitive IDs and undo, Code/visual reloads, mesh dependency preservation,
complex SCAD with module definitions, native save/open, invalid-source recovery,
classic Code entry, stale-tab conflicts, included files, customizer overrides,
and unchanged curve tessellation/volume after visual transforms.

The initial browser runs exposed nested-state aliasing/default-feature injection,
a source-wrapper scope error, and OpenSCAD's top-level-only `use` declarations.
The fixes preserve immutable baselines and exact feature flags, use dedicated
source modules with original curve defaults, and lift reachable local library
uses into the scene entry. Test harness corrections account for editor bracket
completion, background-tab animation frames, and classic hash autosaves that
must not be mistaken for route navigation.

All **seven production workspace workflows passed** against the built assets at
`http://localhost:3000/dist/`. The MCP suite also passed all **115 non-browser
checks** and its cross-origin browser render: 29 requests went to the asset
origin, with no CSP violations. `scripts/capture-studio-docs.mjs` captured nine
real application screenshots; the new matching Visual Design/Code pair was
visually inspected. No environment or application deployment was performed.

The first full development run passed 94 cases and hit the existing five-second
default timeout in the multi-step native-import foundation test. It ran while
other browser verification jobs were active. A standalone full rerun uses
`--runInBand --testTimeout=15000`; explicit geometry timeouts and all assertions
remain unchanged.

The standalone final run passed **all 95 executed browser tests across 11
suites**, with 26 conditional skips (four suites skipped). It completed in 455
seconds with the documented 15-second default timeout. This includes all seven
linked-workspace workflows and the original Code, visual, mesh, recovery, sketch,
boolean, advanced-modeling and bundle regressions. No source changes followed
that passing run.

## Illustrated user-guide walkthrough

The user guide now provides a first-part tutorial and task-based tool reference,
with a prominent README entry. Three new screenshots show the same 60 × 40 × 6 mm
plate before subtraction, after its 8 mm through-hole, and in Code. The native
`examples/forma3d/first-part.forma3d` download contains both editable operands and
the Difference feature. The guide places ten real screenshots alongside the
relevant instructions.

```sh
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
  node scripts/capture-studio-docs.mjs --tutorial-only
```

The capture script executes the instructions through the real UI, checks the
272-triangle exact STL bounds and hole volume, changes the generated width from
60 to 70 in Code, returns to Visual Design, and verifies Undo restores 60. It
waits for the Code viewer's fade-in before taking its screenshot. The native
example was independently decoded with the project loader and checked for its
schema, dimensions, positions and boolean references. All 39 local guide/example
links, image paths and heading anchors were checked, including the prominent
README guide link. No application source changed in this documentation update.

## Direct native SCAD and mesh-restricted Code access

The visual add-on now emits direct OpenSCAD expressions in the editable workspace,
Generated SCAD preview and SCAD downloads. Shapes expose real dimensions; boolean
and pattern expressions are expanded without generated object modules or aliases.
The private module-based generator remains in use for worker evaluation. Any mesh
body blocks a Code handoff at both the UI and persistence boundary, including
hidden/consumed inputs and legacy source-backed meshes. Unsupported source stays
in Code instead of being substituted with an opaque mesh.

All **53 unit cases**, the strict type check and production build pass. Workspace
coverage verifies primitive edits and IDs, real diameter/height parameters,
pattern and elliptical-cylinder exact STL equivalence, mesh restrictions and
re-enabling after deletion, source preservation on unsupported programs, and
migration of older module-based records even without their original header.
Token-based migration ignores module-like text in comments and strings.

The wider visual regression run passed 45 cases and exposed a report-cache mismatch:
analysis stored private evaluation text while the report display compared public
SCAD. The report fingerprint now uses the same public source. The affected boolean
and workspace suites then passed **all 11 checks**. The final production run passed
**all 16 selected checks** across the workspace, original Code and bundle suites;
45 unrelated Code cases were excluded by filtering. No assertions were disabled.

All **12 real application screenshots** were regenerated. The imported-mesh image
shows the unavailable Code link, and the Code images contain direct shape/boolean
expressions. The documentation capture completed its exact STL, Code width-edit
and Undo checks. Its paste verification now accepts Monaco's actual indentation
while still requiring the edited dimensions, a durable save and correct visual
results. All 39 local guide/example links, image references and anchors passed
validation. Existing native projects remain readable; no document schema changed.

## Authored modules and reusable library (schema 7)

The module library adds 14 parser/document tests in `tests/module-library.test.ts`
and eight real-browser workflows in `tests/studio-modules.test.js`. The supplied
flower definitions cover default and required parameters, loops, hulls, colors,
and sibling dependency bundles. Cases also cover comments/strings, user-written
`n0`, helper functions/globals, repeated assignments, Code customizer bindings,
source/name conflicts, and external-import rejection.

Browser workflows exercise detection and review, cancel/skip, explicitly selected
updates, required `ring` arguments, exact STL parameter changes, saving/reusing a
visual boolean, native project reloads, library backup/restore, and another-tab
revision conflicts. Authored geometry is evaluated from source without imported
mesh assets. Existing imported-mesh Code restrictions remain covered.

Screenshots are reproducible after `npm run build` with
`node scripts/capture-studio-docs.mjs` and
`node scripts/capture-module-docs.mjs`. Set `PUPPETEER_EXECUTABLE_PATH` when using
system Chromium. Both scripts capture the running production application; the
beginner walkthrough also checks exact exported bounds, through-hole volume,
Code/visual synchronization and Undo.

Validation for this change: TypeScript and the production build passed; all 67
unit assertions and all 54 Forma3D production browser cases passed (eight suites,
no skips). The 115 server/MCP assertions and real-browser cross-origin request/CSP
check also passed. The final browser run used a static production server to avoid
live-rebuild interference seen in the earlier development run. Both documentation
capture scripts completed, and all local documentation link/image targets exist.
