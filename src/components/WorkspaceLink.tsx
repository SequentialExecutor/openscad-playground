import { ModuleImportReview, ModuleChoice } from "../studio/ModuleImportReview";
import type { LibraryEntry } from "../studio/module-library";
import React, { useContext, useEffect, useRef, useState } from "react";
import { ModelContext, FSContext } from "./contexts";
import { isMcpMode } from "../state/mcp-mode";
import { fetchSource } from "../utils";
export default function WorkspaceLink({
  onBusyChange,
}: {
  onBusyChange?: (busy: boolean) => void;
}) {
  const model = useContext(ModelContext),
    fs = useContext(FSContext);
  const [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false),
    [saveStatus, setSaveStatus] = useState(
      new URLSearchParams(location.search).has("workspace")
        ? "Shared code saved locally."
        : "",
    );
  const [moduleReview, setModuleReview] = useState<{
    choices: ModuleChoice[];
    resolve: (entries: LibraryEntry[] | null) => void;
  }>();
  const reviewResolver = useRef<
    ((entries: LibraryEntry[] | null) => void) | undefined
  >(undefined);
  const abort = useRef<AbortController | undefined>(undefined);
  const current = useRef(model?.state.params);
  current.current = model?.state.params;
  useEffect(() => {
    const onError = (event: Event) => setStatus((event as CustomEvent).detail);
    const onSave = (event: Event) =>
      setSaveStatus((event as CustomEvent).detail);
    window.addEventListener("forma3d-workspace-save", onSave);
    window.addEventListener("forma3d-workspace-error", onError);
    return () => {
      window.removeEventListener("forma3d-workspace-save", onSave);
      window.removeEventListener("forma3d-workspace-error", onError);
      abort.current?.abort();
      reviewResolver.current?.(null);
    };
  }, []);
  if (!model || !fs || isMcpMode()) return null;
  const switchToVisual = async () => {
    if (busy) return;
    setBusy(true);
    onBusyChange?.(true);
    setStatus("Synchronizing the current code with Visual Design…");
    const controller = new AbortController();
    abort.current = controller;
    try {
      const [
        { designFromCode, codeSignature, sourceWithCodeVariables },
        {
          getWorkspaceSession,
          WorkspaceSession,
          openWorkspaceCode,
          persistedWorkspaceCode,
          workspaceUrl,
        },
      ] = await Promise.all([
        import("../studio/workspace-code"),
        import("../studio/workspace-store"),
      ]);
      const snapshot = persistedWorkspaceCode(model.state),
        signature = codeSignature(snapshot);
      let session = getWorkspaceSession();
      let previous;
      if (session) await session.flush();
      else {
        const { loadRecovery } = await import("../studio/persistence");
        previous = await loadRecovery().catch(() => undefined);
      }
      const result = await designFromCode(
        snapshot,
        (source) => fetchSource(fs, source),
        session?.record.visual,
        session?.record.baseline,
        controller.signal,
      );
      const { parseAuthoredProgram, canonicalScad } = await import(
        "../studio/authored-scad"
      );
      const source = sourceWithCodeVariables(snapshot);
      const program = parseAuthoredProgram(source);
      if (program.declarations.some((d) => d.kind === "module")) {
        const { validateModuleSyntax } = await import(
          "../studio/module-syntax"
        );
        await validateModuleSyntax(snapshot, controller.signal);
        const { loadModuleLibrary, detectedLibraryEntries, saveModuleLibrary } =
          await import("../studio/module-library");
        const library = await loadModuleLibrary();
        let choices = detectedLibraryEntries(
          source,
          library,
          session
            ? sourceWithCodeVariables(session.record.baseline)
            : undefined,
        );
        // Do not offer historical automatic worker aliases as authored library entries.
        if (session && !session.record.visual.authoredSource) {
          const { generateScad } = await import("../studio/document");
          const baseline =
            session.record.baseline.params.sources.find(
              (f) => f.path === session!.record.baseline.params.activePath,
            )?.content ?? "";
          if (
            canonicalScad(baseline) ===
            canonicalScad(generateScad(session.record.visual))
          ) {
            const old = parseAuthoredProgram(baseline).declarations;
            choices = choices.filter(
              (c) =>
                !old.some(
                  (d) =>
                    d.kind === "module" &&
                    d.name === c.entry.name &&
                    program.declarations.some(
                      (p) =>
                        p.kind === "module" &&
                        p.name === d.name &&
                        canonicalScad(p.source) === canonicalScad(d.source),
                    ),
                ),
            );
          }
        }
        if (choices.length) {
          const selected = await new Promise<LibraryEntry[] | null>(
            (resolve) => {
              reviewResolver.current = resolve;
              setModuleReview({ choices, resolve });
              controller.signal.addEventListener("abort", () => resolve(null), {
                once: true,
              });
            },
          );
          reviewResolver.current = undefined;
          setModuleReview(undefined);
          if (selected === null) throw Error("Workspace switch canceled.");
          if (codeSignature({ params: current.current! }) !== signature)
            throw Error(
              "Code changed during review. Switch again to review its current modules.",
            );
          if (selected.length) await saveModuleLibrary(library, selected);
        }
      }
      if (controller.signal.aborted) throw Error("Workspace switch canceled.");
      if (codeSignature({ params: current.current! }) !== signature)
        throw Error(
          "Code changed during synchronization. Switch again to use the current source.",
        );
      if (!session)
        session = new WorkspaceSession(
          await openWorkspaceCode(result.design, snapshot),
        );
      else await session.flush();
      await session.enterVisual(result.design, result.mode, snapshot, previous);
      location.assign(workspaceUrl("visual", session.record.id));
    } catch (error) {
      setStatus(`Workspace switch failed: ${error}`);
    } finally {
      abort.current = undefined;
      reviewResolver.current = undefined;
      setModuleReview(undefined);
      setBusy(false);
      onBusyChange?.(false);
    }
  };
  return (
    <div style={{ padding: "8px 14px" }}>
      <a
        href="?studio=1"
        aria-disabled={busy}
        onClick={(e) => {
          e.preventDefault();
          void switchToVisual();
        }}
        style={{ fontWeight: 600 }}
      >
        Forma3D Studio · Visual Design ↗
      </a>
      {moduleReview && (
        <ModuleImportReview
          choices={moduleReview.choices}
          onSave={(entries) => moduleReview.resolve(entries)}
          onSkip={() => moduleReview.resolve([])}
          onCancel={() => moduleReview.resolve(null)}
        />
      )}
      {busy && (
        <button
          onClick={() => abort.current?.abort()}
          style={{ marginLeft: 12 }}
        >
          Cancel workspace switch
        </button>
      )}
      {saveStatus && (
        <span role="status" style={{ marginLeft: 12, fontSize: 12 }}>
          {saveStatus}
        </span>
      )}
      {status && (
        <p
          role="status"
          style={{
            margin: "6px 0",
            color: status.includes("failed") ? "#a11" : undefined,
          }}
        >
          {status}
        </p>
      )}
    </div>
  );
}
