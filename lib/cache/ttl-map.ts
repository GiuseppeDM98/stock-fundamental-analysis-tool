// A minimal in-memory cache with a time to live. Per process: on Vercel each serverless
// instance has its own, which is enough for what it is for — the same page asking the same
// series twice — and not a shared cache. Pure: the clock is a parameter, so a test moves it.

/**
 * @param ttlMs      How long a value is served after it was set.
 * @param now        The clock (injected in tests).
 * @param maxEntries Past this size a write first drops the expired entries. Fresh entries
 *                   are never evicted: the cap bounds what expired keys leave behind, and
 *                   callers only store answers to validated keys.
 */
export function createTtlMap<V>(ttlMs: number, now: () => number = Date.now, maxEntries = 500) {
  const map = new Map<string, { expires: number; value: V }>();
  return {
    get(key: string): V | undefined {
      const entry = map.get(key);
      if (!entry) return undefined;
      if (entry.expires <= now()) {
        map.delete(key);
        return undefined;
      }
      return entry.value;
    },
    set(key: string, value: V): void {
      if (map.size >= maxEntries) {
        for (const [k, entry] of map) if (entry.expires <= now()) map.delete(k);
      }
      map.set(key, { expires: now() + ttlMs, value });
    },
    /** Entries held, expired ones included until a read or a prune drops them. */
    size(): number {
      return map.size;
    },
  };
}
