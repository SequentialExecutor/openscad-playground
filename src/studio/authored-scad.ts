/** Lexical extraction of authored OpenSCAD. Never evaluates JavaScript or rewrites module bodies. */
export interface ScadToken {
  value: string;
  start: number;
  end: number;
  kind: "id" | "string" | "other";
}
export interface ModuleParameter {
  name: string;
  defaultValue?: string;
}
export interface Declaration {
  kind: "module" | "function" | "variable";
  name: string;
  source: string;
  parameters: ModuleParameter[];
}
export interface AuthoredProgram {
  declarations: Declaration[];
  scene: string;
  statements: string[];
}
export const MAX_AUTHORED_SOURCE = 1024 * 1024;
const reserved = new Set(
  "cube sphere cylinder polyhedron square circle polygon text import surface translate rotate scale mirror multmatrix color union difference intersection hull minkowski linear_extrude rotate_extrude offset projection resize render children let assign for intersection_for if echo assert".split(
    " ",
  ),
);
export function lexScad(source: string): ScadToken[] {
  if (
    typeof source !== "string" ||
    new TextEncoder().encode(source).length > MAX_AUTHORED_SOURCE
  )
    throw Error("SCAD source exceeds 1 MB.");
  const out: ScadToken[] = [];
  let i = 0;
  while (i < source.length) {
    if (/\s/.test(source[i])) {
      i++;
      continue;
    }
    if (source.startsWith("//", i)) {
      const end = source.indexOf("\n", i);
      i = end < 0 ? source.length : end;
      continue;
    }
    if (source.startsWith("/*", i)) {
      const end = source.indexOf("*/", i + 2);
      if (end < 0) throw Error("Unclosed SCAD comment.");
      i = end + 2;
      continue;
    }
    const start = i;
    if (source[i] === '"') {
      i++;
      let closed = false;
      while (i < source.length) {
        if (source[i] === "\\") {
          i += 2;
          continue;
        }
        if (source[i++] === '"') {
          closed = true;
          break;
        }
      }
      if (!closed) throw Error("Unclosed SCAD string.");
      out.push({
        value: source.slice(start, i),
        start,
        end: i,
        kind: "string",
      });
      continue;
    }
    const id = /^\$?[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(i));
    if (id) {
      i += id[0].length;
      out.push({ value: id[0], start, end: i, kind: "id" });
    } else {
      i++;
      out.push({ value: source[start], start, end: i, kind: "other" });
    }
    if (out.length > 250000) throw Error("SCAD token limit exceeded.");
  }
  return out;
}
export function canonicalScad(source: string): string {
  return lexScad(source)
    .map((t) => t.value)
    .join("\u0000");
}
function matching(tokens: ScadToken[], at: number): number {
  const pairs: Record<string, string> = { "(": ")", "[": "]", "{": "}" },
    stack: string[] = [];
  for (let i = at; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind === "string") continue;
    if (pairs[t.value]) {
      stack.push(pairs[t.value]);
      if (stack.length > 128) throw Error("SCAD nesting exceeds 128 levels.");
    } else if ([")", "]", "}"].includes(t.value)) {
      if (stack.pop() !== t.value) throw Error("Unbalanced SCAD delimiters.");
      if (!stack.length) return i;
    }
  }
  throw Error("Unclosed SCAD declaration.");
}
function statementEnd(tokens: ScadToken[], at: number): number {
  for (let i = at; i < tokens.length; i++) {
    if (
      ["(", "[", "{"].includes(tokens[i].value) &&
      tokens[i].kind !== "string"
    ) {
      const brace = tokens[i].value === "{";
      i = matching(tokens, i);
      if (brace && tokens[i + 1]?.value !== "else")
        return tokens[i + 1]?.value === ";" ? i + 1 : i;
    } else if (tokens[i].value === ";" && tokens[i + 1]?.value !== "else")
      return i;
    else if (
      [")", "]", "}"].includes(tokens[i].value) &&
      tokens[i].kind !== "string"
    )
      throw Error("Unbalanced SCAD delimiters.");
  }
  throw Error("SCAD statements must end with a semicolon or block.");
}
function commaParts(
  source: string,
  tokens: ScadToken[],
  first: number,
  last: number,
): string[] {
  const parts: string[] = [];
  let start = first;
  for (let i = first; i < last; i++) {
    if (
      ["(", "[", "{"].includes(tokens[i].value) &&
      tokens[i].kind !== "string"
    )
      i = matching(tokens, i);
    else if (tokens[i].value === ",") {
      parts.push(
        source
          .slice(tokens[start]?.start ?? tokens[i].start, tokens[i].start)
          .trim(),
      );
      start = i + 1;
    }
  }
  if (start < last)
    parts.push(source.slice(tokens[start].start, tokens[last].start).trim());
  return parts;
}
export function parseAuthoredProgram(source: string): AuthoredProgram {
  const tokens = lexScad(source),
    declarations: Declaration[] = [],
    statements: string[] = [],
    seen = new Set<string>();
  let previousEnd = 0;
  for (let i = 0; i < tokens.length; ) {
    if (tokens[i].value === ";") {
      i++;
      continue;
    }
    const at = i,
      start = tokens[i].start;
    const kind =
      tokens[i].value === "module"
        ? "module"
        : tokens[i].value === "function"
          ? "function"
          : tokens[i].kind === "id" && tokens[i + 1]?.value === "="
            ? "variable"
            : undefined;
    if (kind) {
      const name = tokens[i + (kind === "variable" ? 0 : 1)]?.value;
      if (!name || !/^\$?[A-Za-z_][A-Za-z0-9_]*$/.test(name))
        throw Error("Invalid SCAD declaration name.");
      let parameters: ModuleParameter[] = [];
      if (kind !== "variable") {
        if (tokens[i + 2]?.value !== "(")
          throw Error("Invalid module/function signature.");
        const end = matching(tokens, i + 2);
        parameters = commaParts(source, tokens, i + 3, end).map((part) => {
          const m = /^([A-Za-z_$][A-Za-z0-9_]*)\s*(?:=([\s\S]*))?$/.exec(part);
          if (!m) throw Error("Invalid module parameter.");
          return {
            name: m[1],
            ...(m[2] !== undefined ? { defaultValue: m[2].trim() } : {}),
          };
        });
        if (
          parameters.length > 64 ||
          new Set(parameters.map((p) => p.name)).size !== parameters.length
        )
          throw Error("Too many or duplicate module parameters.");
        i = end + 1;
      }
      const end = statementEnd(tokens, i);
      const key = kind + ":" + name;
      if (seen.has(key)) {
        if (kind !== "variable") throw Error(`Duplicate ${kind} '${name}'.`);
        const index = declarations.findIndex(
          (d) => d.kind === kind && d.name === name,
        );
        declarations.splice(index, 1);
      }
      seen.add(key);
      declarations.push({
        kind,
        name,
        parameters,
        source: source.slice(previousEnd, tokens[end].end),
      });
      previousEnd = tokens[end].end;
      i = end + 1;
    } else {
      const end = statementEnd(tokens, at);
      statements.push(source.slice(start, tokens[end].end));
      previousEnd = tokens[end].end;
      i = end + 1;
    }
  }
  if (declarations.length > 256) throw Error("Too many authored declarations.");
  return { declarations, scene: statements.join("\n"), statements };
}
export function validateAuthoredSource(source: string): string {
  const p = parseAuthoredProgram(source);
  if (p.scene)
    throw Error(
      "Module source must contain declarations, not top-level geometry.",
    );
  for (const t of lexScad(source))
    if (
      t.kind === "id" &&
      [
        "import",
        "surface",
        "include",
        "use",
        "$parent_modules",
        "parent_module",
      ].includes(t.value)
    )
      throw Error(
        "Library code must be self-contained: external geometry, include/use and parent-module introspection are unsupported.",
      );
  for (const d of p.declarations)
    if (d.kind === "module" && reserved.has(d.name))
      throw Error(
        `Module '${d.name}' shadows a built-in shape or operation. Choose another name.`,
      );
  return source.trim();
}
export function declarationsSource(
  p: AuthoredProgram,
  defaultFn?: number,
): string {
  return [
    !p.declarations.some((d) => d.kind === "variable" && d.name === "$fn") &&
    defaultFn !== undefined
      ? `$fn=${defaultFn};`
      : "",
    ...p.declarations.map((d) => d.source.trim()),
  ]
    .filter(Boolean)
    .join("\n\n");
}
export function mergeAuthoredSources(
  ...sources: (string | undefined)[]
): string {
  const map = new Map<string, Declaration>();
  for (const source of sources) {
    if (!source) continue;
    validateAuthoredSource(source);
    for (const d of parseAuthoredProgram(source).declarations) {
      const key = d.kind + ":" + d.name,
        old = map.get(key);
      if (old && canonicalScad(old.source) !== canonicalScad(d.source))
        throw Error(
          `Conflicting ${d.kind} '${d.name}'. Rename it or use the same definition before combining modules.`,
        );
      map.set(key, d);
    }
  }
  return [...map.values()].map((d) => d.source.trim()).join("\n\n");
}
export function moduleBundle(p: AuthoredProgram, name: string): string {
  const modules = new Map(
      p.declarations.filter((d) => d.kind === "module").map((d) => [d.name, d]),
    ),
    needed = new Set<string>();
  const visit = (n: string) => {
    if (needed.has(n)) return;
    const d = modules.get(n);
    if (!d) throw Error(`Missing module '${n}'.`);
    needed.add(n);
    const ts = lexScad(d.source);
    ts.forEach((t, i) => {
      if (t.kind === "id" && ts[i + 1]?.value === "(" && modules.has(t.value))
        visit(t.value);
    });
  };
  visit(name);
  const source = declarationsSource(
    {
      ...p,
      declarations: p.declarations.filter(
        (d) => d.kind !== "module" || needed.has(d.name),
      ),
    },
    0,
  );
  return validateAuthoredSource(source);
}
export function validateArgument(value: string): string {
  const text = value.trim();
  if (!text || text.length > 4096)
    throw Error("Enter a SCAD value or expression (up to 4096 characters).");
  const ts = lexScad(text);
  if (!ts.length) throw Error("Enter a SCAD expression.");
  for (let i = 0; i < ts.length; i++) {
    const t = ts[i];
    if (t.kind === "string") continue;
    if (["(", "["].includes(t.value)) {
      i = matching(ts, i);
      continue;
    }
    if ([";", "{", "}", ",", "=", ")", "]"].includes(t.value))
      throw Error("Enter one SCAD expression, not a statement.");
  }
  for (const t of ts)
    if (
      t.kind === "id" &&
      ["import", "surface", "include", "use"].includes(t.value)
    )
      throw Error("External geometry is not a module parameter.");
  // Check forbidden statements even inside nested calls/vectors.
  if (ts.some((t) => t.kind !== "string" && [";", "{", "}"].includes(t.value)))
    throw Error("Statements are not module parameters.");
  return text;
}
export function moduleInvocation(
  source: string,
  name: string,
  values: Record<string, string>,
): string {
  const d = parseAuthoredProgram(source).declarations.find(
    (d) => d.kind === "module" && d.name === name,
  );
  if (!d) throw Error("Module is missing from its source bundle.");
  if (Object.keys(values).some((k) => !d.parameters.some((p) => p.name === k)))
    throw Error("Unknown module parameter.");
  const args = d.parameters.flatMap((p) => {
    const v = values[p.name]?.trim();
    if (v) return [`${p.name}=${validateArgument(v)}`];
    if (p.defaultValue === undefined)
      throw Error(`Parameter '${p.name}' is required.`);
    return [];
  });
  return `${name}(${args.join(", ")});`;
}
export function readModuleInvocation(
  source: string,
  expression: string,
): { name: string; values: Record<string, string> } | undefined {
  try {
    const ts = lexScad(expression);
    if (ts[0]?.kind !== "id" || ts[1]?.value !== "(") return;
    const end = matching(ts, 1);
    if (ts[end + 1]?.value !== ";" || end + 2 !== ts.length) return;
    const d = parseAuthoredProgram(source).declarations.find(
      (d) => d.kind === "module" && d.name === ts[0].value,
    );
    if (!d) return;
    const values: Record<string, string> = {};
    let pos = 0;
    for (const arg of commaParts(expression, ts, 2, end)) {
      const named = /^([A-Za-z_$][A-Za-z0-9_]*)\s*=([\s\S]*)$/.exec(arg);
      const key = named?.[1] ?? d.parameters[pos++]?.name;
      if (!key || Object.hasOwn(values, key)) return;
      values[key] = validateArgument(named?.[2] ?? arg);
    }
    moduleInvocation(source, d.name, values);
    return { name: d.name, values };
  } catch {
    return;
  }
}
export function validateModuleExpression(expression: string): string {
  if (typeof expression !== "string" || !expression.trim())
    throw Error("Empty module invocation.");
  const p = parseAuthoredProgram(expression);
  if (p.declarations.length)
    throw Error("Module calls cannot declare global symbols.");
  validateAuthoredSource(`module forma3d_expression_check(){${expression}}`);
  return expression.trim();
}
