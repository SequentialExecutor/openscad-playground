import { useEffect, useRef, useState } from "react";
import { Design, generateScad, rootNodes, isTransformable } from "./document";
import { evaluateExact } from "./evaluate";
export interface FeatureMesh {
  source: string;
  data: ArrayBuffer;
}
/** Hide invalidated results immediately; cache only exact outputs for identical source. */
export function useFeatureMeshes(design: Design, selected?: string) {
  const [meshes, setMeshes] = useState<Record<string, FeatureMesh>>({});
  const [progress, setProgress] = useState("");
  const cache = useRef(new Map<string, ArrayBuffer>());
  const roots = rootNodes(design).filter(
    (node) =>
      "inputs" in node || node.kind === "extrusion" || node.kind === "template",
  );
  const operand = [...design.bodies, ...design.features].find(
    (n) =>
      n.id === selected &&
      n.visible &&
      ("inputs" in n || n.kind === "extrusion" || n.kind === "template"),
  );
  if (operand && !roots.some((n) => n.id === operand.id)) roots.push(operand);
  const sources = roots.map((node) => ({
    id: node.id,
    source: generateScad(
      isTransformable(node)
        ? {
            ...design,
            bodies: design.bodies.map((b) =>
              b.id === node.id
                ? {
                    ...b,
                    position: [0, 0, 0],
                    rotation: [0, 0, 0],
                    scale: [1, 1, 1],
                  }
                : b,
            ),
            features: design.features.map((f) =>
              f.id === node.id && isTransformable(f)
                ? {
                    ...f,
                    position: [0, 0, 0],
                    rotation: [0, 0, 0],
                    scale: [1, 1, 1],
                  }
                : f,
            ),
          }
        : design,
      [node.id],
    ),
  }));
  const key = JSON.stringify(sources);
  useEffect(() => {
    let active = true;
    let job: ReturnType<typeof evaluateExact> | undefined;
    const pending: Record<string, FeatureMesh> = Object.create(null);
    for (const { id, source } of sources) {
      const data = cache.current.get(source);
      if (data) pending[id] = { source, data };
    }
    const timer = setTimeout(async () => {
      for (let i = 0; i < sources.length; i++) {
        const { id, source } = sources[i];
        if (!active) return;
        setProgress(`Evaluating exact feature ${i + 1} of ${sources.length}…`);
        try {
          let data = cache.current.get(source);
          if (!data) {
            job = evaluateExact(source, "display", design.meshAssets);
            data = (await job.promise).data;
            if (!active) return;
            cache.current.set(source, data);
            while (
              cache.current.size > 16 ||
              [...cache.current.values()].reduce(
                (sum, b) => sum + b.byteLength,
                0,
              ) >
                32 * 1024 * 1024
            )
              cache.current.delete(cache.current.keys().next().value!);
          }
          pending[id] = { source, data };
          if (active) setMeshes({ ...pending });
        } catch (e) {
          if (active) {
            setProgress(
              `Geometry evaluation failed (the result may be empty): ${e}`,
            );
            return;
          }
        }
      }
      if (active)
        setProgress(sources.length ? "Exact geometry up to date" : "");
    }, 350);
    setMeshes({ ...pending });
    setProgress(
      sources.length
        ? Object.keys(pending).length === sources.length
          ? "Exact geometry up to date"
          : "Waiting for exact geometry…"
        : "",
    );
    return () => {
      active = false;
      clearTimeout(timer);
      job?.cancel();
    };
  }, [key]);
  const current: Record<string, ArrayBuffer> = Object.create(null);
  for (const { id, source } of sources)
    if (meshes[id]?.source === source) current[id] = meshes[id].data;
  return { meshes: current, progress };
}
