import assert from "node:assert/strict";
import { test } from "node:test";
import {
  blankDesign,
  createBody,
  createBoolean,
  rootNodes,
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
  assert.deepEqual(
    validateDesign({ ...d, print: { ...d.print, unexpected: "ignored" } })
      .print,
    d.print,
  );
});
test("invalid schema, duplicate IDs, nonfinite and degenerate dimensions are rejected", () => {
  const d = blankDesign();
  d.bodies.push(createBody("box"));
  for (const next of [
    { ...d, version: 999 },
    { ...d, units: "inch" },
    { ...d, print: null },
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

test("version 1 primitive files migrate losslessly to version 2", () => {
  const original = {
    version: 1,
    name: "Old project",
    units: "mm",
    bodies: [createBody("box")],
  };
  const migrated = validateDesign(original);
  assert.equal(migrated.version, 2);
  assert.deepEqual(migrated.features, []);
  assert.deepEqual(migrated.bodies, original.bodies);
});
test("boolean DAG preserves operands and root selection, rejects cycles and dangling references", () => {
  const d = blankDesign(),
    a = createBody("box"),
    b = createBody("cylinder");
  d.bodies = [a, b];
  const hole = createBoolean("difference", [a.id, b.id]);
  d.features = [hole];
  assert.deepEqual(
    rootNodes(validateDesign(d)).map((n) => n.id),
    [hole.id],
  );
  assert.match(generateScad(d), /difference\(\)/);
  assert.equal(d.bodies.length, 2);
  assert.deepEqual(
    rootNodes({ ...d, features: [] }).map((n) => n.id),
    [a.id, b.id],
  );
  assert.throws(
    () => validateDesign({ ...d, bodies: [a] }),
    /operand is missing/,
  );
  const child = createBoolean("union", [hole.id, b.id]);
  assert.throws(
    () =>
      validateDesign({
        ...d,
        features: [{ ...hole, inputs: [a.id, child.id] }, child],
      }),
    /cycle/,
  );
  assert.throws(() =>
    validateDesign({ ...d, features: [{ ...hole, inputs: [a.id, a.id] }] }),
  );
  assert.throws(() =>
    validateDesign({ ...d, features: [{ ...hole, id: a.id }] }),
  );
});
test("nested feature source uses bounded module references and explicit isolated outputs", () => {
  const d = blankDesign();
  d.bodies = [createBody("box"), createBody("cylinder"), createBody("sphere")];
  const a = createBoolean("difference", [d.bodies[0].id, d.bodies[1].id]);
  const b = createBoolean("intersection", [a.id, d.bodies[2].id]);
  d.features = [a, b];
  const source = generateScad(d);
  assert.match(source, /difference\(\)/);
  assert.match(source, /intersection\(\)/);
  assert.ok(source.endsWith("n4();\n"));
  assert.doesNotMatch(generateScad(d, [a.id]), /intersection\(\)/);
  assert.deepEqual(
    rootNodes({ ...d, features: [a, { ...b, visible: false }] }),
    [],
  );
  assert.equal(
    generateScad(d),
    generateScad(validateDesign(JSON.parse(JSON.stringify(d)))),
  );
});
