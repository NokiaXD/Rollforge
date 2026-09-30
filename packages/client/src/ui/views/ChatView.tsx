import { useEffect, useRef } from "preact/hooks";
import { messages, chatDraft } from "../../state/chat";
import { sendChatMessage } from "../../net/socket";
import { lastError } from "../../state/scene";
import type { DiceResult, DiceRoll } from "@rollforge/protocol";

function RollBreakdown({ result }: { result: DiceResult }) {
  return (
    <div class="mt-1 space-y-1 text-xs">
      {result.terms.map((diceTerm, termIndex) => (
        <div key={termIndex}>
          <span class="text-muted">
            {diceTerm.roll.sign === -1 ? "−" : "+"}
            {diceTerm.roll.count}d{diceTerm.roll.sides || "F"}
            {diceTerm.roll.kept !== undefined ? `k${diceTerm.roll.kept}` : ""}:
          </span>{" "}
          <span>[</span>
          {diceTerm.rolls.map((diceResult, diceaResultIndex) => {
            const kept =
              diceTerm.kept.includes(diceResult) &&
              diceTerm.kept.filter((k) => k === diceResult).length >=
                diceTerm.rolls.slice(0, diceaResultIndex + 1).filter((x) => x === diceResult).length;
            return (
              <span
                key={diceaResultIndex}
                class={kept ? "text-emerald-300 font-semibold" : "text-red-400 line-through opacity-70"}
              >
                {diceResult}
                {diceaResultIndex < diceTerm.rolls.length - 1 ? <span class="text-white no-underline">,</span>  : ""}
              </span>
            );
          })}
          <span>] = {diceTerm.subtotal}</span>
        </div>
      ))}
      {result.modifier !== 0 && <div class="text-muted">mod {result.modifier}</div>}
      <div class="font-semibold text-emerald-300">Total: {result.total}</div>
    </div>
  );
}

function RollHeader({ rolls }: { rolls: DiceRoll[] }) {
  return (
    <span class="text-muted text-xs">
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

export function ChatView() {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [messages.value.length]);

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
    <div class="flex h-full flex-col bg-transparent text-xs">
      <div ref={listRef} class="chat-scroll flex-1 space-y-2.5 overflow-y-auto p-3">
        {list.length === 0 ? (
          <div class="flex h-full flex-col items-center justify-center p-4 text-center text-muted">
            <span class="text-2xl mb-2">💬</span>
            <p class="font-medium">No messages yet</p>
            <p class="text-[11px] text-muted/70 mt-1">
              Type <code class="bg-white/10 px-1 py-0.5 rounded text-white">/roll 1d20</code> or chat with players.
            </p>
          </div>
        ) : (
          list.map((m) => {
            const isRoll = m.kind === "roll";
            return (
              <div
                key={`${m.seq}-${m.id}`}
                class={`rounded-md border p-2 text-xs transition-colors ${
                  m.whisperTo
                    ? "border-fuchsia-500/30 bg-fuchsia-500/5"
                    : isRoll
                    ? "border-amber-500/20 bg-amber-500/5"
                    : "border-white/5 bg-white/[0.02]"
                }`}
              >
                <div class="mb-1 flex items-center justify-between text-[10px] text-muted">
                  <div class="flex items-center gap-1.5">
                    <span
                      class={`rounded px-1.5 py-0.2 font-bold uppercase tracking-wider ${
                        m.role === "GM"
                          ? "bg-amber-500/20 text-amber-300"
                          : "bg-blue-500/20 text-blue-300"
                      }`}
                    >
                      {m.role}
                    </span>
                    <span class="font-medium text-fg">{m.username}</span>
                    {m.actor?.type === "character" && (
                      <span class="rounded bg-emerald-500/20 px-1.5 py-0.2 text-emerald-300">
                        {m.actor.name}
                      </span>
                    )}
                  </div>
                  {m.whisperTo && (
                    <span class="text-fuchsia-300 font-medium">→ {m.whisperTo}</span>
                  )}
                </div>
                <div class={`wrap-break-word font-mono text-fg ${isRoll ? "font-medium text-sm" : ""}`}>
                  {m.text}
                </div>
                {isRoll && m.rolls && m.result && (
                  <div class="mt-1.5 border-t border-white/5 pt-1.5">
                    <RollHeader rolls={m.rolls} />
                    <RollBreakdown result={m.result} />
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {errBanner && (
        <div class="border-t border-red-500/30 bg-red-500/15 px-3 py-1.5 text-xs text-red-200">
          {errBanner}
        </div>
      )}

      <form onSubmit={onSubmit} class="flex gap-2 border-t border-white/10 bg-[#14171c]/80 p-2">
        <input
          class="flex-1 rounded border border-white/10 bg-black/40 px-3 py-1.5 text-xs text-white placeholder:text-muted/60 outline-none focus:border-accent"
          value={chatDraft.value}
          onInput={(e) => (chatDraft.value = (e.target as HTMLInputElement).value)}
          placeholder="/roll 1d20+5, /w user msg..."
          maxLength={2000}
        />
        <button
          type="submit"
          class=" text-white *:hover:text-accent transition-opacity text-2xl"
        >
          <i class="nf nf-cod-send"></i>
        </button>
      </form>
    </div>
  );
}
