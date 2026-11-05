import React, { useEffect, useState } from "react";
import Numeric from "./Numeric";
import { Body, Feature, Vec3 } from "./document";
import { ModelingFeature, ModelingOperation, modelingNames } from "./advanced";
type Node = Body | Feature;
export function ModelingTools({
  nodes,
  roots,
  selected,
  onCreate,
}: {
  nodes: Node[];
  roots: string[];
  selected?: string;
  onCreate: (op: ModelingOperation, inputs: string[]) => void;
}) {
  const [input, setInput] = useState(""),
    [members, setMembers] = useState<string[]>([]);
  useEffect(() => {
    if (selected && nodes.some((n) => n.id === selected)) setInput(selected);
  }, [selected]);
  useEffect(() => {
    if (!nodes.some((n) => n.id === input)) setInput(nodes[0]?.id ?? "");
  }, [nodes, input]);
  return (
    <details className="studio-modeling">
      <summary>Advanced modeling</summary>
      <label>
        Source
        <select
          aria-label="Modeling source"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        >
          {nodes.map((n) => (
            <option key={n.id} value={n.id}>
              {n.name}
            </option>
          ))}
        </select>
      </label>
      <div className="studio-primitives">
        {(Object.keys(modelingNames) as ModelingOperation[])
          .filter((op) => op !== "group")
          .map((op) => (
            <button
              key={op}
              disabled={!input}
              onClick={() => onCreate(op, [input])}
            >
              {modelingNames[op]}
            </button>
          ))}
      </div>
      <p>
        Offset/revolution use sketches. Shell supports convex profiles. Box
        fillet/chamfer treat all four vertical edges.
      </p>
      <h2>Group roots</h2>
      {nodes
        .filter((n) => roots.includes(n.id))
        .map((n) => (
          <label key={n.id}>
            <input
              type="checkbox"
              aria-label={`Group ${n.name}`}
              checked={members.includes(n.id)}
              onChange={(e) =>
                setMembers(
                  e.target.checked
                    ? [...members, n.id]
                    : members.filter((id) => id !== n.id),
                )
              }
            />
            {n.name}
          </label>
        ))}
      <button
        disabled={!members.some((id) => roots.includes(id))}
        onClick={() =>
          onCreate(
            "group",
            members.filter((id) => roots.includes(id)),
          )
        }
      >
        Group selected roots
      </button>
    </details>
  );
}
export function ModelingInspector({
  feature: f,
  nodes,
  onChange,
  onRemove,
}: {
  feature: ModelingFeature;
  nodes: Node[];
  onChange: (f: ModelingFeature) => void;
  onRemove: () => void;
}) {
  const axis = (value: "X" | "Y" | "Z", set: (a: "X" | "Y" | "Z") => void) => (
    <label>
      Axis
      <select
        aria-label="Modeling axis"
        value={value}
        onChange={(e) => set(e.target.value as "X" | "Y" | "Z")}
      >
        {["X", "Y", "Z"].map((a) => (
          <option key={a}>{a}</option>
        ))}
      </select>
    </label>
  );
  return (
    <section>
      <h2>{modelingNames[f.operation]}</h2>
      <label>
        Name
        <input
          aria-label="Modeling feature name"
          key={`${f.id}:${f.name}`}
          defaultValue={f.name}
          disabled={f.locked}
          maxLength={200}
          onBlur={(e) => onChange({ ...f, name: e.target.value })}
        />
      </label>
      <fieldset disabled={f.locked}>
        {f.inputs.map((id, i) => (
          <label key={i}>
            Source {i + 1}
            <select
              aria-label={`Modeling operand ${i + 1}`}
              value={id}
              onChange={(e) => {
                const inputs = [...f.inputs];
                inputs[i] = e.target.value;
                onChange({ ...f, inputs });
              }}
            >
              {nodes
                .filter((n) => n.id !== f.id)
                .map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name}
                  </option>
                ))}
            </select>
          </label>
        ))}
        {f.operation === "mirror" && (
          <>
            {axis(f.spec.axis, (axis) =>
              onChange({ ...f, spec: { ...f.spec, axis } }),
            )}
            <Numeric
              label="Mirror plane offset (mm)"
              value={f.spec.offset}
              onCommit={(offset) =>
                onChange({ ...f, spec: { ...f.spec, offset } })
              }
            />
            <label>
              <input
                type="checkbox"
                aria-label="Keep mirror original"
                checked={f.spec.keepOriginal}
                onChange={(e) =>
                  onChange({
                    ...f,
                    spec: { ...f.spec, keepOriginal: e.target.checked },
                  })
                }
              />
              Keep original
            </label>
          </>
        )}
        {f.operation === "linear-pattern" && (
          <>
            <Numeric
              label="Pattern count"
              value={f.spec.count}
              positive
              max={100}
              onCommit={(count) =>
                onChange({ ...f, spec: { ...f.spec, count } })
              }
            />
            {f.spec.step.map((n, i) => (
              <Numeric
                key={i}
                label={`Pattern step ${"XYZ"[i]} (mm)`}
                value={n}
                onCommit={(value) => {
                  const step = [...f.spec.step] as Vec3;
                  step[i] = value;
                  onChange({ ...f, spec: { ...f.spec, step } });
                }}
              />
            ))}
          </>
        )}
        {f.operation === "circular-pattern" && (
          <>
            <Numeric
              label="Pattern count"
              value={f.spec.count}
              positive
              max={100}
              onCommit={(count) =>
                onChange({ ...f, spec: { ...f.spec, count } })
              }
            />
            <Numeric
              label="Pattern sweep (degrees)"
              value={f.spec.angle}
              positive
              max={360}
              onCommit={(angle) =>
                onChange({ ...f, spec: { ...f.spec, angle } })
              }
            />
            {axis(f.spec.axis, (axis) =>
              onChange({ ...f, spec: { ...f.spec, axis } }),
            )}
            <p>
              Rotates about the world origin. Move the source off-axis first. A
              360° pattern does not repeat its endpoint.
            </p>
          </>
        )}
        {f.operation === "profile-offset" && (
          <>
            <Numeric
              label="Profile offset (mm)"
              value={f.spec.distance}
              onCommit={(distance) =>
                onChange({ ...f, spec: { ...f.spec, distance } })
              }
            />
            <label>
              Join
              <select
                aria-label="Offset join"
                value={f.spec.join}
                onChange={(e) =>
                  onChange({
                    ...f,
                    spec: {
                      ...f.spec,
                      join: e.target.value as "round" | "miter" | "chamfer",
                    },
                  })
                }
              >
                {["round", "miter", "chamfer"].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <p>
              Offsets the source sketch before linear extrusion. Negative
              offsets can collapse a profile and report an evaluation error.
            </p>
          </>
        )}
        {f.operation === "revolve" && (
          <>
            <Numeric
              label="Revolution angle (degrees)"
              value={f.spec.angle}
              positive
              max={360}
              onCommit={(angle) => onChange({ ...f, spec: { angle } })}
            />
            <p>
              XY sketch X is radius, Y is height. The profile must stay on X ≥
              0. Linear extrusion height is not used.
            </p>
          </>
        )}
        {f.operation === "shell" && (
          <>
            <Numeric
              label="Shell wall (mm)"
              value={f.spec.wall}
              positive
              onCommit={(wall) => onChange({ ...f, spec: { ...f.spec, wall } })}
            />
            <label>
              <input
                type="checkbox"
                aria-label="Open shell top"
                checked={f.spec.openTop}
                onChange={(e) =>
                  onChange({
                    ...f,
                    spec: { ...f.spec, openTop: e.target.checked },
                  })
                }
              />
              Open extrusion end
            </label>
            <p>
              Wall is measured in the source's local units before scaling.
              Convex box/circular profiles only; transform the final shell.
            </p>
          </>
        )}
        {(f.operation === "fillet" || f.operation === "chamfer") && (
          <>
            <Numeric
              label={
                f.operation === "fillet"
                  ? "Vertical edge radius (mm)"
                  : "Vertical edge setback (mm)"
              }
              value={f.spec.radius}
              positive
              onCommit={(radius) => onChange({ ...f, spec: { radius } })}
            />
            <p>
              Treats the four vertical edges of a box, keeping its outer bounds.
              This is not an arbitrary-edge operation.
            </p>
          </>
        )}
        <h2>Result transform</h2>
        <p>
          Pivot: world origin. Transform the result without editing its source.
        </p>
        {(["position", "rotation", "scale"] as const).map((key) => (
          <div className="studio-values" key={key}>
            {f[key].map((n, i) => (
              <Numeric
                key={i}
                label={`Result ${key} ${"XYZ"[i]}`}
                value={n}
                positive={key === "scale"}
                onCommit={(value) => {
                  const v = [...f[key]] as Vec3;
                  v[i] = value;
                  onChange({ ...f, [key]: v });
                }}
              />
            ))}
          </div>
        ))}
      </fieldset>
      <button onClick={() => onChange({ ...f, locked: !f.locked })}>
        {f.locked ? "Unlock result" : "Lock result"}
      </button>
      <button disabled={f.locked} onClick={onRemove}>
        Remove modeling feature
      </button>
    </section>
  );
}
