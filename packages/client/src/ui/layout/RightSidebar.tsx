import { chatOpen, toggleChat } from "../../state/chat";
import { ChatView } from "../views/ChatView";

export function RightSidebar() {
  if (!chatOpen.value) return null;

  return (
    <aside class="pointer-events-auto flex w-80 shrink-0 flex-col border-l border-white/10 bg-[#181a1f]/95 backdrop-blur-md text-[#e7e9ee] shadow-2xl z-20">
      {/* Right Sidebar Header */}
      <div class="flex h-9 shrink-0 items-center justify-between border-b border-white/10 px-3">
        <div class="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
          <span>Chat & Dados</span>
        </div>
      </div>

      {/* Right Sidebar Content View */}
      <div class="flex-1 min-h-0 overflow-hidden">
        <ChatView />
      </div>
    </aside>
  );
}
