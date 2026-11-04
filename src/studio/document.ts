/** Millimeters and degrees. Render objects are derived, never persisted. */
export type Vec3 = [number, number, number];
export type Shape = "box" | "sphere" | "cylinder" | "cone";
export interface Body {
  id: string;
  name: string;
  kind: Shape;
  size: Vec3;
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  visible: boolean;
  locked: boolean;
}
export interface Design {
  version: 1;
  name: string;
  units: "mm";
  bodies: Body[];
}
export interface History {
  past: Design[];
  present: Design;
  future: Design[];
}
export const blankDesign = (): Design => ({
  version: 1,
  name: "Untitled design",
  units: "mm",
  bodies: [],
});
export function createBody(kind: Shape): Body {
  return {
    id: crypto.randomUUID(),
    name: kind[0].toUpperCase() + kind.slice(1),
    kind,
    size: [20, 20, 20],
    position: [0, 0, 10],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    visible: true,
    locked: false,
  };
}
export function validateDesign(input: unknown): Design {
  if (!input || typeof input !== "object")
    throw Error("Project must be an object.");
  const d = input as Design;
  if (
    d.version !== 1 ||
    d.units !== "mm" ||
    typeof d.name !== "string" ||
    d.name.length > 200 ||
    !Array.isArray(d.bodies) ||
    d.bodies.length > 1000
  )
    throw Error("Unsupported or invalid project schema.");
  const ids = new Set<string>();
  for (const b of d.bodies) {
    if (
      !b ||
      !["box", "sphere", "cylinder", "cone"].includes(b.kind) ||
      typeof b.id !== "string" ||
      !b.id ||
      ids.has(b.id) ||
      typeof b.name !== "string" ||
      b.name.length > 200 ||
      typeof b.visible !== "boolean" ||
      typeof b.locked !== "boolean"
    )
      throw Error("Invalid or duplicate body.");
    ids.add(b.id);
    for (const key of ["size", "position", "rotation", "scale"] as const) {
      const v = b[key];
      if (
        !Array.isArray(v) ||
        v.length !== 3 ||
        !v.every(
          (n) =>
            typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 1e6,
        )
      )
        throw Error(`Invalid ${key} on ${b.name}.`);
      if ((key === "size" || key === "scale") && !v.every((n) => n >= 0.001))
        throw Error(`${key} must be positive.`);
    }
  }
  // Strip unrecognized fields so imported data cannot alter runtime-only state.
  return {
    version: 1,
    name: d.name,
    units: "mm",
    bodies: d.bodies.map((b) => ({
      id: b.id,
      name: b.name,
      kind: b.kind,
      size: [...b.size],
      position: [...b.position],
      rotation: [...b.rotation],
      scale: [...b.scale],
      visible: b.visible,
      locked: b.locked,
    })),
  };
}
export function execute(h: History, next: Design): History {
  const valid = validateDesign(next);
  if (JSON.stringify(valid) === JSON.stringify(h.present)) return h;
  return {
    past: [...h.past, h.present].slice(-100),
    present: valid,
    future: [],
  };
}
export function undo(h: History): History {
  return h.past.length
    ? {
        past: h.past.slice(0, -1),
        present: h.past[h.past.length - 1],
        future: [h.present, ...h.future],
      }
    : h;
}
export function redo(h: History): History {
  return h.future.length
    ? {
        past: [...h.past, h.present],
        present: h.future[0],
        future: h.future.slice(1),
      }
    : h;
}
/** Deterministic output; editable source-backed SCAD remains in the original code workspace. */
export function generateScad(d: Design): string {
  validateDesign(d);
  return (
    "// Forma3D Studio — millimeters\n$fn=64;\n" +
    d.bodies
      .filter((b) => b.visible)
      .map((b) => {
        const solid =
          b.kind === "box"
            ? `cube(${JSON.stringify(b.size)}, center=true);`
            : b.kind === "sphere"
              ? `scale(${JSON.stringify(b.size.map((n) => n / 2))}) sphere(r=1);`
              : `scale([${b.size[0] / 2},${b.size[1] / 2},1]) cylinder(h=${b.size[2]},r1=1,r2=${b.kind === "cone" ? 0 : 1},center=true);`;
        return `translate(${JSON.stringify(b.position)}) rotate(${JSON.stringify(b.rotation)}) scale(${JSON.stringify(b.scale)}) ${solid}`;
      })
      .join("\n") +
    "\n"
  );
}
