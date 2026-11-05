import type { Body, Design, Vec3 } from "./document";
import { solveSketch } from "./sketch";
export interface Pose {
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
}
interface Base extends Pose {
  id: string;
  name: string;
  inputs: string[];
  visible: boolean;
  locked: boolean;
}
export type ModelingFeature = Base &
  (
    | {
        operation: "mirror";
        spec: { axis: "X" | "Y" | "Z"; offset: number; keepOriginal: boolean };
      }
    | { operation: "linear-pattern"; spec: { count: number; step: Vec3 } }
    | {
        operation: "circular-pattern";
        spec: { count: number; angle: number; axis: "X" | "Y" | "Z" };
      }
    | { operation: "group"; spec: Record<string, never> }
    | {
        operation: "profile-offset";
        spec: { distance: number; join: "round" | "miter" | "chamfer" };
      }
    | { operation: "revolve"; spec: { angle: number } }
    | { operation: "shell"; spec: { wall: number; openTop: boolean } }
    | { operation: "fillet" | "chamfer"; spec: { radius: number } }
  );
export type ModelingOperation = ModelingFeature["operation"];
export const modelingNames: Record<ModelingOperation, string> = {
  mirror: "Mirror",
  "linear-pattern": "Linear pattern",
  "circular-pattern": "Circular pattern",
  group: "Group",
  "profile-offset": "Profile offset",
  revolve: "Revolution",
  shell: "Shell",
  fillet: "Box vertical fillet",
  chamfer: "Box vertical chamfer",
};
export const identityPose = (): Pose => ({
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
});
export function poseScad(p: Pose): string {
  return `translate(${JSON.stringify(p.position)}) rotate(${JSON.stringify(p.rotation)}) scale(${JSON.stringify(p.scale)}) `;
}
export function validatePose(p: Pose): void {
  for (const key of ["position", "rotation", "scale"] as const)
    if (
      !Array.isArray(p[key]) ||
      p[key].length !== 3 ||
      !p[key].every(
        (n) =>
          Number.isFinite(n) &&
          Math.abs(n) <= 1e6 &&
          (key !== "scale" || n >= 0.001),
      )
    )
      throw Error(`Invalid ${key}.`);
}
export function createModelingFeature(
  operation: ModelingOperation,
  inputs: string[],
  design?: Design,
): ModelingFeature {
  const base = {
    ...identityPose(),
    id: crypto.randomUUID(),
    name: modelingNames[operation],
    inputs,
    visible: true,
    locked: false,
  };
  let radius = 2,
    wall = 2;
  if (
    design &&
    (operation === "fillet" || operation === "chamfer" || operation === "shell")
  ) {
    const p = profileOf(design, inputs[0]);
    const width = Math.min(p.max[0] - p.min[0], p.max[1] - p.min[1]);
    radius = Math.min(2, width / 4);
    wall = Math.min(2, width / 4, p.height / 4);
  }
  switch (operation) {
    case "mirror":
      return {
        ...base,
        operation,
        spec: { axis: "X", offset: 0, keepOriginal: true },
      };
    case "linear-pattern":
      return { ...base, operation, spec: { count: 3, step: [30, 0, 0] } };
    case "circular-pattern":
      return { ...base, operation, spec: { count: 4, angle: 360, axis: "Z" } };
    case "group":
      return { ...base, operation, spec: {} };
    case "profile-offset":
      return { ...base, operation, spec: { distance: 2, join: "round" } };
    case "revolve":
      return { ...base, operation, spec: { angle: 360 } };
    case "shell":
      return { ...base, operation, spec: { wall, openTop: true } };
    case "fillet":
    case "chamfer":
      return { ...base, operation, spec: { radius } };
  }
}
export function validateModelingFeature(f: ModelingFeature): ModelingFeature {
  if (
    !f ||
    !Object.hasOwn(modelingNames, f.operation) ||
    !f.spec ||
    typeof f.spec !== "object" ||
    Array.isArray(f.spec) ||
    typeof f.locked !== "boolean"
  )
    throw Error("Invalid modeling feature.");
  validatePose(f);
  const bounded = (n: number, positive = false) => {
    if (!Number.isFinite(n) || Math.abs(n) > 1e6 || (positive && n < 0.001))
      throw Error("Modeling parameter is out of range.");
  };
  const axis = (a: string) => {
    if (!["X", "Y", "Z"].includes(a)) throw Error("Invalid modeling axis.");
  };
  let spec: ModelingFeature["spec"];
  switch (f.operation) {
    case "mirror":
      axis(f.spec.axis);
      bounded(f.spec.offset);
      if (typeof f.spec.keepOriginal !== "boolean")
        throw Error("Invalid mirror setting.");
      spec = {
        axis: f.spec.axis,
        offset: f.spec.offset,
        keepOriginal: f.spec.keepOriginal,
      };
      break;
    case "linear-pattern":
      if (!Array.isArray(f.spec.step) || f.spec.step.length !== 3)
        throw Error("Invalid pattern step.");
      f.spec.step.forEach((n) => bounded(n));
      if (f.spec.step.every((n) => n === 0))
        throw Error("Pattern step cannot be zero.");
      spec = { count: f.spec.count, step: [...f.spec.step] };
      break;
    case "circular-pattern":
      axis(f.spec.axis);
      if (
        !Number.isFinite(f.spec.angle) ||
        f.spec.angle <= 0 ||
        f.spec.angle > 360
      )
        throw Error("Pattern sweep must be in (0, 360].");
      spec = { count: f.spec.count, angle: f.spec.angle, axis: f.spec.axis };
      break;
    case "group":
      spec = {};
      break;
    case "profile-offset":
      bounded(f.spec.distance);
      if (!["round", "miter", "chamfer"].includes(f.spec.join))
        throw Error("Invalid offset join.");
      spec = { distance: f.spec.distance, join: f.spec.join };
      break;
    case "revolve":
      if (
        !Number.isFinite(f.spec.angle) ||
        f.spec.angle <= 0 ||
        f.spec.angle > 360
      )
        throw Error("Revolution angle must be in (0, 360].");
      spec = { angle: f.spec.angle };
      break;
    case "shell":
      bounded(f.spec.wall, true);
      if (typeof f.spec.openTop !== "boolean")
        throw Error("Invalid shell opening.");
      spec = { wall: f.spec.wall, openTop: f.spec.openTop };
      break;
    case "fillet":
    case "chamfer":
      bounded(f.spec.radius, true);
      spec = { radius: f.spec.radius };
      break;
  }
  if (
    (f.operation === "linear-pattern" || f.operation === "circular-pattern") &&
    (!Number.isInteger(f.spec.count) || f.spec.count < 2 || f.spec.count > 100)
  )
    throw Error("Patterns require 2–100 instances.");
  return {
    id: f.id,
    name: f.name,
    operation: f.operation,
    visible: f.visible,
    locked: f.locked,
    spec,
    position: [...f.position],
    rotation: [...f.rotation],
    scale: [...f.scale],
    inputs: [...f.inputs],
  } as ModelingFeature;
}
export interface Profile {
  source: string;
  height: number;
  center: boolean;
  frame: string;
  body: Body;
  min: [number, number];
  max: [number, number];
  convex: boolean;
}
export function profileOf(d: Design, id: string, allowPose = false): Profile {
  const b = d.bodies.find((b) => b.id === id);
  if (b) {
    if (b.kind === "extrusion") {
      const e = b.extrusion!,
        s = solveSketch(e.sketch);
      return {
        source:
          e.sketch.kind === "circle"
            ? `translate(${JSON.stringify(s.points[0])}) circle(r=${s.radius});`
            : `polygon(points=${JSON.stringify(s.points)});`,
        height: e.height,
        center: false,
        frame:
          e.sketch.plane === "XY"
            ? ""
            : e.sketch.plane === "XZ"
              ? "rotate([90,0,0]) "
              : "rotate([90,0,90]) ",
        body: b,
        min: s.bounds.min,
        max: s.bounds.max,
        convex: e.sketch.kind !== "polygon",
      };
    }
    if (b.kind === "box")
      return {
        source: `square([${b.size[0]},${b.size[1]}],center=true);`,
        height: b.size[2],
        center: true,
        frame: "",
        body: b,
        min: [-b.size[0] / 2, -b.size[1] / 2],
        max: [b.size[0] / 2, b.size[1] / 2],
        convex: true,
      };
    if (b.kind === "cylinder" && Math.abs(b.size[0] - b.size[1]) < 1e-8)
      return {
        source: `circle(r=${b.size[0] / 2});`,
        height: b.size[2],
        center: true,
        frame: "",
        body: b,
        min: [-b.size[0] / 2, -b.size[1] / 2],
        max: [b.size[0] / 2, b.size[1] / 2],
        convex: true,
      };
  }
  const f = d.features.find((f) => f.id === id);
  if (f && (f.operation === "fillet" || f.operation === "chamfer")) {
    const original = d.bodies.find((b) => b.id === f.inputs[0]);
    if (!original || original.kind !== "box")
      throw Error("Vertical fillet/chamfer requires a box primitive.");
    const p = profileOf(d, original.id),
      r = f.spec.radius;
    if (r >= Math.min(original.size[0], original.size[1]) / 2)
      throw Error(
        "Edge radius/setback must be smaller than half the box width and depth.",
      );
    if (
      !allowPose &&
      (f.position.some((n) => n !== 0) ||
        f.rotation.some((n) => n !== 0) ||
        f.scale.some((n) => n !== 1))
    )
      throw Error(
        "Apply shell before transforming the edge-treated feature; transform the final result instead.",
      );
    const x = original.size[0] / 2,
      y = original.size[1] / 2;
    const points = [
      [-x + r, -y],
      [x - r, -y],
      [x, -y + r],
      [x, y - r],
      [x - r, y],
      [-x + r, y],
      [-x, y - r],
      [-x, -y + r],
    ];
    return {
      ...p,
      source:
        f.operation === "fillet"
          ? `offset(r=${r}) square([${original.size[0] - 2 * r},${original.size[1] - 2 * r}],center=true);`
          : `polygon(points=${JSON.stringify(points)});`,
    };
  }
  throw Error(
    "This operation needs a box, circular cylinder, or sketch extrusion profile.",
  );
}
export function validateAdvancedDependencies(d: Design): void {
  for (const f of d.features) {
    if (f.operation === "fillet" || f.operation === "chamfer") {
      profileOf(d, f.id, true);
    }
    if (
      f.operation === "profile-offset" ||
      f.operation === "revolve" ||
      f.operation === "shell"
    ) {
      const p = profileOf(d, f.inputs[0]);
      if (f.operation === "profile-offset" && p.body.kind !== "extrusion")
        throw Error("Profile offset requires a sketch extrusion.");
      if (
        f.operation === "revolve" &&
        (p.body.kind !== "extrusion" ||
          p.body.extrusion!.sketch.plane !== "XY" ||
          p.min[0] < -1e-8 ||
          p.max[0] <= 0)
      )
        throw Error(
          "Revolution requires an XY sketch entirely on the nonnegative X (radius) side.",
        );
      if (
        f.operation === "shell" &&
        (!p.convex ||
          f.spec.wall * 2 >=
            Math.min(p.max[0] - p.min[0], p.max[1] - p.min[1]) ||
          f.spec.wall * (f.spec.openTop ? 1 : 2) >= p.height)
      )
        throw Error(
          "Shell requires a convex box/circular profile and a wall thinner than half its width/depth and its available height.",
        );
    }
  }
}
export function modelingScad(
  d: Design,
  f: ModelingFeature,
  call: (id: string) => string,
): string {
  const child = call(f.inputs[0]);
  let code: string;
  switch (f.operation) {
    case "group":
      code = `union(){${f.inputs.map(call).join(" ")}}`;
      break;
    case "mirror": {
      const i = "XYZ".indexOf(f.spec.axis),
        v = [0, 0, 0];
      v[i] = 1;
      const t = [0, 0, 0];
      t[i] = f.spec.offset;
      code = `union(){${f.spec.keepOriginal ? child : ""} translate(${JSON.stringify(t)}) mirror(${JSON.stringify(v)}) translate(${JSON.stringify(t.map((n) => -n))}) ${child}}`;
      break;
    }
    case "linear-pattern":
      code = `for(i=[0:${f.spec.count - 1}]) translate([${f.spec.step.map((n) => `i*${n}`).join(",")}]) ${child}`;
      break;
    case "circular-pattern": {
      const i = "XYZ".indexOf(f.spec.axis),
        v = ["0", "0", "0"];
      v[i] =
        `i*${f.spec.angle === 360 ? 360 / f.spec.count : f.spec.angle / (f.spec.count - 1)}`;
      code = `for(i=[0:${f.spec.count - 1}]) rotate([${v.join(",")}]) ${child}`;
      break;
    }
    case "fillet":
    case "chamfer": {
      const p = profileOf(d, f.id, true);
      code = `${poseScad(p.body)}linear_extrude(height=${p.height},center=true){${p.source}}`;
      break;
    }
    case "profile-offset": {
      const p = profileOf(d, f.inputs[0]);
      code = `${poseScad(p.body)}${p.frame}linear_extrude(height=${p.height},center=${p.center}){offset(${f.spec.join === "round" ? `r=${f.spec.distance}` : `delta=${f.spec.distance},chamfer=${f.spec.join === "chamfer"}`}) {${p.source}}}`;
      break;
    }
    case "revolve": {
      const p = profileOf(d, f.inputs[0]);
      code = `${poseScad(p.body)}rotate_extrude(angle=${f.spec.angle}){${p.source}}`;
      break;
    }
    case "shell": {
      const p = profileOf(d, f.inputs[0]),
        t = f.spec.wall;
      code = `${poseScad(p.body)}${p.frame}difference(){linear_extrude(height=${p.height},center=${p.center}){${p.source}} ${f.spec.openTop ? `translate([0,0,${t}])` : !p.center ? `translate([0,0,${t}])` : ""}linear_extrude(height=${f.spec.openTop ? p.height : p.height - 2 * t},center=${p.center}){offset(delta=-${t}){${p.source}}}}`;
      break;
    }
  }
  return `${poseScad(f)}{${code}}`;
}
