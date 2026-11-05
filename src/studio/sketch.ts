export type Point2 = [number, number];
export type SketchPlane = "XY" | "XZ" | "YZ";
export type Constraint =
  | { id: string; kind: "fixed"; point: number; axis: 0 | 1; value: number }
  | {
      id: string;
      kind: "delta";
      a: number;
      b: number;
      axis: 0 | 1;
      value: number;
    }
  | {
      id: string;
      kind: "horizontal" | "vertical" | "coincident";
      a: number;
      b: number;
    }
  | {
      id: string;
      kind: "equal-length";
      a: number;
      b: number;
      c: number;
      d: number;
    }
  | { id: string; kind: "radius"; value: number };
export interface Sketch {
  id: string;
  kind: "rectangle" | "circle" | "polygon";
  plane: SketchPlane;
  points: Point2[];
  closed: boolean;
  radius: number;
  constraints: Constraint[];
}
export interface Extrusion {
  height: number;
  sketch: Sketch;
}
export interface SolvedSketch {
  points: Point2[];
  radius: number;
  rank: number;
  degreesOfFreedom: number;
  closed: boolean;
  area: number;
  bounds: { min: Point2; max: Point2 };
}
const EPS = 1e-8;
export function rectangleSketch(width = 20, depth = 20): Sketch {
  return {
    id: crypto.randomUUID(),
    kind: "rectangle",
    plane: "XY",
    points: [
      [0, 0],
      [width, 0],
      [width, depth],
      [0, depth],
    ],
    closed: true,
    radius: 10,
    constraints: [
      { id: crypto.randomUUID(), kind: "fixed", point: 0, axis: 0, value: 0 },
      { id: crypto.randomUUID(), kind: "fixed", point: 0, axis: 1, value: 0 },
      ...(
        [
          { kind: "horizontal", a: 0, b: 1 },
          { kind: "vertical", a: 1, b: 2 },
          { kind: "horizontal", a: 2, b: 3 },
          { kind: "vertical", a: 3, b: 0 },
        ] as const
      ).map((c) => ({ ...c, id: crypto.randomUUID() })),
      {
        id: crypto.randomUUID(),
        kind: "delta",
        a: 0,
        b: 1,
        axis: 0,
        value: width,
      },
      {
        id: crypto.randomUUID(),
        kind: "delta",
        a: 0,
        b: 3,
        axis: 1,
        value: depth,
      },
    ],
  };
}
export function circleSketch(radius = 10): Sketch {
  return {
    id: crypto.randomUUID(),
    kind: "circle",
    plane: "XY",
    points: [[0, 0]],
    closed: true,
    radius,
    constraints: [
      { id: crypto.randomUUID(), kind: "fixed", point: 0, axis: 0, value: 0 },
      { id: crypto.randomUUID(), kind: "fixed", point: 0, axis: 1, value: 0 },
      { id: crypto.randomUUID(), kind: "radius", value: radius },
    ],
  };
}
/** Deterministic RREF linear solver. Equal length is deliberately limited to axis-aligned segments. */
export function solveSketch(s: Sketch): SolvedSketch {
  if (
    !s ||
    typeof s.id !== "string" ||
    !s.id ||
    !["rectangle", "circle", "polygon"].includes(s.kind) ||
    !["XY", "XZ", "YZ"].includes(s.plane) ||
    typeof s.closed !== "boolean" ||
    !Array.isArray(s.points) ||
    s.points.length > 64 ||
    !Array.isArray(s.constraints) ||
    s.constraints.length > 256 ||
    !Number.isFinite(s.radius) ||
    s.radius <= 0 ||
    s.radius > 1e6
  )
    throw Error("Invalid sketch schema.");
  if (
    !s.points.every(
      (p) =>
        Array.isArray(p) &&
        p.length === 2 &&
        p.every((n) => Number.isFinite(n) && Math.abs(n) <= 1e6),
    )
  )
    throw Error("Invalid sketch point.");
  if (s.kind === "circle" && s.points.length !== 1)
    throw Error("A circle requires one center point.");
  const count = s.points.length * 2 + (s.kind === "circle" ? 1 : 0),
    initial = [...s.points.flat(), ...(s.kind === "circle" ? [s.radius] : [])];
  const rows: number[][] = [];
  const ids = new Set<string>();
  const variable = (point: number, axis: number) => {
    if (
      !Number.isInteger(point) ||
      point < 0 ||
      point >= s.points.length ||
      ![0, 1].includes(axis)
    )
      throw Error("Constraint references a missing point or axis.");
    return point * 2 + axis;
  };
  const equation = (terms: [number, number][], value: number) => {
    if (!Number.isFinite(value) || Math.abs(value) > 1e6)
      throw Error("Invalid constraint value.");
    const row = Array(count + 1).fill(0);
    for (const [i, n] of terms) row[i] += n;
    row[count] = value;
    rows.push(row);
  };
  const segment = (a: number, b: number, axis: 0 | 1, value = 0) => {
    if (a === b) throw Error("A segment needs different endpoints.");
    equation(
      [
        [variable(b, axis), 1],
        [variable(a, axis), -1],
      ],
      value,
    );
  };
  for (const c of s.constraints) {
    if (!c || typeof c.id !== "string" || !c.id || ids.has(c.id))
      throw Error("Invalid or duplicate constraint ID.");
    ids.add(c.id);
    if (c.kind === "fixed") equation([[variable(c.point, c.axis), 1]], c.value);
    else if (c.kind === "delta") segment(c.a, c.b, c.axis, c.value);
    else if (c.kind === "horizontal") segment(c.a, c.b, 1);
    else if (c.kind === "vertical") segment(c.a, c.b, 0);
    else if (c.kind === "coincident") {
      segment(c.a, c.b, 0);
      segment(c.a, c.b, 1);
    } else if (c.kind === "radius") {
      if (s.kind !== "circle")
        throw Error("Radius constraint requires a circle.");
      equation([[count - 1, 1]], c.value);
    } else if (c.kind === "equal-length") {
      const orientation = (
        a: number,
        b: number,
      ): { axis: 0 | 1; sign: number } => {
        variable(a, 0);
        variable(b, 0);
        const d = s.points[b].map((n, i) => n - s.points[a][i]);
        const axis: 0 | 1 =
          Math.abs(d[1]) < EPS
            ? 0
            : Math.abs(d[0]) < EPS
              ? 1
              : (() => {
                  throw Error(
                    "Equal length supports horizontal/vertical segments only.",
                  );
                })();
        if (Math.abs(d[axis]) < EPS)
          throw Error("Equal-length segment is degenerate.");
        segment(a, b, axis === 0 ? 1 : 0);
        return { axis, sign: Math.sign(d[axis]) };
      };
      const first = orientation(c.a, c.b),
        second = orientation(c.c, c.d);
      equation(
        [
          [variable(c.b, first.axis), first.sign],
          [variable(c.a, first.axis), -first.sign],
          [variable(c.d, second.axis), -second.sign],
          [variable(c.c, second.axis), second.sign],
        ],
        0,
      );
    } else throw Error("Unsupported sketch constraint.");
  }
  const pivots: number[] = [];
  let rank = 0;
  for (let col = 0; col < count && rank < rows.length; col++) {
    let pivot = rank;
    for (let r = rank + 1; r < rows.length; r++)
      if (Math.abs(rows[r][col]) > Math.abs(rows[pivot][col])) pivot = r;
    if (Math.abs(rows[pivot][col]) < EPS) continue;
    [rows[rank], rows[pivot]] = [rows[pivot], rows[rank]];
    const scale = rows[rank][col];
    for (let j = col; j <= count; j++) rows[rank][j] /= scale;
    for (let r = 0; r < rows.length; r++)
      if (r !== rank) {
        const factor = rows[r][col];
        for (let j = col; j <= count; j++) rows[r][j] -= factor * rows[rank][j];
      }
    pivots.push(col);
    rank++;
  }
  for (const row of rows)
    if (
      row.slice(0, count).every((n) => Math.abs(n) < EPS) &&
      Math.abs(row[count]) > EPS
    )
      throw Error("Sketch constraints are inconsistent.");
  const result = [...initial];
  for (let r = rank - 1; r >= 0; r--) {
    const col = pivots[r];
    result[col] =
      rows[r][count] -
      rows[r]
        .slice(0, count)
        .reduce((sum, n, i) => sum + (i === col ? 0 : n * result[i]), 0);
  }
  if (!result.every((n) => Number.isFinite(n) && Math.abs(n) <= 1e6))
    throw Error("Sketch solution is out of range.");
  const points = s.points.map(
      (_, i) => [result[2 * i], result[2 * i + 1]] as Point2,
    ),
    radius = s.kind === "circle" ? result[count - 1] : s.radius;
  if (radius <= 0) throw Error("Circle radius must be positive.");
  if (s.kind === "circle") {
    const [x, y] = points[0];
    return {
      points,
      radius,
      rank,
      degreesOfFreedom: count - rank,
      closed: true,
      area: Math.PI * radius * radius,
      bounds: { min: [x - radius, y - radius], max: [x + radius, y + radius] },
    };
  }
  let polygon = points;
  const joined =
    points.length > 2 &&
    Math.hypot(
      points[0][0] - points.at(-1)![0],
      points[0][1] - points.at(-1)![1],
    ) < EPS;
  if (joined) polygon = points.slice(0, -1);
  const closed = s.closed || joined;
  if (polygon.length < 3) throw Error("A profile needs at least three points.");
  const cross = (a: Point2, b: Point2, c: Point2) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const on = (a: Point2, b: Point2, p: Point2) =>
    Math.abs(cross(a, b, p)) < EPS &&
    p.every(
      (n, i) =>
        n >= Math.min(a[i], b[i]) - EPS && n <= Math.max(a[i], b[i]) + EPS,
    );
  const intersects = (a: Point2, b: Point2, c: Point2, d: Point2) => {
    const x = cross(a, b, c),
      y = cross(a, b, d),
      u = cross(c, d, a),
      v = cross(c, d, b);
    return (
      (x * y < 0 && u * v < 0) ||
      on(a, b, c) ||
      on(a, b, d) ||
      on(c, d, a) ||
      on(c, d, b)
    );
  };
  const edges = closed ? polygon.length : polygon.length - 1;
  for (let i = 0; i < edges; i++) {
    const a = polygon[i],
      b = polygon[(i + 1) % polygon.length];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < EPS)
      throw Error("Profile has a zero-length edge.");
    for (let j = i + 1; j < edges; j++) {
      if (j === i + 1 || (closed && i === 0 && j === edges - 1)) continue;
      if (intersects(a, b, polygon[j], polygon[(j + 1) % polygon.length]))
        throw Error("Profile self-intersects.");
    }
  }
  const area =
    Math.abs(
      polygon.reduce(
        (sum, p, i) =>
          sum +
          p[0] * polygon[(i + 1) % polygon.length][1] -
          p[1] * polygon[(i + 1) % polygon.length][0],
        0,
      ),
    ) / 2;
  if (area < EPS) throw Error("Profile is degenerate.");
  if (
    s.kind === "rectangle" &&
    (polygon.length !== 4 ||
      Math.abs(points[0][1] - points[1][1]) > EPS ||
      Math.abs(points[1][0] - points[2][0]) > EPS ||
      Math.abs(points[2][1] - points[3][1]) > EPS ||
      Math.abs(points[3][0] - points[0][0]) > EPS)
  )
    throw Error("Rectangle edges must remain horizontal/vertical.");
  const min = [
      Math.min(...polygon.map((p) => p[0])),
      Math.min(...polygon.map((p) => p[1])),
    ] as Point2,
    max = [
      Math.max(...polygon.map((p) => p[0])),
      Math.max(...polygon.map((p) => p[1])),
    ] as Point2;
  return {
    points: polygon,
    radius,
    rank,
    degreesOfFreedom: count - rank,
    closed,
    area,
    bounds: { min, max },
  };
}
export function validateExtrusion(e: Extrusion): Extrusion {
  if (!e || !Number.isFinite(e.height) || e.height < 0.001 || e.height > 1e6)
    throw Error("Extrusion height must be between 0.001 and 1,000,000 mm.");
  const solved = solveSketch(e.sketch);
  if (
    solved.bounds.max.some(
      (n, i) =>
        n - solved.bounds.min[i] < 0.001 || n - solved.bounds.min[i] > 1e6,
    )
  )
    throw Error("Profile dimensions must be between 0.001 and 1,000,000 mm.");
  if (!solved.closed)
    throw Error("Profile is open. Close it before extrusion.");
  // Keep the original point indices so constraints remain stable, including explicit coincident endpoints.
  return {
    height: e.height,
    sketch: {
      id: e.sketch.id,
      kind: e.sketch.kind,
      plane: e.sketch.plane,
      points: e.sketch.points.map((p) => [...p] as Point2),
      closed: e.sketch.closed,
      radius: e.sketch.radius,
      constraints: e.sketch.constraints.map((c) => {
        if (c.kind === "fixed")
          return {
            id: c.id,
            kind: c.kind,
            point: c.point,
            axis: c.axis,
            value: c.value,
          };
        if (c.kind === "delta")
          return {
            id: c.id,
            kind: c.kind,
            a: c.a,
            b: c.b,
            axis: c.axis,
            value: c.value,
          };
        if (c.kind === "radius")
          return { id: c.id, kind: c.kind, value: c.value };
        if (c.kind === "equal-length")
          return { id: c.id, kind: c.kind, a: c.a, b: c.b, c: c.c, d: c.d };
        return { id: c.id, kind: c.kind, a: c.a, b: c.b };
      }),
    },
  };
}
export function extrusionSize(e: Extrusion): [number, number, number] {
  const p = solveSketch(e.sketch),
    w = p.bounds.max[0] - p.bounds.min[0],
    d = p.bounds.max[1] - p.bounds.min[1];
  return e.sketch.plane === "XY"
    ? [w, d, e.height]
    : e.sketch.plane === "XZ"
      ? [w, e.height, d]
      : [e.height, w, d];
}
export function extrusionScad(e: Extrusion): string {
  const p = solveSketch(e.sketch);
  if (!p.closed) throw Error("Profile is open.");
  const profile =
    e.sketch.kind === "circle"
      ? `translate(${JSON.stringify(p.points[0])}) circle(r=${p.radius});`
      : `polygon(points=${JSON.stringify(p.points)});`;
  const frame =
    e.sketch.plane === "XY"
      ? ""
      : e.sketch.plane === "XZ"
        ? "rotate([90,0,0]) "
        : "rotate([90,0,90]) ";
  return `${frame}linear_extrude(height=${e.height}) { ${profile} }`;
}
