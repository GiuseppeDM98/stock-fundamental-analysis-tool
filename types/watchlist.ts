export type WatchlistFreq = "biweekly" | "monthly";

export interface WatchlistLastRun {
  runAt: string;
  fairValueBull: number | null;
  fairValueBase: number | null;
  fairValueBear: number | null;
  method: string | null;
  currency: string | null;
}

export interface WatchlistItem {
  id: string;
  ticker: string;
  companyName: string;
  mosPercent: number;
  notes: string | null;
  addedAt: string;
  lastRun: WatchlistLastRun | null;
}

export interface WatchlistSettings {
  watchlistEmail: string | null;
  watchlistFreq: WatchlistFreq;
  watchlistEnabled: boolean;
}

export interface WatchlistResponse {
  items: WatchlistItem[];
  settings: WatchlistSettings;
}

export interface AddWatchlistItemRequest {
  ticker: string;
  companyName: string;
  mosPercent?: number;
  notes?: string;
}

export interface PatchWatchlistItemRequest {
  mosPercent?: number;
  notes?: string | null;
}

export interface PatchWatchlistSettingsRequest {
  watchlistEmail?: string | null;
  watchlistFreq?: WatchlistFreq;
  watchlistEnabled?: boolean;
}
