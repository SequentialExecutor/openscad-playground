import Numeric from "./Numeric";
import React from "react";
import { MeshAnalysis, PrintSettings } from "./mesh-analysis";
export function PrintPanel({
  settings,
  onSettings,
  report,
  busy,
  onAnalyze,
}: {
  settings: PrintSettings;
  onSettings: (settings: PrintSettings) => void;
  report?: MeshAnalysis;
  busy: boolean;
  onAnalyze: () => void;
}) {
  const number = (
    label: string,
    value: number,
    set: (n: number) => void,
    max = 1000,
  ) => (
    <Numeric
      key={label}
      label={label}
      value={value}
      positive
      max={max}
      onCommit={set}
    />
  );
  return (
    <details className="studio-print">
      <summary>Print setup & mesh analysis</summary>
      <p className="studio-muted">
        Suggested starting values; choose settings for your printer. Build
        volume is centered in X/Y, with the plate at Z = 0.
      </p>
      <div className="studio-values">
        {settings.build.map((n, i) =>
          number(
            `Build ${"XYZ"[i]} (mm)`,
            n,
            (value) => {
              const build = [...settings.build] as [number, number, number];
              build[i] = value;
              onSettings({ ...settings, build });
            },
            1e6,
          ),
        )}
      </div>
      {number("Nozzle (mm)", settings.nozzle, (nozzle) =>
        onSettings({ ...settings, nozzle }),
      )}
      {number("Layer height (mm)", settings.layer, (layer) =>
        onSettings({ ...settings, layer }),
      )}
      {number("Suggested wall (mm)", settings.minimumWall, (minimumWall) =>
        onSettings({ ...settings, minimumWall }),
      )}
      {number(
        "Overhang threshold (°)",
        settings.overhang,
        (overhang) => onSettings({ ...settings, overhang }),
        89,
      )}
      <button disabled={busy} onClick={onAnalyze}>
        Analyze exact mesh
      </button>
      {report ? (
        <section aria-label="Mesh analysis results">
          <p>
            {report.closed
              ? "Closed consistently oriented edge topology"
              : "Mesh topology defects detected"}{" "}
            • tolerance 0.00001 mm
          </p>
          <dl>
            <dt>Dimensions (mm)</dt>
            <dd>{report.bounds.size.map((n) => n.toFixed(3)).join(" × ")}</dd>
            <dt>Triangles</dt>
            <dd>{report.triangles}</dd>
            <dt>Boundary / non-manifold / inconsistent edges</dt>
            <dd>
              {report.boundaryEdges} / {report.nonManifoldEdges} /{" "}
              {report.inconsistentEdges}
            </dd>
            <dt>Degenerate / duplicate / invalid triangles</dt>
            <dd>
              {report.degenerateTriangles} / {report.duplicateTriangles} /{" "}
              {report.invalidTriangles}
            </dd>
            <dt>Connected shells</dt>
            <dd>{report.shells}</dd>
            <dt>Surface area (mm²)</dt>
            <dd>{report.surfaceArea.toFixed(3)}</dd>
            <dt>Volume (mm³)</dt>
            <dd>
              {report.volume?.toFixed(3) ??
                "Unavailable for defective topology"}
            </dd>
          </dl>
          <ul>
            {report.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
          <p>
            Passing these checks does not guarantee printability. Wall thickness
            and supports are not fully analyzed.
          </p>
        </section>
      ) : (
        <p className="studio-muted">
          Analyze after geometry or printer settings change. Results apply only
          to the evaluated revision.
        </p>
      )}
    </details>
  );
}
