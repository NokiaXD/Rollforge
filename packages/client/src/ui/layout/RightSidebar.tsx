import { panelEntries } from "../../extensions/clientPanels";
import {
  effectiveRightTab,
  isRightSidebarEffectiveOpen,
  effectiveSidebarWidths,
  setPreferredRightSidebarWidth,
  resetRightSidebarWidth,
  toggleRightSidebar,
  selectRightTab,
  movePanel,
  visiblePanels,
  panelDocks,
  effectiveFloatingPanels,
  canPopOut,
  popOut,
} from "../../state/layout";
import { SidebarResizeHandle } from "./SidebarResizeHandle";
import { Icon } from "./ActivityBar";

export function RightSidebar() {
  if (!isRightSidebarEffectiveOpen.value) return null;

  // Filter panels currently docked to "right" (not floating)
  const rightPanels = visiblePanels.value.filter(
    (p) =>
      (panelDocks.value[p.panel.id] ?? "left") === "right" &&
      !effectiveFloatingPanels.value.includes(p.panel.id),
  );

  const tab = effectiveRightTab.value;
  const entry = rightPanels.find((p) => p.panel.id === tab) ?? rightPanels[0];
  if (!entry) return null;

  const PanelComponent = entry.panel.component;
  const width = effectiveSidebarWidths.value.right;

  return (
    <aside
      style={{ width: `${width}px` }}
      class="pointer-events-auto relative flex shrink-0 flex-col border-l border-white/10 bg-[#181a1f]/95 backdrop-blur-md text-[#e7e9ee] shadow-2xl z-20"
    >
      {/* Resizing Handle on Left Edge */}
      <SidebarResizeHandle
        side="right"
        currentWidth={width}
        canResize={effectiveSidebarWidths.value.canResize}
        onResize={setPreferredRightSidebarWidth}
        onReset={resetRightSidebarWidth}
      />

      {/* Right Sidebar Header / Tab Bar */}
      <div class="flex h-9 shrink-0 items-center justify-between border-b border-white/10 px-2 gap-2">
        {rightPanels.length > 1 ? (
          <div class="flex items-center gap-1 overflow-x-auto min-w-0 flex-1">
            {rightPanels.map((p) => {
              const isActive = p.panel.id === tab;
              return (
                <button
                  key={p.panel.id}
                  type="button"
                  onClick={() => selectRightTab(p.panel.id)}
                  title={p.panel.title}
                  class={`flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-medium transition-colors truncate ${
                    isActive
                      ? "bg-white/10 text-white"
                      : "text-muted hover:bg-white/5 hover:text-white"
                  }`}
                >
                  <Icon icon={p.panel.icon ?? "nf-cod-window"} class="text-sm" />
                  <span class="truncate">{p.panel.title}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <div class="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted truncate px-1">
            <Icon icon={entry.panel.icon ?? "nf-cod-window"} class="text-sm" />
            <span class="truncate">{entry.panel.title}</span>
          </div>
        )}

        <div class="flex items-center gap-1 shrink-0">
          {canPopOut.value && (
            <button
              type="button"
              onClick={() => popOut(entry.panel.id)}
              title="Abrir como ventana flotante"
              class="rounded p-1 text-[11px] text-muted hover:bg-white/10 hover:text-white transition-colors"
            >
              ↗
            </button>
          )}
          <button
            type="button"
            onClick={() => movePanel(entry.panel.id, "left")}
            title="Mover panel a la barra izquierda"
            class="rounded p-1 text-[11px] text-muted hover:bg-white/10 hover:text-white transition-colors"
          >
            ⬅
          </button>
          <button
            type="button"
            onClick={() => toggleRightSidebar()}
            title="Colapsar barra lateral"
            class="rounded p-1 text-muted hover:bg-white/10 hover:text-white transition-colors text-xs"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Right Sidebar Content View */}
      <div class="flex-1 min-h-0 overflow-hidden">
        <PanelComponent
          api={entry.api}
          entries={panelEntries(entry.panel)}
        />
      </div>
    </aside>
  );
}
