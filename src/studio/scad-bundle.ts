import JSZip from "jszip";
import { Design } from "./document";
import { generateReadableScad } from "./readable-scad";
import { meshInfo } from "./mesh-asset";
export async function encodeScadBundle(
  design: Design,
): Promise<{ data: Uint8Array<ArrayBuffer>; type: string; name: string }> {
  const source = generateReadableScad(design),
    assets = design.meshAssets.filter((a) =>
      source.includes(`import("meshes/${a.id}.stl"`),
    );
  if (!assets.length)
    return {
      data: new TextEncoder().encode(source),
      type: "text/plain",
      name: "design.scad",
    };
  const zip = new JSZip();
  zip.file("design.scad", source);
  for (const a of assets)
    zip.file(`meshes/${a.id}.stl`, meshInfo(a).data, { createFolders: false });
  return {
    data: new Uint8Array(
      await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }),
    ),
    type: "application/zip",
    name: "design.scad.zip",
  };
}
