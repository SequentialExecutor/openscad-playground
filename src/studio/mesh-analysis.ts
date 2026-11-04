/** Millimeter STL inspection. Topology welding uses a documented 0.00001 mm tolerance. */
export interface PrintSettings {
  build: [number, number, number];
  nozzle: number;
  layer: number;
  minimumWall: number;
  overhang: number;
}
export const defaultPrintSettings: PrintSettings = {
  build: [220, 220, 250],
  nozzle: 0.4,
  layer: 0.2,
  minimumWall: 0.8,
  overhang: 45,
};
export interface MeshAnalysis {
  triangles: number;
  bounds: { min: number[]; max: number[]; size: number[] };
  boundaryEdges: number;
  nonManifoldEdges: number;
  inconsistentEdges: number;
  degenerateTriangles: number;
  duplicateTriangles: number;
  invalidTriangles: number;
  shells: number;
  closed: boolean;
  volume?: number;
  surfaceArea: number;
  outsideBuildVolume: boolean;
  warnings: string[];
}
export function validatePrintSettings(s: PrintSettings): void {
  if (
    !s ||
    !Array.isArray(s.build) ||
    s.build.length !== 3 ||
    !s.build.every((n) => Number.isFinite(n) && n > 0 && n <= 1e6) ||
    ![s.nozzle, s.layer, s.minimumWall].every(
      (n) => Number.isFinite(n) && n > 0 && n <= 1000,
    ) ||
    !Number.isFinite(s.overhang) ||
    s.overhang <= 0 ||
    s.overhang >= 90
  )
    throw Error("Invalid printer settings.");
}
export function analyzeStl(
  buffer: ArrayBuffer,
  settings: PrintSettings = defaultPrintSettings,
): MeshAnalysis {
  validatePrintSettings(settings);
  if (buffer.byteLength < 84) throw Error("Invalid binary STL.");
  const data = new DataView(buffer),
    count = data.getUint32(80, true);
  if (!count || count > 250000 || buffer.byteLength !== 84 + count * 50)
    throw Error(
      "Analysis requires a nonempty binary STL with at most 250,000 triangles.",
    );
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  const vertices = new Map<string, number>(),
    faces = new Set<string>();
  const edges = new Map<
    string,
    { count: number; direction: number; triangle: number }
  >();
  const parent = Array.from({ length: count }, (_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const connect = (a: number, b: number) => {
    a = find(a);
    b = find(b);
    if (a !== b) parent[b] = a;
  };
  const validTriangles: number[] = [];
  const triangleFloor: number[] = [];
  let signedVolume = 0,
    area = 0,
    invalid = 0,
    degenerate = 0,
    duplicates = 0,
    overhangArea = 0;
  for (let t = 0; t < count; t++) {
    const p = Array.from({ length: 3 }, (_, v) =>
      [0, 1, 2].map((a) =>
        data.getFloat32(84 + t * 50 + 12 + v * 12 + a * 4, true),
      ),
    );
    if (!p.flat().every(Number.isFinite)) {
      invalid++;
      continue;
    }
    p.forEach((v) =>
      v.forEach((n, a) => {
        min[a] = Math.min(min[a], n);
        max[a] = Math.max(max[a], n);
      }),
    );
    const a = p[1].map((n, i) => n - p[0][i]),
      b = p[2].map((n, i) => n - p[0][i]);
    const cross = [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
      ],
      doubleArea = Math.hypot(...cross);
    if (doubleArea <= 1e-12) {
      degenerate++;
      continue;
    }
    area += doubleArea / 2;
    if (
      cross[2] / doubleArea < -Math.cos((settings.overhang * Math.PI) / 180) &&
      Math.min(...p.map((v) => v[2])) > settings.layer
    )
      overhangArea += doubleArea / 2;
    const ids = p.map((v) => {
      const key = v.map((n) => Math.round(n / 1e-5)).join(",");
      let id = vertices.get(key);
      if (id === undefined) {
        id = vertices.size;
        vertices.set(key, id);
      }
      return id;
    });
    if (new Set(ids).size < 3) {
      degenerate++;
      continue;
    }
    const faceKey = [...ids].sort((a, b) => a - b).join(",");
    if (faces.has(faceKey)) duplicates++;
    else faces.add(faceKey);
    for (let i = 0; i < 3; i++) {
      const from = ids[i],
        to = ids[(i + 1) % 3],
        key = from < to ? `${from},${to}` : `${to},${from}`;
      const edge = edges.get(key);
      if (edge) {
        edge.count++;
        edge.direction += from < to ? 1 : -1;
        connect(t, edge.triangle);
      } else
        edges.set(key, {
          count: 1,
          direction: from < to ? 1 : -1,
          triangle: t,
        });
    }
    const [u, v, w] = p;
    signedVolume +=
      (u[0] * (v[1] * w[2] - v[2] * w[1]) +
        u[1] * (v[2] * w[0] - v[0] * w[2]) +
        u[2] * (v[0] * w[1] - v[1] * w[0])) /
      6;
    validTriangles.push(t);
    triangleFloor[t] = Math.min(...p.map((v) => v[2]));
  }
  const boundaryEdges = [...edges.values()].filter((e) => e.count === 1).length;
  const nonManifoldEdges = [...edges.values()].filter(
    (e) => e.count > 2,
  ).length;
  const inconsistentEdges = [...edges.values()].filter(
    (e) => e.count === 2 && e.direction !== 0,
  ).length;
  const shells = new Map<number, number>();
  for (const t of validTriangles) {
    const id = find(t);
    shells.set(id, Math.min(shells.get(id) ?? Infinity, triangleFloor[t]));
  }
  if (!min.every(Number.isFinite)) {
    min.fill(0);
    max.fill(0);
  }
  const size = max.map((n, i) => n - min[i]);
  const outside =
    min[0] < -settings.build[0] / 2 - 1e-5 ||
    max[0] > settings.build[0] / 2 + 1e-5 ||
    min[1] < -settings.build[1] / 2 - 1e-5 ||
    max[1] > settings.build[1] / 2 + 1e-5 ||
    min[2] < -1e-5 ||
    max[2] > settings.build[2] + 1e-5;
  const closed =
    validTriangles.length > 0 &&
    !boundaryEdges &&
    !nonManifoldEdges &&
    !inconsistentEdges &&
    !invalid &&
    !degenerate &&
    !duplicates;
  const warnings: string[] = [];
  if (outside)
    warnings.push(
      `Geometry exceeds the centered ${settings.build.join(" × ")} mm build volume (Z starts at zero).`,
    );
  if (size.some((n) => n < settings.minimumWall))
    warnings.push(
      `A bounding dimension is below the suggested ${settings.minimumWall} mm wall thickness. Internal walls are not measured.`,
    );
  if (overhangArea > 0)
    warnings.push(
      `Heuristic: ${overhangArea.toFixed(1)} mm² of downward-facing surface exceeds ${settings.overhang}° above layer ${settings.layer} mm. Supports depend on orientation and slicer settings.`,
    );
  const elevated = [...shells.values()].filter(
    (z) => z > settings.layer,
  ).length;
  if (elevated)
    warnings.push(
      `Heuristic: ${elevated} disconnected shell(s) start above the first ${settings.layer} mm layer.`,
    );
  if (settings.layer > settings.nozzle * 0.8)
    warnings.push(
      `Layer height ${settings.layer} mm exceeds 80% of nozzle diameter ${settings.nozzle} mm; review your printer's recommendations.`,
    );
  if (shells.size > 1)
    warnings.push(
      "Multiple shells: signed volume assumes consistent material/cavity winding; intersections between shells are not tested.",
    );
  if (!closed)
    warnings.push(
      "Mesh topology contains defects; volume is not reported. No automatic repair was applied.",
    );
  return {
    triangles: count,
    bounds: { min, max, size },
    boundaryEdges,
    nonManifoldEdges,
    inconsistentEdges,
    degenerateTriangles: degenerate,
    duplicateTriangles: duplicates,
    invalidTriangles: invalid,
    shells: shells.size,
    closed,
    volume: closed ? Math.abs(signedVolume) : undefined,
    surfaceArea: area,
    outsideBuildVolume: outside,
    warnings,
  };
}
