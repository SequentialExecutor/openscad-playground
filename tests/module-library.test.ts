import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  parseAuthoredProgram,
  declarationsSource,
  moduleBundle,
  canonicalScad,
  moduleInvocation,
  readModuleInvocation,
  validateArgument,
  validateAuthoredSource,
  mergeAuthoredSources,
} from "../src/studio/authored-scad";
import {
  emptyLibrary,
  detectedLibraryEntries,
  validateLibrary,
} from "../src/studio/module-library";
import {
  designWithAuthoredCode,
  createModuleBody,
  sourceForSavedShape,
} from "../src/studio/authored-design";
import {
  blankDesign,
  createBody,
  createBoolean,
  validateDesign,
  generateScad,
} from "../src/studio/document";
import { generateReadableScad } from "../src/studio/readable-scad";
import { encodeProject, decodeProject } from "../src/studio/project-file";
const flower = fs.readFileSync(
  new URL("../examples/forma3d/flower-modules.scad", import.meta.url),
  "utf8",
);
test("detect the supplied petal, ring, bud and stem definitions and exact parameter defaults", () => {
  const p = parseAuthoredProgram(flower);
  assert.deepEqual(
    p.declarations.map((d) => d.name),
    ["petal", "ring", "bud", "stem"],
  );
  assert.equal(p.scene, "");
  assert.deepEqual(p.declarations[0].parameters, [
    { name: "len", defaultValue: "12" },
    { name: "base_r", defaultValue: "2.8" },
    { name: "tip_r", defaultValue: "0.6" },
    { name: "flat", defaultValue: "0.65" },
  ]);
  assert.equal(p.declarations[1].parameters.length, 8);
  assert.ok(p.declarations[0].source.includes("// Petal primitive"));
});
test("bundle sibling dependencies without capturing unrelated modules or scene calls", () => {
  const p = parseAuthoredProgram(flower + "\npetal(); stem();"),
    bundle = moduleBundle(p, "ring");
  assert.match(bundle, /module petal/);
  assert.match(bundle, /module ring/);
  assert.doesNotMatch(bundle, /module bud|module stem/);
  assert.equal(parseAuthoredProgram(bundle).scene, "");
});
test("comments, strings, nested declarations, one-statement modules and helpers do not create phantom library modules", () => {
  const p = parseAuthoredProgram(
    '// module fake(){}\nword="module fake2(){}";\nfunction twice(v)=v*2;\nmodule real(x=twice(2)){module nested(){cube(1);}echo("}");nested();}\nmodule second() sphere(2);\nreal();',
  );
  assert.deepEqual(
    p.declarations.filter((d) => d.kind === "module").map((d) => d.name),
    ["real", "second"],
  );
  assert.match(p.scene, /real\(\)/);
  assert.match(moduleBundle(p, "real"), /function twice/);
});
test("required parameters, named/positional invocation and nested SCAD values stay explicit", () => {
  const src = moduleBundle(parseAuthoredProgram(flower), "ring");
  assert.throws(() => moduleInvocation(src, "ring", {}), /required/);
  const values = {
    n: "8",
    radius: "10",
    len: "12",
    base_r: "2.8",
    tilt: "30",
    z: "0",
    phase: "0",
    col: "[0.55,0.05,0.45]",
  };
  const call = moduleInvocation(src, "ring", values);
  assert.deepEqual(readModuleInvocation(src, call), { name: "ring", values });
  assert.equal(validateArgument("sin(30)*2"), "sin(30)*2");
  assert.throws(
    () => validateArgument('1);import("evil.stl");'),
    /Unbalanced|expression|statement/,
  );
  assert.throws(
    () => validateArgument("[1,2]; cube(10);"),
    /expression|statement/,
  );
});
test("external mesh/file dependencies and built-in-shadowing modules cannot bypass the import restriction", () => {
  for (const src of [
    'module m(){import("a.stl");}',
    "include <a.scad>",
    'module m(){surface("a.dat");}',
    "module cube(){sphere(2);}",
  ])
    assert.throws(() => validateAuthoredSource(src));
  assert.doesNotThrow(() =>
    validateAuthoredSource('module n0(){echo("import(a)");cube(10);}'),
  );
});
test("module library detects new and changed definitions, retains dependency changes, and validates backups", () => {
  const candidates = detectedLibraryEntries(flower, emptyLibrary());
  assert.equal(candidates.length, 4);
  const lib = validateLibrary({
    version: 1,
    revision: 4,
    entries: candidates.map((c) => c.entry),
  });
  assert.deepEqual(detectedLibraryEntries(flower, lib), []);
  const changed = detectedLibraryEntries(
    flower.replace("len = 12", "len = 15"),
    lib,
  );
  assert.deepEqual(
    changed.map((c) => c.entry.name),
    ["petal", "ring"],
  );
  assert.ok(changed.every((c) => c.update));
  assert.throws(
    () =>
      validateLibrary({ ...lib, entries: [lib.entries[0], lib.entries[0]] }),
    /duplicate/,
  );
});
test("authored modules preserve native shape IDs when only declarations are added or edited", () => {
  const base = blankDesign();
  base.bodies = [createBody("box")];
  const original = generateReadableScad(base);
  const d = designWithAuthoredCode(original + flower, base, original);
  assert.equal(d.bodies[0].id, base.bodies[0].id);
  assert.match(d.authoredSource!, /module petal/);
  const next = designWithAuthoredCode(
    generateReadableScad(d).replace("len = 12", "len = 14"),
    d,
    generateReadableScad(d),
  );
  assert.equal(next.bodies[0].id, base.bodies[0].id);
});
test("definition-only programs retain their source without fabricating visible geometry", () => {
  const d = designWithAuthoredCode(flower);
  assert.equal(d.bodies.length, 0);
  assert.equal(d.meshAssets.length, 0);
  assert.match(generateReadableScad(d), /module ring/);
});
test("authored instances preserve calls and source through native projects, never become imported meshes", async () => {
  const d = designWithAuthoredCode(flower + "\npetal(len=20); stem();");
  assert.equal(d.bodies.length, 2);
  assert.ok(d.bodies.every((b) => b.kind === "module"));
  assert.equal(d.meshAssets.length, 0);
  const loaded = await decodeProject(
    new Uint8Array(await encodeProject(d)).buffer,
  );
  assert.deepEqual(loaded, validateDesign(d));
  assert.match(generateReadableScad(loaded), /petal\(len=20\)/);
  assert.match(generateScad(loaded), /module petal/);
});
test("saving a selected boolean as a module is explicit and preserves its result and dependencies", () => {
  const d = blankDesign();
  d.bodies = [createBody("box"), createBody("cylinder")];
  d.features = [
    createBoolean("difference", d.bodies.map((b) => b.id) as [string, string]),
  ];
  const source = sourceForSavedShape(d, d.features[0].id, "bracket");
  assert.match(source, /module bracket\(\)/);
  assert.match(source, /difference\(\)/);
  assert.equal(parseAuthoredProgram(source).scene, "");
  assert.throws(
    () =>
      mergeAuthoredSources(
        source,
        source.replace("module bracket()", "module bracket(width=10)"),
      ),
    /Conflicting/,
  );
});
test("user-written n0 modules remain visible, while private worker aliases avoid their names", () => {
  const d = designWithAuthoredCode("module n0(){cube(10);} n0();");
  assert.match(generateReadableScad(d), /module n0/);
  assert.match(generateScad(d), /module forma3d_node_0/);
  assert.equal((generateScad(d).match(/module n0/g) ?? []).length, 1);
  assert.equal(
    canonicalScad(moduleBundle(parseAuthoredProgram(d.authoredSource!), "n0")),
    canonicalScad(d.authoredSource!),
  );
});

