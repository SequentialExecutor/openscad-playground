import React, { useEffect, useState } from "react";
import { Body, Feature } from "./document";
export interface PositionAction {
  kind: "align" | "distribute" | "center" | "plate";
  target: string;
  reference: string;
  axis: number;
  anchor: "min" | "center" | "max";
  mode: "centers" | "gaps";
  members: string[];
}
export default function PositioningTools({
  nodes,
  roots,
  selected,
  busy,
  onAction,
}: {
  nodes: (Body | Feature)[];
  roots: string[];
  selected?: string;
  busy: boolean;
  onAction: (action: PositionAction) => void;
}) {
  const [target, setTarget] = useState(""),
    [reference, setReference] = useState(""),
    [axis, setAxis] = useState(0),
    [anchor, setAnchor] = useState<"min" | "center" | "max">("center"),
    [mode, setMode] = useState<"centers" | "gaps">("gaps"),
    [members, setMembers] = useState<string[]>([]);
  useEffect(() => {
    if (selected && nodes.some((n) => n.id === selected)) setTarget(selected);
  }, [selected]);
  useEffect(() => {
    if (!nodes.some((n) => n.id === target)) setTarget(nodes[0]?.id ?? "");
    if (!nodes.some((n) => n.id === reference))
      setReference(nodes[1]?.id ?? "");
  }, [nodes, target, reference]);
  const action = (kind: PositionAction["kind"]) =>
    onAction({
      kind,
      target,
      reference,
      axis,
      anchor,
      mode,
      members: members.filter((id) => roots.includes(id)),
    });
  return (
    <details>
      <summary>Align & distribute</summary>
      <label>
        Target
        <select
          aria-label="Positioning target"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
        >
          {nodes.map((n) => (
            <option key={n.id} value={n.id}>
              {n.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Reference
        <select
          aria-label="Positioning reference"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
        >
          {nodes.map((n) => (
            <option key={n.id} value={n.id}>
              {n.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Axis
        <select
          aria-label="Positioning axis"
          value={axis}
          onChange={(e) => setAxis(Number(e.target.value))}
        >
          {["X", "Y", "Z"].map((a, i) => (
            <option key={a} value={i}>
              {a}
            </option>
          ))}
        </select>
      </label>
      <select
        aria-label="Alignment anchor"
        value={anchor}
        onChange={(e) => setAnchor(e.target.value as typeof anchor)}
      >
        {["min", "center", "max"].map((v) => (
          <option key={v}>{v}</option>
        ))}
      </select>
      <button
        disabled={busy || !target || !reference || target === reference}
        onClick={() => action("align")}
      >
        Align bounds
      </button>
      <button disabled={busy || !target} onClick={() => action("center")}>
        Center on origin
      </button>
      <button disabled={busy || !target} onClick={() => action("plate")}>
        Place on build plate
      </button>
      <h2>Distribute roots</h2>
      {nodes
        .filter((n) => roots.includes(n.id))
        .map((n) => (
          <label key={n.id}>
            <input
              type="checkbox"
              aria-label={`Distribute ${n.name}`}
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
      <select
        aria-label="Distribution mode"
        value={mode}
        onChange={(e) => setMode(e.target.value as typeof mode)}
      >
        <option value="gaps">Equal gaps, keep outer objects fixed</option>
        <option value="centers">Equal centers (may overlap)</option>
      </select>
      <button
        disabled={busy || members.filter((id) => roots.includes(id)).length < 3}
        onClick={() => action("distribute")}
      >
        Distribute bounds
      </button>
      <p>
        Measures actual evaluated geometry. Dependent references are rejected;
        outer distributed objects remain fixed.
      </p>
    </details>
  );
}
