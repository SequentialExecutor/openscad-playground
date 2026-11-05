import { Design, isTransformable, validateDesign } from "./document";
import { createModelingFeature } from "./advanced";
export interface Bounds {
  min: number[];
  max: number[];
}
export { stlBounds } from "./bounds";
export function translated(
  d: Design,
  moves: { id: string; delta: [number, number, number] }[],
): Design {
  const next = structuredClone(d);
  for (const { id, delta } of moves) {
    const b = next.bodies.find((b) => b.id === id),
      f = next.features.find((f) => f.id === id);
    const node = b ?? f;
    if (!node) throw Error("Positioning target is missing.");
    if (isTransformable(node)) {
      if (node.locked) throw Error("Unlock the positioning target first.");
      node.position = node.position.map((n, i) => n + delta[i]) as [
        number,
        number,
        number,
      ];
    } else {
      const wrapper = createModelingFeature("group", [id]);
      wrapper.name = "Positioned result";
      wrapper.position = delta;
      next.features.push(wrapper);
    }
  }
  return validateDesign(next);
}
export function independentReference(
  d: Design,
  target: string,
  reference: string,
): void {
  if (target === reference)
    throw Error("Choose different target and reference.");
  const features = new Map(d.features.map((f) => [f.id, f]));
  const visit = (id: string): boolean =>
    id === target || (features.get(id)?.inputs.some(visit) ?? false);
  if (visit(reference))
    throw Error(
      "Reference depends on the target; align independent objects instead.",
    );
}
export function distribution(
  bounds: { id: string; bounds: Bounds }[],
  axis: number,
  mode: "centers" | "gaps",
): { id: string; delta: [number, number, number] }[] {
  if (bounds.length < 3)
    throw Error("Distribution needs at least three independent roots.");
  const sorted = [...bounds].sort(
    (a, b) =>
      a.bounds.min[axis] +
      a.bounds.max[axis] -
      (b.bounds.min[axis] + b.bounds.max[axis]),
  );
  const first = sorted[0].bounds,
    last = sorted.at(-1)!.bounds;
  const gap =
    (last.max[axis] -
      first.min[axis] -
      sorted.reduce(
        (sum, n) => sum + n.bounds.max[axis] - n.bounds.min[axis],
        0,
      )) /
    (sorted.length - 1);
  if (mode === "gaps" && gap < 0)
    throw Error(
      "Move the outer objects apart to allow non-overlapping equal gaps.",
    );
  let edge = first.max[axis] + gap;
  return sorted.slice(1, -1).map((item, i) => {
    const center =
      (first.min[axis] + first.max[axis]) / 2 +
      ((i + 1) *
        ((last.min[axis] + last.max[axis] - first.min[axis] - first.max[axis]) /
          2)) /
        (sorted.length - 1);
    const delta: [number, number, number] = [0, 0, 0];
    delta[axis] =
      mode === "centers"
        ? center - (item.bounds.min[axis] + item.bounds.max[axis]) / 2
        : edge - item.bounds.min[axis];
    edge += item.bounds.max[axis] - item.bounds.min[axis] + gap;
    return { id: item.id, delta };
  });
}
