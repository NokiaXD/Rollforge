// ponytail: in-memory limiter. Per-process state, lost on restart. Single-server only.
// For multi-instance deploys swap to a Redis-backed counter — same interface.

interface Bucket {
  failures: number;
  firstFailureAt: number;
  blockedUntil: number;
}

export interface RateLimitOpts {
  maxFailures: number;
  windowMs: number;
  blockMs: number;
}

export class LoginRateLimiter {
  private buckets = new Map<string, Bucket>();
  private readonly opts: Required<RateLimitOpts>;

  constructor(opts: Partial<RateLimitOpts> = {}) {
    this.opts = {
      maxFailures: opts.maxFailures ?? 5,
      windowMs: opts.windowMs ?? 60_000,
      blockMs: opts.blockMs ?? 60_000,
    };
  }

  // Returns seconds until unblock if blocked, otherwise null.
  check(key: string): number | null {
    const b = this.buckets.get(key);
    if (!b) return null;
    const now = Date.now();
    if (b.blockedUntil > now) {
      return Math.ceil((b.blockedUntil - now) / 1000);
    }
    if (now - b.firstFailureAt > this.opts.windowMs) {
      this.buckets.delete(key);
    }
    return null;
  }

  recordFailure(key: string): void {
    const now = Date.now();
    let b = this.buckets.get(key);
    if (!b || now - b.firstFailureAt > this.opts.windowMs) {
      b = { failures: 1, firstFailureAt: now, blockedUntil: 0 };
      this.buckets.set(key, b);
    } else {
      b.failures += 1;
    }
    if (b.failures >= this.opts.maxFailures) {
      b.blockedUntil = now + this.opts.blockMs;
    }
  }

  recordSuccess(key: string): void {
    this.buckets.delete(key);
  }
}