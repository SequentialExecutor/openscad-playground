# Licensing audit notes

The baseline LICENSE.md describes the web demo as GPL v2-or-later source and
GPL v3 for deployment because of linked dependencies. Existing source headers
and all bundled license text must remain intact. Forma3D is an extension of this
codebase, not a proprietary relicensing. The initial regression fixes added no dependencies; viewport/test additions are listed below.

The original inventory covers OpenSCAD, Manifold, CGAL, GMP/MPFR, Boost, Eigen,
font libraries, fonts, JSZip, Monaco, PrimeReact, Three.js and SCAD libraries.
These are a mixture of licenses; a package-level release inventory must also
cover the current lockfiles and prebuilt WASM's exact source/build provenance.
Existing attribution alone does not establish a complete current inventory.

Distribution gate: preserve GPL notices and license text; provide corresponding
source and build instructions for distributed covered code, including the WASM
binary and modifications; retain third-party notices/assets' license terms;
verify binary provenance and the complete production dependency inventory.
The configured upstream prebuilt WASM was downloaded after publication; corresponding-source provenance still requires release review. This is
an initial audit, not a declaration that release obligations are satisfied.

## Visual viewport additions

The visual workspace adds pinned `three@0.187.0` (MIT, copyright 2010–2026
three.js authors) and development-only `@types/three@0.187.0` (MIT). The existing
LICENSE.md already includes the Three.js MIT notice. Preserve the installed
package's LICENSE when distributing this newer runtime. The type package brings
additional development dependencies listed with license metadata in the lockfile;
these do not imply the physics, compression or optimization APIs are used by
Forma3D. No analytics or external geometry service was added. Exact STL evaluation
runs in the local browser worker.

`esbuild@0.28.2` is an explicit MIT-licensed development dependency for the existing MCP browser test bundler. It is not included in the browser runtime.
