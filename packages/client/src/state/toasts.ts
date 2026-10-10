import { signal } from "@preact/signals";

export interface ToastItem {
  id: string;
  text: string;
  kind?: "info" | "chat" | "warn";
  createdAt: number;
}

export const toasts = signal<ToastItem[]>([]);

let toastSeq = 0;

export function addToast(input: { text: string; kind?: "info" | "chat" | "warn" }): string {
  const id = `toast-${++toastSeq}`;
  const item: ToastItem = {
    id,
    text: input.text,
    kind: input.kind ?? "info",
    createdAt: Date.now(),
  };

  // Keep maximum 3 stacked, drop oldest if needed
  const next = [...toasts.value, item];
  if (next.length > 3) {
    toasts.value = next.slice(next.length - 3);
  } else {
    toasts.value = next;
  }

  return id;
}

export function removeToast(id: string): void {
  toasts.value = toasts.value.filter((t) => t.id !== id);
}

export function clearToasts(): void {
  toasts.value = [];
}
