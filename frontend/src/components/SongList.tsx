"use client";
import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Song, SongStatus } from "@/lib/types";
import { Badge, Card, Input } from "@/components/ui";

const STATUS_TONE: Record<SongStatus, "neutral" | "green" | "yellow" | "red"> = {
  uploaded: "neutral",
  processing: "yellow",
  ready: "green",
  failed: "red",
};

export function SongList({ orgId }: { orgId: string }) {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [includeArchived, setIncludeArchived] = useState(false);

  const queryKey = ["songs", orgId, { q, favoritesOnly, includeArchived }] as const;
  const { data: songs, isLoading } = useQuery({
    queryKey,
    queryFn: () => api.listSongs(orgId, { q, favoritesOnly, includeArchived }),
    // Poll while anything is still processing so the badge flips to "ready".
    refetchInterval: (query) =>
      query.state.data?.some((s) => s.status === "processing") ? 3000 : false,
  });

  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Song> }) =>
      api.updateSong(id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["songs", orgId] }),
  });

  const del = useMutation({
    mutationFn: (id: string) => api.deleteSong(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["songs", orgId] }),
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search songs…"
          className="max-w-xs"
        />
        <label className="flex items-center gap-1.5 text-xs text-neutral-400">
          <input
            type="checkbox"
            checked={favoritesOnly}
            onChange={(e) => setFavoritesOnly(e.target.checked)}
          />
          Favorites
        </label>
        <label className="flex items-center gap-1.5 text-xs text-neutral-400">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => setIncludeArchived(e.target.checked)}
          />
          Show archived
        </label>
      </div>

      {isLoading ? (
        <p className="text-neutral-500">Loading songs…</p>
      ) : !songs?.length ? (
        <p className="text-neutral-500">
          {q || favoritesOnly ? "No songs match." : "No songs yet — upload one above."}
        </p>
      ) : (
        <div className="grid gap-3">
          {songs.map((song) => (
            <Card
              key={song.id}
              className="flex items-center justify-between gap-3 transition hover:border-neutral-700"
            >
              <button
                onClick={() =>
                  update.mutate({ id: song.id, patch: { is_favorite: !song.is_favorite } })
                }
                title={song.is_favorite ? "Unfavorite" : "Favorite"}
                className={`text-lg leading-none ${
                  song.is_favorite
                    ? "text-yellow-400"
                    : "text-neutral-600 hover:text-neutral-400"
                }`}
              >
                {song.is_favorite ? "★" : "☆"}
              </button>

              <div className="min-w-0 flex-1">
                {song.status === "ready" ? (
                  <Link href={`/songs/${song.id}`} className="block">
                    <p className="truncate font-medium hover:text-brand">{song.title}</p>
                  </Link>
                ) : (
                  <p className="truncate font-medium">{song.title}</p>
                )}
                <p className="truncate text-xs text-neutral-500">
                  {song.original_filename}
                  {song.duration_sec ? ` · ${song.duration_sec.toFixed(1)}s` : ""}
                  {song.archived ? " · archived" : ""}
                </p>
              </div>

              <Badge tone={STATUS_TONE[song.status]}>{song.status}</Badge>
              <button
                onClick={() =>
                  update.mutate({ id: song.id, patch: { archived: !song.archived } })
                }
                className="rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-700"
              >
                {song.archived ? "Unarchive" : "Archive"}
              </button>
              <button
                onClick={() => {
                  if (
                    window.confirm(
                      `Delete "${song.title}"? This removes its stems and analysis for good.`
                    )
                  )
                    del.mutate(song.id);
                }}
                disabled={del.isPending}
                title="Delete song"
                className="rounded bg-neutral-800 px-2 py-1 text-xs text-red-300 hover:bg-neutral-700"
              >
                ✕
              </button>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
