import type {
  Analysis,
  GuideTrack,
  Job,
  Marker,
  Me,
  MixPreset,
  PlaybackPackage,
  RoutingData,
  RoutingPreset,
  Setlist,
  Song,
  SongUpdate,
  Stem,
  StemMixSnapshot,
  TransposeResult,
  UploadUrl,
} from "./types";

const BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
const TOKEN_KEY = "aisplit_token";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (typeof window === "undefined") return;
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail ?? detail;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, detail);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  register: (email: string, password: string, org_name: string) =>
    request<{ access_token: string }>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password, org_name }),
    }),

  login: (email: string, password: string) =>
    request<{ access_token: string }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  me: () => request<Me>("/auth/me"),

  listSongs: (orgId: string, opts: SongQuery = {}) => {
    const p = new URLSearchParams({ org_id: orgId });
    if (opts.q) p.set("q", opts.q);
    if (opts.folder) p.set("folder", opts.folder);
    if (opts.favoritesOnly) p.set("favorites_only", "true");
    if (opts.includeArchived) p.set("include_archived", "true");
    return request<Song[]>(`/songs?${p.toString()}`);
  },

  getSong: (id: string) => request<Song>(`/songs/${id}`),

  updateSong: (id: string, patch: SongUpdate) =>
    request<Song>(`/songs/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),

  getUploadUrl: (orgId: string, filename: string, contentType: string) =>
    request<UploadUrl>("/songs/upload-url", {
      method: "POST",
      body: JSON.stringify({ org_id: orgId, filename, content_type: contentType }),
    }),

  createSong: (orgId: string, title: string, filename: string, storageKey: string) =>
    request<Song>("/songs", {
      method: "POST",
      body: JSON.stringify({
        org_id: orgId,
        title,
        original_filename: filename,
        storage_key: storageKey,
      }),
    }),

  deleteSong: (id: string) => request<void>(`/songs/${id}`, { method: "DELETE" }),

  getJob: (songId: string) => request<Job>(`/songs/${songId}/job`),

  getAnalysis: (songId: string) => request<Analysis>(`/songs/${songId}/analysis`),

  updateAnalysis: (songId: string, patch: Partial<Analysis>) =>
    request<Analysis>(`/songs/${songId}/analysis`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  // ── Section / cue markers ────────────────────────────────
  listMarkers: (songId: string) => request<Marker[]>(`/songs/${songId}/markers`),

  createMarker: (songId: string, body: { position_sec: number; label: string; kind?: "section" | "cue" }) =>
    request<Marker>(`/songs/${songId}/markers`, {
      method: "POST",
      body: JSON.stringify({ kind: "section", ...body }),
    }),

  updateMarker: (
    songId: string,
    markerId: string,
    patch: { position_sec?: number; label?: string; kind?: "section" | "cue" }
  ) =>
    request<Marker>(`/songs/${songId}/markers/${markerId}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  deleteMarker: (songId: string, markerId: string) =>
    request<void>(`/songs/${songId}/markers/${markerId}`, { method: "DELETE" }),

  // ── Guide track ──────────────────────────────────────────
  getGuide: (songId: string, countInBars = 1) =>
    request<GuideTrack>(`/songs/${songId}/guide?count_in_bars=${countInBars}`),

  listStems: (songId: string, semitones = 0) =>
    request<Stem[]>(`/songs/${songId}/stems?semitones=${semitones}`),

  transpose: (songId: string, semitones: number) =>
    request<TransposeResult>(`/songs/${songId}/transpose`, {
      method: "POST",
      body: JSON.stringify({ semitones }),
    }),

  downloadStem: (stemId: string) =>
    request<{ url: string }>(`/stems/${stemId}/download`),

  // ── Mix presets ──────────────────────────────────────────
  listMixes: (songId: string) => request<MixPreset[]>(`/songs/${songId}/mixes`),

  saveMix: (songId: string, name: string, data: Record<string, StemMixSnapshot>) =>
    request<MixPreset>(`/songs/${songId}/mixes`, {
      method: "POST",
      body: JSON.stringify({ name, data }),
    }),

  deleteMix: (songId: string, mixId: string) =>
    request<void>(`/songs/${songId}/mixes/${mixId}`, { method: "DELETE" }),

  // ── Routing presets (per org/venue) ──────────────────────
  listRoutingPresets: (orgId: string) =>
    request<RoutingPreset[]>(`/orgs/${orgId}/routing-presets`),

  saveRoutingPreset: (orgId: string, name: string, data: RoutingData) =>
    request<RoutingPreset>(`/orgs/${orgId}/routing-presets`, {
      method: "POST",
      body: JSON.stringify({ name, data }),
    }),

  deleteRoutingPreset: (orgId: string, presetId: string) =>
    request<void>(`/orgs/${orgId}/routing-presets/${presetId}`, { method: "DELETE" }),

  // ── Setlists / service planning ──────────────────────────
  listSetlists: (orgId: string) => request<Setlist[]>(`/setlists?org_id=${orgId}`),

  getSetlist: (id: string) => request<Setlist>(`/setlists/${id}`),

  createSetlist: (orgId: string, name: string, serviceDate?: string | null) =>
    request<Setlist>("/setlists", {
      method: "POST",
      body: JSON.stringify({ org_id: orgId, name, service_date: serviceDate ?? null }),
    }),

  updateSetlist: (
    id: string,
    patch: { name?: string; service_date?: string | null; notes?: string | null }
  ) => request<Setlist>(`/setlists/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),

  deleteSetlist: (id: string) =>
    request<void>(`/setlists/${id}`, { method: "DELETE" }),

  addSetlistItem: (id: string, songId: string, semitones = 0) =>
    request<Setlist>(`/setlists/${id}/items`, {
      method: "POST",
      body: JSON.stringify({ song_id: songId, semitones }),
    }),

  updateSetlistItem: (
    id: string,
    itemId: string,
    patch: { semitones?: number; notes?: string | null }
  ) =>
    request<Setlist>(`/setlists/${id}/items/${itemId}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  removeSetlistItem: (id: string, itemId: string) =>
    request<Setlist>(`/setlists/${id}/items/${itemId}`, { method: "DELETE" }),

  reorderSetlist: (id: string, itemIds: string[]) =>
    request<Setlist>(`/setlists/${id}/reorder`, {
      method: "POST",
      body: JSON.stringify({ item_ids: itemIds }),
    }),

  // ── Export package ───────────────────────────────────────
  getPackage: (songId: string, semitones = 0, routingPresetId?: string) => {
    const p = new URLSearchParams({ semitones: String(semitones) });
    if (routingPresetId) p.set("routing_preset_id", routingPresetId);
    return request<PlaybackPackage>(`/songs/${songId}/package?${p.toString()}`);
  },
};

export interface SongQuery {
  q?: string;
  folder?: string;
  favoritesOnly?: boolean;
  includeArchived?: boolean;
}

export { ApiError };

/** Upload a file directly to storage via a presigned PUT URL, reporting progress. */
export function putToStorage(
  url: string,
  file: File,
  onProgress: (pct: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Upload failed: ${xhr.status}`));
    xhr.onerror = () => reject(new Error("Upload network error"));
    xhr.send(file);
  });
}
