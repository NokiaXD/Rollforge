import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { signal, effect as runEffect } from "@preact/signals";
import { documents, getInPath, setInPath } from "../state/documents";

export interface BoundInputProps {
  path: string;
  documentId: string;
  type?: "text" | "number";
  //  defaults are local commits; pass `false` to opt out (e.g. read-only views).
  debounceMs?: number;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  onSaved?: (next: unknown) => void;
}

function getLiveValue(documentId: string, path: string): unknown {
  const doc = documents.value.get(documentId);
  return getInPath(doc, path);
}

export function BoundInput({
  path,
  documentId,
  type = "text",
  debounceMs = 350,
  disabled = false,
  placeholder,
  className,
  onSaved,
}: BoundInputProps) {
  //  a per-instance signal that re-reads from the document signal on every change.
  // Using a local signal keeps the input value in sync with concurrent server updates.
  const liveSignal = useMemo(() => signal<unknown>(getLiveValue(documentId, path)), [documentId, path]);
  useEffect(() => runEffect(() => {
    liveSignal.value = getLiveValue(documentId, path);
  }), [documentId, path]);

  const initial = liveSignal.value;
  const [draft, setDraft] = useState(() => stringifyValue(initial, type));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef(false);

  // Reflect external (server) changes while the input is not being edited.
  useEffect(() => {
    return runEffect(() => {
      const v = liveSignal.value;
      if (inflight.current) return; // user is mid-edit; trust draft
      setDraft(stringifyValue(v, type));
    });
  }, [liveSignal, type]);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const commit = (raw: string) => {
    const parsed = type === "number" ? (raw === "" ? null : Number(raw)) : raw;
    const doc = documents.value.get(documentId);
    if (!doc) return;
    const next = setInPath(doc, path, parsed) as typeof doc;
    documents.value = new Map(documents.value).set(documentId, next);
    // debounce server commit
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      inflight.current = false;
      const res = await fetch(`/api/documents/${encodeURIComponent(documentId)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ [path]: parsed }),
      });
      if (res.ok) {
        const updated = (await res.json()) as typeof doc;
        documents.value = new Map(documents.value).set(documentId, updated);
        onSaved?.(parsed);
      }
    }, debounceMs);
  };

  const onInput = (e: Event) => {
    const next = (e.currentTarget as HTMLInputElement).value;
    setDraft(next);
    inflight.current = true;
    commit(next);
  };

  return (
    <input
      type={type === "number" ? "number" : "text"}
      value={draft ?? ""}
      placeholder={placeholder ?? ""}
      disabled={disabled}
      class={className}
      onInput={onInput}
    />
  );
}

function stringifyValue(v: unknown, type: "text" | "number"): string {
  if (v === null || v === undefined) return "";
  if (type === "number" && typeof v === "number" && Number.isFinite(v)) return String(v);
  return String(v);
}

export function useDocumentField<T = unknown>(documentId: string, path: string): T | undefined {
  const sig = useMemo(() => signal<T | undefined>(getLiveValue(documentId, path) as T | undefined), [documentId, path]);
  useEffect(() => runEffect(() => {
    sig.value = getLiveValue(documentId, path) as T | undefined;
  }), [documentId, path]);
  return sig.value;
}