export interface WatchlistItem {
  id: string;
  ticker: string;
  companyName: string;
  mosPercent: number;
  notes: string | null;
  addedAt: string;
}

export interface WatchlistSettings {
  watchlistEmail: string | null;
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
  watchlistEnabled?: boolean;
}
