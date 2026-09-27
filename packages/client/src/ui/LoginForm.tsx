import { useState } from "preact/hooks";
import { login, register, type AuthError } from "../net/auth";

type Mode = "login" | "register";

const ERROR_MESSAGES: Record<string, string> = {
  "invalid-username":
    "Username must be 3-32 chars: letters, digits, _ or -.",
  "weak-password": "Password must be at least 8 characters.",
  "username-taken": "That username is already taken.",
  "invalid-credentials": "Wrong username or password.",
  "rate-limited": "Too many attempts. Wait and try again.",
};

function describeError(err: AuthError | null): string | null {
  if (!err) return null;
  if (err.code === "rate-limited" && err.retryAfterSeconds !== undefined) {
    return `${ERROR_MESSAGES["rate-limited"]} (${err.retryAfterSeconds}s)`;
  }
  return ERROR_MESSAGES[err.code] ?? `Request failed (${err.status}).`;
}

export function LoginForm() {
  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AuthError | null>(null);

  const submit = async (e: Event) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const fn = mode === "login" ? login : register;
    const err = await fn(username, password);
    setBusy(false);
    if (err) setError(err);
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
  };

  return (
    <div class="fixed inset-0 grid place-items-center bg-[var(--color-bg)]">
      <form
        onSubmit={submit}
        class="w-80 rounded-xl border border-white/10 bg-white/5 p-6 backdrop-blur"
      >
        <h1 class="mb-1 text-lg font-semibold">RollForge</h1>
        <p class="mb-4 text-xs text-[var(--color-muted)]">
          {mode === "login"
            ? "Sign in to your account."
            : "First account becomes GM; everyone else is Player."}
        </p>

        <label class="mb-2 block text-xs uppercase tracking-wide text-[var(--color-muted)]">
          Username
          <input
            type="text"
            value={username}
            onInput={(e) => setUsername((e.target as HTMLInputElement).value)}
            autocomplete="username"
            autocapitalize="off"
            spellcheck={false}
            disabled={busy}
            class="mt-1 block w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-[var(--color-accent)]"
          />
        </label>

        <label class="mb-3 block text-xs uppercase tracking-wide text-[var(--color-muted)]">
          Password
          <input
            type="password"
            value={password}
            onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
            autocomplete={mode === "login" ? "current-password" : "new-password"}
            disabled={busy}
            class="mt-1 block w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-[var(--color-accent)]"
          />
        </label>

        {error && (
          <p class="mb-3 rounded border border-red-500/30 bg-red-500/10 px-2 py-1 text-xs text-red-300">
            {describeError(error)}
          </p>
        )}

        <button
          type="submit"
          disabled={busy || !username || !password}
          class="block w-full rounded-md bg-[var(--color-accent)] py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {busy ? "..." : mode === "login" ? "Sign in" : "Create account"}
        </button>

        <p class="mt-4 text-center text-xs text-[var(--color-muted)]">
          {mode === "login" ? (
            <>
              No account?{" "}
              <button
                type="button"
                onClick={() => switchMode("register")}
                class="text-[var(--color-accent)] hover:underline"
              >
                Register
              </button>
            </>
          ) : (
            <>
              Already have one?{" "}
              <button
                type="button"
                onClick={() => switchMode("login")}
                class="text-[var(--color-accent)] hover:underline"
              >
                Sign in
              </button>
            </>
          )}
        </p>
      </form>
    </div>
  );
}