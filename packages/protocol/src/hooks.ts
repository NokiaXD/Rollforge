export type HookName = string;

export type NotifyHandler<T = unknown> = (payload: T) => void | Promise<void>;

export type FilterHandler<T = unknown> = (
  value: T,
  ctx: { priority: number },
) => T | Promise<T>;

export interface HooksAPI<T = unknown> {
  on(event: HookName, handler: NotifyHandler<T>): void;
  filter(event: HookName, handler: FilterHandler<T>, opts?: { priority?: number }): void;
  off(event: HookName, handler: NotifyHandler<T> | FilterHandler<T>): void;
}