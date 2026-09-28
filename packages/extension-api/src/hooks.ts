import type { HookName, NotifyHandler, FilterHandler } from "@rollforge/protocol";

interface NotifyListener<T = any> {
  handler: NotifyHandler<T>;
  ownerId?: string | undefined;
}

interface FilterListener<T = any> {
  handler: FilterHandler<T>;
  priority: number;
  index: number;
  ownerId?: string | undefined;
}

export class HooksEngine {
  private notifyListeners = new Map<HookName, NotifyListener[]>();
  private filterListeners = new Map<HookName, FilterListener[]>();
  private counter = 0;

  on<T = unknown>(
    event: HookName,
    handler: NotifyHandler<T>,
    opts?: { ownerId?: string }
  ): () => void {
    const list = this.notifyListeners.get(event) ?? [];
    list.push({ handler, ownerId: opts?.ownerId });
    this.notifyListeners.set(event, list);
    return () => this.off(event, handler);
  }

  async emit<T = unknown>(event: HookName, payload: T): Promise<void> {
    const list = this.notifyListeners.get(event);
    if (!list || list.length === 0) return;
    await Promise.allSettled(
      list.map(async (entry) => {
        try {
          await entry.handler(payload);
        } catch (err) {
          console.error(`[hook:${event}] error from ${entry.ownerId ?? "unknown"}:`, err);
          throw err;
        }
      })
    );
  }

  filter<T = unknown>(
    event: HookName,
    handler: FilterHandler<T>,
    opts?: { priority?: number; ownerId?: string }
  ): () => void {
    const list = this.filterListeners.get(event) ?? [];
    list.push({
      handler,
      priority: opts?.priority ?? 0,
      index: this.counter++,
      ownerId: opts?.ownerId,
    });
    this.filterListeners.set(event, list);
    return () => this.off(event, handler);
  }

  async runFilter<T = unknown>(event: HookName, value: T): Promise<T | null> {
    const list = this.filterListeners.get(event);
    if (!list || list.length === 0) return value;

    const sorted = [...list].sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      if (a.index !== b.index) return a.index - b.index;
      return (a.ownerId ?? "").localeCompare(b.ownerId ?? "");
    });

    let current: T = value;
    for (const entry of sorted) {
      try {
        const next = await entry.handler(current);
        if (next === null) {
          return null;
        }
        current = next;
      } catch (err) {
        console.error(`[hook-filter:${event}] error from ${entry.ownerId ?? "unknown"}:`, err);
      }
    }
    return current;
  }

  off(event: HookName, handler: NotifyHandler<any> | FilterHandler<any>): void {
    const notifyList = this.notifyListeners.get(event);
    if (notifyList) {
      this.notifyListeners.set(
        event,
        notifyList.filter((e) => e.handler !== handler)
      );
    }
    const filterList = this.filterListeners.get(event);
    if (filterList) {
      this.filterListeners.set(
        event,
        filterList.filter((e) => e.handler !== handler)
      );
    }
  }

  clear(ownerId: string): void {
    for (const [event, list] of this.notifyListeners.entries()) {
      this.notifyListeners.set(
        event,
        list.filter((e) => e.ownerId !== ownerId)
      );
    }
    for (const [event, list] of this.filterListeners.entries()) {
      this.filterListeners.set(
        event,
        list.filter((e) => e.ownerId !== ownerId)
      );
    }
  }
}
