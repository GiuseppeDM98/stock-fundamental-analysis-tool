// Client-side fetch helpers for portfolio positions.
// Thin wrappers over the /api/positions routes — keeps components clean.
import type { Position, CreatePositionRequest } from "@/types/portfolio";

export async function fetchPositions(): Promise<Position[]> {
  const res = await fetch("/api/positions");
  if (!res.ok) throw new Error("Failed to load positions");
  return res.json();
}

export async function createPosition(data: CreatePositionRequest): Promise<Position> {
  const res = await fetch("/api/positions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? "Failed to create position");
  }
  return res.json();
}

export async function deletePosition(id: string): Promise<void> {
  const res = await fetch(`/api/positions/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete position");
}
