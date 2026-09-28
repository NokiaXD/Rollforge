import { useEffect, useRef } from "preact/hooks";
import { messages, chatOpen, chatDraft } from "../state/chat";
import { sendChatMessage } from "../net/socket";
import { lastError } from "../state/scene";
import type { DiceResult, DiceRoll } from "@rollforge/protocol";

function RollBreakdown({ result }: { result: DiceResult }) {
  return (
    <div class="mt-1 space-y-1 text-xs">
      {result.terms.map((t, i) => (
        <div key={i}>
          <span class="text-[var(--color-muted)]">
            {t.roll.sign === -1 ? "−" : "+"}
            {t.roll.count}d{t.roll.sides || "F"}
            {t.roll.kept !== undefined ? `k${t.roll.kept}` : ""}:
          </span>{" "}
          <span>[</span>
          {t.rolls.map((v, j) => {
            const kept = t.kept.includes(v) &&
              t.kept.filter((k) => k === v).length >=
                t.rolls.slice(0, j + 1).filter((x) => x === v).length;
            return (
              <span key={j} class={kept ? "text-emerald-300" : "text-red-400 line-through"}>
                {v}
                {j < t.rolls.length - 1 ? ", " : ""}
              </span>
            );
          })}
          <span>] = {t.subtotal}</span>
        </div>
      ))}
      {result.modifier !== 0 && (
        <div class="text-[var(--color-muted)]">mod {result.modifier}</div>
      )}
      <div class="font-semibold">total {result.total}</div>
    </div>
  );
}

function RollHeader({ rolls }: { rolls: DiceRoll[] }) {
  return (
    <span class="text-[var(--color-muted)]">
      {rolls.map((r, i) => (
        <span key={i}>
          {i > 0 && r.sign === -1 ? "−" : i > 0 ? "+" : ""}
          {r.count}d{r.sides || "F"}
          {r.kept !== undefined ? `k${r.kept}` : ""}
          {i < rolls.length - 1 ? " " : ""}
        </span>
      ))}
    </span>
  );
}

export function ChatPanel() {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // keep the newest message in view without disrupting scroll-back users;
    // only auto-scroll if they were already at the bottom.
    const el = listRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [messages.value.length]);

  if (!chatOpen.value) return null;

  const onSubmit = (e: Event) => {
    e.preventDefault();
    const text = chatDraft.value.trim();
    if (!text) return;
    sendChatMessage(text);
    chatDraft.value = "";
  };

  const list = messages.value;
  const errBanner = lastError.value
    ? lastError.value.startsWith("SendChatMessage")
      ? lastError.value
      : null
    : null;

  return (
    <div class="fixed bottom-3 left-3 top-16 z-20 flex w-[28rem] max-w-[calc(100vw-1.5rem)] flex-col rounded-lg border border-white/10 bg-black/80 text-xs backdrop-blur">
      <div class="flex items-center justify-between border-b border-white/10 px-3 py-2">
        <span class="font-semibold uppercase tracking-wide text-[var(--color-muted)]">
          Chat ({list.length})
        </span>
        <button
          type="button"
          onClick={() => (chatOpen.value = false)}
          class="text-[var(--color-muted)] hover:text-white"
        >
          ✕
        </button>
      </div>
      <div ref={listRef} class="flex-1 space-y-2 overflow-y-auto px-3 py-2 text-sm">
        {list.length === 0 && (
          <div class="text-[var(--color-muted)]">No messages yet.</div>
        )}
        {list.map((m) => {
          const isRoll = m.kind === "roll";
          return (
            <div
              key={`${m.seq}-${m.id}`}
              class={`rounded border px-2 py-1 ${
                m.whisperTo
                  ? "border-fuchsia-500/30 bg-fuchsia-500/5"
                  : "border-white/5 bg-white/[0.02]"
              }`}
            >
              <div class="flex items-center gap-2 text-[10px] text-[var(--color-muted)]">
                <span
                  class={`rounded px-1.5 py-0.5 font-bold uppercase ${
                    m.role === "GM"
                      ? "bg-amber-500/20 text-amber-300"
                      : "bg-blue-500/20 text-blue-300"
                  }`}
                >
                  {m.role}
                </span>
                <span>{m.username}</span>
                {m.actor?.type === "character" && (
                  <span class="rounded bg-emerald-500/20 px-1.5 py-0.5 text-emerald-300">
                    as {m.actor.name}
                  </span>
                )}
                {m.whisperTo && <span class="text-fuchsia-300">whisper → {m.whisperTo}</span>}
              </div>
              <div class={isRoll ? "font-mono" : ""}>{m.text}</div>
              {isRoll && m.rolls && m.result && (
                <div class="mt-1">
                  <RollHeader rolls={m.rolls} />
                  <RollBreakdown result={m.result} />
                </div>
              )}
            </div>
          );
        })}
      </div>
      {errBanner && (
        <div class="border-t border-red-500/30 bg-red-500/15 px-3 py-1 text-xs text-red-200">
          {errBanner}
        </div>
      )}
      <form class="flex gap-2 border-t border-white/10 p-2" onSubmit={onSubmit}>
        <input
          class="flex-1 rounded border border-white/10 bg-black/30 px-2 py-1 text-sm placeholder:text-[var(--color-muted)]"
          value={chatDraft.value}
          onInput={(e) => (chatDraft.value = (e.target as HTMLInputElement).value)}
          placeholder="/roll 1d20, /w alice message..."
          maxLength={2000}
        />
        <button
          type="submit"
          class="rounded bg-[var(--color-accent)] px-3 py-1 text-xs text-white hover:bg-blue-500"
        >
          Send
        </button>
      </form>
    </div>
  );
}
