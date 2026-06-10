import { create } from "zustand";

export interface StemMix {
  volume: number; // 0..1.5
  pan: number; // -1..1
  muted: boolean;
  soloed: boolean;
}

export interface ClickSettings {
  enabled: boolean;
  volume: number; // 0..1.5
  countIn: boolean; // one-bar count-in on play
}

export interface GuideSettings {
  enabled: boolean; // spoken section cues via the Web Speech API
}

interface PlayerState {
  mix: Record<string, StemMix>;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  masterVolume: number; // 0..1.5
  click: ClickSettings;
  guide: GuideSettings;
  ensureStem: (id: string) => void;
  setVolume: (id: string, v: number) => void;
  setPan: (id: string, p: number) => void;
  toggleMute: (id: string) => void;
  toggleSolo: (id: string) => void;
  setPlaying: (playing: boolean) => void;
  setCurrentTime: (t: number) => void;
  setDuration: (d: number) => void;
  setMasterVolume: (v: number) => void;
  setClick: (patch: Partial<ClickSettings>) => void;
  setGuide: (patch: Partial<GuideSettings>) => void;
  applyMix: (mix: Record<string, StemMix>) => void;
  reset: () => void;
}

const DEFAULT_MIX: StemMix = { volume: 1, pan: 0, muted: false, soloed: false };
const DEFAULT_CLICK: ClickSettings = { enabled: false, volume: 0.9, countIn: false };
const DEFAULT_GUIDE: GuideSettings = { enabled: false };

export const usePlayer = create<PlayerState>((set) => ({
  mix: {},
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  masterVolume: 1,
  click: { ...DEFAULT_CLICK },
  guide: { ...DEFAULT_GUIDE },
  ensureStem: (id) =>
    set((s) => (s.mix[id] ? s : { mix: { ...s.mix, [id]: { ...DEFAULT_MIX } } })),
  setVolume: (id, v) =>
    set((s) => ({ mix: { ...s.mix, [id]: { ...s.mix[id], volume: v } } })),
  setPan: (id, p) =>
    set((s) => ({ mix: { ...s.mix, [id]: { ...s.mix[id], pan: p } } })),
  toggleMute: (id) =>
    set((s) => ({ mix: { ...s.mix, [id]: { ...s.mix[id], muted: !s.mix[id].muted } } })),
  toggleSolo: (id) =>
    set((s) => ({ mix: { ...s.mix, [id]: { ...s.mix[id], soloed: !s.mix[id].soloed } } })),
  setPlaying: (isPlaying) => set({ isPlaying }),
  setCurrentTime: (currentTime) => set({ currentTime }),
  setDuration: (duration) => set({ duration }),
  setMasterVolume: (masterVolume) => set({ masterVolume }),
  setClick: (patch) => set((s) => ({ click: { ...s.click, ...patch } })),
  setGuide: (patch) => set((s) => ({ guide: { ...s.guide, ...patch } })),
  applyMix: (mix) => set({ mix }),
  reset: () =>
    set((s) => ({
      mix: {},
      isPlaying: false,
      currentTime: 0,
      duration: 0,
      // Keep transport preferences (click/guide/master) across reloads & key changes.
      masterVolume: s.masterVolume,
      click: s.click,
      guide: s.guide,
    })),
}));

/** Effective gain accounting for solo: if any stem is soloed, non-soloed are silent. */
export function effectiveGain(mix: Record<string, StemMix>, id: string): number {
  const anySolo = Object.values(mix).some((m) => m.soloed);
  const m = mix[id];
  if (!m) return 0;
  if (m.muted) return 0;
  if (anySolo && !m.soloed) return 0;
  return m.volume;
}
