import { useEffect, useCallback } from "preact/hooks";
import { settingsModalOpen } from "../state/ui";

export function SettingsModal() {
  const close = useCallback(() => {
    settingsModalOpen.value = false;
  }, []);

  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    },
    [close],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [handleKey]);

  return (
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs">
      <div class="flex max-h-[85vh] w-full max-w-lg flex-col rounded-lg border border-white/10 bg-[#181a1f] shadow-2xl text-xs text-[#e7e9ee]">
        {/* Header */}
        <header class="flex items-center justify-between border-b border-white/10 px-5 py-3.5 bg-[#14171c] rounded-t-lg">
          <div class="flex items-center gap-2">
            <span class="text-base">⚙️</span>
            <h2 class="text-sm font-semibold tracking-wide text-white">
              Ajustes y Atajos de Teclado
            </h2>
          </div>
          <button
            type="button"
            onClick={close}
            class="rounded p-1 text-muted hover:bg-white/10 hover:text-white transition-colors"
            title="Cerrar (Esc)"
          >
            ✕
          </button>
        </header>

        {/* Content */}
        <div class="flex-1 overflow-y-auto p-5 space-y-5">
          <section class="space-y-3">
            <h3 class="text-xs font-semibold uppercase tracking-wider text-muted">
              Atajos de Teclado y Controles
            </h3>
            <div class="space-y-2 rounded-lg border border-white/10 bg-black/30 p-3">
              <div class="flex items-center justify-between">
                <span class="text-white">Colapsar / Expandir Sidebar</span>
                <kbd class="rounded border border-white/20 bg-white/5 px-2 py-0.5 font-mono text-[11px] text-muted">
                  Ctrl + B / ⌘ + B
                </kbd>
              </div>
              <div class="flex items-center justify-between border-t border-white/5 pt-2">
                <span class="text-white">Mover el mapa (Pan)</span>
                <span class="text-muted">Clic derecho / Rueda / Arrastrar</span>
              </div>
              <div class="flex items-center justify-between border-t border-white/5 pt-2">
                <span class="text-white">Zoom del mapa</span>
                <span class="text-muted">Rueda del ratón (Scroll)</span>
              </div>
              <div class="flex items-center justify-between border-t border-white/5 pt-2">
                <span class="text-white">Mover token (Drag)</span>
                <span class="text-muted">Clic izquierdo y arrastrar</span>
              </div>
              <div class="flex items-center justify-between border-t border-white/5 pt-2">
                <span class="text-white">Regla de medición (extensión)</span>
                <kbd class="rounded border border-white/20 bg-white/5 px-2 py-0.5 font-mono text-[11px] text-muted">
                  R
                </kbd>
              </div>
              <div class="flex items-center justify-between border-t border-white/5 pt-2">
                <span class="text-white">Ajuste de la regla a la cuadrícula</span>
                <kbd class="rounded border border-white/20 bg-white/5 px-2 py-0.5 font-mono text-[11px] text-muted">
                  Shift + R
                </kbd>
              </div>
              <div class="flex items-center justify-between border-t border-white/5 pt-2">
                <span class="text-white">Borrar la línea de medición</span>
                <kbd class="rounded border border-white/20 bg-white/5 px-2 py-0.5 font-mono text-[11px] text-muted">
                  Esc
                </kbd>
              </div>
            </div>
          </section>

          <section class="space-y-3">
            <h3 class="text-xs font-semibold uppercase tracking-wider text-muted">
              Comandos de Dados (Chat)
            </h3>
            <div class="space-y-1.5 rounded-lg border border-white/10 bg-black/30 p-3 font-mono text-[11px]">
              <p class="text-muted"><strong class="text-white">/roll 1d20+5</strong> — Tirada estándar con modificador</p>
              <p class="text-muted"><strong class="text-white">/roll 4d6kh3</strong> — Tirar 4d6 y quedarse los 3 mejores</p>
              <p class="text-muted"><strong class="text-white">/w [usuario] [mensaje]</strong> — Susurrar a un usuario en privado</p>
            </div>
          </section>

          <section class="rounded-lg border border-white/5 bg-white/[0.02] p-3 text-[11px] text-muted">
            <p><strong class="text-white">Rollforge Core:</strong> v0.1.0 </p>
          </section>
        </div>
      </div>
    </div>
  );
}