test("saving a native shape excludes unrelated project module dependencies", () => {
  const d = designWithAuthoredCode(flower + "\ncube(10);");
  const source = sourceForSavedShape(d, d.bodies[0].id, "petal");
  assert.deepEqual(
    parseAuthoredProgram(source)
      .declarations.filter((d) => d.kind === "module")
      .map((d) => d.name),
    ["petal"],
  );
  assert.doesNotMatch(source, /module ring|module bud|module stem/);
});
test("repeated global assignments keep the final SCAD binding and unchanged project snapshots do not overwrite newer library entries", () => {
  const p = parseAuthoredProgram("$fn=64; $fn=32; module p(){sphere(2);}");
  assert.equal(p.declarations.filter((d) => d.kind === "variable").length, 1);
  assert.match(declarationsSource(p), /\$fn=32/);
  const entries = detectedLibraryEntries(
      flower.replace("len = 12", "len = 15"),
      emptyLibrary(),
    ).map((c) => c.entry),
    lib = validateLibrary({ version: 1, revision: 2, entries });
  assert.deepEqual(detectedLibraryEntries(flower, lib, flower), []);
});

test("Code customizer values remain explicit in authored project source", async () => {
  const { designFromCode } = await import("../src/studio/workspace-code");
  const code = {
    params: {
      activePath: "/custom.scad",
      sources: [
        {
          path: "/custom.scad",
          content: "height=10; module part(h=height){cube([5,5,h]);} part();",
        },
      ],
      features: [],
      vars: { height: 18 },
      exportFormat2D: "svg" as const,
      exportFormat3D: "stl" as const,
    },
  };
  const result = await designFromCode(
    code,
    async () => new Uint8Array(),
    undefined,
    undefined,
    new AbortController().signal,
  );
  assert.match(result.design.authoredSource!, /height=18/);
  assert.equal(result.design.bodies[0].kind, "module");
  assert.match(generateReadableScad(result.design), /part\(\)/);
});
