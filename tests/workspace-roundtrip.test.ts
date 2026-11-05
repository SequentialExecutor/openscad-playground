import { test } from "node:test";
import assert from "node:assert/strict";
import {
  blankDesign,
  createBody,
  createBoolean,
  createTemplateBody,
  createExtrusion,
  generateScad,
  validateDesign,
  createMeshBody,
} from "../src/studio/document";
import { defaultTemplate } from "../src/studio/templates";
import { rectangleSketch } from "../src/studio/sketch";
import {
  updateNativeFromCode,
  importNativeScad,
} from "../src/studio/scad-roundtrip";
import {
  workspaceCodeForDesign,
  nativeCodeRoundTrip,
} from "../src/studio/workspace-code";
import { validateCodeProject } from "../src/studio/code-project";
import { parseMesh } from "../src/studio/mesh-import";
import { binaryStl } from "./mesh-fixtures";
import { encodeProject, decodeProject } from "../src/studio/project-file";
const project = (source: string, vars = {}) => ({
  entryPath: "/test.scad",
  files: [{ path: "/test.scad", content: source }],
  vars,
  features: [],
});
test("unchanged source/comments preserve complete native graphs, IDs, templates and sketches", () => {
  const d = blankDesign();
  d.bodies = [
    createTemplateBody(defaultTemplate("enclosure")),
    createExtrusion({ sketch: rectangleSketch(), height: 12 }),
  ];
  const code = workspaceCodeForDesign(d);
  const edited = structuredClone(code);
  edited.params.sources[0].content += "\n// Reviewed in Code\n";
  assert.deepEqual(nativeCodeRoundTrip(d, code, code), d);
  assert.deepEqual(
    updateNativeFromCode(
      d,
      code.params.sources[0].content!,
      edited.params.sources[0].content!,
    ),
    d,
  );
});
test("generated primitive dimensions and poses roundtrip without losing body IDs or boolean references", () => {
  for (const kind of ["box", "sphere", "cylinder", "cone"] as const) {
    const d = blankDesign(),
      b = createBody(kind),
      c = createBody("cylinder");
    b.rotation = [15, 30, 60];
    d.bodies = [b, c];
    d.features = [createBoolean("difference", [b.id, c.id])];
    const original = generateScad(d),
      candidate = structuredClone(d);
    candidate.bodies[0].size = [40, 30, 25];
    candidate.bodies[0].position = [10, 20, 30];
    const edited = generateScad(candidate),
      restored = updateNativeFromCode(d, original, edited);
    assert.ok(restored, kind);
    assert.deepEqual(restored, candidate);
  }
});
test("primitive code with constants, transforms and booleans becomes editable native solids", () => {
  const d = importNativeScad(
    project("width=30; translate([5,0,0]) cube([width*2,20,10]);"),
  );
  assert.ok(d);
  assert.deepEqual(d.bodies[0].size, [60, 20, 10]);
  assert.deepEqual(d.bodies[0].position, [35, 10, 5]);
  const cut = importNativeScad(
    project(
      "$fn=64;difference(){cube([20,20,10],center=true);cylinder(h=30,d=4,center=true);}",
    ),
  );
  assert.ok(cut);
  assert.equal(cut.features[0].operation, "difference");
  assert.equal(cut.bodies[1].kind, "cylinder");
  const cone = importNativeScad(project("$fn=64;cylinder(10,3,0,true);"));
  assert.ok(cone);
  assert.equal(cone.bodies[0].kind, "cone");
});
test("unsupported semantics stay source-backed rather than guessing geometry", () => {
  for (const s of [
    "a=10;cube(a);a=20;",
    "translate(10) cube(10);",
    "cube(2^3^2);",
    "cylinder(h=10,r1=2,r2=3);",
    "sphere(10);",
    "module part(){cube(10);}part();",
    "rotate([0,0,45])scale([2,1,1])rotate([0,0,45])cube(10);",
    "union(){w=2;cube(w);cube(3);}",
  ])
    assert.equal(importNativeScad(project(s)), undefined, s);
});
test("invalid/structural code edits cannot silently reinterpret a native document", () => {
  const d = blankDesign();
  d.bodies = [createBody("box")];
  const code = workspaceCodeForDesign(d),
    current = structuredClone(code);
  current.params.sources[0].content = code.params.sources[0].content!.replace(
    "cube([20,20,20]",
    "cube([40,20,20]",
  );
  const result = nativeCodeRoundTrip(d, code, current);
  assert.ok(result);
  assert.equal(result.bodies[0].size[0], 40);
  current.params.sources[0].content += " sphere(5);";
  assert.equal(nativeCodeRoundTrip(d, code, current), undefined);
  current.params.sources[0].content = "cube(";
  assert.equal(nativeCodeRoundTrip(d, code, current), undefined);
});
test("linked source metadata and dependencies persist in native containers and generated Code projects", async () => {
  const a = await parseMesh(binaryStl(), "cube.stl", "mm"),
    d = blankDesign(),
    b = createMeshBody(a, "Source result", "preserve");
  b.codeProject = project("for(i=[0:1]) translate([i*20,0,0]) cube(10);");
  d.bodies = [b];
  d.meshAssets = [a];
  const bytes = await encodeProject(d),
    restored = await decodeProject(new Uint8Array(bytes).buffer);
  assert.deepEqual(restored, validateDesign(d));
  const code = workspaceCodeForDesign(d);
  assert.ok(
    code.params.sources.some((s) => s.content?.includes("for(i=[0:1])")),
  );
  assert.match(code.params.sources[0].content!, /include <\/test.scad>/);
  assert.throws(
    () =>
      validateCodeProject({
        ...project("cube(1);"),
        files: [
          { path: "/test.scad", url: "https://example.invalid/code.scad" },
        ],
      }),
    /embedded/,
  );
  assert.throws(
    () =>
      validateCodeProject({
        ...project("cube(1);"),
        entryPath: "/../escape.scad",
      }),
    /Invalid/,
  );
});

