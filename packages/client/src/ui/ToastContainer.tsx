import { useEffect, useRef, useState } from "preact/hooks";
import { toasts, removeToast, type ToastItem } from "../state/toasts";
import {
  effectiveSidebarWidths,
  isLeftSidebarEffectiveOpen,
  isRightSidebarEffectiveOpen,
} from "../state/layout";

export function ToastContainer() {
  const list = toasts.value;
  if (list.length === 0) return null;

  // ActivityBar width is 48px (w-12).
  // When left sidebar is collapsed or empty, effectiveLeft is 0, so left margin is 48px.
  // When right sidebar is collapsed or empty, effectiveRight is 0, so right margin is 0px.
  const leftMargin = (isLeftSidebarEffectiveOpen.value ? effectiveSidebarWidths.value.left : 0) + 48;
  const rightMargin = isRightSidebarEffectiveOpen.value ? effectiveSidebarWidths.value.right : 0;

  return (
    <div
      class="fixed top-12 z-[49] pointer-events-none flex justify-center"
      style={{ left: `${leftMargin}px`, right: `${rightMargin}px` }}
      aria-live="polite"
    >
      <div class="flex flex-col items-center gap-1.5 max-w-md w-full px-2">
        {list.map((t) => (
          <ToastCard key={t.id} toast={t} />
        ))}
      </div>
    </div>
  );
}

function ToastCard({ toast }: { toast: ToastItem }) {
  const [isPaused, setIsPaused] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (isPaused) return;

    timerRef.current = window.setTimeout(() => {
      removeToast(toast.id);
    }, 4000);

    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [toast.id, isPaused]);

  return (
    <div
      onPointerEnter={() => setIsPaused(true)}
      onPointerLeave={() => setIsPaused(false)}
      onClick={() => removeToast(toast.id)}
      class="pointer-events-auto flex items-center gap-2 rounded-md border border-white/15 bg-[#14171c]/95 px-3 py-1.5 text-xs text-white shadow-xl backdrop-blur-md transition-all hover:border-white/30 cursor-pointer max-w-md select-none animate-in fade-in slide-in-from-top-1"
    >
      <span class="text-sm">
        {toast.kind === "chat" ? "🎲" : toast.kind === "warn" ? "⚠️" : "💬"}
      </span>
      <span class="truncate">{toast.text}</span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          removeToast(toast.id);
        }}
        class="ml-1 text-muted hover:text-white transition-colors text-[10px]"
        title="Cerrar"
      >
        ✕
      </button>
    </div>
  );
}
