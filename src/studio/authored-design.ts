import {
  Body,
  Design,
  blankDesign,
  createBody,
  rootNodes,
  validateDesign,
} from "./document";
import {
  canonicalScad,
  declarationsSource,
  parseAuthoredProgram,
  validateAuthoredSource,
  validateModuleExpression,
  readModuleInvocation,
  mergeAuthoredSources,
  moduleBundle,
} from "./authored-scad";
import { generateReadableScad } from "./readable-scad";
import { importNativeScad, updateReadableFromCode } from "./scad-roundtrip";
export function createModuleBody(source: string, expression: string): Body {
  validateAuthoredSource(source);
  const call = readModuleInvocation(source, expression);
  return {
    ...createBody("box"),
    kind: "module",
    name: call?.name ?? "Authored SCAD",
    moduleCall: { expression: validateModuleExpression(expression) },
    position: [0, 0, 0],
    size: [1, 1, 1],
  };
}
export function subsetDesign(base: Design, id: string): Design {
  const nodes = new Map(
      [...base.bodies, ...base.features].map((n) => [n.id, n]),
    ),
    seen = new Set<string>();
  const visit = (id: string) => {
    if (seen.has(id)) return;
    const n = nodes.get(id);
    if (!n) throw Error("Selected shape is missing.");
    seen.add(id);
    if ("inputs" in n) n.inputs.forEach(visit);
  };
  visit(id);
  return validateDesign({
    ...base,
    bodies: base.bodies.filter((b) => seen.has(b.id)),
    features: base.features.filter((f) => seen.has(f.id)),
  });
}
export function sourceForSavedShape(
  design: Design,
  id: string,
  name: string,
): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))
    throw Error("Use a SCAD identifier for the module name.");
  const d = subsetDesign(design, id);
  if (d.bodies.some((b) => b.kind === "mesh"))
    throw Error("Imported mesh geometry cannot be saved as a code module.");
  const p = parseAuthoredProgram(generateReadableScad(d, [id]));
  let probe = "forma3d_saved_shape_probe";
  while (p.declarations.some((d) => d.name === probe)) probe += "_";
  const bundled = parseAuthoredProgram(
    moduleBundle(
      parseAuthoredProgram(
        mergeAuthoredSources(
          declarationsSource(p),
          `module ${probe}(){${p.scene}}`,
        ),
      ),
      probe,
    ),
  );
  const dependencies = {
    ...bundled,
    declarations: bundled.declarations.filter(
      (d) => d.name !== probe || d.kind !== "module",
    ),
  };
  if (
    dependencies.declarations.some(
      (d) => d.kind === "module" && d.name === name,
    )
  )
    throw Error(
      "That name belongs to a dependency of this shape. Choose another module name.",
    );
  return validateAuthoredSource(
    mergeAuthoredSources(
      declarationsSource(dependencies),
      `module ${name}() {\n${p.scene}\n}`,
    ),
  );
}
export function designWithAuthoredCode(
  source: string,
  base?: Design,
  baselineSource?: string,
): Design {
  const p = parseAuthoredProgram(source),
    modules = p.declarations.filter((d) => d.kind === "module");
  if (!modules.length)
    throw Error("No authored module declarations were found.");
  const authoredSource = validateAuthoredSource(declarationsSource(p, 0));
  validateModuleExpression(p.scene || ";");
  const globals = p.declarations
    .filter((d) => d.kind === "variable")
    .map((d) => d.source)
    .join("\n");
  if (base && baselineSource) {
    const old = parseAuthoredProgram(baselineSource),
      oldGlobals = old.declarations
        .filter((d) => d.kind === "variable")
        .map((d) => d.source)
        .join("\n");
    if (
      canonicalScad(old.scene) === canonicalScad(p.scene) &&
      canonicalScad(globals) === canonicalScad(oldGlobals)
    )
      return validateDesign({ ...base, authoredSource });
  }
  const d = blankDesign();
  d.name = base?.name ?? "Authored modules";
  d.print = base?.print ?? d.print;
  d.authoredSource = authoredSource;
  const add = (sub: Design) => {
    for (const b of sub.bodies)
      if (!d.bodies.some((x) => x.id === b.id)) d.bodies.push(b);
    for (const f of sub.features)
      if (!d.features.some((x) => x.id === f.id)) d.features.push(f);
  };
  const available = base ? rootNodes(base) : [],
    used = new Set<string>();
  for (const statement of p.statements) {
    const same = available.find(
      (n) =>
        !used.has(n.id) &&
        canonicalScad(
          parseAuthoredProgram(generateReadableScad(subsetDesign(base!, n.id)))
            .scene,
        ) === canonicalScad(statement),
    );
    if (same) {
      used.add(same.id);
      add(subsetDesign(base!, same.id));
      continue;
    }
    let mapped: Design | undefined;
    for (const root of available) {
      if (used.has(root.id)) continue;
      const sub = subsetDesign(base!, root.id);
      if (sub.bodies.some((b) => b.kind === "module")) continue;
      const clean = { ...sub, authoredSource: undefined },
        original = generateReadableScad(clean);
      mapped = updateReadableFromCode(
        clean,
        original,
        `${globals || "$fn=64;"}\n${statement}`,
      );
      if (mapped) {
        used.add(root.id);
        break;
      }
    }
    if (mapped) {
      add(mapped);
      continue;
    }
    const native = importNativeScad({
      entryPath: "/shape.scad",
      files: [{ path: "/shape.scad", content: `${globals}\n${statement}` }],
      vars: {},
      features: [],
    });
    if (native) {
      add(native);
      continue;
    }
    d.bodies.push(createModuleBody(authoredSource, statement));
  }
  return validateDesign(d);
}
