import { useState, useEffect, useCallback } from "preact/hooks";
import { users as usersSignal, currentUser, type PublicUser } from "../state/auth";
import { gmUsersModalOpen } from "../state/ui";
import { listUsers, gmResetPassword, gmDeleteUser } from "../net/auth";

const MIN_PASSWORD_LEN = 8;

export function GmUsersModal() {
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string>("");
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const close = useCallback(() => {
    gmUsersModalOpen.value = false;
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

  const refresh = useCallback(async () => {
    setLoading(true);
    await listUsers();
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const submitReset = async (e: Event) => {
    e.preventDefault();
    if (busy || !selected || newPassword.length < MIN_PASSWORD_LEN) return;
    setBusy(true);
    setFeedback(null);
    const err = await gmResetPassword(selected, newPassword);
    setBusy(false);
    if (err) {
      setFeedback({ kind: "err", text: err.code === "not-found" ? "Usuario no encontrado." : `Error: ${err.status}` });
    } else {
      setFeedback({ kind: "ok", text: `Contraseña para "${selected}" actualizada con éxito.` });
      setNewPassword("");
    }
  };

  const onDelete = async (username: string) => {
    if (busy) return;
    if (!window.confirm(`¿Eliminar al usuario "${username}"? Esta acción no se puede deshacer.`)) return;
    setBusy(true);
    setFeedback(null);
    const err = await gmDeleteUser(username);
    setBusy(false);
    if (err) {
      const map: Record<string, string> = {
        "cannot-delete-self": "No puedes eliminar tu propia cuenta.",
        "cannot-delete-last-gm": "No puedes eliminar al último GM del sistema.",
        "not-found": "Usuario no encontrado.",
      };
      setFeedback({ kind: "err", text: map[err.code] ?? `Error: ${err.status}` });
      return;
    }
    setFeedback({ kind: "ok", text: `Usuario "${username}" eliminado.` });
    if (selected === username) setSelected("");
    await refresh();
  };

  return (
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs">
      <div class="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-lg border border-white/10 bg-[#181a1f] shadow-2xl text-xs text-[#e7e9ee]">
        {/* Header */}
        <header class="flex items-center justify-between border-b border-white/10 px-5 py-3.5 bg-[#14171c] rounded-t-lg">
          <div class="flex items-center gap-2">
            <span class="text-base">🛡️</span>
            <h2 class="text-sm font-semibold tracking-wide text-white">
              Gestión de Cuentas de Usuario (GM)
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
        <div class="flex-1 overflow-y-auto p-5 space-y-6">
          {/* User List */}
          <section class="rounded-lg border border-white/10 bg-black/30 p-4">
            <h3 class="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
              Cuentas registradas
            </h3>
            {loading ? (
              <p class="text-xs text-muted">Cargando usuarios…</p>
            ) : (
              <UserTable
                list={usersSignal.value}
                currentUsername={currentUser.value?.username ?? ""}
                onDelete={onDelete}
                busy={busy}
              />
            )}
          </section>

          {/* Reset Password */}
          <section class="rounded-lg border border-white/10 bg-black/30 p-4">
            <h3 class="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
              Restablecer contraseña de usuario
            </h3>
            <form onSubmit={submitReset} class="flex flex-col gap-3">
              <div class="grid grid-cols-2 gap-3">
                <select
                  value={selected}
                  onChange={(e) => setSelected((e.target as HTMLSelectElement).value)}
                  disabled={busy}
                  class="rounded border border-white/10 bg-black/40 px-3 py-2 text-xs text-white outline-none focus:border-accent"
                >
                  <option value="">— Seleccionar usuario —</option>
                  {usersSignal.value.map((u) => (
                    <option key={u.username} value={u.username}>
                      {u.username} ({u.role})
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  placeholder={`Nueva contraseña (mín ${MIN_PASSWORD_LEN} caracteres)`}
                  value={newPassword}
                  onInput={(e) => setNewPassword((e.target as HTMLInputElement).value)}
                  disabled={busy}
                  autocomplete="off"
                  spellcheck={false}
                  class="rounded border border-white/10 bg-black/40 px-3 py-2 text-xs text-white outline-none focus:border-accent"
                />
              </div>
              <button
                type="submit"
                disabled={busy || !selected || newPassword.length < MIN_PASSWORD_LEN}
                class="self-start rounded bg-accentpx-4 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-40 transition-opacity"
              >
                {busy ? "Actualizando..." : "Restablecer contraseña"}
              </button>
            </form>
            {feedback && (
              <p
                class={`mt-3 rounded border px-3 py-2 text-xs ${
                  feedback.kind === "ok"
                    ? "border-green-500/30 bg-green-500/10 text-green-300"
                    : "border-red-500/30 bg-red-500/10 text-red-300"
                }`}
              >
                {feedback.text}
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function UserTable({
  list,
  currentUsername,
  onDelete,
  busy,
}: {
  list: PublicUser[];
  currentUsername: string;
  onDelete: (username: string) => void;
  busy: boolean;
}) {
  if (list.length === 0) {
    return <p class="text-xs text-muted">No hay usuarios registrados aún.</p>;
  }
  return (
    <table class="w-full text-xs">
      <thead>
        <tr class="text-muted border-b border-white/5">
          <th class="py-2 text-left font-normal">Usuario</th>
          <th class="py-2 text-left font-normal">Rol</th>
          <th class="py-2 text-right font-normal">Creado</th>
          <th class="py-2 text-right font-normal">Acciones</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-white/5">
        {list.map((u) => {
          const isSelf = u.username === currentUsername;
          return (
            <tr key={u.username} class="hover:bg-white/[0.02]">
              <td class="py-2 text-white font-medium">
                {u.username}
                {isSelf && <span class="ml-1.5 text-[10px] text-muted">(tú)</span>}
              </td>
              <td class="py-2">
                <span
                  class={`rounded px-1.5 py-0.2 text-[10px] font-bold uppercase ${
                    u.role === "GM"
                      ? "bg-amber-500/20 text-amber-300"
                      : "bg-blue-500/20 text-blue-300"
                  }`}
                >
                  {u.role}
                </span>
              </td>
              <td class="py-2 text-right text-muted">
                {new Date(u.createdAt).toISOString().slice(0, 10)}
              </td>
              <td class="py-2 text-right">
                <button
                  type="button"
                  onClick={() => onDelete(u.username)}
                  disabled={busy || isSelf}
                  title={isSelf ? "No puedes borrarte a ti mismo" : "Eliminar cuenta"}
                  class="rounded border border-red-500/30 px-2 py-0.5 text-xs text-red-300 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-30 transition-colors"
                >
                  Eliminar
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
