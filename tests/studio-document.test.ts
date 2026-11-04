import assert from "node:assert/strict";
import { test } from "node:test";
import {
  blankDesign,
  createBody,
  execute,
  generateScad,
  redo,
  undo,
  validateDesign,
} from "../src/studio/document";

test("document roundtrip preserves stable IDs and strips unrelated imported state", () => {
  const d = blankDesign();
  d.bodies.push(createBody("box"));
  assert.deepEqual(
    validateDesign(JSON.parse(JSON.stringify({ ...d, scene: "untrusted" }))),
    d,
  );
  assert.equal(validateDesign(d).bodies[0].id, d.bodies[0].id);
});
test("invalid schema, duplicate IDs, nonfinite and degenerate dimensions are rejected", () => {
  const d = blankDesign();
  d.bodies.push(createBody("box"));
  for (const next of [
    { ...d, version: 2 },
    { ...d, units: "inch" },
    { ...d, bodies: [d.bodies[0], d.bodies[0]] },
    { ...d, bodies: [{ ...d.bodies[0], size: [0, 1, 1] }] },
    { ...d, bodies: [{ ...d.bodies[0], position: [NaN, 1, 1] }] },
  ])
    assert.throws(() => validateDesign(next));
  assert.throws(() => validateDesign(null));
});
test("command history restores dimensions and transforms, and edits after undo discard redo", () => {
  const initial = blankDesign(),
    body = createBody("box");
  const h = execute(
    { past: [], present: initial, future: [] },
    { ...initial, bodies: [body] },
  );
  const moved = execute(h, {
    ...h.present,
    bodies: [{ ...body, position: [15, 0, 10], size: [50, 30, 20] }],
  });
  assert.deepEqual(undo(moved).present, h.present);
  assert.deepEqual(redo(undo(moved)).present, moved.present);
  assert.equal(
    execute(undo(moved), { ...h.present, name: "Changed" }).future.length,
    0,
  );
  assert.equal(execute(h, h.present), h);
});
test("compiler is deterministic, uses millimeters, honors transforms and omits hidden bodies", () => {
  const d = blankDesign();
  const body = createBody("box");
  d.bodies = [
    {
      ...body,
      size: [50, 30, 20],
      position: [0, 0, 0],
      rotation: [0, 0, 90],
      scale: [2, 1, 1],
    },
  ];
  assert.match(
    generateScad(d),
    /translate\(\[0,0,0\]\) rotate\(\[0,0,90\]\) scale\(\[2,1,1\]\) cube\(\[50,30,20\], center=true\);/,
  );
  assert.equal(generateScad(d), generateScad(structuredClone(d)));
  assert.doesNotMatch(
    generateScad({ ...d, bodies: [{ ...body, visible: false }] }),
    /cube\(/,
  );
  for (const kind of ["sphere", "cylinder", "cone"] as const)
    assert.ok(
      generateScad({ ...d, bodies: [createBody(kind)] }).includes(
        kind === "sphere" ? "sphere" : "cylinder",
      ),
    );
});
