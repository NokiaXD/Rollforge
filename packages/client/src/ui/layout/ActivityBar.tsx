import { activeSidebarTab, toggleSidebar, gmUsersModalOpen, settingsModalOpen, type SidebarTab } from "../../state/ui";
import { messages } from "../../state/chat";
import { currentUser } from "../../state/auth";

interface ActivityItem {
  id: SidebarTab;
  label: string;
  icon: string;
  badge?: number;
}

export function ActivityBar() {
  const activeTab = activeSidebarTab.value;
  const isGM = currentUser.value?.role === "GM";
  const msgCount = messages.value.length;

  const items: ActivityItem[] = [
    { id: "scenes", label: "Gestor de Escenas", icon: "\uec05" },
    { id: "tokens", label: "Tokens en Escena", icon: "\uedca" },
  ];

  return (
    <aside class="pointer-events-auto flex w-12 shrink-0 select-none flex-col justify-between border-r border-white/10 bg-[#14171c]/90 backdrop-blur-md py-2 shadow-lg z-20">
      {/* Top action tabs */}
      <div class="flex flex-col items-center gap-1">
        {items.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => toggleSidebar(item.id)}
              title={`${item.label} (Ctrl+B)`}
              class={`group relative flex h-10 w-10 items-center justify-center rounded-md transition-colors ${
                isActive
                  ? "text-white bg-white/10"
                  : "text-muted hover:bg-white/5 hover:text-white"
              }`}
            >
              {/* Active left indicator bar */}
              {isActive && (
                <div class="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r bg-accent" />
              )}
              <span class="text-4xl font-mono">{item.icon}</span>
             
            </button>
          );
        })}
      </div>

      {/* Bottom tools (GM & Settings) */}
      <div class="flex flex-col items-center gap-1 border-t border-white/5 pt-2">
        {isGM && (
          <button
            type="button"
            onClick={() => (gmUsersModalOpen.value = true)}
            title="Gestión de Cuentas GM"
            class="group relative flex h-10 w-10 items-center justify-center rounded-md text-muted hover:bg-white/5 hover:text-white transition-colors"
          >
            <span class="text-4xl font-mono">{"\ued25"}</span>
          </button>
        )}
        <button
          type="button"
          onClick={() => (settingsModalOpen.value = true)}
          title="Ajustes y Atajos"
          class="group relative flex h-10 w-10 items-center justify-center rounded-md text-muted hover:bg-white/5 hover:text-white transition-colors"
        >
          <span class="text-4xl font-mono">{"\ueaf8"}</span>
        </button>
      </div>
    </aside>
  );
}
