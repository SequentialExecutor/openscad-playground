import { test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { blankDesign, createBody, createBoolean } from "../src/studio/document";
import { encodeProject, decodeProject } from "../src/studio/project-file";
const arrayBuffer = (bytes: Uint8Array) => new Uint8Array(bytes).buffer;
test("native ZIP preserves feature references, primitives and printer settings", async () => {
  const d = blankDesign();
  d.bodies = [createBody("box"), createBody("cylinder")];
  d.features = [createBoolean("difference", [d.bodies[0].id, d.bodies[1].id])];
  d.print.nozzle = 0.6;
  d.features[0].id = "__proto__";
  const data = await encodeProject(d);
  assert.equal(data[0], 0x50);
  assert.deepEqual(await decodeProject(arrayBuffer(data)), d);
});
test("legacy JSON projects migrate through the same validator", async () => {
  const d = {
    version: 1,
    name: "Legacy",
    units: "mm",
    bodies: [createBody("box")],
  };
  const restored = await decodeProject(
    new TextEncoder().encode(JSON.stringify(d)).buffer,
  );
  assert.equal(restored.version, 3);
  assert.deepEqual(restored.features, []);
  assert.deepEqual(restored.bodies, d.bodies);
});
test("modified documents fail the manifest integrity check", async () => {
  const zip = await JSZip.loadAsync(await encodeProject(blankDesign()));
  zip.file(
    "project.json",
    JSON.stringify({ ...blankDesign(), name: "Modified" }),
  );
  const altered = await zip.generateAsync({ type: "uint8array" });
  await assert.rejects(() => decodeProject(arrayBuffer(altered)), /integrity/);
});

test("unexpected paths and zip expansion are bounded before document parsing", async () => {
  const extra = await JSZip.loadAsync(await encodeProject(blankDesign()));
  extra.file("../outside.txt", "bad");
  const unsafe = await extra.generateAsync({ type: "uint8array" });
  await assert.rejects(() => decodeProject(arrayBuffer(unsafe)), /unsafe/);
  const large = await JSZip.loadAsync(await encodeProject(blankDesign()));
  large.file("project.json", " ".repeat(3 * 1024 * 1024));
  const packed = await large.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
  });
  await assert.rejects(() => decodeProject(arrayBuffer(packed)), /size limit/);
});
