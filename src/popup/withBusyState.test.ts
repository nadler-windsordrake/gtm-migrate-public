import { describe, expect, it } from "vitest";
import { withBusyState } from "./withBusyState";

describe("withBusyState", () => {
  it("clears the busy state after success", async () => {
    const states: boolean[] = [];
    await expect(withBusyState((busy) => states.push(busy), async () => "done")).resolves.toBe("done");
    expect(states).toEqual([true, false]);
  });

  it("clears the busy state after failure", async () => {
    const states: boolean[] = [];
    await expect(
      withBusyState((busy) => states.push(busy), async () => {
        throw new Error("access denied");
      }),
    ).rejects.toThrow("access denied");
    expect(states).toEqual([true, false]);
  });
});
