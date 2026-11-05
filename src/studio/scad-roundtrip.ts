import { Matrix4, Vector3, Quaternion, Euler, MathUtils } from "three";
import {
  Body,
  Design,
  Vec3,
  blankDesign,
  createBody,
  createBoolean,
  validateDesign,
  generateScad,
} from "./document";
import type { CodeProject } from "./code-project";
type Value = number | boolean | string | Value[];
type Args = { named: Record<string, Value>; pos: Value[] };
type Node = { name: string; args: Args; children: Node[] };
interface Token {
  value: string;
  kind: "number" | "id" | "string" | "symbol";
}
export function scadTokens(source: string): Token[] {
  if (source.length > 1024 * 1024) throw Error("SCAD source exceeds 1 MB.");
  const out: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const rest = source.slice(i),
      space = /^\s+/.exec(rest);
    if (space) {
      i += space[0].length;
      continue;
    }
    if (rest.startsWith("//")) {
      const n = rest.indexOf("\n");
      i += n < 0 ? rest.length : n;
      continue;
    }
    if (rest.startsWith("/*")) {
      const n = rest.indexOf("*/", 2);
      if (n < 0) throw Error("Unclosed SCAD comment.");
      i += n + 2;
      continue;
    }
    const n = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(rest);
    if (n) {
      out.push({ value: String(Number(n[0])), kind: "number" });
      i += n[0].length;
      continue;
    }
    const id = /^\$?[A-Za-z_][A-Za-z0-9_]*/.exec(rest);
    if (id) {
      out.push({ value: id[0], kind: "id" });
      i += id[0].length;
      continue;
    }
    if (rest[0] === '"') {
      const text = /^"(?:[^"\\]|\\.)*"/.exec(rest);
      if (!text) throw Error("Unclosed SCAD string.");
      out.push({ value: JSON.stringify(JSON.parse(text[0])), kind: "string" });
      i += text[0].length;
      continue;
    }
    out.push({ value: rest[0], kind: "symbol" });
    i++;
    if (out.length > 200000) throw Error("SCAD token limit exceeded.");
  }
  return out;
}
export function normalizedScad(source: string): string {
  return scadTokens(source)
    .map((t) => t.kind + ":" + t.value)
    .join("|");
}
class Parser {
  at = 0;
  env: Record<string, Value> = Object.create(null);
  modules = new Map<string, Node[]>();
  roots: Node[] = [];
  assignments = new Set<string>();
  constructor(
    readonly tokens: Token[],
    overrides: Record<string, unknown> = {},
  ) {
    for (const [k, v] of Object.entries(overrides)) this.env[k] = v as Value;
    this.overrides = overrides;
  }
  overrides: Record<string, unknown>;
  peek(offset = 0) {
    return this.tokens[this.at + offset]?.value;
  }
  take(value?: string) {
    const t = this.tokens[this.at++];
    if (!t || (value !== undefined && t.value !== value))
      throw Error("Unsupported SCAD structure.");
    return t;
  }
  value(min = 0): Value {
    let a: Value;
    if (this.peek() === "-") {
      this.take();
      a = -this.scalar(this.value(4));
    } else if (this.peek() === "+") {
      this.take();
      a = this.scalar(this.value(4));
    } else if (this.peek() === "[") {
      this.take();
      a = [];
      while (this.peek() !== "]") {
        a.push(this.value());
        if (this.peek() !== ",") break;
        this.take();
      }
      this.take("]");
    } else if (this.peek() === "(") {
      this.take();
      a = this.value();
      this.take(")");
    } else {
      const t = this.take();
      if (t.kind === "number") a = Number(t.value);
      else if (t.kind === "string") a = JSON.parse(t.value);
      else if (t.value === "true" || t.value === "false")
        a = t.value === "true";
      else if (Object.hasOwn(this.env, t.value)) a = this.env[t.value];
      else throw Error("Unsupported SCAD expression.");
    }
    const precedence: Record<string, number> = {
      "+": 1,
      "-": 1,
      "*": 2,
      "/": 2,
      "%": 2,
    };
    while (precedence[this.peek()!] >= min) {
      const op = this.take().value,
        p = precedence[op],
        b = this.scalar(this.value(p + 1)),
        x = this.scalar(a);
      a =
        op === "+"
          ? x + b
          : op === "-"
            ? x - b
            : op === "*"
              ? x * b
              : op === "/"
                ? x / b
                : op === "%"
                  ? x % b
                  : x ** b;
      if (!Number.isFinite(a)) throw Error("Nonfinite SCAD arithmetic.");
    }
    return a;
  }
  scalar(v: Value): number {
    if (typeof v !== "number" || !Number.isFinite(v))
      throw Error("Expected finite SCAD number.");
    return v;
  }
  nodes(stop?: string, depth = 0): Node[] {
    if (depth > 64) throw Error("SCAD nesting exceeds 64 levels.");
    const nodes: Node[] = [];
    while (this.peek() !== undefined && this.peek() !== stop) {
      if (this.peek() === ";") {
        this.take();
        continue;
      }
      if (this.peek() === "module") {
        this.take();
        const name = this.take().value;
        this.take("(");
        this.take(")");
        this.take("{");
        const children = this.nodes("}", depth + 1);
        this.take("}");
        if (this.modules.has(name)) throw Error("Duplicate SCAD module.");
        this.modules.set(name, children);
        continue;
      }
      if (this.tokens[this.at]?.kind === "id" && this.peek(1) === "=") {
        const name = this.take().value;
        if (depth > 0 || nodes.length || this.assignments.has(name))
          throw Error(
            "Scoped, late or repeated assignments stay source-backed.",
          );
        this.assignments.add(name);
        this.take("=");
        const v = this.value();
        this.take(";");
        this.env[name] = Object.hasOwn(this.overrides, name)
          ? (this.overrides[name] as Value)
          : v;
        continue;
      }
      if (this.peek() === "{") {
        this.take();
        nodes.push(...this.nodes("}", depth + 1));
        this.take("}");
        continue;
      }
      const name = this.take().value;
      this.take("(");
      const args: Args = { named: Object.create(null), pos: [] };
      while (this.peek() !== ")") {
        if (this.tokens[this.at]?.kind === "id" && this.peek(1) === "=") {
          const k = this.take().value;
          this.take("=");
          if (Object.hasOwn(args.named, k))
            throw Error("Duplicate SCAD argument.");
          args.named[k] = this.value();
        } else args.pos.push(this.value());
        if (this.peek() !== ",") break;
        this.take();
      }
      this.take(")");
      let children: Node[] = [];
      if (this.peek() === ";") this.take();
      else if (this.peek() === "{") {
        this.take();
        children = this.nodes("}", depth + 1);
        this.take("}");
      } else children = this.nodesOne(depth + 1);
      nodes.push({ name, args, children });
    }
    return nodes;
  }
  nodesOne(depth: number): Node[] {
    // Parse a single transform/primitive statement without consuming sibling geometry.
    const start = this.at;
    let parens = 0,
      braces = 0,
      end = start;
    for (; end < this.tokens.length; end++) {
      const v = this.tokens[end].value;
      if (v === "(") parens++;
      if (v === ")") parens--;
      if (v === "{") braces++;
      if (v === "}") braces--;
      if (
        (v === ";" && parens === 0 && braces === 0) ||
        (v === "}" && braces === 0 && parens === 0)
      ) {
        end++;
        break;
      }
    }
    const sub = new Parser(this.tokens.slice(start, end), this.env);
    sub.env = { ...this.env };
    sub.modules = this.modules;
    const result = sub.nodes(undefined, depth);
    this.at = end;
    return result;
  }
  parse() {
    this.roots = this.nodes();
    if (this.at !== this.tokens.length) throw Error("Unparsed SCAD.");
    return this;
  }
}
const arg = (n: Node, name: string, index: number, fallback?: Value): Value =>
  n.args.named[name] ?? n.args.pos[index] ?? fallback!;
