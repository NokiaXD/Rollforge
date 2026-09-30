import { tokens, locks, currentSceneId } from "../../state/scene";
import { createTokenRequest } from "../../net/socket";

export function TokensView() {
  const tokenList = [...tokens.value.values()];
  const lockMap = locks.value;

  const handleCreate = () => {
    createTokenRequest(currentSceneId.value, 200, 200);
  };

  return (
    <div class="custom-scroll flex h-full flex-col overflow-y-auto bg-transparent p-3 text-xs">
      <div class="mb-3 flex items-center justify-between">
        <span class="font-semibold uppercase tracking-wider text-muted text-[11px]">
          Tokens on scene ({tokenList.length})
        </span>
        <button
          type="button"
          onClick={handleCreate}
          class="rounded bg-accent px-2 py-1 text-[11px] font-medium text-white hover:opacity-90 transition-opacity"
        >
          + Add Token
        </button>
      </div>

      {tokenList.length === 0 ? (
        <div class="flex flex-1 flex-col items-center justify-center p-6 text-center text-muted">
          <span class="text-2xl mb-2">👥</span>
          <p class="font-medium">No tokens in this scene</p>
          <p class="text-[11px] text-muted/70 mt-1">
            Click "+ Add Token" to spawn a token on the board.
          </p>
        </div>
      ) : (
        <div class="space-y-1.5">
          {tokenList.map((t) => {
            const lockUser = lockMap.get(t.id);
            return (
              <div
                key={t.id}
                class="flex items-center justify-between rounded-md border border-white/5 bg-black/20 p-2 text-xs hover:border-white/10 transition-colors"
              >
                <div class="flex items-center gap-2 min-w-0">
                  <div class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/10 font-bold text-white text-[11px]">
                    {t.name ? t.name.slice(0, 2).toUpperCase() : "TK"}
                  </div>
                  <div class="min-w-0">
                    <p class="font-medium text-white text-xs truncate">
                      {t.name || t.id}
                    </p>
                    <p class="text-[10px] text-muted font-mono">
                      x: {Math.round(t.x)} · y: {Math.round(t.y)} · rev: {t._rev}
                    </p>
                  </div>
                </div>
                {lockUser && (
                  <span
                    class="shrink-0 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300"
                    title={`Locked by ${lockUser}`}
                  >
                    🔒 {lockUser}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
