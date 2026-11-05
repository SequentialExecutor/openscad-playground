import { test } from "node:test";
import assert from "node:assert/strict";
import {
  blankDesign,
  createBody,
  createBoolean,
  createExtrusion,
  createTemplateBody,
  generateScad,
  validateDesign,
  rootNodes,
} from "../src/studio/document";
import { createModelingFeature } from "../src/studio/advanced";
import {
  defaultTemplate,
  validateTemplate,
  templateScad,
} from "../src/studio/templates";
import { rectangleSketch } from "../src/studio/sketch";
import { stlBounds } from "../src/studio/bounds";
import {
  distribution,
  translated,
  independentReference,
} from "../src/studio/positioning";
test("patterns, mirrors and groups preserve inputs, poses and root ownership", () => {
  const d = blankDesign(),
    b = createBody("box");
  d.bodies = [b];
  for (const op of [
    "mirror",
    "linear-pattern",
    "circular-pattern",
    "group",
  ] as const) {
    const f = createModelingFeature(op, [b.id]);
    const valid = validateDesign({ ...d, features: [f] });
    assert.deepEqual(
      rootNodes(valid).map((n) => n.id),
      [f.id],
    );
    assert.equal(valid.bodies[0].id, b.id);
    assert.match(
      generateScad(valid),
      op === "mirror" ? /mirror\(/ : op === "group" ? /union\(/ : /for\(i=/,
    );
  }
});
test("bounds and dependency validation reject bad patterns and invalid feature chains", () => {
  const d = blankDesign();
  d.bodies = [createBody("box")];
  const f = createModelingFeature("linear-pattern", [d.bodies[0].id]);
  assert.equal(f.operation, "linear-pattern");
  if (f.operation !== "linear-pattern") return;
  assert.throws(() =>
    validateDesign({
      ...d,
      features: [{ ...f, spec: { count: 1, step: [30, 0, 0] } }],
    }),
  );
  assert.throws(() =>
    validateDesign({
      ...d,
      features: [{ ...f, spec: { count: 3, step: [0, 0, 0] } }],
    }),
  );
  const a = {
    ...f,
    spec: { count: 100, step: [30, 0, 0] as [number, number, number] },
  };
  const b = createModelingFeature("linear-pattern", [a.id]);
  if (b.operation === "linear-pattern") b.spec.count = 100;
  const c = createModelingFeature("linear-pattern", [b.id]);
  assert.throws(() => validateDesign({ ...d, features: [a, b, c] }), /10,000/);
  const tenThousand = { ...d, features: [a, b] };
  assert.ok(validateDesign(tenThousand));
  assert.throws(
    () =>
      validateDesign({
        ...tenThousand,
        bodies: [...d.bodies, createBody("box")],
      }),
    /10,000/,
  );
  const fillet = createModelingFeature("fillet", [d.bodies[0].id]);
  const shell = createModelingFeature("shell", [fillet.id]);
  assert.ok(validateDesign({ ...d, features: [fillet, shell] }));
  assert.throws(
    () =>
      validateDesign({
        ...d,
        features: [{ ...fillet, position: [1, 0, 0] }, shell],
      }),
    /transform/,
  );
});
test("profile operations use the actual sketch and reject axis-crossing revolutions", () => {
  const d = blankDesign(),
    sketch = rectangleSketch(5, 20);
  d.bodies = [createExtrusion({ height: 10, sketch })];
  const f = createModelingFeature("revolve", [d.bodies[0].id]);
  assert.match(
    generateScad({ ...d, features: [f] }),
    /rotate_extrude\(angle=360\)/,
  );
  const negative = structuredClone(d);
  negative.bodies[0].extrusion!.sketch.constraints = sketch.constraints.map(
    (c) => (c.kind === "fixed" && c.axis === 0 ? { ...c, value: -2 } : c),
  );
  assert.throws(
    () => validateDesign({ ...negative, features: [f] }),
    /nonnegative/,
  );
  const offset = createModelingFeature("profile-offset", [d.bodies[0].id]);
  assert.match(generateScad({ ...d, features: [offset] }), /offset\(r=2\)/);
});
test("shell and vertical edge tools are bounded, preserve dimensions and serialize", () => {
  const d = blankDesign();
  d.bodies = [createBody("box")];
  for (const op of ["shell", "fillet", "chamfer"] as const) {
    const f = createModelingFeature(op, [d.bodies[0].id]);
    assert.deepEqual(
      validateDesign(JSON.parse(JSON.stringify({ ...d, features: [f] }))),
      validateDesign({ ...d, features: [f] }),
    );
  }
  const tiny = structuredClone(d);
  tiny.bodies[0].size = [1, 1, 1];
  for (const op of ["fillet", "chamfer", "shell"] as const)
    assert.ok(
      validateDesign({
        ...tiny,
        features: [createModelingFeature(op, [tiny.bodies[0].id], tiny)],
      }),
    );
  const f = createModelingFeature("fillet", [d.bodies[0].id]);
  if (f.operation === "fillet")
    assert.throws(() =>
      validateDesign({ ...d, features: [{ ...f, spec: { radius: 10 } }] }),
    );
});
test("mechanical templates produce source and reject impossible fits", () => {
  for (const kind of [
    "enclosure",
    "spacer",
    "standoff",
    "hole",
    "mounting-tab",
    "alignment-pin",
    "snap-reference",
  ] as const) {
    const t = defaultTemplate(kind);
    assert.ok(templateScad(t).length > 20);
    const d = blankDesign();
    d.bodies = [createTemplateBody(t)];
    assert.ok(generateScad(validateDesign(d)).length > 50);
  }
  const e = defaultTemplate("enclosure");
  if (e.kind === "enclosure") {
    assert.throws(() => validateTemplate({ ...e, wall: 40 }));
    assert.throws(() => validateTemplate({ ...e, holes: true, posts: false }));
    assert.match(
      templateScad({ ...e, width: 120, posts: true, holes: true }),
      /x=\[-50,50\]/,
    );
  }
});
test("distribution uses real bounds; old boolean targets receive a reversible transform wrapper", () => {
  assert.throws(() => stlBounds(new ArrayBuffer(20)), /Invalid STL/);
  const bytes = new ArrayBuffer(134),
    view = new DataView(bytes);
  view.setUint32(80, 1, true);
  [
    [1, 2, 3],
    [4, 5, 6],
    [-1, -2, -3],
  ].forEach((p, i) =>
    p.forEach((n, a) => view.setFloat32(96 + i * 12 + a * 4, n, true)),
  );
  assert.deepEqual(stlBounds(bytes), { min: [-1, -2, -3], max: [4, 5, 6] });
  const b = (id: string, x: number, w: number) => ({
    id,
    bounds: { min: [x, 0, 0], max: [x + w, 10, 10] },
  });
  assert.deepEqual(
    distribution([b("a", 0, 10), b("b", 12, 20), b("c", 60, 10)], 0, "gaps"),
    [{ id: "b", delta: [13, 0, 0] }],
  );
  assert.throws(() =>
    distribution([b("a", 0, 20), b("b", 5, 20), b("c", 10, 20)], 0, "gaps"),
  );
  const d = blankDesign();
  d.bodies = [createBody("box"), createBody("cylinder")];
  const f = createBoolean("difference", [d.bodies[0].id, d.bodies[1].id]);
  d.features = [f];
  assert.throws(() => independentReference(d, d.bodies[0].id, f.id));
  const moved = translated(d, [{ id: f.id, delta: [0, 0, 5] }]);
  assert.equal(moved.features.length, 2);
  assert.equal(moved.features[1].operation, "group");
  assert.deepEqual(d.features, [f]);
});

test("enclosure posts fit the rounded cavity, including the actual faceted corner boundary", () => {
  const e = defaultTemplate("enclosure");
  if (e.kind !== "enclosure") throw Error("Expected enclosure");
  assert.throws(
    () => validateTemplate({ ...e, corner: 29, inset: 7, posts: true }),
    /rounded corners/,
  );
  assert.ok(validateTemplate({ ...e, corner: 29, inset: 7, posts: false }));
  assert.ok(
    validateTemplate({ ...e, corner: 29, inset: 14, posts: true, holes: true }),
  );
  // This disk fits an ideal circle but clips the 64-segment cavity boundary.
  const idealInset = 29 - (26 - 4) / Math.SQRT2;
  assert.throws(
    () =>
      validateTemplate({ ...e, corner: 29, inset: idealInset, posts: true }),
    /rounded corners/,
  );
  // A disk tangent to a straight cavity side remains valid.
  assert.ok(validateTemplate({ ...e, corner: 0, inset: 7, posts: true }));
});
test("countersinks validate their conical depth independently of unused counterbore depth", () => {
  const h = defaultTemplate("hole");
  if (h.kind !== "hole") throw Error("Expected hole");
  const thin = {
    ...h,
    style: "countersink" as const,
    depth: 1,
    headDiameter: 4,
    headDepth: 3,
  };
  assert.ok(validateTemplate(thin));
  assert.ok(validateTemplate({ ...thin, headDepth: 1000 }));
  assert.throws(
    () => validateTemplate({ ...thin, style: "counterbore" }),
    /depth/,
  );
  assert.throws(
    () => validateTemplate({ ...thin, headDiameter: 6.5 }),
    /depth/,
  );
  assert.throws(() => validateTemplate({ ...thin, angle: 10 }), /depth/);
});
