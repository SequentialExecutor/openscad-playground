import { test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { parseMesh } from "../src/studio/mesh-import";
import {
  meshInfo,
  MAX_IMPORT_BYTES,
  MAX_MESH_TRIANGLES,
} from "../src/studio/mesh-asset";
import {
  blankDesign,
  createMeshBody,
  createBoolean,
  createBody,
  generateScad,
  validateDesign,
  execute,
  undo,
  redo,
} from "../src/studio/document";
import { encodeProject, decodeProject } from "../src/studio/project-file";
import { encodeScadBundle } from "../src/studio/scad-bundle";
import {
  binaryStl,
  asciiStl,
  objCube,
  gltfCube,
  threeMfCube,
  text,
  points,
  faces,
} from "./mesh-fixtures";
const buffer = (bytes: Uint8Array) => new Uint8Array(bytes).buffer;
test("binary and ASCII STL retain coordinates, topology and explicit unit scaling", async () => {
  for (const data of [binaryStl(), asciiStl()]) {
    const a = await parseMesh(data, "cube.STL", "in"),
      r = meshInfo(a).report;
    assert.equal(r.closed, true);
    assert.deepEqual(r.bounds.size, [254, 254, 254]);
    assert.ok(Math.abs(r.volume! - 254 ** 3) < 1e-6);
  }
  const solid = binaryStl();
  new Uint8Array(solid).set(new TextEncoder().encode("solid binary header"));
  assert.equal(
    meshInfo(await parseMesh(solid, "cube.stl", "mm")).report.closed,
    true,
  );
  await assert.rejects(
    () => parseMesh(binaryStl(), "cube.stl", "file"),
    /explicit/,
  );
  await assert.rejects(() =>
    parseMesh(binaryStl().slice(0, -1), "bad.stl", "mm"),
  );
  await assert.rejects(
    () =>
      parseMesh(text("solid bad\nvertex 0 0 0\nendsolid bad"), "bad.stl", "mm"),
    /Malformed/,
  );
});
test("OBJ convex faces and negative indices retain a closed solid; invalid polygons are rejected", async () => {
  const a = await parseMesh(objCube(), "cube.obj", "mm");
  assert.equal(meshInfo(a).report.closed, true);
  assert.ok(Math.abs(meshInfo(a).report.volume! - 1000) < 1e-6);
  const triangle = await parseMesh(
    text("v 0 0 0\nv 1 0 0\nv 0 1 0\nf -3 -2 -1"),
    "triangle.obj",
    "cm",
  );
  assert.equal(meshInfo(triangle).report.boundaryEdges, 3);
  for (const source of [
    "v 0 0 0\nf 1 2 3",
    "v 0 0 0\nv 2 0 0\nv 1 .5 0\nv 2 2 0\nv 0 2 0\nf 1 2 3 4 5",
    "v 0 0 0\nv 1 0 0\nv 1 1 1\nv 0 1 0\nf 1 2 3 4",
  ])
    await assert.rejects(() => parseMesh(text(source), "bad.obj", "mm"));
});
test("embedded glTF and GLB bake scene transforms, meters and Y-up into millimeters/Z-up", async () => {
  for (const binary of [false, true]) {
    const a = await parseMesh(
        gltfCube(binary).data,
        binary ? "cube.glb" : "cube.gltf",
        "file",
      ),
      r = meshInfo(a).report;
    assert.equal(r.closed, true);
    r.bounds.min.forEach((n, i) =>
      assert.ok(Math.abs(n - [20, -50, 30][i]) < 1e-4),
    );
    r.bounds.size.forEach((n) => assert.ok(Math.abs(n - 10) < 1e-4));
    assert.ok(Math.abs(r.volume! - 1000) < 0.01);
  }
  const reflected = await parseMesh(
    gltfCube(false, { scale: [-1, 1, 1] }).data,
    "cube.gltf",
    "file",
  );
  assert.equal(meshInfo(reflected).report.closed, true);
});
test("glTF rejects external buffers, animation, invalid accessors and cycles without fetching", async () => {
  for (const change of [
    (j: any) => (j.buffers[0].uri = "https://example.invalid/a.bin"),
    (j: any) => (j.animations = [{}]),
    (j: any) => (j.accessors[0].count = 300000),
    (j: any) => (j.nodes[0].children = [0]),
    (j: any) => (j.extensionsRequired = ["KHR_draco_mesh_compression"]),
  ]) {
    const j = gltfCube().text;
    change(j);
    await assert.rejects(() =>
      parseMesh(text(JSON.stringify(j)), "bad.gltf", "file"),
    );
  }
});
test("3MF unit metadata, components and build transforms preserve assembled dimensions", async () => {
  const a = await parseMesh(
      await threeMfCube("centimeter"),
      "assembly.3mf",
      "file",
    ),
    r = meshInfo(a).report;
  assert.equal(r.closed, true);
  assert.deepEqual(r.bounds.min, [70, 30, 40]);
  assert.deepEqual(r.bounds.size, [100, 100, 100]);
  assert.ok(Math.abs(r.volume! - 1000000) < 1e-6);
  const override = await parseMesh(
    await threeMfCube("centimeter"),
    "assembly.3mf",
    "mm",
  );
  assert.deepEqual(meshInfo(override).report.bounds.size, [10, 10, 10]);
});
test("3MF rejects external relationships, XML entities, missing references and ZIP expansion", async () => {
  for (const kind of ["external", "entities"]) {
    const z = await JSZip.loadAsync(await threeMfCube());
    if (kind === "external")
      z.file(
        "_rels/.rels",
        (await z.file("_rels/.rels")!.async("string")).replace(
          'Target="/3D',
          'TargetMode="External" Target="https://bad.invalid/3D',
        ),
      );
    else
      z.file(
        "3D/3dmodel.model",
        '<!DOCTYPE model [<!ENTITY x "bad">]>' +
          (await z.file("3D/3dmodel.model")!.async("string")),
      );
    await assert.rejects(async () =>
      parseMesh(
        buffer(await z.generateAsync({ type: "uint8array" })),
        "bad.3mf",
        "file",
      ),
    );
  }
  const z = await JSZip.loadAsync(await threeMfCube());
  z.file("3D/3dmodel.model", " ".repeat(5 * 1024 * 1024));
  await assert.rejects(
    async () =>
      parseMesh(
        buffer(
          await z.generateAsync({ type: "uint8array", compression: "DEFLATE" }),
        ),
        "bomb.3mf",
        "file",
      ),
    /size limit/,
  );
});
test("file/triangle limits and nonfinite data fail before publishing imported geometry", async () => {
  await assert.rejects(
    () => parseMesh(new ArrayBuffer(MAX_IMPORT_BYTES + 1), "big.stl", "mm"),
    /10 MB/,
  );
  const huge = new ArrayBuffer(84 + (MAX_MESH_TRIANGLES + 1) * 50);
  new DataView(huge).setUint32(80, MAX_MESH_TRIANGLES + 1, true);
  await assert.rejects(() => parseMesh(huge, "big.stl", "mm"), /100,000/);
  const bad = binaryStl();
  new DataView(bad).setFloat32(96, Infinity, true);
  await assert.rejects(() => parseMesh(bad, "bad.stl", "mm"), /finite/);
});
test("native mesh bodies retain IDs, placements, transforms, assets and history; open meshes cannot enter solid features", async () => {
  const a = await parseMesh(binaryStl(), "cube.stl", "mm"),
    d = blankDesign();
  d.meshAssets = [a];
  d.bodies = [createMeshBody(a, "cube.stl", "plate")];
  assert.deepEqual(d.bodies[0].position, [-5, -5, 0]);
  assert.match(generateScad(d), /import\("meshes\//);
  const h = execute({ past: [], present: blankDesign(), future: [] }, d);
  assert.equal(undo(h).present.bodies.length, 0);
  assert.equal(redo(undo(h)).present.bodies[0].id, d.bodies[0].id);
  const open = await parseMesh(
      binaryStl(points, faces.slice(1)),
      "open.stl",
      "mm",
    ),
    o = {
      ...blankDesign(),
      meshAssets: [open],
      bodies: [createMeshBody(open, "open", "preserve"), createBody("box")],
    };
  assert.ok(validateDesign(o));
  assert.throws(
    () =>
      validateDesign({
        ...o,
        features: [createBoolean("union", [o.bodies[0].id, o.bodies[1].id])],
      }),
    /closed/,
  );
  assert.equal(validateDesign({ ...d, bodies: [] }).meshAssets.length, 0);
});
test("native container v2 and SCAD bundles preserve hashed mesh assets and reject tampering", async () => {
  const a = await parseMesh(binaryStl(), "cube.stl", "mm"),
    d = blankDesign();
  d.meshAssets = [a];
  d.bodies = [createMeshBody(a, "cube.stl", "preserve")];
  d.bodies[0].rotation = [0, 0, 90];
  d.bodies[0].scale = [2, 1, 1];
  const bytes = await encodeProject(d);
  assert.deepEqual(await decodeProject(buffer(bytes)), validateDesign(d));
  const z = await JSZip.loadAsync(bytes);
  assert.equal(
    JSON.parse(await z.file("manifest.json")!.async("string")).version,
    2,
  );
  const bundle = await encodeScadBundle(d),
    scad = await JSZip.loadAsync(bundle.data);
  assert.equal(bundle.name, "design.scad.zip");
  assert.ok(scad.file(`meshes/${a.id}.stl`));
  assert.equal(
    await scad.file("design.scad")!.async("string"),
    generateScad(d),
  );
  z.file(`meshes/${a.id}.stl`, new Uint8Array(meshInfo(a).data).fill(0), {
    createFolders: false,
  });
  await assert.rejects(
    async () =>
      decodeProject(buffer(await z.generateAsync({ type: "uint8array" }))),
    /integrity/,
  );
  const forged = structuredClone(d);
  forged.meshAssets[0].id = "a".repeat(64);
  forged.bodies[0].meshAssetId = "a".repeat(64);
  await assert.rejects(
    () => decodeProject(text(JSON.stringify(forged))),
    /integrity/,
  );
});
