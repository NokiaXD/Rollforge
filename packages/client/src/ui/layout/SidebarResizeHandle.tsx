import { useRef } from "preact/hooks";

export interface SidebarResizeHandleProps {
  side: "left" | "right";
  currentWidth: number;
  canResize: boolean;
  onResize: (width: number) => void;
  onReset: () => void;
}

export function SidebarResizeHandle({
  side,
  currentWidth,
  canResize,
  onResize,
  onReset,
}: SidebarResizeHandleProps) {
  const isDraggingRef = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);
  const rafIdRef = useRef<number | null>(null);

  if (!canResize) return null;

  const handlePointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    isDraggingRef.current = true;
    startXRef.current = e.clientX;
    startWidthRef.current = currentWidth;

    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // Ignored if capture unsupported
    }

    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
  };

  const handlePointerMove = (e: PointerEvent) => {
    if (!isDraggingRef.current) return;

    const deltaX = side === "left" ? e.clientX - startXRef.current : startXRef.current - e.clientX;
    const nextWidth = startWidthRef.current + deltaX;

    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
    }

    rafIdRef.current = requestAnimationFrame(() => {
      onResize(nextWidth);
      rafIdRef.current = null;
    });
  };

  const stopDragging = (e: PointerEvent) => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;

    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }

    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // Ignored
    }

    document.body.style.userSelect = "";
    document.body.style.cursor = "";
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={currentWidth}
      title="Arrastra para redimensionar (Doble clic para restaurar)"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={stopDragging}
      onPointerCancel={stopDragging}
      onLostPointerCapture={stopDragging}
      onDblClick={onReset}
      class={`group absolute top-0 bottom-0 z-30 w-3 cursor-col-resize select-none ${
        side === "left" ? "-right-1.5" : "-left-1.5"
      }`}
      style={{ touchAction: "none" }}
    >
      {/* 2px visual line centered in the 12px hitbox */}
      <div class="h-full w-0.5 mx-auto bg-transparent group-hover:bg-accent/60 group-active:bg-accent transition-colors" />
    </div>
  );
}
