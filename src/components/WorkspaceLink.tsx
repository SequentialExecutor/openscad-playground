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
        { designFromCode, codeSignature },
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
