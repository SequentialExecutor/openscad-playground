import React, { useRef, useState } from "react";
import type { Body } from "./document";
import { MeshAsset, MeshUnit, meshInfo } from "./mesh-asset";
export type MeshPlacement = "preserve" | "plate";
export function MeshImportTools({
  busy,
  ready,
  onImport,
}: {
  busy: boolean;
  ready: boolean;
  onImport: (
    file: File,
    units: MeshUnit | "file",
    placement: MeshPlacement,
  ) => Promise<boolean>;
}) {
  const [file, setFile] = useState<File>(),
    [units, setUnits] = useState<MeshUnit | "file">("mm"),
    [confirmed, setConfirmed] = useState(false),
    [placement, setPlacement] = useState<MeshPlacement>("plate");
  const input = useRef<HTMLInputElement>(null);
  return (
    <details className="studio-mesh-import">
      <summary>Import mesh</summary>
      <fieldset disabled={busy || !ready}>
        <label>
          Mesh file
          <input
            ref={input}
            aria-label="Mesh file"
            type="file"
            accept=".stl,.obj,.3mf,.glb,.gltf"
            onChange={(e) => {
              const f = e.target.files?.[0];
              setFile(f);
              setConfirmed(false);
              setUnits(f && /\.(3mf|glb|gltf)$/i.test(f.name) ? "file" : "mm");
            }}
          />
        </label>
        <label>
          Import units
          <select
            aria-label="Mesh import units"
            value={units}
            onChange={(e) => {
              setUnits(e.target.value as MeshUnit | "file");
              setConfirmed(false);
            }}
          >
            {file && /\.(3mf|glb|gltf)$/i.test(file.name) && (
              <option value="file">
                Format units (3MF metadata / glTF meters)
              </option>
            )}
            {(["mm", "cm", "m", "in", "ft", "um"] as MeshUnit[]).map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </label>
        <label>
          Placement
          <select
            aria-label="Mesh import placement"
            value={placement}
            onChange={(e) => setPlacement(e.target.value as MeshPlacement)}
          >
            <option value="plate">Center X/Y and place on build plate</option>
            <option value="preserve">Preserve source coordinates</option>
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            aria-label="Confirm mesh import units"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          I confirm these import units
        </label>
        <button
          disabled={!file || !confirmed}
          onClick={async () => {
            if (file && (await onImport(file, units, placement))) {
              setFile(undefined);
              setConfirmed(false);
              if (input.current) input.current.value = "";
            }
          }}
        >
          Import mesh
        </button>
      </fieldset>
      <p>
        STL/OBJ need a unit assumption. Geometry only, up to 10 MB / 100,000
        triangles. glTF must embed its buffers. Materials, animation and CAD
        history are not imported. No automatic mesh repair.
      </p>
    </details>
  );
}
export function MeshInspector({
  body,
  asset,
}: {
  body: Body;
  asset: MeshAsset;
}) {
  const r = meshInfo(asset).report;
  return (
    <section aria-label="Imported mesh diagnostics">
      <h2>Imported mesh</h2>
      <p>
        {body.meshSource?.format.toUpperCase() ?? asset.format.toUpperCase()} •
        source units: {body.meshSource?.units ?? asset.units} • stored in
        millimeters
      </p>
      <p>
        Mesh geometry is retained; use transforms and supported solid features.
        This is not an editable parametric reconstruction.
      </p>
      <dl>
        <dt>Local dimensions (mm)</dt>
        <dd>{r.bounds.size.map((n) => n.toFixed(3)).join(" × ")}</dd>
        <dt>Source surface area (mm²)</dt>
        <dd>{r.surfaceArea.toFixed(3)}</dd>
        <dt>Source volume (mm³)</dt>
        <dd>{r.volume?.toFixed(3) ?? "Unavailable for defective topology"}</dd>
        <dt>Triangles / connected shells</dt>
        <dd>
          {r.triangles} / {r.shells}
        </dd>
        <dt>Boundary / non-manifold / inconsistent edges</dt>
        <dd>
          {r.boundaryEdges} / {r.nonManifoldEdges} / {r.inconsistentEdges}
        </dd>
        <dt>Degenerate / duplicate triangles</dt>
        <dd>
          {r.degenerateTriangles} / {r.duplicateTriangles}
        </dd>
      </dl>
      <p>
        {r.closed
          ? "Closed, consistently oriented edge topology: eligible for solid evaluation."
          : "Topology defects: visible and savable; solid features/export require a closed mesh."}
      </p>
      <p>
        Source topology is unchanged by transforms. Final world dimensions and
        volume come from exact mesh analysis. Self-intersections and manifold
        vertices are not certified.
      </p>
      {asset.warnings.map((w) => (
        <p key={w}>{w}</p>
      ))}
    </section>
  );
}
