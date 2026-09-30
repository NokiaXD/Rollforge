import { tokens, locks } from "../../state/scene";
import { viewedScene } from "../../state/scenes";
import { currentUser, authStatus } from "../../state/auth";

export function StatusBar() {
  const user = currentUser.value;
  const isAuthed = authStatus.value === "authenticated";
  const scene = viewedScene.value;
  const gridSize = scene?.system.grid.size ?? 50;
  const tilesW = scene ? Math.round(scene.system.width / gridSize) : 80;
  const tilesH = scene ? Math.round(scene.system.height / gridSize) : 80;

  return (
    <footer class="flex h-6 shrink-0 select-none items-center justify-between border-t border-white/10 bg-[#14171c] px-3 text-[11px] text-muted">
      {/* Left: Connection & Scene dimensions */}
      <div class="flex items-center gap-3">
        <div class="flex items-center gap-1.5 font-medium">
          <span class={`h-2 w-2 rounded-full ${isAuthed ? "bg-emerald-400" : "bg-amber-400 animate-ping"}`} />
          <span class={isAuthed ? "text-emerald-400" : "text-amber-400"}>
            {isAuthed ? "Conectado" : "Conectando..."}
          </span>
        </div>

        <div class="h-3 w-px bg-white/10" />
      </div>

      {/* Center: Live Board Metrics */}
      <div class="flex items-center gap-4">
        <span>
          Tokens: <strong class="text-white font-medium">{tokens.value.size}</strong>
        </span>
        <span>
          Bloqueos: <strong class="text-white font-medium">{locks.value.size}</strong>
        </span>
      </div>

      {/* Right: User & Version */}
      <div class="flex items-center gap-3">
        {user && (
          <span class="text-white/80 font-medium">
           
            {user.role === "GM" ?  <i class="nf nf-fa-crown mr-1"></i> : <i class="nf nf-fa-user mr-1"></i>}
            {user.username}
          </span>
        )}
        <div class="h-3 w-px bg-white/10" />
        <span class="font-mono text-[10px] text-muted/60">Rollforge v0.1.0</span>
      </div>
    </footer>
  );
}
