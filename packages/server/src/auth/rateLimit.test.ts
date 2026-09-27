import { describe, it, expect } from "vitest";
import { LoginRateLimiter } from "./rateLimit";

describe("LoginRateLimiter", () => {
  it("allows until maxFailures failures, then blocks", () => {
    const lim = new LoginRateLimiter({ maxFailures: 3, windowMs: 60_000, blockMs: 30_000 });
    expect(lim.check("u:i")).toBeNull();
    lim.recordFailure("u:i");
    lim.recordFailure("u:i");
    expect(lim.check("u:i")).toBeNull();
    lim.recordFailure("u:i");
    expect(lim.check("u:i")).not.toBeNull();
  });

  it("recordSuccess clears the bucket", () => {
    const lim = new LoginRateLimiter({ maxFailures: 2 });
    lim.recordFailure("u:i");
    lim.recordFailure("u:i");
    lim.recordSuccess("u:i");
    expect(lim.check("u:i")).toBeNull();
  });

  it("separate keys have independent buckets", () => {
    const lim = new LoginRateLimiter({ maxFailures: 1 });
    lim.recordFailure("a:x");
    expect(lim.check("a:x")).not.toBeNull();
    expect(lim.check("b:x")).toBeNull();
  });
});