"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { StemMixSnapshot } from "@/lib/types";
import { usePlayer, type StemMix } from "@/stores/player";

const DEFAULT: StemMix = { volume: 1, pan: 0, muted: false, soloed: false };

/**
 * Save / recall named rehearsal mixes (Drummer Mix, Vocalist Mix, …).
 * Presets are stored keyed by stem_type so they survive key changes, where
 * stems are re-rendered under new ids.
 */
export function MixPresets({
  songId,
  stems,
}: {
  songId: string;
  stems: { id: string; stem_type: string }[];
}) {
  const qc = useQueryClient();
  const mix = usePlayer((s) => s.mix);
  const applyMix = usePlayer((s) => s.applyMix);
  const [selected, setSelected] = useState("");

  const { data: presets } = useQuery({
    queryKey: ["mixes", songId],
    queryFn: () => api.listMixes(songId),
  });

  const save = useMutation({
    mutationFn: (name: string) => {
      // Collapse the current per-id mix down to per-stem_type.
      const data: Record<string, StemMixSnapshot> = {};
      for (const s of stems) {
        const m = mix[s.id] ?? DEFAULT;
        data[s.stem_type] = {
          volume: m.volume,
          pan: m.pan,
          muted: m.muted,
          soloed: m.soloed,
        };
      }
      return api.saveMix(songId, name, data);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mixes", songId] }),
  });

  const del = useMutation({
    mutationFn: (id: string) => api.deleteMix(songId, id),
    onSuccess: () => {
      setSelected("");
      qc.invalidateQueries({ queryKey: ["mixes", songId] });
    },
  });

  function recall(id: string) {
    setSelected(id);
    const preset = presets?.find((p) => p.id === id);
    if (!preset) return;
    const next: Record<string, StemMix> = {};
    for (const s of stems) {
      const snap = preset.data[s.stem_type];
      next[s.id] = snap ? { ...DEFAULT, ...snap } : { ...DEFAULT };
    }
    applyMix(next);
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="font-semibold text-neutral-300">Mix</span>
      <select
        value={selected}
        onChange={(e) => recall(e.target.value)}
        className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
      >
        <option value="">Custom…</option>
        {presets?.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <button
        onClick={() => {
          const name = prompt("Save current mix as", "Rehearsal Mix");
          if (name) save.mutate(name);
        }}
        className="rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-700"
        disabled={save.isPending}
      >
        {save.isPending ? "Saving…" : "Save mix"}
      </button>
      {selected && (
        <button
          onClick={() => del.mutate(selected)}
          className="rounded bg-neutral-800 px-2 py-1 text-xs text-red-300 hover:bg-neutral-700"
          disabled={del.isPending}
        >
          Delete
        </button>
      )}
    </div>
  );
}
