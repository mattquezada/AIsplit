"use client";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { RoutingAssignment, RoutingData } from "@/lib/types";
import { stemMeta } from "@/lib/stems";
import { Button, Card } from "@/components/ui";

type Assignments = Record<string, RoutingAssignment>;

function pretty(type: string): string {
  return stemMeta(type).label;
}

/**
 * Sound-board / audio-interface routing for a song's stems. Each stem_type is
 * assigned an output and a console channel; the whole map can be saved as a
 * reusable venue preset (Main Sanctuary, Youth Room, …) at the org level.
 */
export function RoutingPanel({ songId, orgId }: { songId: string; orgId: string }) {
  const qc = useQueryClient();
  const [assignments, setAssignments] = useState<Assignments>({});
  const [selected, setSelected] = useState("");

  const { data: stems } = useQuery({
    queryKey: ["stems", songId, 0],
    queryFn: () => api.listStems(songId, 0),
  });
  const { data: presets } = useQuery({
    queryKey: ["routing-presets", orgId],
    queryFn: () => api.listRoutingPresets(orgId),
  });

  const stemTypes = useMemo(
    () =>
      Array.from(new Set((stems ?? []).map((s) => s.stem_type))).sort(
        (a, b) => stemMeta(a).order - stemMeta(b).order
      ),
    [stems]
  );

  // Seed sensible defaults (output N, channel N) once stems load.
  useEffect(() => {
    if (!stemTypes.length) return;
    setAssignments((prev) => {
      if (Object.keys(prev).length) return prev;
      const seed: Assignments = {};
      stemTypes.forEach((t, i) => {
        seed[t] = { output: i + 1, channel: i + 1, label: pretty(t) };
      });
      return seed;
    });
  }, [stemTypes]);

  const set = (type: string, patch: Partial<RoutingAssignment>) =>
    setAssignments((a) => ({ ...a, [type]: { ...a[type], ...patch } }));

  const save = useMutation({
    mutationFn: (name: string) => {
      const data: RoutingData = { assignments };
      return api.saveRoutingPreset(orgId, name, data);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["routing-presets", orgId] }),
  });

  const del = useMutation({
    mutationFn: (id: string) => api.deleteRoutingPreset(orgId, id),
    onSuccess: () => {
      setSelected("");
      qc.invalidateQueries({ queryKey: ["routing-presets", orgId] });
    },
  });

  function recall(id: string) {
    setSelected(id);
    const preset = presets?.find((p) => p.id === id);
    if (!preset) return;
    const next: Assignments = {};
    stemTypes.forEach((t, i) => {
      next[t] = preset.data.assignments?.[t] ?? {
        output: i + 1,
        channel: i + 1,
        label: pretty(t),
      };
    });
    setAssignments(next);
  }

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-neutral-300">Venue preset</span>
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
        <Button
          variant="subtle"
          onClick={() => {
            const name = prompt("Save routing as", "Main Sanctuary");
            if (name) save.mutate(name);
          }}
          disabled={save.isPending}
        >
          {save.isPending ? "Saving…" : "Save preset"}
        </Button>
        {selected && (
          <Button variant="danger" onClick={() => del.mutate(selected)} disabled={del.isPending}>
            Delete
          </Button>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border border-neutral-800">
        <div className="grid grid-cols-[1fr_90px_90px] gap-2 bg-neutral-900/80 px-3 py-2 text-xs uppercase tracking-wide text-neutral-500">
          <span>Stem</span>
          <span>Output</span>
          <span>Channel</span>
        </div>
        {stemTypes.length === 0 ? (
          <p className="px-3 py-4 text-sm text-neutral-500">No stems to route yet.</p>
        ) : (
          stemTypes.map((type) => {
            const a = assignments[type] ?? { output: 0, channel: 0 };
            return (
              <div
                key={type}
                className="grid grid-cols-[1fr_90px_90px] items-center gap-2 border-t border-neutral-800 px-3 py-2 text-sm"
              >
                <span className="flex items-center gap-2 font-medium">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: stemMeta(type).color }} />
                  {pretty(type)}
                </span>
                <input
                  type="number"
                  min={1}
                  max={64}
                  value={a.output}
                  onChange={(e) => set(type, { output: parseInt(e.target.value, 10) || 0 })}
                  className="w-20 rounded border border-neutral-700 bg-neutral-900 px-2 py-1"
                />
                <input
                  type="number"
                  min={1}
                  max={128}
                  value={a.channel}
                  onChange={(e) => set(type, { channel: parseInt(e.target.value, 10) || 0 })}
                  className="w-20 rounded border border-neutral-700 bg-neutral-900 px-2 py-1"
                />
              </div>
            );
          })
        )}
      </div>
      <p className="text-xs text-neutral-500">
        Outputs map stems to physical interface outs; channels map them to your
        console. Save a preset per venue to recall it on any song.
      </p>
    </Card>
  );
}
