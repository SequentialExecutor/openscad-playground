import React, { useEffect, useState } from "react";
import { Body, BooleanFeature, BooleanOperation } from "./document";
type Node = Body | BooleanFeature;
export function BooleanTools({
  nodes,
  onCreate,
}: {
  nodes: Node[];
  onCreate: (operation: BooleanOperation, inputs: [string, string]) => void;
}) {
  const [first, setFirst] = useState(""),
    [second, setSecond] = useState("");
  useEffect(() => {
    if (!nodes.some((n) => n.id === first)) setFirst(nodes[0]?.id ?? "");
    if (!nodes.some((n) => n.id === second)) setSecond(nodes[1]?.id ?? "");
  }, [nodes, first, second]);
  return (
    <section>
      <h2>Boolean modeling</h2>
      <label>
        Base / first operand
        <select
          aria-label="Boolean base"
          value={first}
          onChange={(e) => setFirst(e.target.value)}
        >
          {nodes.map((n) => (
            <option key={n.id} value={n.id}>
              {n.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Tool / second operand
        <select
          aria-label="Boolean tool"
          value={second}
          onChange={(e) => setSecond(e.target.value)}
        >
          {nodes.map((n) => (
            <option key={n.id} value={n.id}>
              {n.name}
            </option>
          ))}
        </select>
      </label>
      <div className="studio-primitives">
        {(["union", "difference", "intersection"] as const).map((op) => (
          <button
            key={op}
            disabled={!first || !second || first === second}
            onClick={() => onCreate(op, [first, second])}
          >
            {op[0].toUpperCase() + op.slice(1)}
          </button>
        ))}
      </div>
      <p className="studio-muted">
        Difference cuts the second operand from the first. Both remain editable
        in Objects.
      </p>
    </section>
  );
}
export function BooleanInspector({
  feature,
  nodes,
  onChange,
  onRemove,
}: {
  feature: BooleanFeature;
  nodes: Node[];
  onChange: (feature: BooleanFeature) => void;
  onRemove: () => void;
}) {
  return (
    <section>
      <h2>Boolean feature</h2>
      <label>
        Name
        <input
          aria-label="Feature name"
          key={`${feature.id}:${feature.name}`}
          defaultValue={feature.name}
          maxLength={200}
          onBlur={(e) => onChange({ ...feature, name: e.target.value })}
        />
      </label>
      <label>
        Operation
        <select
          aria-label="Feature operation"
          value={feature.operation}
          onChange={(e) =>
            onChange({
              ...feature,
              operation: e.target.value as BooleanOperation,
            })
          }
        >
          {(["union", "difference", "intersection"] as const).map((op) => (
            <option key={op}>{op}</option>
          ))}
        </select>
      </label>
      {feature.inputs.map((id, i) => (
        <label key={i}>
          {i === 0 ? "Base" : "Tool"}
          <select
            aria-label={`Feature operand ${i + 1}`}
            value={id}
            onChange={(e) => {
              const inputs = [...feature.inputs] as [string, string];
              inputs[i] = e.target.value;
              onChange({ ...feature, inputs });
            }}
          >
            {nodes
              .filter((n) => n.id !== feature.id)
              .map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}
                </option>
              ))}
          </select>
        </label>
      ))}
      <p className="studio-muted">
        Select an operand in Objects to edit its dimensions or transform.
        Changes recompute this feature. Removing a boolean releases its
        operands.
      </p>
      <button onClick={onRemove}>Remove boolean</button>
    </section>
  );
}
