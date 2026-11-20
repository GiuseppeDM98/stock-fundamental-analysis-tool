// @vitest-environment node
// The client never writes an analysis: the AI routes create the row and write each phase's
// result themselves (lib/analyses-store.ts). These routes only read and delete.
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "u1" } })) }));
vi.mock("@/lib/db", () => ({ db: {} }));

describe("/api/analyses — read and delete only", () => {
  it("the list has no POST", async () => {
    const list = await import("@/app/api/analyses/route");
    expect(Object.keys(list).sort()).toEqual(["GET"]);
  });

  it("one analysis has no PATCH", async () => {
    const one = await import("@/app/api/analyses/[id]/route");
    expect(Object.keys(one).sort()).toEqual(["DELETE", "GET"]);
  });
});
