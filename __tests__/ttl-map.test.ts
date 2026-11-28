import { describe, it, expect } from "vitest";
import { createTtlMap } from "@/lib/cache/ttl-map";

describe("createTtlMap", () => {
  it("should serve a value within its time to live", () => {
    let clock = 0;
    const cache = createTtlMap<string>(1000, () => clock);
    cache.set("a", "value");

    clock = 999;

    expect(cache.get("a")).toBe("value");
  });

  it("should miss once the time to live has passed", () => {
    let clock = 0;
    const cache = createTtlMap<string>(1000, () => clock);
    cache.set("a", "value");

    clock = 1000;

    expect(cache.get("a")).toBeUndefined();
    expect(cache.size()).toBe(0);
  });

  it("should drop the expired entries on a write past the size cap, and keep the fresh ones", () => {
    let clock = 0;
    const cache = createTtlMap<number>(1000, () => clock, 3);
    cache.set("old-1", 1);
    cache.set("old-2", 2);
    clock = 600;
    cache.set("fresh", 3);

    // old-1 and old-2 expired at 1000; fresh lives until 1600.
    clock = 1200;
    cache.set("new", 4);

    expect(cache.size()).toBe(2);
    expect(cache.get("fresh")).toBe(3);
    expect(cache.get("new")).toBe(4);
  });

  it("should not prune below the size cap", () => {
    let clock = 0;
    const cache = createTtlMap<number>(1000, () => clock, 3);
    cache.set("old", 1);

    clock = 1200;
    cache.set("new", 2);

    expect(cache.size()).toBe(2);
  });
});
