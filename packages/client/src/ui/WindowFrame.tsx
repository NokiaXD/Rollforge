import { type ComponentChildren } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { clampPosition } from "./windowFrameUtils";

export interface WindowFrameProps {
  title: ComponentChildren;
  subtitle?: string;
  icon?: string;
  children: ComponentChildren;
  onClose: () => void;
  backdrop?: "dark" | "none";
  initialX?: number;
  initialY?: number;
  initialWidth?: number;
  allowMaximize?: boolean;
  closeOnEscape?: boolean;
  headerActions?: ComponentChildren;
  onFocus?: () => void;
  zIndex?: number;
}

export function WindowFrame({
  title,
  subtitle,
  icon,
  children,
  onClose,
  backdrop = "dark",
  initialX = 40,
  initialY = 60,
  initialWidth = 440,
  allowMaximize = true,
  closeOnEscape = true,
  headerActions,
  onFocus,
  zIndex,
}: WindowFrameProps) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLElement | null>(null);

  // Small screen detection via matchMedia
  const [isSmallScreen, setIsSmallScreen] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia("(max-width: 639px)").matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(max-width: 639px)");
    const handler = (e: MediaQueryListEvent) => {
      setIsSmallScreen(e.matches);
    };
    if (mq.addEventListener) {
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    } else {
      mq.addListener(handler);
      return () => mq.removeListener(handler);
    }
  }, []);

  const [maximized, setMaximized] = useState(false);
  const isMaximized = maximized || isSmallScreen;

  const [pos, setPos] = useState({ x: initialX, y: initialY });
  const prevPosRef = useRef({ x: initialX, y: initialY });
  const isDraggingRef = useRef(false);
  const dragOffsetRef = useRef({ x: 0, y: 0 });

  // Focus container on mount for immediate keyboard navigation
  useEffect(() => {
    frameRef.current?.focus();
  }, []);

  // Re-clamp position on window resize
  useEffect(() => {
    if (backdrop !== "none") return;
    const handleResize = () => {
      if (!frameRef.current) return;
      const rect = frameRef.current.getBoundingClientRect();
      const clamped = clampPosition(pos, {
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        windowWidth: rect.width || initialWidth,
        windowHeight: rect.height || 400,
        headerHeight: 40,
        minVisibleHorizontal: 60,
      });
      setPos(clamped);
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [backdrop, pos, initialWidth]);

  const toggleMaximize = useCallback(() => {
    if (isMaximized) {
      setMaximized(false);
      // Restore previous position clamped
      const rect = frameRef.current?.getBoundingClientRect();
      const clamped = clampPosition(prevPosRef.current, {
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        windowWidth: rect?.width || initialWidth,
        windowHeight: rect?.height || 400,
        headerHeight: 40,
        minVisibleHorizontal: 60,
      });
      setPos(clamped);
    } else {
      prevPosRef.current = pos;
      setMaximized(true);
    }
  }, [isMaximized, pos, initialWidth]);

  // Pointer drag events on header
  const handlePointerDown = (e: PointerEvent) => {
    onFocus?.();
    if (backdrop !== "none" || isMaximized) return;

    // Do not initiate drag if clicking buttons or interactive elements in header
    const target = e.target as HTMLElement | null;
    if (target?.closest("button") || target?.closest("input") || target?.closest("select")) {
      return;
    }

    isDraggingRef.current = true;
    dragOffsetRef.current = {
      x: e.clientX - pos.x,
      y: e.clientY - pos.y,
    };

    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // Ignore if pointer capture fails on certain platforms
    }
  };

  const handlePointerMove = (e: PointerEvent) => {
    if (!isDraggingRef.current || backdrop !== "none" || isMaximized) return;

    const rect = frameRef.current?.getBoundingClientRect();
    const rawX = e.clientX - dragOffsetRef.current.x;
    const rawY = e.clientY - dragOffsetRef.current.y;

    const clamped = clampPosition(
      { x: rawX, y: rawY },
      {
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        windowWidth: rect?.width || initialWidth,
        windowHeight: rect?.height || 400,
        headerHeight: 40,
        minVisibleHorizontal: 60,
      },
    );

    setPos(clamped);
  };

  const handlePointerUp = (e: PointerEvent) => {
    if (isDraggingRef.current) {
      isDraggingRef.current = false;
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // Ignore
      }
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    // Stop all key events from leaking to global window listeners (such as ruler or app shortcuts)
    e.stopPropagation();
    if (closeOnEscape && e.key === "Escape") {
      onClose();
    }
  };

  // Dark modal mode (standard blocking dialog)
  if (backdrop === "dark") {
    return (
      <div
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs"
        role="dialog"
        aria-modal="true"
        onPointerDown={onFocus}
      >
        <div
          ref={frameRef}
          tabIndex={-1}
          onKeyDown={handleKeyDown}
          class="flex max-h-[85vh] w-full max-w-lg flex-col rounded-lg border border-white/10 bg-[#181a1f] shadow-2xl text-xs text-[#e7e9ee] outline-none"
        >
          <header class="flex items-center justify-between border-b border-white/10 px-5 py-3.5 bg-[#14171c] rounded-t-lg select-none">
            <div class="flex items-center gap-2">
              {icon && <span class="text-base">{icon}</span>}
              <div class="flex flex-col">
                {subtitle && (
                  <span class="text-[10px] font-semibold uppercase tracking-wider text-muted">
                    {subtitle}
                  </span>
                )}
                <h2 class="text-sm font-semibold tracking-wide text-white">{title}</h2>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              class="rounded p-1 text-muted hover:bg-white/10 hover:text-white transition-colors"
              title="Cerrar (Esc)"
            >
              ✕
            </button>
          </header>
          {children}
        </div>
      </div>
    );
  }

  // Floating window mode (backdrop: "none")
  const windowStyle = isMaximized
    ? {
        position: "fixed" as const,
        left: 0,
        top: 0,
        width: "100vw",
        height: "100vh",
        zIndex: zIndex ?? 30,
      }
    : {
        position: "fixed" as const,
        left: `${pos.x}px`,
        top: `${pos.y}px`,
        width: `${initialWidth}px`,
        zIndex: zIndex ?? 30,
      };

  return (
    <div
      class="pointer-events-none fixed inset-0 overflow-hidden"
      style={{ zIndex: zIndex ?? 30 }}
      role="dialog"
      aria-modal="false"
    >
      <div
        ref={frameRef}
        tabIndex={-1}
        onPointerDown={(e: PointerEvent) => {
          onFocus?.();
          const target = e.target as HTMLElement | null;
          const isInteractive =
            target &&
            (target.tagName === "INPUT" ||
              target.tagName === "TEXTAREA" ||
              target.tagName === "SELECT" ||
              target.tagName === "BUTTON" ||
              target.tagName === "A" ||
              target.isContentEditable);
          if (!isInteractive) {
            frameRef.current?.focus();
          }
        }}
        onKeyDown={handleKeyDown}
        style={windowStyle}
        class={`pointer-events-auto flex flex-col bg-[#14171c] text-[#e7e9ee] shadow-2xl outline-none ${
          isMaximized
            ? "h-full w-full rounded-none border-0"
            : "max-h-[90vh] max-w-[95vw] rounded-lg border border-white/10"
        }`}
      >
        <header
          ref={headerRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          class={`flex shrink-0 items-center justify-between border-b border-white/10 px-4 py-2.5 bg-[#181a1f] select-none ${
            isMaximized ? "rounded-none" : "rounded-t-lg cursor-grab active:cursor-grabbing"
          }`}
          style={{ touchAction: "none" }}
        >
          <div class="flex items-center gap-2 pointer-events-none">
            {icon && <span class="text-base">{icon}</span>}
            <div class="flex flex-col">
              {subtitle && (
                <span class="text-[10px] font-semibold uppercase tracking-wider text-muted">
                  {subtitle}
                </span>
              )}
              <span class="text-sm font-semibold text-white">{title}</span>
            </div>
          </div>
          <div class="flex items-center gap-1">
            {headerActions}
            {allowMaximize && !isSmallScreen && (
              <button
                type="button"
                onClick={toggleMaximize}
                class="rounded p-1 text-muted hover:bg-white/10 hover:text-white transition-colors"
                title={isMaximized ? "Restaurar" : "Maximizar"}
              >
                {isMaximized ? "🗗" : "🗖"}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              class="rounded p-1 text-muted hover:bg-white/10 hover:text-white transition-colors"
              title="Cerrar (Esc)"
            >
              ✕
            </button>
          </div>
        </header>
        <div class="custom-scroll flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
