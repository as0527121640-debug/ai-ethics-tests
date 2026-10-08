export type ProviderErrorKind =
  | 'auth' // bad or missing key: stop the run
  | 'quota' // daily quota exhausted: pause the run until it resets
  | 'rate' // per-minute limit: wait and retry
  | 'server' // 5xx or network: retry with backoff
  | 'unavailable' // still failing after the server retries: pause the run
  | 'bad_request'; // the provider rejected the request itself

export class ProviderError extends Error {
  constructor(
    public kind: ProviderErrorKind,
    message: string,
    public retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

/** Spaces out calls to stay under a provider's requests-per-minute limit. */
export class RateLimiter {
  private next = 0;

  constructor(
    public rpm: number,
    private now: () => number = () => Date.now(),
    private sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  /** Resolves when the caller may send its request. */
  async acquire(): Promise<void> {
    if (!(this.rpm > 0) || !Number.isFinite(this.rpm)) return;
    const interval = 60_000 / this.rpm;
    const t = this.now();
    const slot = Math.max(t, this.next);
    this.next = slot + interval;
    if (slot > t) await this.sleep(slot - t);
  }

  /** Pushes every future slot back, e.g. after a 429 with a retry delay. */
  backOff(ms: number): void {
    this.next = Math.max(this.next, this.now() + ms);
  }
}
