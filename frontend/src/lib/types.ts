export interface Membership {
  org_id: string;
  role: string;
}

export interface Me {
  user: { id: string; email: string; created_at: string };
  memberships: Membership[];
}

export interface Org {
  id: string;
  name: string;
  created_at: string;
}

export type SongStatus = "uploaded" | "processing" | "ready" | "failed";

export interface Song {
  id: string;
  org_id: string;
  title: string;
  original_filename: string;
  status: SongStatus;
  duration_sec: number | null;
  sample_rate: number | null;
  is_favorite: boolean;
  archived: boolean;
  folder: string | null;
  created_at: string;
}

export interface SongUpdate {
  title?: string;
  is_favorite?: boolean;
  archived?: boolean;
  folder?: string | null;
}

export interface Job {
  id: string;
  type: string;
  status: "queued" | "running" | "succeeded" | "failed";
  progress: number;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
}

export interface Section {
  label: string;
  start: number;
  end: number;
  confidence: number;
}

export interface Analysis {
  bpm: number | null;
  bpm_confidence: number | null;
  music_key: string | null;
  key_confidence: number | null;
  time_signature: string | null;
  click_offset_sec: number | null;
  beat_grid: number[] | null;
  downbeats: number[] | null;
  tempo_map: { time: number; bpm: number }[] | null;
  sections: Section[] | null;
}

export interface Marker {
  id: string;
  position_sec: number;
  label: string;
  kind: "section" | "cue";
}

export interface GuideCue {
  time: number;
  text: string;
}

export interface GuideTrack {
  beats_per_bar: number;
  count_in_bars: number;
  cues: GuideCue[];
}

export interface Stem {
  id: string;
  name: string;
  stem_type: string;
  duration_sec: number | null;
  pitch_semitones: number;
  url: string;
}

export interface TransposeResult {
  semitones: number;
  status: "ready" | "processing";
}

export interface UploadUrl {
  upload_url: string;
  storage_key: string;
}

// ─── Mix presets ─────────────────────────────────────────────
export interface StemMixSnapshot {
  volume: number;
  pan: number;
  muted: boolean;
  soloed: boolean;
}

export interface MixPreset {
  id: string;
  name: string;
  // keyed by stem_type
  data: Record<string, StemMixSnapshot>;
  created_at: string;
}

// ─── Routing presets ─────────────────────────────────────────
export interface RoutingAssignment {
  output: number;
  channel: number;
  label?: string;
}

export interface RoutingData {
  assignments: Record<string, RoutingAssignment>;
  notes?: string;
}

export interface RoutingPreset {
  id: string;
  org_id: string;
  name: string;
  data: RoutingData;
  created_at: string;
}

// ─── Setlists ────────────────────────────────────────────────
export interface SetlistItem {
  id: string;
  song_id: string;
  position: number;
  semitones: number;
  notes: string | null;
  song_title: string | null;
  song_status: SongStatus | null;
}

export interface Setlist {
  id: string;
  org_id: string;
  name: string;
  service_date: string | null;
  notes: string | null;
  created_at: string;
  items: SetlistItem[];
}

// ─── Export package ──────────────────────────────────────────
export interface PackageStem {
  name: string;
  stem_type: string;
  url: string;
}

export interface PackageMarker {
  position_sec: number;
  label: string;
  kind: string;
}

export interface PlaybackPackage {
  song_id: string;
  title: string;
  semitones: number;
  music_key: string | null;
  bpm: number | null;
  time_signature: string | null;
  duration_sec: number | null;
  stems: PackageStem[];
  markers: PackageMarker[];
  routing: ({ name: string } & RoutingData) | null;
}
