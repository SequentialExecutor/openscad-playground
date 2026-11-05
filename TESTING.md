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
