import JSZip from "jszip";
export const points = [
  [0, 0, 0],
  [10, 0, 0],
  [10, 10, 0],
  [0, 10, 0],
  [0, 0, 10],
  [10, 0, 10],
  [10, 10, 10],
  [0, 10, 10],
];
export const faces = [
  [0, 2, 1],
  [0, 3, 2],
  [4, 5, 6],
  [4, 6, 7],
  [0, 1, 5],
  [0, 5, 4],
  [1, 2, 6],
  [1, 6, 5],
  [2, 3, 7],
  [2, 7, 6],
  [3, 0, 4],
  [3, 4, 7],
];
export const quads = [
  [0, 3, 2, 1],
  [4, 5, 6, 7],
  [0, 1, 5, 4],
  [1, 2, 6, 5],
  [2, 3, 7, 6],
  [3, 0, 4, 7],
];
export function binaryStl(vertices = points, triangles = faces) {
  const data = new ArrayBuffer(84 + triangles.length * 50),
    view = new DataView(data);
  view.setUint32(80, triangles.length, true);
  triangles.forEach((f, i) =>
    f.forEach((v, j) =>
      vertices[v].forEach((n, k) =>
        view.setFloat32(96 + i * 50 + j * 12 + k * 4, n, true),
      ),
    ),
  );
  return data;
}
export const text = (value: string) => new TextEncoder().encode(value).buffer;
export function asciiStl() {
  return text(
    "solid cube\n" +
      faces
        .map(
          (f) =>
            "facet normal 0 0 0\nouter loop\n" +
            f.map((v) => "vertex " + points[v].join(" ")).join("\n") +
            "\nendloop\nendfacet",
        )
        .join("\n") +
      "\nendsolid cube\n",
  );
}
export function objCube() {
  return text(
    points.map((p) => "v " + p.join(" ")).join("\n") +
      "\n" +
      quads.map((f) => "f " + f.map((n) => n + 1).join(" ")).join("\n"),
  );
}
export function gltfCube(
  binary = false,
  transform: Record<string, unknown> = { translation: [0.02, 0.03, 0.04] },
) {
  const buffer = new ArrayBuffer(points.length * 12 + faces.length * 6),
    view = new DataView(buffer);
  points.flat().forEach((v, i) => view.setFloat32(i * 4, v / 1000, true));
  faces
    .flat()
    .forEach((v, i) => view.setUint16(points.length * 12 + i * 2, v, true));
  const json: any = {
    asset: { version: "2.0" },
    buffers: [
      {
        byteLength: buffer.byteLength,
        ...(!binary
          ? {
              uri:
                "data:application/octet-stream;base64," +
                Buffer.from(buffer).toString("base64"),
            }
          : {}),
      },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: points.length * 12 },
      {
        buffer: 0,
        byteOffset: points.length * 12,
        byteLength: faces.length * 6,
      },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: points.length,
        type: "VEC3",
      },
      {
        bufferView: 1,
        componentType: 5123,
        count: faces.length * 3,
        type: "SCALAR",
      },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    nodes: [{ mesh: 0, ...transform }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  };
  if (!binary) return { text: json, data: text(JSON.stringify(json)) };
  let encoded = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = Math.ceil(encoded.length / 4) * 4,
    binLength = Math.ceil(buffer.byteLength / 4) * 4;
  const out = new ArrayBuffer(12 + 8 + jsonLength + 8 + binLength),
    dv = new DataView(out);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, out.byteLength, true);
  dv.setUint32(12, jsonLength, true);
  dv.setUint32(16, 0x4e4f534a, true);
  const bytes = new Uint8Array(out);
  bytes.fill(32, 20, 20 + jsonLength);
  bytes.set(encoded, 20);
  dv.setUint32(20 + jsonLength, binLength, true);
  dv.setUint32(24 + jsonLength, 0x004e4942, true);
  bytes.set(new Uint8Array(buffer), 28 + jsonLength);
  return { text: json, data: out };
}
export async function threeMfCube(unit = "millimeter", components = true) {
  const model = `<?xml version="1.0"?><model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" unit="${unit}"><resources><object id="1" type="model"><mesh><vertices>${points.map((p) => `<vertex x="${p[0]}" y="${p[1]}" z="${p[2]}"/>`).join("")}</vertices><triangles>${faces.map((f) => `<triangle v1="${f[0]}" v2="${f[1]}" v3="${f[2]}"/>`).join("")}</triangles></mesh></object>${components ? '<object id="2"><components><component objectid="1" transform="1 0 0 0 1 0 0 0 1 2 3 4"/></components></object>' : ""}</resources><build><item objectid="${components ? 2 : 1}" transform="1 0 0 0 1 0 0 0 1 5 0 0"/></build></model>`;
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>',
  );
  zip.file(
    "_rels/.rels",
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" Target="/3D/3dmodel.model"/></Relationships>',
    { createFolders: false },
  );
  zip.file("3D/3dmodel.model", model, { createFolders: false });
  return new Uint8Array(
    await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }),
  ).buffer;
}
