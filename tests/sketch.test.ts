import { test } from "node:test";
import assert from "node:assert/strict";
import {
  rectangleSketch,
  circleSketch,
  solveSketch,
  validateExtrusion,
  extrusionSize,
  extrusionScad,
  Sketch,
} from "../src/studio/sketch";
import {
  blankDesign,
  createExtrusion,
  validateDesign,
  generateScad,
} from "../src/studio/document";
test("rectangle constraints fully determine the profile and propagate dimensions", () => {
  const s = rectangleSketch(50, 30);
  assert.equal(solveSketch(s).degreesOfFreedom, 0);
  assert.equal(solveSketch(s).area, 1500);
  s.constraints = s.constraints.map((c) =>
    c.kind === "delta" && c.axis === 0 ? { ...c, value: 80 } : c,
  );
  assert.deepEqual(solveSketch(s).bounds.max, [80, 30]);
  assert.equal(solveSketch(s).area, 2400);
});
test("inconsistent dimensions are diagnosed without changing the sketch", () => {
  const s = rectangleSketch();
  s.constraints.push({
    id: crypto.randomUUID(),
    kind: "delta",
    a: 0,
    b: 1,
    axis: 0,
    value: 30,
  });
  const original = JSON.stringify(s);
  assert.throws(() => solveSketch(s), /inconsistent/);
  assert.equal(JSON.stringify(s), original);
});
test("free polygons are underconstrained and open or self-intersecting profiles cannot extrude", () => {
  const s: Sketch = {
    id: crypto.randomUUID(),
    kind: "polygon",
    plane: "XY",
    points: [
      [0, 0],
      [30, 0],
      [20, 20],
      [0, 10],
    ],
    radius: 10,
    closed: true,
    constraints: [],
  };
  assert.equal(solveSketch(s).degreesOfFreedom, 8);
  assert.equal(solveSketch(s).closed, true);
  assert.throws(
    () => validateExtrusion({ height: 10, sketch: { ...s, closed: false } }),
    /open/,
  );
  assert.throws(
    () =>
      solveSketch({
        ...s,
        points: [
          [0, 0],
          [20, 20],
          [0, 20],
          [20, 0],
        ],
      }),
    /self-intersects/,
  );
});
test("axis-aligned equal length and coincident endpoints are solved deterministically", () => {
  const s = rectangleSketch(20, 20);
  s.constraints = s.constraints.filter(
    (c) => c.kind !== "delta" || c.axis !== 1,
  );
  s.constraints.push({
    id: crypto.randomUUID(),
    kind: "equal-length",
    a: 0,
    b: 1,
    c: 1,
    d: 2,
  });
  assert.deepEqual(solveSketch(s).bounds.max, [20, 20]);
  assert.equal(solveSketch(s).degreesOfFreedom, 0);
  const p: Sketch = {
    id: crypto.randomUUID(),
    kind: "polygon",
    plane: "XY",
    points: [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [0, 1],
    ],
    radius: 1,
    closed: false,
    constraints: [{ id: crypto.randomUUID(), kind: "coincident", a: 0, b: 4 }],
  };
  assert.equal(solveSketch(p).closed, true);
});
test("circle has verified fixed center and radius; planes map extrusion bounds", () => {
  const s = circleSketch(5);
  assert.equal(solveSketch(s).degreesOfFreedom, 0);
  assert.deepEqual(solveSketch(s).bounds.min, [-5, -5]);
  const e = { height: 12, sketch: rectangleSketch(30, 20) };
  assert.deepEqual(extrusionSize(e), [30, 20, 12]);
  e.sketch.plane = "XZ";
  assert.deepEqual(extrusionSize(e), [30, 12, 20]);
  assert.match(extrusionScad(e), /rotate\(\[90,0,0\]\)/);
  e.sketch.plane = "YZ";
  assert.deepEqual(extrusionSize(e), [12, 30, 20]);
});
test("extrusions serialize, migrate, reference booleans and ignore derived size edits", () => {
  const d = blankDesign(),
    b = createExtrusion({ height: 10, sketch: rectangleSketch(30, 20) });
  d.bodies = [b];
  assert.deepEqual(validateDesign(JSON.parse(JSON.stringify(d))), d);
  assert.match(generateScad(d), /linear_extrude\(height=10\)/);
  assert.deepEqual(
    validateDesign({ ...d, bodies: [{ ...b, size: [99, 99, 99] }] }).bodies[0]
      .size,
    [30, 20, 10],
  );
});