const scalar = (v: Value): number => {
  if (typeof v !== "number" || !Number.isFinite(v))
    throw Error("Unsupported SCAD scalar.");
  return v;
};
const vec = (v: Value): Vec3 => {
  if (typeof v === "number") return [v, v, v];
  if (!Array.isArray(v) || v.length !== 3) throw Error("Expected a 3D vector.");
  return v.map(scalar) as Vec3;
};
const noExtra = (n: Node, names: string[], pos: number) => {
  if (
    n.args.pos.length > pos ||
    Object.keys(n.args.named).some((k) => !names.includes(k))
  )
    throw Error("Unsupported SCAD arguments.");
};
function poseMatrix(n: Node): Matrix4 {
  if (n.name === "translate") {
    noExtra(n, ["v"], 1);
    if (!Array.isArray(arg(n, "v", 0)))
      throw Error("Translate requires a vector.");
    return new Matrix4().makeTranslation(...vec(arg(n, "v", 0)));
  }
  if (n.name === "scale") {
    noExtra(n, ["v"], 1);
    const v = vec(arg(n, "v", 0));
    if (v.some((n) => n <= 0))
      throw Error("Reflections need source-backed geometry.");
    return new Matrix4().makeScale(...v);
  }
  if (n.name === "rotate") {
    noExtra(n, ["a"], 1);
    let v = arg(n, "a", 0);
    v = typeof v === "number" ? [0, 0, v] : v;
    const a = vec(v).map(MathUtils.degToRad) as Vec3;
    return new Matrix4().makeRotationFromEuler(new Euler(...a, "ZYX"));
  }
  throw Error("Unsupported transform.");
}
function applyPose(b: Body, m: Matrix4): Body {
  const t = new Vector3(),
    q = new Quaternion(),
    s = new Vector3();
  m.decompose(t, q, s);
  const rebuilt = new Matrix4().compose(t, q, s);
  if (
    rebuilt.elements.some((v, i) => Math.abs(v - m.elements[i]) > 1e-7) ||
    s.toArray().some((v) => v <= 0)
  )
    throw Error("Sheared/reflected code stays source-backed.");
  const e = new Euler().setFromQuaternion(q, "ZYX");
  return {
    ...b,
    position: t.toArray() as Vec3,
    rotation: [e.x, e.y, e.z].map(MathUtils.radToDeg) as Vec3,
    scale: s.toArray() as Vec3,
  };
}
function primitive(n: Node, fn: number): { body: Body; offset: Matrix4 } {
  let b: Body,
    offset = new Matrix4();
  if (n.children.length) throw Error("Primitives cannot have children.");
  if (n.name === "cube") {
    noExtra(n, ["size", "center"], 2);
    if (
      (n.args.pos.length > 0 && n.args.named.size !== undefined) ||
      (n.args.pos.length > 1 && n.args.named.center !== undefined)
    )
      throw Error("Repeated primitive arguments.");
    const size = vec(arg(n, "size", 0, 1));
    b = createBody("box");
    b.size = size;
    const center = arg(n, "center", 1, false);
    if (typeof center !== "boolean") throw Error("Invalid cube centering.");
    if (!center) offset.makeTranslation(...(size.map((v) => v / 2) as Vec3));
  } else if (n.name === "sphere") {
    noExtra(n, ["r", "d", "$fn"], 1);
    if (
      (n.args.named.r !== undefined && n.args.named.d !== undefined) ||
      (n.args.pos.length &&
        (n.args.named.r !== undefined || n.args.named.d !== undefined))
    )
      throw Error("Ambiguous sphere radius.");
    if (scalar(n.args.named.$fn ?? fn) !== 64)
      throw Error("Keep original source tessellation.");
    const r =
      n.args.named.d !== undefined
        ? scalar(n.args.named.d) / 2
        : scalar(arg(n, "r", 0, 1));
    b = createBody("sphere");
    b.size = [2 * r, 2 * r, 2 * r];
  } else if (n.name === "cylinder") {
    noExtra(n, ["h", "r", "r1", "r2", "d", "d1", "d2", "center", "$fn"], 4);
    if (
      (n.args.pos.length > 0 && n.args.named.h !== undefined) ||
      (n.args.pos.length > 1 &&
        ["r", "r1", "d", "d1"].some((k) => n.args.named[k] !== undefined)) ||
      (n.args.pos.length > 2 &&
        ["r2", "d2"].some((k) => n.args.named[k] !== undefined)) ||
      (n.args.pos.length > 3 && n.args.named.center !== undefined)
    )
      throw Error("Repeated cylinder arguments.");
    if (scalar(n.args.named.$fn ?? fn) !== 64)
      throw Error("Keep original source tessellation.");
    const h = scalar(arg(n, "h", 0, 1)),
      r =
        n.args.named.d !== undefined
          ? scalar(n.args.named.d) / 2
          : scalar(arg(n, "r", 1, 1)),
      r1 =
        n.args.named.d1 !== undefined
          ? scalar(n.args.named.d1) / 2
          : scalar(n.args.named.r1 ?? r),
      r2 =
        n.args.named.d2 !== undefined
          ? scalar(n.args.named.d2) / 2
          : scalar(n.args.named.r2 ?? n.args.pos[2] ?? r1);
    if (r2 !== r1 && r2 !== 0) throw Error("Unsupported native frustum.");
    b = createBody(r2 === 0 ? "cone" : "cylinder");
    b.size = [2 * r1, 2 * r1, h];
    const center = arg(n, "center", 3, false);
    if (typeof center !== "boolean") throw Error("Invalid cylinder centering.");
    if (!center) offset.makeTranslation(0, 0, h / 2);
  } else throw Error("SCAD shape stays source-backed.");
  b.position = [0, 0, 0];
  return { body: b, offset };
}
function parsePrimitiveChain(nodes: Node[], fn: number): Body {
  if (nodes.length !== 1) throw Error("Expected one native primitive.");
  let n = nodes[0],
    m = new Matrix4();
  while (["translate", "rotate", "scale"].includes(n.name)) {
    m.multiply(poseMatrix(n));
    if (n.children.length !== 1) throw Error("Unsupported transform grouping.");
    n = n.children[0];
  }
  const p = primitive(n, fn);
  return applyPose(p.body, m.multiply(p.offset));
}
function generatedBody(nodes: Node[]): Body {
  if (nodes.length !== 1) throw Error("Expected generated primitive.");
  const translate = nodes[0],
    rotate = translate.children[0],
    scale = rotate?.children[0];
  if (
    translate.name !== "translate" ||
    translate.children.length !== 1 ||
    rotate?.name !== "rotate" ||
    rotate.children.length !== 1 ||
    scale?.name !== "scale" ||
    scale.children.length !== 1
  )
    throw Error("Generated transform layout changed.");
  const position = vec(arg(translate, "v", 0)),
    rotation = vec(arg(rotate, "a", 0)),
    scaling = vec(arg(scale, "v", 0));
  let leaf = scale.children[0],
    size: Vec3,
    kind: Body["kind"];
  if (leaf.name === "cube") {
    size = vec(arg(leaf, "size", 0));
    if (arg(leaf, "center", 1, false) !== true)
      throw Error("Generated cube centering changed.");
    kind = "box";
  } else {
    if (leaf.name !== "scale" || leaf.children.length !== 1)
      throw Error("Generated primitive scale changed.");
    const local = vec(arg(leaf, "v", 0));
    leaf = leaf.children[0];
    if (leaf.name === "sphere" && arg(leaf, "r", 0) === 1) {
      size = local.map((v) => v * 2) as Vec3;
      kind = "sphere";
    } else if (
      leaf.name === "cylinder" &&
      local[2] === 1 &&
      leaf.args.named.r1 === 1 &&
      [0, 1].includes(scalar(leaf.args.named.r2)) &&
      leaf.args.named.center === true
    ) {
      size = [local[0] * 2, local[1] * 2, scalar(leaf.args.named.h)];
      kind = leaf.args.named.r2 === 0 ? "cone" : "cylinder";
    } else throw Error("Unsupported generated shape edit.");
  }
  return {
    ...createBody("box"),
    kind,
    size,
    position,
    rotation,
    scale: scaling,
  };
}
/** Conservatively preserve native IDs only if recompilation is exactly the edited program. */
export function updateNativeFromCode(
  base: Design,
  original: string,
  edited: string,
  vars: Record<string, unknown> = {},
): Design | undefined {
  try {
    if (Object.keys(vars).length) return undefined;
    if (normalizedScad(original) === normalizedScad(edited))
      return validateDesign(base);
    const p = new Parser(scadTokens(edited)).parse(),
      d = structuredClone(base);
    if (Object.keys(p.env).some((k) => k !== "$fn") || p.env.$fn !== 64)
      return undefined;
    const nodes = [...base.bodies, ...base.features];
    for (let i = 0; i < nodes.length; i++) {
      const module = p.modules.get(`n${i}`);
      if (!module) continue;
      const old = nodes[i];
      if (
        !("kind" in old) ||
        !["box", "sphere", "cylinder", "cone"].includes(old.kind)
      )
        continue;
      const b = generatedBody(module);
      d.bodies = d.bodies.map((o) =>
        o.id === old.id
          ? {
              ...o,
              kind: b.kind,
              size: b.size,
              position: b.position,
              rotation: b.rotation,
              scale: b.scale,
            }
          : o,
      );
    }
    const valid = validateDesign(d);
    return normalizedScad(generateScad(valid)) === normalizedScad(edited)
      ? valid
      : undefined;
  } catch {
    return undefined;
  }
}
/** Native conversion for a small, fully parsed, deterministic SCAD subset. */
export function importNativeScad(project: CodeProject): Design | undefined {
  try {
    const source = project.files.find(
      (f) => f.path === project.entryPath,
    )?.content;
    if (source === undefined || project.files.length !== 1) return undefined;
    const p = new Parser(scadTokens(source), project.vars).parse();
    if (p.modules.size) return undefined;
    const d = blankDesign();
    const visit = (n: Node, m = new Matrix4()): string => {
      if (["translate", "rotate", "scale"].includes(n.name)) {
        const next = m.clone().multiply(poseMatrix(n));
        const ids = n.children.map((c) => visit(c, next));
        if (ids.length !== 1)
          throw Error("Multiple transformed roots stay source-backed.");
        return ids[0];
      }
      if (["union", "difference", "intersection"].includes(n.name)) {
        noExtra(n, [], 0);
        if (
          n.children.length < 2 ||
          (n.name === "intersection" && n.children.length !== 2)
        )
          throw Error("Unsupported boolean arity.");
        const children = n.children.map((c) => visit(c, m));
        let root = children[0];
        for (const id of children.slice(1)) {
          const f = createBoolean(
            n.name as "union" | "difference" | "intersection",
            [root, id],
          );
          d.features.push(f);
          root = f.id;
        }
        return root;
      }
      const b = primitive(n, scalar(p.env.$fn ?? 0));
      b.body = applyPose(b.body, m.clone().multiply(b.offset));
      d.bodies.push(b.body);
      return b.body.id;
    };
    if (Object.keys(p.env).some((k) => k.startsWith("$") && k !== "$fn"))
      return undefined;
    for (const n of p.roots) visit(n);
    return validateDesign(d);
  } catch {
    return undefined;
  }
}
