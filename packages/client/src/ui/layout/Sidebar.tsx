import { activeSidebarTab, closeSidebar } from "../../state/ui";
import { ScenesView } from "../views/ScenesView";
import { TokensView } from "../views/TokensView";
import { DocumentsView } from "../views/DocumentsView";
import { currentUser } from "../../state/auth";

export function Sidebar() {
  const tab = activeSidebarTab.value;
  if (!tab) return null;
  if (tab === "scenes" && currentUser.value?.role !== "GM") return null;

  const titles: Record<string, string> = {
    scenes: "Gestor de Escenas",
    tokens: "Tokens en Escena",
    actors: "Actores",
  };

  return (
    <aside class="pointer-events-auto flex w-80 shrink-0 flex-col border-r border-white/10 bg-[#181a1f]/95 backdrop-blur-md text-[#e7e9ee] shadow-2xl z-20">
      {/* Sidebar Header */}
      <div class="flex h-9 shrink-0 items-center justify-between border-b border-white/10 px-3">
        <span class="text-[11px] font-semibold uppercase tracking-wider text-muted">
          {titles[tab] ?? tab}
        </span>

      </div>

      {/* Sidebar Content View */}
      <div class="flex-1 min-h-0 overflow-hidden">
        {tab === "scenes" && <ScenesView />}
        {tab === "tokens" && <TokensView />}
        {tab === "actors" && <DocumentsView />}
      </div>
    </aside>
  );
}
