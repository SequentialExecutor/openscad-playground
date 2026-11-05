import { Matrix4, Quaternion, Vector3 } from "three";
import JSZip from "jszip";
import { DOMParser } from "@xmldom/xmldom";
import {
  MeshAsset,
  MeshFormat,
  MeshUnit,
  MAX_IMPORT_BYTES,
  MAX_MESH_TRIANGLES,
  unitScale,
  toBase64,
  meshDigest,
  meshInfo,
} from "./mesh-asset";
const decode = (data: ArrayBuffer | Uint8Array) =>
  new TextDecoder("utf-8", { fatal: true }).decode(data);
const finite = (n: unknown): number => {
  if (typeof n !== "number" || !Number.isFinite(n))
    throw Error("Mesh contains a nonfinite number.");
  return n;
};
const number = (s: string | null): number => {
  if (s === null || !s.trim()) throw Error("Missing mesh coordinate.");
  return finite(Number(s));
};
const integer = (n: unknown, max = 10000000): number => {
  if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > max)
    throw Error("Invalid mesh index/count.");
  return n;
};
type Point = [number, number, number];
class Triangles {
  values: number[] = [];
  add(a: Point, b: Point, c: Point, matrix?: Matrix4) {
    if (this.values.length / 9 >= MAX_MESH_TRIANGLES)
      throw Error("Mesh exceeds 100,000 triangles (including instances).");
    const points = [a, b, c].map((p) =>
      matrix ? new Vector3(...p).applyMatrix4(matrix).toArray() : p,
    );
    if (matrix && matrix.determinant() < 0)
      [points[1], points[2]] = [points[2], points[1]];
    this.values.push(...points.flat().map(finite));
  }
}
function stl(data: ArrayBuffer, out: Triangles) {
  const view = new DataView(data);
  if (
    data.byteLength >= 84 &&
    84 + view.getUint32(80, true) * 50 === data.byteLength
  ) {
    const count = view.getUint32(80, true);
    if (count > MAX_MESH_TRIANGLES)
      throw Error("Mesh exceeds 100,000 triangles.");
    for (let t = 0; t < count; t++) {
      const p = Array.from(
        { length: 3 },
        (_, v) =>
          [0, 1, 2].map((a) =>
            view.getFloat32(96 + t * 50 + v * 12 + a * 4, true),
          ) as Point,
      );
      out.add(p[0], p[1], p[2]);
    }
    return;
  }
  const text = decode(data);
  const start = /^\s*solid[^\r\n]*(?:\r?\n|$)/i.exec(text);
  if (!start) throw Error("Malformed binary/ASCII STL.");
  const n = "([-+]?(?:[0-9]+(?:\\.[0-9]*)?|\\.[0-9]+)(?:[eE][-+]?[0-9]+)?)";
  const facet = new RegExp(
    `\\s*facet\\s+normal\\s+${n}\\s+${n}\\s+${n}\\s+outer\\s+loop\\s+vertex\\s+${n}\\s+${n}\\s+${n}\\s+vertex\\s+${n}\\s+${n}\\s+${n}\\s+vertex\\s+${n}\\s+${n}\\s+${n}\\s+endloop\\s+endfacet`,
    "giy",
  );
  let cursor = start[0].length;
  while (true) {
    facet.lastIndex = cursor;
    const match = facet.exec(text);
    if (!match) break;
    const v = match.slice(4).map(Number);
    out.add(
      v.slice(0, 3) as Point,
      v.slice(3, 6) as Point,
      v.slice(6, 9) as Point,
    );
    cursor = facet.lastIndex;
  }
  if (!/^\s*endsolid[^\r\n]*\s*$/i.test(text.slice(cursor)))
    throw Error("Malformed ASCII STL facets or trailing data.");
}
function obj(data: ArrayBuffer, out: Triangles) {
  const vertices: Point[] = [];
  for (const raw of decode(data).split(/\r?\n/)) {
    const parts = raw.replace(/#.*/, "").trim().split(/\s+/),
      tag = parts.shift();
    if (!tag) continue;
    if (tag === "v") {
      if (parts.length < 3 || parts.length > 4 || vertices.length >= 300000)
        throw Error("Invalid or oversized OBJ vertex list.");
      const p = parts.map(number),
        w = p[3] ?? 1;
      if (!w) throw Error("OBJ homogeneous coordinate cannot be zero.");
      vertices.push(p.slice(0, 3).map((n) => n / w) as Point);
    } else if (tag === "f") {
      if (parts.length < 3 || parts.length > 256)
        throw Error("OBJ faces need 3–256 vertices.");
      const face = parts.map((token) => {
        const s = token.split("/")[0];
        if (!/^-?[0-9]+$/.test(s)) throw Error("Invalid OBJ face index.");
        const n = Number(s),
          i = n > 0 ? n - 1 : vertices.length + n;
        if (!n || i < 0 || i >= vertices.length)
          throw Error("OBJ face index is out of bounds.");
        return vertices[i];
      });
      const normal = new Vector3();
      for (let i = 0; i < face.length; i++) {
        const a = face[i],
          b = face[(i + 1) % face.length];
        normal.x += (a[1] - b[1]) * (a[2] + b[2]);
        normal.y += (a[2] - b[2]) * (a[0] + b[0]);
        normal.z += (a[0] - b[0]) * (a[1] + b[1]);
      }
      if (face.length > 3) {
        const drop = [
          Math.abs(normal.x),
          Math.abs(normal.y),
          Math.abs(normal.z),
        ].indexOf(
          Math.max(Math.abs(normal.x), Math.abs(normal.y), Math.abs(normal.z)),
        );
        const projected = face.map((p) => p.filter((_, i) => i !== drop));
        const cross = (a: number[], b: number[], c: number[]) =>
          (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
        const on = (a: number[], b: number[], p: number[]) =>
          Math.abs(cross(a, b, p)) < 1e-10 &&
          p.every(
            (v, i) =>
              v >= Math.min(a[i], b[i]) - 1e-10 &&
              v <= Math.max(a[i], b[i]) + 1e-10,
          );
        for (let i = 0; i < face.length; i++)
          for (let j = i + 1; j < face.length; j++) {
            if (j === i + 1 || (i === 0 && j === face.length - 1)) continue;
            const a = projected[i],
              b = projected[(i + 1) % face.length],
              c = projected[j],
              d = projected[(j + 1) % face.length];
            if (
              (cross(a, b, c) * cross(a, b, d) < 0 &&
                cross(c, d, a) * cross(c, d, b) < 0) ||
              on(a, b, c) ||
              on(a, b, d) ||
              on(c, d, a) ||
              on(c, d, b)
            )
              throw Error(
                "OBJ polygon self-intersects. Triangulate valid faces before import.",
              );
          }
        if (normal.length() < 1e-12) throw Error("OBJ polygon is degenerate.");
        normal.normalize();
        const origin = new Vector3(...face[0]);
        for (let i = 0; i < face.length; i++) {
          const a = new Vector3(...face[i]),
            b = new Vector3(...face[(i + 1) % face.length]),
            c = new Vector3(...face[(i + 2) % face.length]);
          if (
            Math.abs(a.clone().sub(origin).dot(normal)) > 1e-5 ||
            b
              .sub(a)
              .cross(c.sub(new Vector3(...face[(i + 1) % face.length])))
              .dot(normal) < -1e-10
          )
            throw Error(
              "OBJ polygons must be planar and convex; triangulate this face before importing.",
            );
        }
      }
      for (let i = 1; i < face.length - 1; i++)
        out.add(face[0], face[i], face[i + 1]);
    } else if (!["vt", "vn", "o", "g", "s", "usemtl", "mtllib"].includes(tag))
      throw Error(
        `Unsupported OBJ statement: ${tag}. Import polygon geometry only.`,
      );
  }
}
function matrix(values: unknown): Matrix4 {
  if (!Array.isArray(values) || values.length !== 16)
    throw Error("Invalid scene matrix.");
  values.forEach(finite);
  if (
    values[3] !== 0 ||
    values[7] !== 0 ||
    values[11] !== 0 ||
    values[15] !== 1
  )
    throw Error("Only affine scene transforms are supported.");
  const m = new Matrix4().fromArray(values);
  if (!Number.isFinite(m.determinant()) || m.determinant() === 0)
    throw Error("Singular scene transform.");
  return m;
}
function vector(values: unknown, length: number, fallback: number[]): number[] {
  if (values === undefined) return fallback;
  if (!Array.isArray(values) || values.length !== length)
    throw Error("Invalid node transform.");
  return values.map(finite);
}
function gltf(data: ArrayBuffer, format: "glb" | "gltf", out: Triangles) {
  let json: any, bin: ArrayBuffer | undefined;
  if (format === "glb") {
    const view = new DataView(data);
    if (
      data.byteLength < 20 ||
      view.getUint32(0, true) !== 0x46546c67 ||
      view.getUint32(4, true) !== 2 ||
      view.getUint32(8, true) !== data.byteLength
    )
      throw Error("Malformed GLB 2.0 header.");
    let cursor = 12;
    while (cursor < data.byteLength) {
      if (cursor + 8 > data.byteLength) throw Error("Truncated GLB chunk.");
      const length = view.getUint32(cursor, true),
        type = view.getUint32(cursor + 4, true);
      cursor += 8;
      if (length % 4 || cursor + length > data.byteLength)
        throw Error("Invalid GLB chunk length.");
      const chunk = data.slice(cursor, cursor + length);
      if (type === 0x4e4f534a) {
        if (json || cursor !== 20) throw Error("Invalid GLB JSON order.");
        json = JSON.parse(decode(chunk));
      } else if (type === 0x004e4942) {
        if (bin) throw Error("Multiple GLB binary chunks.");
        bin = chunk;
      } else throw Error("Unsupported GLB chunk.");
      cursor += length;
    }
  } else json = JSON.parse(decode(data));
  if (
    !json ||
    json.asset?.version !== "2.0" ||
    (json.extensionsRequired?.length ?? 0) ||
    (json.animations?.length ?? 0) ||
    (json.skins?.length ?? 0)
  )
    throw Error(
      "Import static glTF 2.0 with no required extensions, compression, skins or animation.",
    );
  let total = 0;
  const buffers = (json.buffers ?? []).map((b: any, i: number) => {
    let bytes: ArrayBuffer;
    if (b.uri === undefined && i === 0 && bin) bytes = bin;
    else {
      if (
        typeof b.uri !== "string" ||
        !/^data:application\/(?:octet-stream|gltf-buffer);base64,[A-Za-z0-9+/]*={0,2}$/.test(
          b.uri,
        )
      )
        throw Error(
          "glTF buffers must be embedded data URIs; external files are not fetched.",
        );
      const raw = atob(b.uri.split(",")[1]);
      bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0)).buffer;
    }
    const size = integer(b.byteLength, 20 * 1024 * 1024);
    if (bytes.byteLength < size || bytes.byteLength > size + 3)
      throw Error("Invalid glTF buffer length.");
    total += bytes.byteLength;
    if (total > 20 * 1024 * 1024) throw Error("glTF buffers exceed 20 MB.");
    return bytes;
  });
  const accessor = (id: unknown, positions: boolean): number[][] => {
    const a = json.accessors?.[integer(id)],
      v = json.bufferViews?.[integer(a?.bufferView)];
    if (
      !a ||
      !v ||
      a.sparse ||
      a.normalized ||
      a.type !== (positions ? "VEC3" : "SCALAR") ||
      !(positions ? [5126] : [5121, 5123, 5125]).includes(a.componentType)
    )
      throw Error(
        "Unsupported glTF accessor: use float positions and unsigned triangle indices.",
      );
    const buffer = buffers[integer(v.buffer)];
    if (!buffer) throw Error("Missing glTF buffer.");
    const count = integer(a.count, 300000),
      components = positions ? 3 : 1,
      bytes = a.componentType === 5121 ? 1 : a.componentType === 5123 ? 2 : 4,
      stride =
        v.byteStride === undefined
          ? components * bytes
          : integer(v.byteStride, 252),
      start = integer(v.byteOffset ?? 0),
      offset = integer(a.byteOffset ?? 0),
      size = integer(v.byteLength);
    if (
      stride < components * bytes ||
      stride % bytes ||
      start + size > buffer.byteLength ||
      offset + (count ? stride * (count - 1) + components * bytes : 0) > size
    )
      throw Error("glTF accessor exceeds its buffer view.");
    const dv = new DataView(buffer);
    return Array.from({ length: count }, (_, i) =>
      Array.from({ length: components }, (_, c) => {
        const p = start + offset + i * stride + c * bytes;
        return a.componentType === 5126
          ? finite(dv.getFloat32(p, true))
          : a.componentType === 5121
            ? dv.getUint8(p)
            : a.componentType === 5123
              ? dv.getUint16(p, true)
              : dv.getUint32(p, true);
      }),
    );
  };
  const nodes = json.nodes;
  if (!Array.isArray(nodes) || nodes.length > 2000)
    throw Error("Invalid or oversized glTF scene.");
  const scene = json.scenes?.[integer(json.scene ?? 0)];
  if (!scene || !Array.isArray(scene.nodes))
    throw Error("glTF needs a scene with root nodes.");
  let instances = 0;
  const visiting = new Set<number>();
  const visit = (id: number, parent: Matrix4, depth: number) => {
    integer(id);
    if (depth > 64 || visiting.has(id) || ++instances > 10000)
      throw Error("Invalid, cyclic or oversized glTF scene graph.");
    const node = nodes[id];
    if (!node || node.skin !== undefined || node.weights !== undefined)
      throw Error("Unsupported glTF node.");
    visiting.add(id);
    let local: Matrix4;
    if (node.matrix !== undefined) {
      if (node.translation || node.rotation || node.scale)
        throw Error("glTF matrix and TRS cannot be combined.");
      local = matrix(node.matrix);
    } else {
      const t = vector(node.translation, 3, [0, 0, 0]),
        q = vector(node.rotation, 4, [0, 0, 0, 1]),
        s = vector(node.scale, 3, [1, 1, 1]);
      if (Math.abs(Math.hypot(...q) - 1) > 1e-5 || s.some((n) => n === 0))
        throw Error("Invalid glTF rotation/scale.");
      local = new Matrix4().compose(
        new Vector3(...t),
        new Quaternion(...q),
        new Vector3(...s),
      );
    }
    const world = parent.clone().multiply(local);
    if (node.mesh !== undefined) {
      const mesh = json.meshes?.[integer(node.mesh)];
      if (!mesh || !Array.isArray(mesh.primitives) || mesh.weights)
        throw Error("Unsupported glTF mesh.");
      for (const p of mesh.primitives) {
        if ((p.mode ?? 4) !== 4 || p.targets || p.extensions)
          throw Error(
            "glTF supports uncompressed static triangle primitives only.",
          );
        const positions = accessor(p.attributes?.POSITION, true) as Point[],
          indices =
            p.indices === undefined
              ? positions.map((_, i) => i)
              : accessor(p.indices, false).flat();
        if (indices.length % 3) throw Error("Incomplete glTF triangles.");
        for (let i = 0; i < indices.length; i += 3) {
          const points = indices.slice(i, i + 3).map((n) => {
            if (n >= positions.length)
              throw Error("glTF triangle index is out of bounds.");
            return positions[n];
          });
          out.add(points[0], points[1], points[2], world);
        }
      }
    }
    for (const child of node.children ?? []) visit(child, world, depth + 1);
    visiting.delete(id);
  };
  const zUp = new Matrix4().makeRotationX(Math.PI / 2);
  for (const id of scene.nodes) visit(id, zUp, 1);
}
async function bounded(
  entry: JSZip.JSZipObject,
  limit: number,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    let size = 0,
      stopped = false;
    const chunks: Uint8Array[] = [];
    const stream = (entry as any).internalStream("uint8array");
    stream.on("data", (chunk: Uint8Array) => {
      if (stopped) return;
      size += chunk.length;
      if (size > limit) {
        stopped = true;
        stream.pause();
        reject(Error("Expanded 3MF data exceeds its size limit."));
      } else chunks.push(chunk);
    });
    stream.on("error", reject);
    stream.on("end", () => {
      if (stopped) return;
      const out = new Uint8Array(size);
      let offset = 0;
      for (const c of chunks) {
        out.set(c, offset);
        offset += c.length;
      }
      resolve(out);
    });
    stream.resume();
  });
}
async function threeMf(data: ArrayBuffer, out: Triangles): Promise<MeshUnit> {
  const zip = await JSZip.loadAsync(data),
    entries = Object.values(zip.files);
  if (
    entries.length > 128 ||
    entries.some(
      (e: any) =>
        (e.unsafeOriginalName ?? e.name) !== e.name ||
        e.name.startsWith("/") ||
        e.name.includes("\\") ||
        e.name.split("/").includes(".."),
    )
  )
    throw Error("Unsafe or oversized 3MF archive.");
  const xml = async (path: string) => {
    const entry = zip.file(path);
    if (!entry) throw Error("Missing 3MF package part.");
    const text = decode(await bounded(entry, 4 * 1024 * 1024));
    if (/<!DOCTYPE|<!ENTITY/i.test(text))
      throw Error("3MF XML entities/DTDs are unsupported.");
    let bad = false;
    const doc = new DOMParser({
      onError: () => {
        bad = true;
      },
    }).parseFromString(text, "application/xml");
    if (bad || !doc.documentElement) throw Error("Invalid 3MF XML.");
    return doc.documentElement;
  };
  const children = (el: any, name: string): any[] =>
    Array.from(el.childNodes ?? []).filter(
      (n: any) => n.nodeType === 1 && n.localName === name,
    );
  const rels = await xml("_rels/.rels");
  if (
    rels.localName !== "Relationships" ||
    rels.namespaceURI !==
      "http://schemas.openxmlformats.org/package/2006/relationships"
  )
    throw Error("Invalid 3MF relationships.");
  const modelRels = children(rels, "Relationship").filter(
    (r) =>
      r.getAttribute("Type") ===
      "http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel",
  );
  if (
    modelRels.length !== 1 ||
    modelRels[0].getAttribute("TargetMode") === "External"
  )
    throw Error("3MF needs one local model relationship.");
  const modelPath = modelRels[0].getAttribute("Target").replace(/^\//, "");
  if (
    modelPath.includes("..") ||
    modelPath.includes("\\") ||
    !modelPath.endsWith(".model")
  )
    throw Error("Unsafe 3MF model target.");
  const types = await xml("[Content_Types].xml");
  if (
    types.localName !== "Types" ||
    types.namespaceURI !==
      "http://schemas.openxmlformats.org/package/2006/content-types"
  )
    throw Error("Invalid 3MF content types.");
  const contentType = "application/vnd.ms-package.3dmanufacturing-3dmodel+xml";
  if (
    !children(types, "Default").some(
      (e) =>
        e.getAttribute("Extension") === "model" &&
        e.getAttribute("ContentType") === contentType,
    ) &&
    !children(types, "Override").some(
      (e) =>
        e.getAttribute("PartName") === `/${modelPath}` &&
        e.getAttribute("ContentType") === contentType,
    )
  )
    throw Error("3MF model content type is missing.");
  const root = await xml(modelPath);
  if (
    root.localName !== "model" ||
    root.namespaceURI !==
      "http://schemas.microsoft.com/3dmanufacturing/core/2015/02" ||
    root.getAttribute("requiredextensions")
  )
    throw Error("Unsupported 3MF model namespace or required extensions.");
  const units: Record<string, MeshUnit> = {
      micron: "um",
      millimeter: "mm",
      centimeter: "cm",
      meter: "m",
      inch: "in",
      foot: "ft",
    },
    unit = units[root.getAttribute("unit") || "millimeter"];
  if (!unit) throw Error("Unsupported 3MF unit.");
  const resources = children(root, "resources");
  if (resources.length !== 1) throw Error("Invalid 3MF resources.");
  const objects = new Map<string, any>();
  for (const object of children(resources[0], "object")) {
    const id = object.getAttribute("id");
    if (
      !/^[1-9][0-9]{0,8}$/.test(id) ||
      objects.has(id) ||
      objects.size >= 1000
    )
      throw Error("Invalid 3MF object IDs.");
    objects.set(id, object);
  }
  const transform = (text: string) => {
    if (!text) return new Matrix4();
    const a = text.trim().split(/\s+/).map(number);
    if (a.length !== 12) throw Error("Invalid 3MF transform.");
    return matrix([
      a[0],
      a[1],
      a[2],
      0,
      a[3],
      a[4],
      a[5],
      0,
      a[6],
      a[7],
      a[8],
      0,
      a[9],
      a[10],
      a[11],
      1,
    ]);
  };
  const visiting = new Set<string>();
  let instances = 0;
  const visit = (id: string, parent: Matrix4, depth: number) => {
    if (depth > 64 || visiting.has(id) || ++instances > 10000)
      throw Error("Invalid, cyclic or oversized 3MF component graph.");
    const object = objects.get(id);
    if (!object) throw Error("Missing 3MF object.");
    visiting.add(id);
    const meshes = children(object, "mesh"),
      components = children(object, "components");
    if (meshes.length + components.length !== 1)
      throw Error("3MF objects need one mesh or component group.");
    if (meshes.length) {
      const vs = children(meshes[0], "vertices"),
        ts = children(meshes[0], "triangles");
      if (vs.length !== 1 || ts.length !== 1) throw Error("Invalid 3MF mesh.");
      const vertices = children(vs[0], "vertex").map(
        (v) => ["x", "y", "z"].map((a) => number(v.getAttribute(a))) as Point,
      );
      if (vertices.length > 300000) throw Error("3MF vertex limit exceeded.");
      for (const t of children(ts[0], "triangle")) {
        const points = ["v1", "v2", "v3"].map((key) => {
          const i = integer(number(t.getAttribute(key)));
          if (i >= vertices.length)
            throw Error("3MF triangle index is out of bounds.");
          return vertices[i];
        });
        out.add(points[0], points[1], points[2], parent);
      }
    } else
      for (const c of children(components[0], "component")) {
        if (Array.from(c.attributes).some((a: any) => a.localName === "path"))
          throw Error("3MF external component parts are unsupported.");
        visit(
          c.getAttribute("objectid"),
          parent.clone().multiply(transform(c.getAttribute("transform"))),
          depth + 1,
        );
      }
    visiting.delete(id);
  };
  const builds = children(root, "build");
  if (builds.length !== 1) throw Error("3MF needs one build.");
  for (const item of children(builds[0], "item")) {
    if (
      Array.from(item.attributes).some((a: any) => a.localName === "path") ||
      item.getAttribute("printable") === "false"
    )
      throw Error("3MF external/non-printable build items are unsupported.");
    visit(
      item.getAttribute("objectid"),
      transform(item.getAttribute("transform")),
      1,
    );
  }
  return unit;
}
export async function parseMesh(
  data: ArrayBuffer,
  filename: string,
  chosen: MeshUnit | "file",
): Promise<MeshAsset> {
  if (!data.byteLength || data.byteLength > MAX_IMPORT_BYTES)
    throw Error("Import files must be between 1 byte and 10 MB.");
  const format = filename.toLowerCase().split(".").pop() as MeshFormat;
  if (!["stl", "obj", "3mf", "glb", "gltf"].includes(format))
    throw Error("Choose STL, OBJ, 3MF, GLB or embedded glTF geometry.");
  if (chosen !== "file" && !Object.hasOwn(unitScale, chosen))
    throw Error("Confirm valid import units.");
  const out = new Triangles();
  let declared: MeshUnit = "mm";
  if (format === "stl") stl(data, out);
  else if (format === "obj") obj(data, out);
  else if (format === "3mf") declared = await threeMf(data, out);
  else {
    declared = "m";
    gltf(data, format, out);
  }
  if (!out.values.length) throw Error("No triangle geometry was found.");
  if (chosen === "file" && (format === "stl" || format === "obj"))
    throw Error("STL/OBJ require an explicit unit assumption.");
  const units = chosen === "file" ? declared : chosen,
    scale = unitScale[units];
  const binary = new ArrayBuffer(84 + (out.values.length / 9) * 50),
    view = new DataView(binary);
  view.setUint32(80, out.values.length / 9, true);
  out.values.forEach((n, i) =>
    view.setFloat32(96 + Math.floor(i / 9) * 50 + (i % 9) * 4, n * scale, true),
  );
  const asset: MeshAsset = {
    id: await meshDigest(binary),
    format,
    units,
    data: toBase64(binary),
    warnings:
      format === "stl"
        ? []
        : [
            "Geometry only: materials, textures, names/groups and editable CAD history are not imported.",
          ],
  };
  meshInfo(asset);
  return asset;
}
