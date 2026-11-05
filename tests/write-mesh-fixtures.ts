import fs from "node:fs";
import path from "node:path";
import {
  binaryStl,
  asciiStl,
  objCube,
  gltfCube,
  threeMfCube,
  points,
  faces,
} from "./mesh-fixtures";
const root = process.argv[2];
if (!root) throw Error("Provide a fixture directory.");
for (const [name, data] of [
  ["cube.stl", binaryStl()],
  ["ascii.stl", asciiStl()],
  ["cube.obj", objCube()],
  ["cube.glb", gltfCube(true).data],
  ["cube.gltf", gltfCube(false).data],
  ["cube.3mf", await threeMfCube()],
  ["open.stl", binaryStl(points, faces.slice(1))],
] as const)
  fs.writeFileSync(path.join(root, name), new Uint8Array(data));
fs.writeFileSync(path.join(root, "invalid.stl"), "not a mesh");
