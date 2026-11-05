import React, { useState } from "react";
import Numeric from "./Numeric";
import {
  MechanicalSpec,
  TemplateKind,
  templateNames,
  defaultTemplate,
} from "./templates";
export function MechanicalTools({
  onAdd,
}: {
  onAdd: (spec: MechanicalSpec) => void;
}) {
  const [kind, setKind] = useState<TemplateKind>("enclosure");
  return (
    <details>
      <summary>Mechanical templates</summary>
      <select
        aria-label="Mechanical template"
        value={kind}
        onChange={(e) => setKind(e.target.value as TemplateKind)}
      >
        {(Object.keys(templateNames) as TemplateKind[]).map((k) => (
          <option key={k} value={k}>
            {templateNames[k]}
          </option>
        ))}
      </select>
      <button onClick={() => onAdd(defaultTemplate(kind))}>
        Add mechanical template
      </button>
      <p>
        Hole templates are cutting solids: use Difference to cut a body. Fits
        depend on your printer and material.
      </p>
    </details>
  );
}
export function MechanicalInspector({
  spec,
  onChange,
}: {
  spec: MechanicalSpec;
  onChange: (spec: MechanicalSpec) => void;
}) {
  // Field metadata is limited to known numeric spec keys; validation remains authoritative.
  const field = (key: string, label: string, positive = true) => {
    const v = Object.getOwnPropertyDescriptor(spec, key)?.value;
    return typeof v === "number" ? (
      <Numeric
        key={key}
        label={label}
        value={v}
        positive={positive}
        onCommit={(value) => onChange({ ...spec, [key]: value })}
      />
    ) : null;
  };
  let fields: [string, string, boolean?][] = [];
  switch (spec.kind) {
    case "enclosure":
      fields = [
        ["width", "Enclosure width (mm)"],
        ["depth", "Enclosure depth (mm)"],
        ["height", "Enclosure height (mm)"],
        ["wall", "Enclosure wall (mm)"],
        ["corner", "Enclosure corner radius (mm)", false],
        ["inset", "Mounting inset (mm)"],
        ["postDiameter", "Post diameter (mm)"],
        ["postHeight", "Post height (mm)"],
        ["holeDiameter", "Post hole diameter (mm)"],
      ];
      break;
    case "spacer":
    case "standoff":
      fields = [
        ["outer", "Outer diameter (mm)"],
        ["inner", "Bore diameter (mm)", false],
        ["height", "Template height (mm)"],
        ...(spec.kind === "standoff"
          ? ([
              ["baseDiameter", "Base diameter (mm)"],
              ["baseHeight", "Base height (mm)"],
            ] as [string, string][])
          : []),
      ];
      break;
    case "hole":
      fields = [
        ["diameter", "Nominal hole diameter (mm)"],
        ["clearance", "Hole allowance (mm)", false],
        ["depth", "Hole cutter depth (mm)"],
        ["headDiameter", "Head recess diameter (mm)"],
        ["headDepth", "Counterbore depth (mm)"],
        ["angle", "Countersink angle (degrees)"],
      ];
      break;
    case "mounting-tab":
      fields = [
        ["width", "Tab width (mm)"],
        ["depth", "Tab depth (mm)"],
        ["height", "Tab thickness (mm)"],
        ["corner", "Tab corner radius (mm)", false],
        ["holeDiameter", "Tab hole diameter (mm)"],
        ["holeX", "Tab hole X (mm)", false],
      ];
      break;
    case "alignment-pin":
      fields = [
        ["diameter", "Pin diameter (mm)"],
        ["height", "Pin height (mm)"],
        ["tipDiameter", "Pin tip diameter (mm)"],
        ["tipHeight", "Pin tip height (mm)"],
      ];
      break;
    case "snap-reference":
      fields = [
        ["length", "Beam length (mm)"],
        ["width", "Beam width (mm)"],
        ["thickness", "Beam thickness (mm)"],
        ["latchHeight", "Latch height (mm)"],
        ["latchLength", "Latch length (mm)"],
      ];
      break;
  }
  return (
    <section>
      <h2>{templateNames[spec.kind]}</h2>
      {spec.kind === "enclosure" && (
        <>
          <label>
            <input
              type="checkbox"
              aria-label="Enclosure mounting posts"
              checked={spec.posts}
              onChange={(e) =>
                onChange({
                  ...spec,
                  posts: e.target.checked,
                  holes: e.target.checked ? spec.holes : false,
                })
              }
            />
            Four mounting posts
          </label>
          <label>
            <input
              type="checkbox"
              aria-label="Enclosure post holes"
              disabled={!spec.posts}
              checked={spec.holes}
              onChange={(e) => onChange({ ...spec, holes: e.target.checked })}
            />
            Through-holes in posts and floor
          </label>
          <p>
            Posts follow the outer width/depth at the specified inset. All four
            share dimensions.
          </p>
        </>
      )}
      {spec.kind === "hole" && (
        <label>
          Hole cutter style
          <select
            aria-label="Hole cutter style"
            value={spec.style}
            onChange={(e) =>
              onChange({
                ...spec,
                style: e.target.value as
                  | "clearance"
                  | "counterbore"
                  | "countersink",
              })
            }
          >
            {["clearance", "counterbore", "countersink"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
      )}
      {fields.map(([key, label, positive]) =>
        field(key, label, positive ?? true),
      )}
      {spec.kind === "snap-reference" && (
        <p>
          Geometry reference only. Flexibility, fatigue and material suitability
          have not been mechanically validated.
        </p>
      )}
    </section>
  );
}
