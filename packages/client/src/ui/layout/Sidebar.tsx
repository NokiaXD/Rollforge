import { panelEntries, listPanels } from "../../extensions/clientPanels";
import {
  effectiveLeftTab,
  isLeftSidebarEffectiveOpen,
  effectiveSidebarWidths,
  setPreferredLeftSidebarWidth,
  resetLeftSidebarWidth,
  toggleLeftSidebar,
} from "../../state/layout";
import { panelDropZone, startPanelDrag } from "../../state/panelDrag";
import { SidebarResizeHandle } from "./SidebarResizeHandle";

export function Sidebar() {
  if (!isLeftSidebarEffectiveOpen.value) return null;

  const tab = effectiveLeftTab.value;
  if (!tab) return null;

  const entry = listPanels().find((p) => p.panel.id === tab);
  if (!entry) return null;

  const PanelComponent = entry.panel.component;
  const width = effectiveSidebarWidths.value.left;

  return (
    <aside
      style={{ width: `${width}px` }}
      class={`pointer-events-auto relative flex shrink-0 flex-col border-r border-white/10 bg-[#181a1f]/95 backdrop-blur-md text-[#e7e9ee] shadow-2xl z-20 ${
        panelDropZone.value === "left" ? "ring-2 ring-inset ring-accent" : ""
      }`}
    >
      {/* Sidebar Header — drag to left / right / center is the only way to move it */}
      <div
        class="flex h-9 shrink-0 cursor-grab items-center justify-between border-b border-white/10 px-3 active:cursor-grabbing"
        style={{ touchAction: "none" }}
        onPointerDown={(e) => startPanelDrag(entry.panel.id, e)}
      >
        <span class="text-[11px] font-semibold uppercase tracking-wider text-muted truncate">
          {entry.panel.title}
        </span>
        <button
          type="button"
          onClick={() => toggleLeftSidebar()}
          title="Colapsar barra lateral"
          class="rounded p-1 text-muted hover:bg-white/10 hover:text-white transition-colors text-xs"
        >
          ✕
        </button>
      </div>

      {/* Sidebar Content View */}
      <div class="flex-1 min-h-0 overflow-hidden">
        <PanelComponent
          api={entry.api}
          entries={panelEntries(entry.panel)}
        />
      </div>

      {/* Resizing Handle on Right Edge */}
      <SidebarResizeHandle
        side="left"
        currentWidth={width}
        canResize={effectiveSidebarWidths.value.canResize}
        onResize={setPreferredLeftSidebarWidth}
        onReset={resetLeftSidebarWidth}
      />
    </aside>
  );
}
