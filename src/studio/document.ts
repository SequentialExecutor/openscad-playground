import {
  ModelingFeature,
  validateModelingFeature,
  validateAdvancedDependencies,
  modelingScad,
} from "./advanced";
import {
  MechanicalSpec,
  validateTemplate,
  templateSize,
  templateScad,
  templateNames,
} from "./templates";
import {
  Extrusion,
  validateExtrusion,
  extrusionSize,
  extrusionScad,
} from "./sketch";
import {
  defaultPrintSettings,
  validatePrintSettings,
  PrintSettings,
} from "./mesh-analysis";
/** Millimeters and degrees. Render objects are derived, never persisted. */
export type Vec3 = [number, number, number];
export type Shape = "box" | "sphere" | "cylinder" | "cone";
export interface Body {
  id: string;
  name: string;
  kind: Shape | "extrusion" | "template";
  template?: MechanicalSpec;
  extrusion?: Extrusion;
  size: Vec3;
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  visible: boolean;
  locked: boolean;
}
export type BooleanOperation = "union" | "difference" | "intersection";
export interface BooleanFeature {
  id: string;
  name: string;
  operation: BooleanOperation;
  inputs: [string, string];
  visible: boolean;
}
export type Feature = BooleanFeature | ModelingFeature;
export type Transformable = Body | ModelingFeature;
export interface Design {
  version: 4;
  name: string;
  units: "mm";
  bodies: Body[];
  features: Feature[];
  print: PrintSettings;
}
export interface History {
  past: Design[];
  present: Design;
  future: Design[];
}
export const blankDesign = (): Design => ({
  version: 4,
  features: [],
  print: structuredClone(defaultPrintSettings),
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
  const raw = input as { version?: unknown };
  const d = (
    raw.version === 1
      ? { ...input, version: 4, features: [] }
      : raw.version === 2 || raw.version === 3
        ? { ...input, version: 4 }
        : input
  ) as Design;
  if (
    d.version !== 4 ||
    d.units !== "mm" ||
    typeof d.name !== "string" ||
    d.name.length > 200 ||
    !Array.isArray(d.bodies) ||
    !Array.isArray(d.features) ||
    d.bodies.length + d.features.length > 1000
  )
    throw Error("Unsupported or invalid project schema.");
  const print = d.print === undefined ? defaultPrintSettings : d.print;
  validatePrintSettings(print);
  const ids = new Set<string>();
  for (const b of d.bodies) {
    if (
      !b ||
      !["box", "sphere", "cylinder", "cone", "extrusion", "template"].includes(
        b.kind,
      ) ||
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
  const sketchIds = new Set<string>();
  for (const b of d.bodies)
    if (b.kind === "extrusion") {
      const e = validateExtrusion(b.extrusion!);
      if (sketchIds.has(e.sketch.id)) throw Error("Duplicate sketch ID.");
      sketchIds.add(e.sketch.id);
    }
  for (const f of d.features) {
    if (
      !f ||
      typeof f.id !== "string" ||
      !f.id ||
      ids.has(f.id) ||
      typeof f.name !== "string" ||
      f.name.length > 200 ||
      typeof f.visible !== "boolean" ||
      !Array.isArray(f.inputs) ||
      !f.inputs.every((id) => typeof id === "string") ||
      new Set(f.inputs).size !== f.inputs.length
    )
      throw Error("Invalid feature or duplicate ID/operand.");
    if (["union", "difference", "intersection"].includes(f.operation)) {
      if (f.inputs.length !== 2) throw Error("A boolean needs two operands.");
    } else {
      validateModelingFeature(f as ModelingFeature);
      if (
        f.operation === "group"
          ? f.inputs.length < 1 || f.inputs.length > 1000
          : f.inputs.length !== 1
      )
        throw Error("Invalid modeling operand count.");
    }
    ids.add(f.id);
  }
  for (const id of sketchIds)
    if (ids.has(id)) throw Error("Sketch and node IDs must be distinct.");
  const features = new Map(d.features.map((f) => [f.id, f]));
  const visiting = new Set<string>();
  const depths = new Map<string, number>();
  const visit = (id: string): number => {
    if (!ids.has(id))
      throw Error(
        "Feature operand is missing. Remove dependent features before deleting an operand.",
      );
    if (visiting.has(id)) throw Error("Feature graph contains a cycle.");
    const cached = depths.get(id);
    if (cached !== undefined) return cached;
    visiting.add(id);
    const depth =
      1 + Math.max(0, ...(features.get(id)?.inputs.map(visit) ?? []));
    visiting.delete(id);
    if (depth > 64) throw Error("Feature graph exceeds 64 levels.");
    depths.set(id, depth);
    return depth;
  };
  for (const id of ids) visit(id);
  const costs = new Map<string, number>();
  const cost = (id: string): number => {
    if (costs.has(id)) return costs.get(id)!;
    const f = features.get(id);
    let n = f ? f.inputs.reduce((sum, id) => sum + cost(id), 0) : 1;
    if (
      f?.operation === "linear-pattern" ||
      f?.operation === "circular-pattern"
    )
      n *= f.spec.count;
    if (f?.operation === "mirror" && f.spec.keepOriginal) n *= 2;
    if (n > 10000)
      throw Error("Model exceeds 10,000 expanded primitive instances.");
    costs.set(id, n);
    return n;
  };
  for (const id of ids) cost(id);
  const consumed = new Set(d.features.flatMap((f) => f.inputs));
  if (
    [...ids]
      .filter((id) => !consumed.has(id))
      .reduce((sum, id) => sum + cost(id), 0) > 10000
  )
    throw Error("Model exceeds 10,000 expanded primitive instances.");
  validateAdvancedDependencies(d);
  for (const b of d.bodies)
    if (b.kind === "template") {
      const size = templateSize(validateTemplate(b.template!));
      if (!size.every((n) => n >= 0.001 && n <= 1e6))
        throw Error("Template bounds exceed modeling limits.");
    }
  // Strip unrecognized fields so imported data cannot alter runtime-only state.
  return {
    version: 4,
    print: {
      build: [...print.build],
      nozzle: print.nozzle,
      layer: print.layer,
      minimumWall: print.minimumWall,
      overhang: print.overhang,
    },
    features: d.features.map((f) =>
      ["union", "difference", "intersection"].includes(f.operation)
        ? {
            id: f.id,
            name: f.name,
            operation: f.operation as BooleanOperation,
            inputs: [...f.inputs] as [string, string],
            visible: f.visible,
          }
        : validateModelingFeature(f as ModelingFeature),
    ),
    name: d.name,
    units: "mm",
    bodies: d.bodies.map((b) => ({
      id: b.id,
      name: b.name,
      kind: b.kind,
      size:
        b.kind === "extrusion"
          ? extrusionSize(b.extrusion!)
          : b.kind === "template"
            ? templateSize(b.template!)
            : [...b.size],
      ...(b.kind === "template"
        ? { template: validateTemplate(b.template!) }
        : {}),
      ...(b.kind === "extrusion"
        ? { extrusion: validateExtrusion(b.extrusion!) }
        : {}),
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
export function createBoolean(
  operation: BooleanOperation,
  inputs: [string, string],
): BooleanFeature {
  return {
    id: crypto.randomUUID(),
    name: operation[0].toUpperCase() + operation.slice(1),
    operation,
    inputs,
    visible: true,
  };
}
export function rootNodes(d: Design): (Body | Feature)[] {
  const consumed = new Set(d.features.flatMap((f) => f.inputs));
  return [...d.bodies, ...d.features].filter(
    (node) => node.visible && !consumed.has(node.id),
  );
}
/** Module calls keep source bounded even for shared, nested feature graphs. */
export function generateScad(design: Design, roots?: string[]): string {
  const d = validateDesign(design);
  const nodes = [...d.bodies, ...d.features];
  const byId = new Map(nodes.map((node, index) => [node.id, { node, index }]));
  const output = roots ?? rootNodes(d).map((node) => node.id);
  const used = new Set<string>();
  const mark = (id: string) => {
    if (used.has(id)) return;
    const found = byId.get(id);
    if (!found) throw Error("Requested output is missing.");
    used.add(id);
    if ("inputs" in found.node) found.node.inputs.forEach(mark);
  };
  output.forEach(mark);
  const definitions = nodes
    .filter((node) => used.has(node.id))
    .map((node) => {
      const name = `n${byId.get(node.id)!.index}`;
      if ("inputs" in node && "spec" in node)
        return `module ${name}() { ${modelingScad(d, node, (id) => `n${byId.get(id)!.index}();`)} }`;
      if ("inputs" in node)
        return `module ${name}() { ${node.operation}() { ${node.inputs.map((id) => `n${byId.get(id)!.index}();`).join(" ")} } }`;
      const b = node;
      const solid =
        b.kind === "template"
          ? templateScad(b.template!)
          : b.kind === "extrusion"
            ? extrusionScad(b.extrusion!)
            : b.kind === "box"
              ? `cube(${JSON.stringify(b.size)}, center=true);`
              : b.kind === "sphere"
                ? `scale(${JSON.stringify(b.size.map((n) => n / 2))}) sphere(r=1);`
                : `scale([${b.size[0] / 2},${b.size[1] / 2},1]) cylinder(h=${b.size[2]},r1=1,r2=${b.kind === "cone" ? 0 : 1},center=true);`;
      return `module ${name}() { translate(${JSON.stringify(b.position)}) rotate(${JSON.stringify(b.rotation)}) scale(${JSON.stringify(b.scale)}) ${solid} }`;
    });
  return (
    "// Forma3D Studio — millimeters\n$fn=64;\n" +
    definitions.join("\n") +
    "\n" +
    output.map((id) => `n${byId.get(id)!.index}();`).join("\n") +
    "\n"
  );
}

export function createExtrusion(extrusion: Extrusion): Body {
  const e = validateExtrusion(extrusion);
  return {
    ...createBody("box"),
    name: "Sketch extrusion",
    kind: "extrusion",
    position: [0, 0, 0],
    size: extrusionSize(e),
    extrusion: e,
  };
}

export function createTemplateBody(template: MechanicalSpec): Body {
  const t = validateTemplate(template);
  return {
    ...createBody("box"),
    kind: "template",
    name: templateNames[t.kind],
    position: [0, 0, 0],
    size: templateSize(t),
    template: t,
  };
}
export function isTransformable(node: Body | Feature): node is Transformable {
  return "position" in node;
}
