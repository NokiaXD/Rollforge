import { useMemo } from "preact/hooks";
import { minidenticon } from "minidenticons";
import {
  gmUsersModalOpen,
  settingsModalOpen,
  openContextMenu,
} from "../../state/ui";
import { currentUser } from "../../state/auth";
import { logout } from "../../net/auth";
import {
  panelDocks,
  visiblePanels,
  effectiveLeftTab,
  effectiveFloatingPanels,
  isLeftSidebarEffectiveOpen,
  selectLeftTab,
} from "../../state/layout";
import { startPanelDrag } from "../../state/panelDrag";

export const isIconClass = (icon: string) => icon.startsWith("nf-");

export function Icon({ icon, class: cls }: { icon: string; class?: string }) {
  return isIconClass(icon) ? (
    <i class={`nf ${icon} ${cls ?? ""}`} />
  ) : (
    <i class={`nf ${cls ?? ""}`}>{icon}</i>
  );
}

export function ActivityBar() {
  const user = currentUser.value;
  const isGM = user?.role === "GM";

  // Filter panels currently docked to "left" (not floating)
  const leftPanels = visiblePanels.value.filter(
    (p) =>
      (panelDocks.value[p.panel.id] ?? "left") === "left" &&
      !effectiveFloatingPanels.value.includes(p.panel.id),
  );

  const activeTab = effectiveLeftTab.value;
  const isOpen = isLeftSidebarEffectiveOpen.value;

  const handleUserMenu = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!user) return;

    const target = e.currentTarget as HTMLElement | null;
    const rect = target?.getBoundingClientRect();
    const pos = rect
      ? { clientX: rect.right + 6, clientY: Math.max(8, rect.top - 80) }
      : { clientX: e.clientX, clientY: e.clientY };

    openContextMenu(pos, [
      {
        label: user.username,
        hint: `Rol: ${user.role}`,
        disabled: true,
      },
      { divider: true },
      {
        label: "Cerrar Sesión",
        danger: true,
        onClick: () => {
          void logout();
        },
      },
    ]);
  };

  const identiconUri = useMemo(() => {
    if (!user?.username) return "";
    return `data:image/svg+xml;utf8,${encodeURIComponent(minidenticon(user.username, 90, 50))}`;
  }, [user?.username]);

  return (
    <aside class="pointer-events-auto flex w-12 shrink-0 select-none flex-col justify-between border-r border-white/10 bg-[#14171c]/90 backdrop-blur-md py-2 shadow-lg z-20">
      {/* Top action tabs */}
      <div class="flex flex-col items-center gap-1">
        {leftPanels.map((item) => {
          const isActive = isOpen && activeTab === item.panel.id;
          return (
            <button
              key={item.panel.id}
              type="button"
              onClick={() => selectLeftTab(item.panel.id)}
              onPointerDown={(e) => startPanelDrag(item.panel.id, e, true)}
              title={`${item.panel.title} (Ctrl+B)`}
              class={`group relative flex h-10 w-10 cursor-grab items-center justify-center rounded-md transition-colors active:cursor-grabbing ${
                isActive
                  ? "text-white bg-white/10"
                  : "text-muted hover:bg-white/5 hover:text-white"
              }`}
            >
              {/* Active left indicator bar */}
              {isActive && (
                <div class="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r bg-accent" />
              )}
              <Icon icon={item.panel.icon ?? "nf-cod-window"} class="text-2xl" />
            </button>
          );
        })}
      </div>

      {/* Bottom tools (GM, Settings & User Avatar) */}
      <div class="flex flex-col items-center gap-1.5 border-t border-white/5 pt-2">
        {isGM && (
          <button
            type="button"
            onClick={() => (gmUsersModalOpen.value = true)}
            title="Gestión de Cuentas GM"
            class="group relative flex h-10 w-10 items-center justify-center rounded-md text-muted hover:bg-white/5 hover:text-white transition-colors"
          >
            <Icon icon="nf-fa-shield_halved" class="text-2xl" />
          </button>
        )}
        <button
          type="button"
          onClick={() => (settingsModalOpen.value = true)}
          title="Ajustes y Atajos"
          class="group relative flex h-10 w-10 items-center justify-center rounded-md text-muted hover:bg-white/5 hover:text-white transition-colors"
        >
          <Icon icon="nf-cod-gear" class="text-2xl" />
        </button>

        {/* User avatar circle */}
        {user && (
          <button
            type="button"
            onClick={handleUserMenu}
            onContextMenu={handleUserMenu}
            title={`${user.username} (${user.role}) - Opciones de usuario`}
            class={`group relative mt-1 flex h-8 w-8 items-center justify-center rounded-full transition-all duration-150 hover:scale-110 active:scale-95 cursor-pointer shadow-md ${
              isGM
                ? "bg-[#1f1d18] border border-amber-500/60 ring-1 ring-amber-500/30 hover:border-amber-400 hover:ring-amber-400/50"
                : "bg-[#181b22] border border-indigo-500/60 ring-1 ring-indigo-500/30 hover:border-indigo-400 hover:ring-indigo-400/50"
            }`}
          >
            <img
              src={identiconUri}
              alt={user.username}
              class="h-7 w-7 rounded-full object-contain pointer-events-none"
            />
            {/* Online status / role indicator badge */}
            <span
              class={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[#14171c] ${
                isGM ? "bg-amber-400" : "bg-emerald-400"
              }`}
            />
          </button>
        )}
      </div>
    </aside>
  );
}
