/**
 * Token bucket shared by every outbound CHUNITHM-NET request.
 *
 * SEGA rate limits aggressively and a ban affects the whole instance, not one
 * user, so the ceiling is global rather than per session.
 */
export class RateLimiter {
  private tokens: number;
  private lastRefill = Date.now();
  private readonly queue: Array<() => void> = [];
  private draining = false;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
  ) {
    this.tokens = capacity;
  }

  async acquire(): Promise<void> {
    this.refill();

    if (this.tokens >= 1 && this.queue.length === 0) {
      this.tokens -= 1;
      return;
    }

    await new Promise<void>((resolve) => {
      this.queue.push(resolve);
      void this.drain();
    });
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;

    if (elapsed <= 0) return;

    this.tokens = Math.min(
      this.capacity,
      this.tokens + elapsed * this.refillPerSecond,
    );
    this.lastRefill = now;
  }

  private async drain(): Promise<void> {
    if (this.draining) return;

    this.draining = true;

    try {
      while (this.queue.length > 0) {
        this.refill();

        if (this.tokens >= 1) {
          this.tokens -= 1;
          this.queue.shift()?.();
          continue;
        }

        const waitMs = Math.ceil(
          ((1 - this.tokens) / this.refillPerSecond) * 1000,
        );

        await new Promise((resolve) =>
          setTimeout(resolve, Math.max(waitMs, 10)),
        );
      }
    } finally {
      this.draining = false;
    }
  }
}
