"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Marker } from "@/lib/types";
import { Card } from "@/components/ui";

function fmt(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// Quick-add palette of common worship arrangement sections.
const PALETTE = ["Intro", "Verse", "Pre-Chorus", "Chorus", "Bridge", "Instrumental", "Tag", "Outro"];
// Parts that usually repeat get auto-numbered (Verse 1, Verse 2, …).
const REPEATABLE = new Set(["Verse", "Chorus", "Pre-Chorus", "Instrumental", "Tag"]);

/** Next label for `base`, numbering repeatable parts and de-duping the rest. */
function nextLabel(base: string, existing: string[]): string {
  const re = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&")}(\\s+\\d+)?$`);
  const matches = existing.filter((l) => re.test(l));
  if (REPEATABLE.has(base)) return `${base} ${matches.length + 1}`;
  if (matches.length === 0) return base;
  return `${base} ${matches.length + 1}`;
}

/**
 * Custom sections: add named parts (Verse / Chorus / Bridge …), lay them out by
 * position, rename, and delete. Persisted as section markers on the server, so
 * they drive the section ribbon and the spoken guide track.
 */
export function SectionManager({
  songId,
  currentTime,
  duration,
  onSeek,
}: {
  songId: string;
  currentTime: number;
  duration: number;
  onSeek: (t: number) => void;
}) {
  const qc = useQueryClient();
  const { data: markers } = useQuery({
    queryKey: ["markers", songId],
    queryFn: () => api.listMarkers(songId),
  });
  const sections = (markers ?? [])
    .filter((m) => m.kind === "section")
    .sort((a, b) => a.position_sec - b.position_sec);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["markers", songId] });
    qc.invalidateQueries({ queryKey: ["guide", songId] });
  };

  const add = useMutation({
    mutationFn: (base: string) => {
      const label = nextLabel(base, sections.map((s) => s.label));
      return api.createMarker(songId, {
        position_sec: Math.min(currentTime, duration),
        label,
        kind: "section",
      });
    },
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Marker> }) =>
      api.updateMarker(songId, id, patch),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteMarker(songId, id),
    onSuccess: invalidate,
  });

  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-neutral-300">Sections</h3>
        <button
          onClick={() => add.mutate("Section")}
          disabled={add.isPending}
          className="rounded-md bg-brand px-2.5 py-1 text-xs font-medium text-brand-fg hover:bg-violet-600"
          title={`Cut a new part at ${fmt(currentTime)}`}
        >
          ✂ Split at {fmt(currentTime)}
        </button>
      </div>

      {/* Quick-add palette */}
      <div className="flex flex-wrap gap-1.5">
        {PALETTE.map((label) => (
          <button
            key={label}
            onClick={() => add.mutate(label)}
            disabled={add.isPending}
            className="rounded-full border border-neutral-700 bg-neutral-900 px-2.5 py-1 text-xs text-neutral-300 hover:border-brand hover:text-neutral-100"
          >
            + {label}
          </button>
        ))}
      </div>

      {sections.length === 0 ? (
        <p className="text-sm text-neutral-500">
          No sections yet — move the playhead and tap a label above to drop one.
        </p>
      ) : (
        <ol className="space-y-1.5">
          {sections.map((s, i) => (
            <li
              key={s.id}
              className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-900/40 px-2 py-1.5"
            >
              <span className="w-5 text-center font-mono text-xs text-neutral-500">{i + 1}</span>
              <input
                defaultValue={s.label}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== s.label) update.mutate({ id: s.id, patch: { label: v } });
                }}
                className="w-full rounded border border-transparent bg-transparent px-1.5 py-1 text-sm hover:border-neutral-700 focus:border-brand focus:outline-none"
              />
              <div className="flex items-center gap-1">
                <button
                  onClick={() => update.mutate({ id: s.id, patch: { position_sec: Math.min(currentTime, duration) } })}
                  title="Move to playhead"
                  className="rounded bg-neutral-800 px-1.5 py-1 text-[11px] text-neutral-300 hover:bg-neutral-700"
                >
                  ⌖
                </button>
                <button
                  onClick={() => onSeek(s.position_sec)}
                  className="rounded bg-neutral-800 px-2 py-1 font-mono text-[11px] tabular-nums text-neutral-300 hover:bg-neutral-700"
                  title="Jump here"
                >
                  {fmt(s.position_sec)}
                </button>
              </div>
              <button
                onClick={() => remove.mutate(s.id)}
                className="rounded bg-neutral-800 px-1.5 py-1 text-[11px] text-red-300 hover:bg-neutral-700"
                title="Delete section"
              >
                ✕
              </button>
            </li>
          ))}
        </ol>
      )}
      <p className="text-xs text-neutral-500">
        Sections drive the timeline ribbon and the spoken guide. Use ⌖ to pin one to
        the current playhead position.
      </p>
    </Card>
  );
}
