import React, { useState, useRef, useEffect } from "react";
export default function Numeric({
  label,
  value,
  positive,
  max = 1e6,
  onCommit,
}: {
  label: string;
  value: number;
  positive?: boolean;
  max?: number;
  onCommit: (value: number) => void;
}) {
  const [text, setText] = useState(String(value));
  const canceled = useRef(false);
  const edited = useRef(false);
  useEffect(() => {
    edited.current = false;
    setText(String(Math.round(value * 1e5) / 1e5));
  }, [value]);
  const apply = () => {
    if (!edited.current) return;
    edited.current = false;
    const n = Number(text);
    // A domain validator may reject an otherwise valid number. Show the
    // accepted value until a successful document update supplies the new one.
    setText(String(value));
    if (
      text.trim() &&
      Number.isFinite(n) &&
      Math.abs(n) <= max &&
      (!positive || n >= 0.001)
    )
      onCommit(n);
  };
  return (
    <label>
      {label}
      <input
        aria-label={label}
        type="number"
        title={`Exact value: ${value}`}
        step="any"
        min={positive ? 0.001 : undefined}
        max={max}
        value={text}
        onChange={(e) => {
          edited.current = true;
          setText(e.target.value);
        }}
        onBlur={() => {
          if (canceled.current) canceled.current = false;
          else apply();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            e.stopPropagation();
            canceled.current = true;
            edited.current = false;
            setText(String(value));
            const dialog = e.currentTarget.closest<HTMLElement>(
              '[role="dialog"][aria-modal="true"]',
            );
            e.currentTarget.blur();
            dialog?.focus();
          }
        }}
      />
    </label>
  );
}
