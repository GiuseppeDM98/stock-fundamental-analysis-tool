// Client-side fetch helpers for portfolio positions and history.
// Thin wrappers over the API routes — keeps components clean.
import type { Position, CreatePositionRequest, SnapshotPoint } from "@/types/portfolio";

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

export async function fetchSnapshots(): Promise<SnapshotPoint[]> {
  const res = await fetch("/api/portfolio/snapshots");
  if (!res.ok) throw new Error("Failed to load portfolio history");
  return res.json();
}