test("shared Code snapshots do not alias nested editor mutations or their native baseline", async () => {
  const { copyWorkspaceCode, sameWorkspaceCode } = await import(
    "../src/studio/workspace-store"
  );
  const d = blankDesign();
  d.bodies = [createBody("box")];
  const code = workspaceCodeForDesign(d),
    saved = copyWorkspaceCode(code),
    baseline = copyWorkspaceCode(code);
  code.params.sources[0].content = code.params.sources[0].content!.replace(
    "cube([20,20,20]",
    "cube([30,20,20]",
  );
  assert.equal(sameWorkspaceCode(saved, code), false);
  assert.match(baseline.params.sources[0].content!, /cube\(\[20,20,20\]/);
  assert.ok(nativeCodeRoundTrip(d, baseline, code));
});

test("reachable use declarations lift to the scene entry without changing archived source or unused files", async () => {
  const a = await parseMesh(binaryStl(), "cube.stl", "mm"),
    d = blankDesign(),
    b = createMeshBody(a, "Code", "preserve");
  b.codeProject = {
    entryPath: "/code/main.scad",
    files: [
      {
        path: "/code/main.scad",
        content:
          '// use <ignored.scad>\necho("use <also-ignored.scad>");\ninclude <sub/part.scad>\n',
      },
      {
        path: "/code/sub/part.scad",
        content: "use <../../lib/piece%name.scad>\npiece();",
      },
      { path: "/lib/piece%name.scad", content: "module piece(){cube(10);}" },
      { path: "/unused.scad", content: "use <unused-library.scad>" },
    ],
    vars: {},
    features: [],
  };
  d.bodies = [b];
  d.meshAssets = [a];
  const original = structuredClone(b.codeProject),
    code = workspaceCodeForDesign(d);
  assert.match(
    code.params.sources[0].content!,
    /^use <\/lib\/piece%name.scad>/,
  );
  assert.doesNotMatch(
    code.params.sources[0].content!,
    /ignored|unused-library/,
  );
  assert.match(
    code.params.sources.find((f) => f.path === "/code/sub/part.scad")!.content!,
    /declared in the generated scene entry/,
  );
  assert.equal(
    code.params.sources.find((f) => f.path === "/unused.scad")!.content,
    "use <unused-library.scad>",
  );
  assert.deepEqual(b.codeProject, original);
});
