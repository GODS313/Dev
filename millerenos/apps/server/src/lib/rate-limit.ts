/** Small in-memory fixed-window limiter (per process). Move to Redis when running >1 replica. */
export class WindowLimiter {
  private hits = new Map<string, { start: number; n: number }>();
  constructor(
    private limit: number,
    private windowMs: number,
  ) {}

  allow(key: string, now = Date.now()): boolean {
    const cur = this.hits.get(key);
    if (!cur || now - cur.start >= this.windowMs) {
      this.hits.set(key, { start: now, n: 1 });
      if (this.hits.size > 50_000) this.sweep(now);
      return true;
    }
    cur.n += 1;
    return cur.n <= this.limit;
  }

  private sweep(now: number) {
    for (const [k, v] of this.hits) if (now - v.start >= this.windowMs) this.hits.delete(k);
  }
}
