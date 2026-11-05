import React, { useEffect, useMemo, useRef, useState } from "react";
import Numeric from "./Numeric";
import {
  Constraint,
  Extrusion,
  Point2,
  Sketch,
  SketchPlane,
  circleSketch,
  rectangleSketch,
  solveSketch,
  validateExtrusion,
} from "./sketch";
export default function SketchEditor({
  initial,
  onApply,
  onCancel,
}: {
  initial: Extrusion;
  onApply: (e: Extrusion) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<Extrusion>(() => structuredClone(initial));
  const s = draft.sketch;
  const [pointX, setPointX] = useState(0),
    [pointY, setPointY] = useState(0);
  const [snap, setSnap] = useState(true),
    [grid, setGrid] = useState(5),
    [drag, setDrag] = useState<number>();
  const [view, setView] = useState<[number, number, number, number]>([
    -10, -40, 70, 50,
  ]);
  const [kind, setKind] = useState("horizontal"),
    [a, setA] = useState(0),
    [b, setB] = useState(1),
    [c, setC] = useState(1),
    [d, setD] = useState(2),
    [value, setValue] = useState(10);
  const dialog = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const result = useMemo(() => {
    try {
      const solved = solveSketch(s);
      if (solved.closed) validateExtrusion(draft);
      return { solved, error: "" };
    } catch (e) {
      return { solved: undefined, error: String(e) };
    }
  }, [draft]);
  const solved = result.solved,
    points = solved?.points ?? s.points;
  const patch = (next: Partial<Sketch>) =>
    setDraft((old) => ({ ...old, sketch: { ...old.sketch, ...next } }));
  const fit = () => {
    const p = solved?.bounds;
    if (p)
      setView([
        p.min[0] - 10,
        -p.max[1] - 10,
        Math.max(40, p.max[0] - p.min[0] + 20),
        Math.max(30, p.max[1] - p.min[1] + 20),
      ]);
  };
  useEffect(() => {
    dialog.current?.focus();
    fit();
  }, []);
  useEffect(() => {
    setA(0);
    setB(Math.min(1, Math.max(0, s.points.length - 1)));
    setC(Math.min(1, Math.max(0, s.points.length - 1)));
    setD(Math.min(2, Math.max(0, s.points.length - 1)));
  }, [s.points.length]);
  const parameter = (
    label: string,
    match: (c: Constraint) => boolean,
    positive = false,
  ) => {
    const constraint = s.constraints.find(match);
    return constraint && "value" in constraint ? (
      <Numeric
        label={label}
        value={constraint.value}
        positive={positive}
        onCommit={(n) =>
          patch({
            constraints: s.constraints.map((c) =>
              c.id === constraint.id ? { ...c, value: n } : c,
            ),
          })
        }
      />
    ) : null;
  };
  const location = (event: React.PointerEvent | React.MouseEvent): Point2 => {
    const point = svg.current!.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const world = point.matrixTransform(svg.current!.getScreenCTM()!.inverse());
    let x = world.x,
      y = -world.y;
    if (snap) {
      x = Math.round(x / grid) * grid;
      y = Math.round(y / grid) * grid;
    }
    const candidates: Point2[] = [
      [0, 0],
      ...points.filter((_, i) => i !== drag),
    ];
    const near = candidates.find(
      (p) => Math.hypot(p[0] - x, p[1] - y) < grid * 0.35,
    );
    return near ?? [x, y];
  };
  const addConstraint = () => {
    const id = crypto.randomUUID();
    let constraint: Constraint;
    if (kind === "fixed-x" || kind === "fixed-y")
      constraint = {
        id,
        kind: "fixed",
        point: a,
        axis: kind === "fixed-x" ? 0 : 1,
        value,
      };
    else if (kind === "distance-x" || kind === "distance-y")
      constraint = {
        id,
        kind: "delta",
        a,
        b,
        axis: kind === "distance-x" ? 0 : 1,
        value,
      };
    else if (kind === "equal-length")
      constraint = { id, kind: "equal-length", a, b, c, d };
    else
      constraint = {
        id,
        kind: kind as "horizontal" | "vertical" | "coincident",
        a,
        b,
      };
    patch({ constraints: [...s.constraints, constraint] });
  };
  const index = (label: string, index: number, set: (n: number) => void) => (
    <label>
      {label}
      <select
        aria-label={label}
        value={index}
        onChange={(e) => set(Number(e.target.value))}
      >
        {s.points.map((_, i) => (
          <option key={i} value={i}>
            Point {i + 1}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <div className="studio-sketch-backdrop">
      <div
        className="studio-sketch-editor"
        role="dialog"
        aria-modal="true"
        aria-label="Sketch editor"
        tabIndex={-1}
        ref={dialog}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
          }
          if (event.key === "Tab") {
            const items = [
              ...dialog.current!.querySelectorAll<HTMLElement>(
                "button:not(:disabled),input:not(:disabled),select:not(:disabled)",
              ),
            ];
            const first = items[0],
              last = items.at(-1);
            if (
              event.shiftKey &&
              (document.activeElement === first ||
                document.activeElement === dialog.current)
            ) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <header>
          <h2>Sketch & extrusion</h2>
          <button onClick={onCancel}>Cancel sketch</button>
        </header>
        <p>
          Draft profile: apply before saving or exporting. Cancel keeps the
          previous solid.
        </p>
        <div className="studio-sketch-layout">
          <section className="studio-sketch-drawing">
            <div className="studio-viewtools">
              <label>
                Profile
                <select
                  aria-label="Sketch shape"
                  value={s.kind}
                  onChange={(e) => {
                    const kind = e.target.value;
                    const next: Sketch =
                      kind === "rectangle"
                        ? rectangleSketch()
                        : kind === "circle"
                          ? circleSketch()
                          : {
                              ...s,
                              kind: "polygon" as const,
                              points:
                                points.length >= 3
                                  ? points
                                  : [
                                      [0, 0],
                                      [20, 0],
                                      [20, 20],
                                      [0, 20],
                                    ],
                              constraints: [],
                            };
                    setDraft({
                      ...draft,
                      sketch: { ...next, id: s.id, plane: s.plane },
                    });
                  }}
                >
                  <option value="rectangle">Rectangle</option>
                  <option value="circle">Circle</option>
                  <option value="polygon">Polygon / polyline</option>
                </select>
              </label>
              <label>
                Plane
                <select
                  aria-label="Sketch plane"
                  value={s.plane}
                  onChange={(e) =>
                    patch({ plane: e.target.value as SketchPlane })
                  }
                >
                  <option value="XY">XY → +Z</option>
                  <option value="XZ">XZ → −Y</option>
                  <option value="YZ">YZ → +X</option>
                </select>
              </label>
              <label>
                Grid
                <select
                  aria-label="Sketch grid"
                  value={grid}
                  onChange={(e) => setGrid(Number(e.target.value))}
                >
                  {[1, 2, 5, 10].map((n) => (
                    <option key={n} value={n}>
                      {n} mm
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={snap}
                  onChange={(e) => setSnap(e.target.checked)}
                />{" "}
                Grid snap
              </label>
              <button disabled={!solved} onClick={fit}>
                Fit profile
              </button>
              <button
                onClick={() =>
                  setView(([x, y, w, h]) => [
                    x + w / 4,
                    y + h / 4,
                    w / 2,
                    h / 2,
                  ])
                }
              >
                Zoom in
              </button>
              <button
                onClick={() =>
                  setView(([x, y, w, h]) => [
                    x - w / 2,
                    y - h / 2,
                    w * 2,
                    h * 2,
                  ])
                }
              >
                Zoom out
              </button>
            </div>
            <svg
              ref={svg}
              role="img"
              aria-label="2D sketch canvas"
              viewBox={view.join(" ")}
              onClick={(event) => {
                if (s.kind === "polygon" && !s.closed && drag === undefined) {
                  const point = location(event);
                  if (
                    s.points.length >= 3 &&
                    Math.hypot(
                      point[0] - s.points[0][0],
                      point[1] - s.points[0][1],
                    ) < 1e-6
                  )
                    patch({ closed: true });
                  else if (s.points.length < 64)
                    patch({ points: [...s.points, point] });
                }
              }}
              onPointerMove={(event) => {
                if (drag === undefined) return;
                const point = location(event);
                patch({
                  points: s.points.map((p, i) => (i === drag ? point : p)),
                });
              }}
              onPointerUp={() => setDrag(undefined)}
              onPointerCancel={() => setDrag(undefined)}
            >
              <defs>
                <pattern
                  id="sketch-grid"
                  width={grid}
                  height={grid}
                  patternUnits="userSpaceOnUse"
                >
                  <path
                    d={`M ${grid} 0 L 0 0 0 ${grid}`}
                    fill="none"
                    stroke="#35465e"
                    strokeWidth="0.1"
                  />
                </pattern>
              </defs>
              <rect
                x={view[0]}
                y={view[1]}
                width={view[2]}
                height={view[3]}
                fill="url(#sketch-grid)"
              />
              <path
                d={`M ${view[0]} 0 h ${view[2]} M 0 ${view[1]} v ${view[3]}`}
                stroke="#6b849c"
                strokeWidth="0.15"
              />
              {s.kind === "circle" ? (
                <circle
                  cx={points[0]?.[0]}
                  cy={-points[0]?.[1]}
                  r={solved?.radius ?? s.radius}
                  fill="#6ca7cc33"
                  stroke="#ffbe55"
                  strokeWidth="0.4"
                />
              ) : (
                <path
                  d={
                    points
                      .map((p, i) => `${i === 0 ? "M" : "L"} ${p[0]} ${-p[1]}`)
                      .join(" ") + ((solved?.closed ?? s.closed) ? " Z" : "")
                  }
                  fill={(solved?.closed ?? s.closed) ? "#6ca7cc33" : "none"}
                  stroke={result.error ? "#ff7a7a" : "#ffbe55"}
                  strokeWidth="0.4"
                />
              )}
              {points.map((p, i) => (
                <g key={i}>
                  <circle
                    cx={p[0]}
                    cy={-p[1]}
                    r="0.8"
                    fill="#fff"
                    stroke="#ffbe55"
                    strokeWidth="0.3"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (
                        s.kind === "polygon" &&
                        !s.closed &&
                        i === 0 &&
                        s.points.length >= 3
                      )
                        patch({ closed: true });
                    }}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      if (solved?.degreesOfFreedom === 0) return;
                      setDrag(i);
                      event.currentTarget.setPointerCapture(event.pointerId);
                    }}
                  />
                  <text
                    x={p[0] + 1}
                    y={-p[1] - 1}
                    fontSize="2"
                    fill="#dce8ff"
                    pointerEvents="none"
                  >
                    {i + 1}
                  </text>
                </g>
              ))}
              {s.kind !== "circle" &&
                points.map((p, i) => {
                  if (!s.closed && i === points.length - 1) return null;
                  const next = points[(i + 1) % points.length];
                  return (
                    <text
                      key={i}
                      x={(p[0] + next[0]) / 2}
                      y={-(p[1] + next[1]) / 2 - 1.5}
                      fontSize="2"
                      fill="#9ed5ff"
                      pointerEvents="none"
                    >
                      {Math.hypot(next[0] - p[0], next[1] - p[1]).toFixed(2)} mm
                    </text>
                  );
                })}
            </svg>
            {s.kind === "polygon" && (
              <div className="studio-viewtools">
                <button
                  onClick={() =>
                    patch({ points: [], constraints: [], closed: false })
                  }
                >
                  Draw new polygon
                </button>
                <button
                  disabled={s.points.length < 3}
                  onClick={() => patch({ closed: !s.closed })}
                >
                  {s.closed ? "Reopen profile" : "Close profile"}
                </button>
                <button
                  disabled={!s.points.length}
                  onClick={() =>
                    patch({
                      points: s.points.slice(0, -1),
                      constraints: s.constraints.filter(
                        (c) =>
                          !("point" in c && c.point === s.points.length - 1) &&
                          !(
                            "a" in c &&
                            [
                              c.a,
                              c.b,
                              ...(c.kind === "equal-length" ? [c.c, c.d] : []),
                            ].some((i) => i === s.points.length - 1)
                          ),
                      ),
                      closed: false,
                    })
                  }
                >
                  Remove last point
                </button>
              </div>
            )}
            {s.kind === "polygon" && !s.closed && (
              <div className="studio-viewtools">
                <Numeric
                  label="Point X (mm)"
                  value={pointX}
                  onCommit={setPointX}
                />
                <Numeric
                  label="Point Y (mm)"
                  value={pointY}
                  onCommit={setPointY}
                />
                <button
                  disabled={s.points.length >= 64}
                  onClick={() =>
                    patch({ points: [...s.points, [pointX, pointY]] })
                  }
                >
                  Add point
                </button>
              </div>
            )}
            <p role="status" className="studio-sketch-status">
              {result.error ||
                (!solved?.closed
                  ? "Open profile — close it before extrusion."
                  : solved.degreesOfFreedom === 0
                    ? "Fully constrained (verified by solver)."
                    : `Underconstrained: ${solved.degreesOfFreedom} degrees of freedom.`)}
            </p>
            <p>
              Click to draw an open polygon. Drag free vertices. Grid, endpoints
              and the origin can snap. Fully constrained profiles are edited
              numerically.
            </p>
          </section>
          <aside>
            <Numeric
              label="Extrusion height (mm)"
              value={draft.height}
              positive
              onCommit={(height) => setDraft({ ...draft, height })}
            />
            {s.kind === "rectangle" && (
              <>
                {parameter(
                  "Sketch width (mm)",
                  (c) => c.kind === "delta" && c.axis === 0,
                  true,
                )}
                {parameter(
                  "Sketch depth (mm)",
                  (c) => c.kind === "delta" && c.axis === 1,
                  true,
                )}
              </>
            )}
            {s.kind === "circle" &&
              parameter("Sketch radius (mm)", (c) => c.kind === "radius", true)}
            {(s.kind === "rectangle" || s.kind === "circle") && (
              <>
                {parameter(
                  "Sketch anchor X (mm)",
                  (c) => c.kind === "fixed" && c.point === 0 && c.axis === 0,
                )}
                {parameter(
                  "Sketch anchor Y (mm)",
                  (c) => c.kind === "fixed" && c.point === 0 && c.axis === 1,
                )}
              </>
            )}
            {(s.kind === "rectangle" || s.kind === "circle") && (
              <button
                onClick={() => {
                  const next =
                    s.kind === "circle"
                      ? circleSketch(solved?.radius ?? s.radius)
                      : rectangleSketch(
                          (solved?.bounds.max[0] ?? 20) -
                            (solved?.bounds.min[0] ?? 0),
                          (solved?.bounds.max[1] ?? 20) -
                            (solved?.bounds.min[1] ?? 0),
                        );
                  next.constraints = next.constraints.map((c) =>
                    c.kind === "fixed"
                      ? { ...c, value: solved?.points[0][c.axis] ?? 0 }
                      : c,
                  );
                  setDraft({
                    ...draft,
                    sketch: { ...next, id: s.id, plane: s.plane },
                  });
                }}
              >
                Restore dimensional constraints
              </button>
            )}
            <h2>Constraints</h2>
            <ul className="studio-sketch-constraints">
              {s.constraints.map((c, i) => (
                <li key={c.id}>
                  {c.kind}
                  {"value" in c ? ` = ${c.value}` : ""}{" "}
                  <button
                    aria-label={`Remove constraint ${i + 1}`}
                    onClick={() =>
                      patch({
                        constraints: s.constraints.filter((x) => x.id !== c.id),
                      })
                    }
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
            {s.kind === "polygon" && s.points.length >= 3 && (
              <>
                <label>
                  Constraint
                  <select
                    aria-label="Constraint type"
                    value={kind}
                    onChange={(e) => setKind(e.target.value)}
                  >
                    {[
                      "horizontal",
                      "vertical",
                      "coincident",
                      "fixed-x",
                      "fixed-y",
                      "distance-x",
                      "distance-y",
                      "equal-length",
                    ].map((k) => (
                      <option key={k}>{k}</option>
                    ))}
                  </select>
                </label>
                {index("Constraint point A", a, setA)}
                {index("Constraint point B", b, setB)}
                {kind === "equal-length" && (
                  <>
                    {index("Constraint point C", c, setC)}
                    {index("Constraint point D", d, setD)}
                  </>
                )}
                {(kind.startsWith("fixed") || kind.startsWith("distance")) && (
                  <Numeric
                    label="Constraint value (mm)"
                    value={value}
                    onCommit={setValue}
                  />
                )}
                <button
                  disabled={s.constraints.length >= 256}
                  onClick={addConstraint}
                >
                  Add constraint
                </button>
              </>
            )}
            <p className="studio-muted">
              Equal length supports axis-aligned segments. General nonlinear
              constraints, arcs and arbitrary-face sketches are not available.
            </p>
          </aside>
        </div>
        <footer>
          <span>
            {solved?.closed
              ? `Profile area: ${solved.area.toFixed(3)} mm²`
              : "Invalid or open profile"}
          </span>
          <button
            disabled={!!result.error || !solved?.closed}
            onClick={() => onApply(validateExtrusion(draft))}
          >
            Apply extrusion
          </button>
        </footer>
      </div>
    </div>
  );
}
