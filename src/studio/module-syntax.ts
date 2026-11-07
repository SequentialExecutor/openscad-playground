import type { WorkspaceCode } from "./workspace-code";
/** An isolated parse-only worker: definitions do not need a top-level invocation. */
export async function validateModuleSyntax(
  code: WorkspaceCode,
  signal: AbortSignal,
): Promise<void> {
  const { spawnOpenSCAD } = await import("../runner/openscad-runner");
  if (signal.aborted) throw Error("Module review canceled.");
  const task = spawnOpenSCAD(
    {
      mountArchives: false,
      inputs: code.params.sources,
      args: [
        code.params.activePath,
        "-o",
        "/module-parameters.json",
        "--export-format=param",
      ],
      outputPaths: ["/module-parameters.json"],
    },
    () => {},
  );
  let timer: ReturnType<typeof setTimeout> | undefined,
    cancel: (() => void) | undefined;
  try {
    const result = await Promise.race([
      task,
      new Promise<never>((_, reject) => {
        cancel = () => {
          task.kill();
          reject(Error("Module review canceled."));
        };
        signal.addEventListener("abort", cancel, { once: true });
        timer = setTimeout(() => {
          task.kill();
          reject(Error("Module syntax validation exceeded 30 seconds."));
        }, 30000);
      }),
    ]);
    const errors = result.mergedOutputs
      .map((o) => o.stderr ?? o.error ?? "")
      .filter((t) => /\bERROR\b|Parser error|syntax error/i.test(t));
    if (result.error || result.exitCode || errors.length)
      throw Error(
        `Module syntax is invalid: ${errors.join("\n") || result.error || "OpenSCAD could not parse the source."}`,
      );
  } finally {
    if (timer) clearTimeout(timer);
    if (cancel) signal.removeEventListener("abort", cancel);
  }
}
