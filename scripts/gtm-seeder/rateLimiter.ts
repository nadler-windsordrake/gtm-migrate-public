export const GTM_REQUEST_INTERVAL_MS = 5_000;

type Sleep = (milliseconds: number) => Promise<void>;
type Clock = () => number;

export interface RequestScheduler {
  schedule<T>(task: () => Promise<T>, label: string): Promise<T>;
  defer(milliseconds: number): void;
}

export interface GtmRequestSchedulerOptions {
  intervalMs?: number;
  now?: Clock;
  sleep?: Sleep;
  onWait?: (milliseconds: number, label: string) => void;
}

const defaultSleep: Sleep = async (milliseconds) => {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
};

export class GtmRequestScheduler implements RequestScheduler {
  readonly #intervalMs: number;
  readonly #now: Clock;
  readonly #sleep: Sleep;
  readonly #onWait?: (milliseconds: number, label: string) => void;
  #nextStartAt = 0;
  #tail: Promise<void> = Promise.resolve();

  constructor(options: GtmRequestSchedulerOptions = {}) {
    this.#intervalMs = options.intervalMs ?? GTM_REQUEST_INTERVAL_MS;
    if (!Number.isFinite(this.#intervalMs) || this.#intervalMs < 0) {
      throw new Error("GTM request interval must be a non-negative finite number.");
    }
    this.#now = options.now ?? Date.now;
    this.#sleep = options.sleep ?? defaultSleep;
    this.#onWait = options.onWait;
  }

  schedule<T>(task: () => Promise<T>, label: string): Promise<T> {
    const run = async (): Promise<T> => {
      const waitMs = Math.max(0, this.#nextStartAt - this.#now());
      if (waitMs > 0) {
        this.#onWait?.(waitMs, label);
        await this.#sleep(waitMs);
      }
      this.#nextStartAt = this.#now() + this.#intervalMs;
      return task();
    };
    const result = this.#tail.then(run, run);
    this.#tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  defer(milliseconds: number): void {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) return;
    this.#nextStartAt = Math.max(this.#nextStartAt, this.#now() + milliseconds);
  }
}
