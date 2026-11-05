import { MeshAsset, meshInfo, meshSources } from "./mesh-asset";
/** Separate display/export scheduling slots; cancellation always settles the caller. */
export function evaluateExact(
  source: string,
  channel: "display" | "export",
  assets: MeshAsset[] = [],
) {
  const cancellation =
    channel === "export" ? "Export canceled." : "Evaluation canceled.";
  let canceled = false;
  let killWorker: (() => void) | undefined;
  let rejectCancel: (reason: Error) => void = () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  const interrupted = new Promise<never>((_, reject) => {
    rejectCancel = reject;
  });
  const work = (async () => {
    const sources = meshSources(source, assets);
    for (const a of assets)
      if (
        sources.some((s) => s.path === `/meshes/${a.id}.stl`) &&
        !meshInfo(a).report.closed
      )
        throw Error(
          "Exact solid evaluation requires closed imported mesh edge topology. Review import diagnostics; no automatic repair is applied.",
        );
    const actions = await import("../runner/actions");
    if (canceled) throw Error(cancellation);
    const run = channel === "display" ? actions.render : actions.renderIsolated;
    const task = run({
      scadPath: "/forma.scad",
      sources: [{ path: "/forma.scad", content: source }, ...sources],
      isPreview: false,
      mountArchives: false,
      renderFormat: "stl",
      streamsCallback: () => {},
    })({ now: true });
    killWorker = () => task.kill();
    timer = setTimeout(() => {
      task.kill();
      rejectCancel(Error("Exact evaluation exceeded 60 seconds."));
    }, 60000);
    const result = await task;
    const data = await result.outFile.arrayBuffer();
    inspectStl(data);
    return { file: result.outFile, data };
  })();
  const promise = Promise.race([work, interrupted]).finally(() =>
    clearTimeout(timer),
  );
  return {
    promise,
    cancel: () => {
      canceled = true;
      killWorker?.();
      rejectCancel(Error(cancellation));
    },
  };
}
export function inspectStl(data: ArrayBuffer): number {
  const view = new DataView(data);
  if (data.byteLength < 84 || data.byteLength > 128 * 1024 * 1024)
    throw Error("Empty, oversized or malformed binary STL.");
  const count = view.getUint32(80, true);
  if (!count || data.byteLength !== 84 + count * 50)
    throw Error("Empty or malformed binary STL.");
  for (let offset = 84; offset < data.byteLength; offset += 50) {
    const points = Array.from({ length: 3 }, (_, v) =>
      [0, 1, 2].map((axis) =>
        view.getFloat32(offset + 12 + v * 12 + axis * 4, true),
      ),
    );
    if (!points.flat().every(Number.isFinite))
      throw Error("Nonfinite mesh coordinates.");
    const a = points[1].map((n, i) => n - points[0][i]),
      b = points[2].map((n, i) => n - points[0][i]);
    if (
      Math.hypot(
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
      ) === 0
    )
      throw Error("Degenerate mesh triangle.");
  }
  return count;
}
