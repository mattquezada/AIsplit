"use client";
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Setlist } from "@/lib/types";
import { useAuth } from "@/stores/auth";
import { useSession } from "@/hooks/useSession";
import { AppHeader } from "@/components/AppHeader";
import { Button, Card } from "@/components/ui";

const RANGE = Array.from({ length: 13 }, (_, i) => i - 6); // -6..+6

function keyTag(semitones: number): string {
  if (semitones === 0) return "Original";
  return `${semitones > 0 ? "+" : ""}${semitones}`;
}

export default function SetlistDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const qc = useQueryClient();
  const hasToken = useAuth((s) => s.hasToken);
  useSession();
  const [addSong, setAddSong] = useState("");

  useEffect(() => {
    if (!hasToken) router.replace("/login");
  }, [hasToken, router]);

  const { data: setlist, isLoading } = useQuery({
    queryKey: ["setlist", id],
    queryFn: () => api.getSetlist(id),
    enabled: hasToken,
  });

  // Library songs to add (ready ones), scoped to the setlist's org.
  const { data: songs } = useQuery({
    queryKey: ["songs", setlist?.org_id],
    queryFn: () => api.listSongs(setlist!.org_id),
    enabled: !!setlist?.org_id,
  });

  const onSetlist = (sl: Setlist) => qc.setQueryData(["setlist", id], sl);

  const addItem = useMutation({
    mutationFn: (songId: string) => api.addSetlistItem(id, songId),
    onSuccess: (sl) => {
      setAddSong("");
      onSetlist(sl);
    },
  });
  const updateItem = useMutation({
    mutationFn: ({ itemId, semitones }: { itemId: string; semitones: number }) =>
      api.updateSetlistItem(id, itemId, { semitones }),
    onSuccess: onSetlist,
  });
  const removeItem = useMutation({
    mutationFn: (itemId: string) => api.removeSetlistItem(id, itemId),
    onSuccess: onSetlist,
  });
  const reorder = useMutation({
    mutationFn: (itemIds: string[]) => api.reorderSetlist(id, itemIds),
    onSuccess: onSetlist,
  });
  const remove = useMutation({
    mutationFn: () => api.deleteSetlist(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["setlists"] });
      router.push("/setlists");
    },
  });

  function move(index: number, dir: -1 | 1) {
    if (!setlist) return;
    const ids = setlist.items.map((i) => i.id);
    const j = index + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    reorder.mutate(ids);
  }

  if (!hasToken) return null;

  return (
    <main className="min-h-screen">
      <AppHeader />
      <div className="mx-auto max-w-3xl space-y-6 p-6">
        <Link href="/setlists" className="text-sm text-neutral-400 hover:text-neutral-100">
          ← All service plans
        </Link>

        {isLoading || !setlist ? (
          <p className="text-neutral-500">Loading…</p>
        ) : (
          <>
            <div className="flex items-start justify-between">
              <div>
                <h1 className="text-2xl font-semibold">{setlist.name}</h1>
                {setlist.service_date && (
                  <p className="text-sm text-neutral-500">{setlist.service_date}</p>
                )}
              </div>
              <Button variant="danger" onClick={() => remove.mutate()}>
                Delete plan
              </Button>
            </div>

            <Card>
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex-1">
                  <label className="mb-1 block text-xs uppercase tracking-wide text-neutral-400">
                    Add a song
                  </label>
                  <select
                    value={addSong}
                    onChange={(e) => setAddSong(e.target.value)}
                    className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-2 py-2 text-sm"
                  >
                    <option value="">Choose a song…</option>
                    {songs
                      ?.filter((s) => s.status === "ready")
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.title}
                        </option>
                      ))}
                  </select>
                </div>
                <Button
                  onClick={() => addSong && addItem.mutate(addSong)}
                  disabled={!addSong || addItem.isPending}
                >
                  Add
                </Button>
              </div>
            </Card>

            {setlist.items.length === 0 ? (
              <p className="text-neutral-500">No songs yet — add one above.</p>
            ) : (
              <ol className="space-y-2">
                {setlist.items.map((item, index) => (
                  <li key={item.id}>
                    <Card className="flex items-center gap-3">
                      <span className="w-6 text-center font-mono text-sm text-neutral-500">
                        {index + 1}
                      </span>
                      <div className="flex flex-col">
                        <button
                          onClick={() => move(index, -1)}
                          disabled={index === 0}
                          className="text-xs text-neutral-500 hover:text-neutral-200 disabled:opacity-30"
                        >
                          ▲
                        </button>
                        <button
                          onClick={() => move(index, 1)}
                          disabled={index === setlist.items.length - 1}
                          className="text-xs text-neutral-500 hover:text-neutral-200 disabled:opacity-30"
                        >
                          ▼
                        </button>
                      </div>
                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/songs/${item.song_id}`}
                          className="truncate font-medium hover:text-brand"
                        >
                          {item.song_title ?? "Untitled"}
                        </Link>
                      </div>
                      <div className="flex items-center gap-1 text-xs text-neutral-400">
                        <span>Key</span>
                        <select
                          value={item.semitones}
                          onChange={(e) =>
                            updateItem.mutate({
                              itemId: item.id,
                              semitones: parseInt(e.target.value, 10),
                            })
                          }
                          className="rounded border border-neutral-700 bg-neutral-900 px-1.5 py-1"
                        >
                          {RANGE.map((s) => (
                            <option key={s} value={s}>
                              {keyTag(s)}
                            </option>
                          ))}
                        </select>
                      </div>
                      <button
                        onClick={() => removeItem.mutate(item.id)}
                        className="rounded bg-neutral-800 px-2 py-1 text-xs text-red-300 hover:bg-neutral-700"
                      >
                        Remove
                      </button>
                    </Card>
                  </li>
                ))}
              </ol>
            )}
          </>
        )}
      </div>
    </main>
  );
}
