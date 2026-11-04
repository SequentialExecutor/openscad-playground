import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeStl, defaultPrintSettings } from "../src/studio/mesh-analysis";
const points = [
  [0, 0, 0],
  [10, 0, 0],
  [0, 10, 0],
  [0, 0, 10],
];
const faces = [
  [0, 2, 1],
  [0, 1, 3],
  [1, 2, 3],
  [2, 0, 3],
];
function binary(vertices: number[][], triangles: number[][]): ArrayBuffer {
  const data = new ArrayBuffer(84 + triangles.length * 50),
    view = new DataView(data);
  view.setUint32(80, triangles.length, true);
  triangles.forEach((ids, t) =>
    ids.forEach((id, v) =>
      vertices[id].forEach((n, a) =>
        view.setFloat32(84 + t * 50 + 12 + v * 12 + a * 4, n, true),
      ),
    ),
  );
  return data;
}
test("closed tetrahedron has exact bounds, area, volume and one shell", () => {
  const r = analyzeStl(binary(points, faces));
  assert.equal(r.closed, true);
  assert.equal(r.shells, 1);
  assert.deepEqual(r.bounds.size, [10, 10, 10]);
  assert.ok(Math.abs(r.volume! - 1000 / 6) < 1e-6);
  assert.ok(Math.abs(r.surfaceArea - (150 + 50 * Math.sqrt(3))) < 1e-6);
  assert.equal(r.boundaryEdges, 0);
  assert.equal(r.nonManifoldEdges, 0);
});
test("missing, duplicate, degenerate and reversed triangles are distinguished", () => {
  const open = analyzeStl(binary(points, faces.slice(1)));
  assert.equal(open.boundaryEdges, 3);
  assert.equal(open.volume, undefined);
  const duplicate = analyzeStl(binary(points, [...faces, faces[0]]));
  assert.equal(duplicate.duplicateTriangles, 1);
  assert.equal(duplicate.nonManifoldEdges, 3);
  const degenerate = analyzeStl(binary(points, [...faces, [0, 0, 0]]));
  assert.equal(degenerate.degenerateTriangles, 1);
  assert.equal(degenerate.closed, false);
  const reversed = analyzeStl(
    binary(points, [[...faces[0]].reverse(), ...faces.slice(1)]),
  );
  assert.equal(reversed.inconsistentEdges, 3);
  assert.equal(reversed.closed, false);
});
test("disconnected elevated shells and downward surfaces produce labeled heuristics", () => {
  const vertices = [
    ...points,
    ...points.map((v) => [v[0] + 40, v[1], v[2] + 20]),
  ];
  const r = analyzeStl(
    binary(vertices, [...faces, ...faces.map((f) => f.map((id) => id + 4))]),
  );
  assert.equal(r.shells, 2);
  assert.equal(r.closed, true);
  assert.ok(r.warnings.some((w) => w.includes("1 disconnected shell")));
  assert.ok(
    r.warnings.some(
      (w) => w.includes("Heuristic:") && w.includes("downward-facing"),
    ),
  );
});
test("build-volume and settings warnings use explicit user settings", () => {
  const r = analyzeStl(binary(points, faces), {
    ...defaultPrintSettings,
    build: [5, 5, 5],
    layer: 0.4,
  });
  assert.equal(r.outsideBuildVolume, true);
  assert.ok(r.warnings.some((w) => w.includes("80%")));
  const thin = analyzeStl(
    binary(
      points.map((v) => [v[0], v[1], v[2] / 100]),
      faces,
    ),
  );
  assert.ok(
    thin.warnings.some((w) => w.includes("Internal walls are not measured")),
  );
  assert.throws(() =>
    analyzeStl(binary(points, faces), { ...defaultPrintSettings, nozzle: 0 }),
  );
});
test("malformed data and nonfinite triangles cannot yield a valid-volume claim", () => {
  assert.throws(() => analyzeStl(new ArrayBuffer(10)));
  const data = binary(points, faces);
  new DataView(data).setFloat32(96, NaN, true);
  const r = analyzeStl(data);
  assert.equal(r.invalidTriangles, 1);
  assert.equal(r.volume, undefined);
  assert.equal(r.closed, false);
});
