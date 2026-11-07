import { parseAuthoredProgram } from "./authored-scad";
import { Body, Design, rootNodes, validateDesign } from "./document";
import { modelingScad } from "./advanced";
import { templateScad } from "./templates";
import { extrusionScad } from "./sketch";

export const importedCodeReason =
  "Code workspace unavailable: this design contains imported or mesh geometry. Remove all mesh bodies, including hidden operands, to edit native shapes as code.";

export function hasMeshBodies(d: Design): boolean {
  return d.bodies.some((b) => b.kind === "mesh");
}

/** Keep public SCAD expressed in its own primitives, without generated modules. */
export function readableBodyScad(b: Body): string {
  let solid: string;
  switch (b.kind) {
    case "module":
      solid = b.moduleCall!.expression;
      break;
    case "box":
      solid = `cube(${JSON.stringify(b.size)}, center=true);`;
      break;
    case "sphere":
      solid = `sphere(d=${b.size[0]});`;
      if (b.size[1] !== b.size[0] || b.size[2] !== b.size[0])
        solid = `scale([1,${b.size[1] / b.size[0]},${b.size[2] / b.size[0]}])\n${solid}`;
      break;
    case "cylinder":
    case "cone":
      solid =
        b.kind === "cylinder"
          ? `cylinder(h=${b.size[2]}, d=${b.size[0]}, center=true);`
          : `cylinder(h=${b.size[2]}, d1=${b.size[0]}, d2=0, center=true);`;
      if (b.size[1] !== b.size[0])
        solid = `scale([1,${b.size[1] / b.size[0]},1])\n${solid}`;
      break;
    case "extrusion":
      solid = extrusionScad(b.extrusion!);
      break;
    case "template":
      solid = templateScad(b.template!);
      break;
    case "mesh":
      solid = `import("meshes/${b.meshAssetId}.stl",convexity=10);`;
      break;
  }
  const transforms: string[] = [];
  if (b.position.some((v) => v !== 0))
    transforms.push(`translate(${JSON.stringify(b.position)})`);
  if (b.rotation.some((v) => v !== 0))
    transforms.push(`rotate(${JSON.stringify(b.rotation)})`);
  if (b.scale.some((v) => v !== 1))
    transforms.push(`scale(${JSON.stringify(b.scale)})`);
  return [...transforms, solid].join("\n");
}

/** Format generated expressions without modifying strings or SCAD semantics. */
function formatScad(source: string): string {
  let depth = 0,
    line = "",
    text = "",
    quoted = false,
    escaped = false;
  const flush = () => {
    if (line.trim()) text += "  ".repeat(depth) + line.trim() + "\n";
    line = "";
  };
  for (const char of source) {
    if (quoted) {
      line += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') {
      quoted = true;
      line += char;
    } else if (char === "{") {
      line = line.trimEnd() + " {";
      flush();
      depth++;
    } else if (char === "}") {
      flush();
      depth--;
      line = "}";
      flush();
    } else if (char === ";") {
      line += char;
      flush();
    } else if (char === "\n") flush();
    else line += char;
  }
  flush();
  return text;
}

export function generateReadableScad(input: Design, roots?: string[]): string {
  const d = validateDesign(input),
    nodes = new Map([...d.bodies, ...d.features].map((n) => [n.id, n]));
  const emit = (id: string): string => {
    const n = nodes.get(id)!;
    if (!("inputs" in n)) return readableBodyScad(n);
    if ("spec" in n) return modelingScad(d, n, emit);
    return `${n.operation}() {\n${n.inputs.map(emit).join("\n")}\n}`;
  };
  return (
    (d.authoredSource?.startsWith("// Forma3D Studio — millimeters")
      ? ""
      : "// Forma3D Studio — millimeters\n") +
    (d.authoredSource &&
    parseAuthoredProgram(d.authoredSource).declarations.some(
      (d) => d.kind === "variable" && d.name === "$fn",
    )
      ? ""
      : "$fn=64;\n") +
    (d.authoredSource ? "\n" + d.authoredSource + "\n\n" : "\n") +
    formatScad((roots ?? rootNodes(d).map((n) => n.id)).map(emit).join("\n\n"))
  );
}
