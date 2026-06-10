/**
 * Shared stem presentation — labels, colors, and ordering for the worship-style
 * track list. Keyed by stem_type so the player, routing, and export panels all
 * speak the same vocabulary. Falls back gracefully for unknown/legacy types.
 */
export interface StemMeta {
  label: string;
  color: string;
  order: number;
}

const META: Record<string, StemMeta> = {
  click: { label: "Click", color: "#a1a1aa", order: 0 },
  guide: { label: "Guide", color: "#f472b6", order: 1 },
  kick: { label: "Kick", color: "#ef4444", order: 2 },
  drums: { label: "Drums", color: "#f97316", order: 3 },
  percussion: { label: "Percussion", color: "#fb923c", order: 4 },
  bass: { label: "Bass", color: "#eab308", order: 5 },
  acoustic: { label: "Acoustic", color: "#84cc16", order: 6 },
  electric: { label: "Electric", color: "#22c55e", order: 7 },
  guitar: { label: "Electric", color: "#22c55e", order: 7 },
  keys: { label: "Keys", color: "#06b6d4", order: 8 },
  piano: { label: "Keys", color: "#06b6d4", order: 8 },
  synth: { label: "Synth / Pad", color: "#3b82f6", order: 9 },
  pad: { label: "Pad", color: "#3b82f6", order: 9 },
  other: { label: "Synth / Pad", color: "#3b82f6", order: 9 },
  lead_vocal: { label: "Lead Vocal", color: "#a855f7", order: 10 },
  vocals: { label: "Vocals", color: "#a855f7", order: 10 },
  bgv: { label: "BGV", color: "#d946ef", order: 11 },
};

function titleCase(s: string): string {
  return s
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function stemMeta(type: string): StemMeta {
  return META[type] ?? { label: titleCase(type), color: "#8b5cf6", order: 50 };
}

/** Stem types that are synthesized/spoken in the transport, not shown as tracks. */
export const SYNTHETIC_STEM_TYPES = new Set(["click", "guide"]);

/** Sort stems into the conventional console order (kick → drums → … → BGV). */
export function sortStems<T extends { stem_type: string; name?: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const oa = stemMeta(a.stem_type).order;
    const ob = stemMeta(b.stem_type).order;
    if (oa !== ob) return oa - ob;
    return (a.name ?? "").localeCompare(b.name ?? "");
  });
}
