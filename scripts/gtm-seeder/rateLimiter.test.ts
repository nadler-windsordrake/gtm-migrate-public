import { describe, expect, it, vi } from "vitest";
import { GTM_REQUEST_INTERVAL_MS, GtmRequestScheduler } from "./rateLimiter";

describe("GTM request scheduler", () => {
  it("serializes concurrent work through one scheduler with minimum request spacing", async () => {
    let now = 1_000;
    const waits: number[] = [];
    const starts: number[] = [];
    const scheduler = new GtmRequestScheduler({
      now: () => now,
      sleep: async (milliseconds) => {
        waits.push(milliseconds);
        now += milliseconds;
      },
    });

    await Promise.all(
      ["one", "two", "three"].map((label) =>
        scheduler.schedule(async () => {
          starts.push(now);
          return label;
        }, label),
      ),
    );

    expect(starts).toEqual([1_000, 6_000, 11_000]);
    expect(waits).toEqual([GTM_REQUEST_INTERVAL_MS, GTM_REQUEST_INTERVAL_MS]);
    expect(starts.slice(1).every((start, index) => start - starts[index]! >= GTM_REQUEST_INTERVAL_MS)).toBe(true);
  });

  it("continues scheduling after an earlier request rejects", async () => {
    let now = 0;
    const sleep = vi.fn(async (milliseconds: number) => {
      now += milliseconds;
    });
    const scheduler = new GtmRequestScheduler({ now: () => now, sleep });
    const failed = scheduler.schedule(async () => {
      throw new Error("failed");
    }, "failed");
    const succeeded = scheduler.schedule(async () => "ok", "succeeded");

    await expect(failed).rejects.toThrow("failed");
    await expect(succeeded).resolves.toBe("ok");
    expect(sleep).toHaveBeenCalledWith(GTM_REQUEST_INTERVAL_MS);
  });

  it("applies retry cooldowns to every request sharing the scheduler", async () => {
    let now = 0;
    const starts: number[] = [];
    const scheduler = new GtmRequestScheduler({
      now: () => now,
      sleep: async (milliseconds) => {
        now += milliseconds;
      },
    });

    await scheduler.schedule(async () => starts.push(now), "first");
    scheduler.defer(20_000);
    await scheduler.schedule(async () => starts.push(now), "second");

    expect(starts).toEqual([0, 20_000]);
  });
});
