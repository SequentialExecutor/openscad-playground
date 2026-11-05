export interface Bounds {
  min: number[];
  max: number[];
}
export function stlBounds(data: ArrayBuffer): Bounds {
  if (data.byteLength < 84) throw Error("Invalid STL bounds input.");
  const v = new DataView(data),
    count = v.getUint32(80, true);
  if (data.byteLength !== 84 + count * 50 || !count)
    throw Error("Invalid STL bounds input.");
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  for (let t = 0; t < count; t++)
    for (let vertex = 0; vertex < 3; vertex++)
      for (let axis = 0; axis < 3; axis++) {
        const n = v.getFloat32(84 + t * 50 + 12 + vertex * 12 + axis * 4, true);
        if (!Number.isFinite(n)) throw Error("Nonfinite mesh bounds.");
        min[axis] = Math.min(min[axis], n);
        max[axis] = Math.max(max[axis], n);
      }
  return { min, max };
}
