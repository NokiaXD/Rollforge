import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { signal, effect as runEffect } from "@preact/signals";
import type { Document } from "@rollforge/protocol";
import type { ClientExtensionAPI } from "../client";
import { DocumentUpdateRejection, type DocumentUpdateRejectionReason } from "../errors";

export interface BoundInputProps {
  path: string;
  documentId: string;
  type?: "text" | "number";
  debounceMs?: number;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  onSaved?: (next: unknown) => void;
  // ponytail: i18n passed through; defaults to ES strings below. Hard-coded
  // for now per plan §7 — replace with the global i18n table in a future pass.
  messages?: Partial<Record<DocumentUpdateRejectionReason | "ok", string>>;
}

const DEFAULT_MESSAGES: Record<DocumentUpdateRejectionReason | "ok", string> = {
  ok: "Guardado.",
  forbidden: "No tienes permiso para editar esto. Avísale al GM.",
  "extension-not-ready": "Espera un segundo, la extensión aún está cargando.",
  "migration-blocked": "La migración está bloqueada. Revisa /migrations.",
  "stale-rev": "Alguien más editó esto. Refresca los datos.",
  "not-found": "Este documento ya no existe.",
  "network-error": "Falló la conexión con el servidor.",
};

function makeMessages(override?: BoundInputProps["messages"]): Record<DocumentUpdateRejectionReason | "ok", string> {
  return { ...DEFAULT_MESSAGES, ...(override ?? {}) };
}

function getInPath(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const k of parts) {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

function stringifyValue(v: unknown, type: "text" | "number"): string {
  if (v === null || v === undefined) return "";
  if (type === "number" && typeof v === "number" && Number.isFinite(v)) return String(v);
  return String(v);
}

//  factory captures `api` in the closure so two factories with two distinct
// apis don't share state. Mirrors how `api.context` stays scoped per-extension.
export function createBoundInput(api: ClientExtensionAPI) {
  return function BoundInput({
    path,
    documentId,
    type = "text",
    debounceMs = 350,
    disabled = false,
    placeholder,
    className,
    onSaved,
    messages: propMessages,
  }: BoundInputProps) {
    const localMessages = useMemo(() => makeMessages(propMessages), [propMessages]);
    // ponytail: per-instance signal for live read; re-reads on doc change.
    const liveSignal = useMemo(
      () => signal<Document | null>(api.documents.get<Document>(documentId)),
      [documentId, path],
    );
    useEffect(
      () =>
        runEffect(() => {
          liveSignal.value = api.documents.get<Document>(documentId);
        }),
      [documentId, path],
    );

    const [draft, setDraft] = useState(() =>
      stringifyValue(getInPath(liveSignal.value, path), type),
    );
    const [status, setStatus] = useState<DocumentUpdateRejectionReason | "ok" | "idle">("idle");
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const inflight = useRef(false);

    useEffect(() => {
      return runEffect(() => {
        const v = liveSignal.value;
        if (inflight.current) return;
        setDraft(stringifyValue(getInPath(v, path), type));
      });
    }, [liveSignal, path, type]);

    useEffect(() => {
      const unsubscribe = api.documents.subscribe(documentId, (doc) => {
        liveSignal.value = doc;
      });
      return () => {
        unsubscribe();
        if (timer.current) clearTimeout(timer.current);
      };
    }, [documentId]);

    const commit = (raw: string) => {
      const parsed = type === "number" ? (raw === "" ? null : Number(raw)) : raw;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(async () => {
        inflight.current = false;
        try {
          await api.documents.update(documentId, { [path]: parsed } as Partial<Document>);
          setStatus("ok");
          onSaved?.(parsed);
        } catch (err) {
          if (err instanceof DocumentUpdateRejection) {
            setStatus(err.reason);
          } else {
            setStatus("network-error");
          }
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
      <div class="flex flex-col gap-1">
        <input
          type={type === "number" ? "number" : "text"}
          value={draft ?? ""}
          placeholder={placeholder ?? ""}
          disabled={disabled}
          class={className}
          onInput={onInput}
        />
        {status !== "idle" && (
          <span class="text-[10px]" data-status={status}>
            {localMessages[status as keyof typeof localMessages] ?? localMessages["network-error"]}
          </span>
        )}
      </div>
    );
  };
}
