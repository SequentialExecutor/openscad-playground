import "./module-review.css";
import React, { useState, useEffect, useRef } from "react";
import type { LibraryEntry } from "./module-library";
export interface ModuleChoice {
  entry: LibraryEntry;
  update: boolean;
}
export function ModuleImportReview({
  choices,
  onSave,
  onSkip,
  onCancel,
  error = "",
  returning = true,
}: {
  choices: ModuleChoice[];
  onSave: (entries: LibraryEntry[]) => void;
  onSkip: () => void;
  onCancel: () => void;
  error?: string;
  returning?: boolean;
}) {
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    return () => previous?.focus();
  }, []);
  const [selected, setSelected] = useState(
    () => new Set(choices.filter((c) => !c.update).map((c) => c.entry.name)),
  );
  return (
    <>
      <div
        aria-hidden="true"
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 999,
          background: "#0009",
        }}
      />
      <section
        ref={dialog}
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
          if (e.key === "Tab") {
            const nodes = [
              ...e.currentTarget.querySelectorAll<HTMLElement>(
                "button:not(:disabled),input:not(:disabled),summary",
              ),
            ];
            const first = nodes[0],
              last = nodes.at(-1);
            if (
              e.shiftKey &&
              (document.activeElement === first ||
                document.activeElement === e.currentTarget)
            ) {
              e.preventDefault();
              last?.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault();
              first?.focus();
            }
          }
        }}
        style={{
          position: "fixed",
          top: "8vh",
          left: "50%",
          transform: "translateX(-50%)",
          width: "min(900px, 90vw)",
          boxSizing: "border-box",
          maxHeight: "84vh",
          zIndex: 1000,
          overflow: "auto",
          padding: 24,
          background: "#1c293b",
          color: "#e5edf8",
          border: "2px solid #8bb9ea",
          borderRadius: 8,
        }}
        role="dialog"
        aria-modal="true"
        aria-label="Import detected modules"
        className="studio-module-review"
      >
        <h2>
          {returning
            ? "Save detected code modules to your library?"
            : "Import modules from this library backup?"}
        </h2>
        <p>
          Review the modules below. Existing library entries change only if you
          select their updates. Current projects keep their saved source
          snapshots.
        </p>
        {choices.map((c) => (
          <div className="studio-module-choice" key={c.entry.name}>
            <label>
              <input
                type="checkbox"
                aria-label={`Import module ${c.entry.name}`}
                checked={selected.has(c.entry.name)}
                onChange={(e) =>
                  setSelected((s) => {
                    const n = new Set(s);
                    if (e.target.checked) n.add(c.entry.name);
                    else n.delete(c.entry.name);
                    return n;
                  })
                }
              />
              {c.entry.name}
              {c.update ? " — update existing entry" : " — new module"}
            </label>
            <details>
              <summary>Review {c.entry.name} source and dependencies</summary>
              <pre
                style={{
                  whiteSpace: "pre-wrap",
                  overflowWrap: "anywhere",
                  maxHeight: 200,
                  overflow: "auto",
                }}
              >
                {c.entry.source}
              </pre>
            </details>
          </div>
        ))}
        {error && <p role="alert">{error}</p>}
        <button
          onClick={() =>
            onSave(
              choices
                .filter((c) => selected.has(c.entry.name))
                .map((c) => c.entry),
            )
          }
        >
          {returning
            ? "Save selected modules and return"
            : "Import selected modules"}
        </button>
        <button onClick={onSkip}>
          {returning ? "Return without saving" : "Skip import"}
        </button>
        <button onClick={onCancel}>
          {returning ? "Cancel return" : "Cancel import"}
        </button>
      </section>
    </>
  );
}
