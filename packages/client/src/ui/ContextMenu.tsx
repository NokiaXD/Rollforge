import { useEffect, useRef } from "preact/hooks";
import { contextMenu } from "../state/ui";

const MENU_WIDTH = 192;
const ITEM_HEIGHT = 28;

export function ContextMenu() {
  const state = contextMenu.value;
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!state) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        contextMenu.value = null;
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") contextMenu.value = null;
    };
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [state]);

  if (!state) return null;

  //  clamp to viewport so tall menus on the bottom edge don't overflow.
  const maxX = window.innerWidth - MENU_WIDTH - 4;
  const maxY = window.innerHeight - state.items.length * ITEM_HEIGHT - 4;
  const x = Math.max(4, Math.min(state.x, maxX));
  const y = Math.max(4, Math.min(state.y, maxY));

  return (
    <div
      ref={ref}
      role="menu"
      style={{ position: "fixed", left: x, top: y, zIndex: 60 }}
      class="min-w-44 rounded-md border border-white/10 bg-[#181a1f] py-1 text-xs text-[#e7e9ee] shadow-2xl"
      onContextMenu={(e) => e.preventDefault()}
    >
      {state.items.map((it, i) =>
        it.divider ? (
          <div key={i} class="my-1 border-t border-white/10" />
        ) : (
          <button
            key={i}
            type="button"
            role="menuitem"
            disabled={it.disabled}
            onClick={(e) => {
              e.stopPropagation();
              if (it.disabled) return;
              it.onClick?.();
              contextMenu.value = null;
            }}
            class={`flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left transition-colors ${
              it.disabled
                ? "cursor-default text-white/70 font-medium"
                : it.danger
                ? "text-red-300 hover:bg-red-500/20"
                : "hover:bg-white/10 text-muted hover:text-white"
            }`}
          >
            <span>{it.label}</span>
            {it.hint && (
              <span
                class={`text-[10px] ${
                  it.disabled ? "text-amber-300/80 font-normal" : "text-muted"
                }`}
              >
                {it.hint}
              </span>
            )}
          </button>
        )
      )}
    </div>
  );
}